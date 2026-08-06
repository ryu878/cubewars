// EPIC 15 Story 15.2 regression/evidence script
// (`docs/tasks/epic-15-fire-input-debounce-fix.md`): reproduces the exact
// live drop-rate measurement methodology Critic used to discover this
// defect during EPIC 14's review (`docs/tasks/epic-14-critic-review.md`
// F-001) — a real client's independently-timed `input` stream colliding
// with its independently-timed `fire` clicks inside the old shared
// per-connection debounce, silently dropping fire attempts before they ever
// reached the server's own separate per-weapon fire-cooldown gate.
//
// Faithfully mirrors the real client's architecture (all constants read
// from/confirmed against the real source, not assumed):
//   - `input` stream: an independent `setInterval` at INPUT_SEND_INTERVAL_MS
//     = 33, matching client/src/main.ts's real INPUT_SEND_INTERVAL_MS.
//   - `fire` stream: a SEPARATE, independently-timed clock (self-scheduling
//     via setTimeout with a randomized 550-650ms gap each time, never a
//     fixed period phase-locked to the input timer) — mirrors a real DOM
//     "click" handler's total lack of synchronization with the input loop
//     (client/src/fpsController.ts). The 550ms floor keeps the per-weapon
//     fire cooldown (pistol = 500ms, shared/src/weapons.ts) from ever being
//     the limiting factor in what this script measures.
//
// This script is self-contained and re-runnable: it spawns its OWN fresh
// server subprocess (tsx server/src/index.ts) on a dedicated port distinct
// from the normal dev-server port, in "public" mode with no bots (avoids
// the death confound Critic's own methodology avoided — a dead player can't
// fire, which would look like a false drop). Capturing that subprocess's
// own stdout is also how the true-flood case (Case 3 below) verifies the
// server-side aggregate/throttled log line count, not just client-visible
// accept/reject behavior.
//
// Run: node scripts/regression-fire-input-drop-rate.mjs
// (or `npm run regression:fire-input-drop-rate` from the repo root)
//
// Exits non-zero if:
//   - the real-architecture simulation's (Case 2) drop rate exceeds
//     DROP_RATE_TOLERANCE (documented below), or
//   - the true-flood case (Case 3) fails to bound accepted throughput, or
//   - the aggregate flood-guard log line count is not O(1).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const SERVER_PORT = 7778; // deliberately distinct from the normal 7777 dev port
const WS_URL = `ws://localhost:${SERVER_PORT}`;

// Matches client/src/main.ts INPUT_SEND_INTERVAL_MS exactly (confirmed by
// reading that file — see the doc comment above).
const INPUT_SEND_INTERVAL_MS = 33;

// Independent fire clock: each next fire is scheduled 550-650ms after the
// previous one, uncorrelated with the 33ms input timer's phase. Comfortably
// above the pistol's 500ms cooldown (shared/src/weapons.ts) so the cooldown
// gate is never what's being measured here.
const FIRE_GAP_MIN_MS = 550;
const FIRE_GAP_JITTER_MS = 100;

const CASE_A_DURATION_MS = 10_000; // control: fire-only
const CASE_B_DURATION_MS = 15_000; // real-architecture simulation

// New rolling-window cap (server/src/index.ts) — mirrored here only for
// reporting/sanity math, not hardcoded into the pass/fail assertions below
// beyond "accepted stays roughly bounded near this order of magnitude".
const MAX_MESSAGES_PER_WINDOW = 100;
const FLOOD_WINDOW_MS = 1000;
// Mirrors server/src/index.ts FLOOD_LOG_INTERVAL_MS (createDropTracker's
// throttle interval) — used only for reporting/sanity math below, see
// runTrueFloodCase's doc comment for why this value matters to the flood
// test's methodology.
const FLOOD_LOG_INTERVAL_MS_REF = 5000;

// "After" acceptance tolerance (Story 15.2 AC): allow a small amount of
// ordinary network/scheduling noise, not a hard mathematical zero.
const DROP_RATE_TOLERANCE = 0.02;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- server subprocess lifecycle -------------------------------------------

function startServer() {
  return new Promise((resolve, reject) => {
    const tsxBin = join(REPO_ROOT, "node_modules", ".bin", "tsx");
    const child = spawn(tsxBin, ["server/src/index.ts"], {
      cwd: REPO_ROOT,
      env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const logLines = [];
    let ready = false;
    const onData = (buf) => {
      const text = buf.toString();
      for (const line of text.split("\n")) {
        if (line.trim().length === 0) continue;
        logLines.push({ t: Date.now(), line });
      }
      if (!ready && text.includes("cubewars game server listening")) {
        ready = true;
        resolve({ child, logLines });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`server subprocess exited before becoming ready (code ${code})`));
    });

    setTimeout(() => {
      if (!ready) reject(new Error("server subprocess did not become ready within 8s"));
    }, 8000);
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGINT");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
      resolve();
    }, 3000);
  });
}

// --- WS puppet helpers (matches this repo's established qa-epic*/regression scripts) ---

function connect(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { label, ws, playerId: null, messages: [] };
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      state.messages.push(msg);
      if (msg.type === "welcome") state.playerId = msg.playerId;
    });
    ws.on("open", () => {
      const check = setInterval(() => {
        if (state.playerId) {
          clearInterval(check);
          resolve(state);
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        if (!state.playerId) reject(new Error(`${label}: no welcome received`));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

function joinPublic(state) {
  state.ws.send(JSON.stringify({ type: "join", mode: "public", nickname: `Load${state.playerId.slice(0, 6)}` }));
}

async function waitForJoinAccepted(state) {
  for (let i = 0; i < 100; i++) {
    if (state.messages.some((message) => message.type === "join_accepted")) return;
    const rejection = state.messages.find((message) => message.type === "join_rejected");
    if (rejection) throw new Error(`${state.label}: join rejected (${rejection.reason})`);
    await sleep(30);
  }
  throw new Error(`${state.label}: join_accepted timed out`);
}

function countFireBroadcastEchoes(state) {
  return state.messages.filter((m) => m.type === "fire_broadcast" && m.shooterId === state.playerId).length;
}

/** Runs an independently-clocked `fire` stream for `durationMs`, self-scheduling each next attempt via a randomized 350-450ms gap (never a fixed period), and returns the number of fire attempts actually sent. */
async function runFireClock(state, durationMs) {
  let sent = 0;
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    state.ws.send(JSON.stringify({ type: "fire" }));
    sent += 1;
    const gap = FIRE_GAP_MIN_MS + Math.random() * FIRE_GAP_JITTER_MS;
    await sleep(gap);
  }
  return sent;
}

/** Starts an independent `input` setInterval at INPUT_SEND_INTERVAL_MS, matching the real client's own uncorrelated timer — returns a stop() function. */
function startInputTimer(state) {
  let sent = 0;
  const timer = setInterval(() => {
    state.ws.send(
      JSON.stringify({ type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false }),
    );
    sent += 1;
  }, INPUT_SEND_INTERVAL_MS);
  return {
    stop: () => {
      clearInterval(timer);
      return sent;
    },
  };
}

// --- Case 1: control (fire-only, no competing input stream) ---------------

async function runControlCase() {
  console.log("\n=== Case 1: control (fire-only, no competing input stream) ===");
  const p = await connect("Control");
  joinPublic(p);
  await waitForJoinAccepted(p);
  await sleep(300);

  const sent = await runFireClock(p, CASE_A_DURATION_MS);
  await sleep(500); // let the last fire_broadcast arrive
  const received = countFireBroadcastEchoes(p);
  const dropRate = sent > 0 ? 1 - received / sent : 0;

  console.log(`[control] fire attempts sent=${sent} received=${received} dropRate=${(dropRate * 100).toFixed(1)}%`);
  p.ws.close();
  return { sent, received, dropRate };
}

// --- Case 2: real-architecture simulation (competing input timer + independent fire clicks) ---

async function runRealArchitectureCase() {
  console.log("\n=== Case 2: real-architecture simulation (33ms input timer + independent fire clock) ===");
  const p = await connect("RealArchitecture");
  joinPublic(p);
  await waitForJoinAccepted(p);
  await sleep(300);

  const inputTimer = startInputTimer(p);
  const fireSentPromise = runFireClock(p, CASE_B_DURATION_MS);
  const sent = await fireSentPromise;
  const inputSent = inputTimer.stop();
  await sleep(500); // let the last fire_broadcast arrive

  const received = countFireBroadcastEchoes(p);
  const dropRate = sent > 0 ? 1 - received / sent : 0;

  console.log(
    `[real-architecture] input messages sent=${inputSent}, fire attempts sent=${sent} received=${received} ` +
      `dropRate=${(dropRate * 100).toFixed(1)}%`,
  );
  p.ws.close();
  return { sent, received, dropRate, inputSent };
}

// --- Case 3: true flood — a single shape flooded far past the new cap -----

/** Parses this connection's playerId out of every "[server] flood guard: dropped N message(s) from <playerId> ..." line captured from the server subprocess's own stdout since `sinceIndex`, returning the total dropped count and the number of distinct log LINES (the O(1) aggregate-logging proof). */
function analyzeFloodGuardLog(logLines, sinceIndex, playerId) {
  const re = new RegExp(`\\[server\\] flood guard: dropped (\\d+) message\\(s\\) from ${playerId} `);
  let totalDropped = 0;
  let lineCount = 0;
  for (let i = sinceIndex; i < logLines.length; i++) {
    const m = logLines[i].line.match(re);
    if (m) {
      totalDropped += Number(m[1]);
      lineCount += 1;
    }
  }
  return { totalDropped, lineCount };
}

function floodPayload(shape) {
  if (shape === "input") return JSON.stringify({ type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false });
  if (shape === "unknown-type") return JSON.stringify({ type: "totally-bogus-type-does-not-exist" });
  if (shape === "non-json") return "this is not valid JSON {{{";
  throw new Error(`unknown flood shape: ${shape}`);
}

// `createDropTracker` (server/src/index.ts, untouched by EPIC 15) logs the
// FIRST drop immediately, then throttles: it stays silent for up to
// FLOOD_LOG_INTERVAL_MS (5000ms) while accumulating a silent per-connection
// count, only flushing that accumulated count in the NEXT log line once the
// throttle interval has elapsed. A flood burst shorter than
// FLOOD_LOG_INTERVAL_MS therefore only ever produces ONE log line whose
// embedded count (1, the very first violation) is NOT the true total
// dropped — that's a real, correct property of the untouched aggregate-
// logging pattern (it exists specifically to avoid O(message count) log
// spam / event-loop stall risk), not something this EPIC may change. To
// read a real, accurate "true total dropped" number back out of the log
// (rather than just the trivial first-violation count), this flood must be
// SUSTAINED past the FLOOD_LOG_INTERVAL_MS boundary at a rate well above
// MAX_MESSAGES_PER_WINDOW/FLOOD_WINDOW_MS, so a second, later violation
// triggers a real flush of everything accumulated since the first log line.
const FLOOD_SUSTAIN_MS = 6500; // > FLOOD_LOG_INTERVAL_MS (5000ms), guarantees at least one flush
const FLOOD_BATCH_SIZE = 20;
const FLOOD_BATCH_INTERVAL_MS = 10; // ~2000 msgs/sec nominal send rate — far above the 100/sec cap

async function runTrueFloodCase(logLines, shape) {
  console.log(`\n=== Case 3 (${shape}): true flood — sustained tight loop, single message shape ===`);
  const p = await connect(`Flood-${shape}`);
  joinPublic(p);
  await waitForJoinAccepted(p);
  await sleep(300);

  const sinceIndex = logLines.length;
  const payload = floodPayload(shape);
  let sent = 0;

  const start = Date.now();
  while (Date.now() - start < FLOOD_SUSTAIN_MS) {
    for (let i = 0; i < FLOOD_BATCH_SIZE; i++) {
      p.ws.send(payload);
      sent += 1;
    }
    await sleep(FLOOD_BATCH_INTERVAL_MS);
  }
  const sendElapsedMs = Date.now() - start;

  // Let the server finish processing/logging the tail of the flood.
  await sleep(1000);

  const { totalDropped, lineCount } = analyzeFloodGuardLog(logLines, sinceIndex, p.playerId);
  // totalDropped is a real (possibly slightly conservative — see doc comment
  // above) count read directly from the server's own aggregate log lines,
  // not assumed. accepted is computed as sent - totalDropped, which is a
  // safe UPPER bound on true accepted (any as-yet-unflushed silent tail
  // undercounts totalDropped, which can only overstate accepted here, never
  // understate it — so a passing "accepted is bounded" result below is never
  // a false pass).
  const accepted = sent - totalDropped;

  console.log(
    `[flood:${shape}] sent=${sent} over ~${sendElapsedMs}ms (sustained, well past the ${FLOOD_LOG_INTERVAL_MS_REF}ms log-throttle boundary), ` +
      `flood-guard-reported dropped=${totalDropped}, accepted (upper bound)=${accepted}, ` +
      `aggregate log lines for this connection=${lineCount}`,
  );

  p.ws.close();
  return { shape, sent, totalDropped, accepted, lineCount, sendElapsedMs };
}

// --- main -------------------------------------------------------------------

async function main() {
  console.log(`[regression] spawning fresh server subprocess on port ${SERVER_PORT}...`);
  const { child, logLines } = await startServer();
  console.log("[regression] server ready.");

  let anyFailed = false;
  try {
    const control = await runControlCase();
    const real = await runRealArchitectureCase();
    const floodInput = await runTrueFloodCase(logLines, "input");
    const floodUnknown = await runTrueFloodCase(logLines, "unknown-type");

    console.log("\n=== SUMMARY ===");
    console.log(
      JSON.stringify(
        {
          control: { sent: control.sent, received: control.received, dropRatePct: +(control.dropRate * 100).toFixed(2) },
          realArchitecture: {
            inputSent: real.inputSent,
            fireSent: real.sent,
            fireReceived: real.received,
            dropRatePct: +(real.dropRate * 100).toFixed(2),
          },
          trueFlood: [floodInput, floodUnknown].map((f) => ({
            shape: f.shape,
            sent: f.sent,
            accepted: f.accepted,
            dropped: f.totalDropped,
            aggregateLogLines: f.lineCount,
          })),
        },
        null,
        2,
      ),
    );

    // --- Assertions ---

    // Case 1 sanity: harness itself must be sound (fire-only, no competing
    // traffic) — expect a small drop rate, comfortably inside tolerance.
    if (control.dropRate > DROP_RATE_TOLERANCE) {
      console.log(
        `\nFAIL: control case drop rate ${(control.dropRate * 100).toFixed(1)}% exceeds tolerance ` +
          `${(DROP_RATE_TOLERANCE * 100).toFixed(1)}% — the measurement harness itself may be unsound.`,
      );
      anyFailed = true;
    } else {
      console.log(`\nPASS: control case drop rate ${(control.dropRate * 100).toFixed(1)}% is within tolerance.`);
    }

    // Case 2: the actual claim under test — real-architecture concurrent
    // traffic must no longer collide inside the (now shape-agnostic,
    // count-based) flood guard.
    if (real.dropRate > DROP_RATE_TOLERANCE) {
      console.log(
        `\nFAIL: real-architecture drop rate ${(real.dropRate * 100).toFixed(1)}% exceeds tolerance ` +
          `${(DROP_RATE_TOLERANCE * 100).toFixed(1)}% — the fix did not eliminate the cross-type collision.`,
      );
      anyFailed = true;
    } else {
      console.log(
        `PASS: real-architecture drop rate ${(real.dropRate * 100).toFixed(1)}% is at/near 0%, ` +
          `within the ${(DROP_RATE_TOLERANCE * 100).toFixed(1)}% tolerance.`,
      );
    }

    // Case 3: anti-flood protection must still be intact — a tight flood of
    // a single shape, well past MAX_MESSAGES_PER_WINDOW, must still get
    // dropped/bounded (not accepted wholesale), and the aggregate/throttled
    // logging pattern must still produce O(1) log lines regardless of how
    // many thousands of messages were dropped.
    for (const flood of [floodInput, floodUnknown]) {
      const bounded = flood.accepted < flood.sent * 0.5 && flood.totalDropped > 0;
      const aggregateLogging = flood.lineCount <= 3; // well under FLOOD_COUNT; proves O(1), not O(message count)
      if (!bounded) {
        console.log(
          `\nFAIL: true-flood case (${flood.shape}) did not bound accepted throughput ` +
            `(sent=${flood.sent}, accepted=${flood.accepted}, dropped=${flood.totalDropped}).`,
        );
        anyFailed = true;
      } else {
        console.log(
          `PASS: true-flood case (${flood.shape}) bounded accepted throughput ` +
            `(sent=${flood.sent}, accepted=${flood.accepted}, dropped=${flood.totalDropped}).`,
        );
      }
      if (!aggregateLogging) {
        console.log(
          `\nFAIL: true-flood case (${flood.shape}) produced ${flood.lineCount} flood-guard log lines ` +
            `for ${flood.sent} dropped messages — not O(1) aggregate logging.`,
        );
        anyFailed = true;
      } else {
        console.log(
          `PASS: true-flood case (${flood.shape}) produced only ${flood.lineCount} aggregate flood-guard log line(s) ` +
            `despite ${flood.totalDropped} dropped messages (O(1), matches FLOOD_LOG_INTERVAL_MS throttling).`,
        );
      }
    }
  } finally {
    console.log("\n[regression] stopping server subprocess...");
    await stopServer(child);
  }

  if (anyFailed) {
    console.log("\n[regression] FAIL: one or more cases did not meet Story 15.2 acceptance criteria.");
    process.exit(1);
  }
  console.log("\n[regression] ALL CASES PASSED.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[regression] script crashed:", err);
  process.exit(2);
});
