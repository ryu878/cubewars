// EPIC 12 Programmer self-check (Pusya): NOT the formal Tester QA pass — a
// visual sanity check before handoff. Captures a player jumping onto a
// crate and standing on top (camera visibly elevated), walking off the
// edge and falling back down, and a ground-level-approach-still-blocked
// regression screenshot.
//
// Reuses the navigation/puppet patterns established in
// scripts/qa-epic11-programmer-selfcheck.mjs (same pointer-lock/CDP
// movementX limitation: the page's yaw stays fixed at spawn's yaw=0, i.e.
// facing world -z/"south" — navigation is via discrete WASD holds relative
// to that fixed forward: W = -z, S = +z, A = -x, D = +x).
//
// Targets crate_a1 (Site A, 2x2, center x=-38,z=-6) if spawned on the west
// side (x<0), or its mirror crate_b1 (Site B, 2x2, center x=38,z=6)
// otherwise — approaching from the side nearer to spawn, per the
// hold-forward-then-release-mid-flight mount technique measured by
// scripts/regression-crate-mount.ts (a literal "hold forward the entire
// jump" does NOT land on top at these numbers — see that script's
// top-of-file comment for the full explanation).

import { chromium } from "playwright";
import WebSocket from "ws";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
const WS_URL = "ws://localhost:7777";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-12-programmer-selfcheck";

const MOVE_SPEED = 13.3; // MOVEMENT.maxSpeed
const JUMP_SPEED = 7.5; // MOVEMENT.jumpSpeed
const GRAVITY = 18; // MOVEMENT.gravity
const CRATE_HEIGHT = 1.2;
const PLAYER_RADIUS = 0.4;

await mkdir(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connectPuppet(label) {
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
          ws.send(JSON.stringify({ type: "join", mode: "public" }));
          resolve(state);
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        if (!state.playerId) reject(new Error(`${label}: no welcome`));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

function resolvePosFull(observer, shortId) {
  const worldStates = observer.messages.filter((m) => m.type === "world_state");
  const last = worldStates[worldStates.length - 1];
  const p = last ? (last.players.find((p) => p.id.startsWith(shortId)) ?? null) : null;
  return p ? { position: p.position, health: p.health, alive: p.alive, worldStateCount: worldStates.length } : null;
}

function resolvePos(observer, shortId) {
  const full = resolvePosFull(observer, shortId);
  return full ? full.position : null;
}

async function main() {
  console.log(`[selfcheck] navigating to ${CLIENT_URL}`);
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });

  const statusText = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const shortId = statusText.match(/player ([0-9a-f]{8})/)?.[1];
  if (!shortId) throw new Error("could not read player short id from status bar");
  console.log("[selfcheck] status:", statusText);

  await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await page.click("#modePublicBtn");
  await page.waitForTimeout(300);
  console.log("[selfcheck] joined Multiplayer (public)");

  const box = await page.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  console.log("[selfcheck] pointer locked:", locked);

  const observer = await connectPuppet("Observer");
  await sleep(300);

  const spawnPos = resolvePos(observer, shortId);
  if (!spawnPos) throw new Error("could not resolve spawn position from observer world_state");
  console.log("[selfcheck] spawn position:", spawnPos);

  // Pick the nearer 2x2 crate + approach direction depending which site we
  // spawned on. West-side (x<0): crate_a1 (-38,-6), approached from the
  // east moving -x (hold "A"). East-side (x>=0): crate_b1 (38,6), mirrored,
  // approached from the west moving +x (hold "D").
  const west = spawnPos.x < 0;
  const crateCenter = west ? { x: -38, z: -6 } : { x: 38, z: 6 };
  const approachKey = west ? "KeyA" : "KeyD"; // -x or +x
  const blockedEdgeX = west ? crateCenter.x + 1 + PLAYER_RADIUS : crateCenter.x - 1 - PLAYER_RADIUS; // crate half-width 1 (2x2)
  const zAdjustKey = crateCenter.z > spawnPos.z ? "KeyS" : "KeyW"; // S = +z, W = -z

  console.log(
    `[selfcheck] targeting crate at (${crateCenter.x}, ${crateCenter.z}), approach key=${approachKey}, blocked edge x=${blockedEdgeX}`,
  );

  // Note: this sandboxed environment runs the dev server (tsx watch) and a
  // software-rendered (swiftshader) headless Chromium on the same machine —
  // under CPU contention the server's setInterval-based 20Hz tick loop can
  // fall behind and then burst-catch-up several ticks back-to-back once CPU
  // frees up, which breaks any navigation phase that assumes real elapsed
  // wall-clock time maps 1:1 to distance covered. To stay robust against
  // that, phases 1-2 below POLL the observer's actual reported position
  // (not a precomputed hold duration) and release the key once the target
  // is reached/settled, rather than trusting a fixed timeout.
  async function holdKeyUntil(key, isDone, maxPolls = 200, pollMs = 50) {
    await page.keyboard.down(key);
    let last = null;
    for (let i = 0; i < maxPolls; i++) {
      await page.waitForTimeout(pollMs);
      const p = resolvePos(observer, shortId);
      if (p && isDone(p, last)) {
        last = p;
        break;
      }
      last = p;
    }
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
    return resolvePos(observer, shortId);
  }

  // Z-alignment has no natural wall/crate stop, so a single long continuous
  // hold is vulnerable to the CPU-contention burst-catch-up described above
  // (a stalled server tick loop firing many fixed-dt ticks back-to-back once
  // CPU frees up, overshooting past the intended target between two polls).
  // Bound the worst case per attempt by pulsing in short bounded bursts
  // instead of one long hold, re-checking position after every pulse.
  async function pulseKeyUntil(key, isDone, pulseMs = 120, maxPulses = 60) {
    let p = resolvePos(observer, shortId);
    for (let i = 0; i < maxPulses && !isDone(p); i++) {
      await page.keyboard.down(key);
      await page.waitForTimeout(pulseMs);
      await page.keyboard.up(key);
      await page.waitForTimeout(80);
      p = resolvePos(observer, shortId);
    }
    return p;
  }

  // --- Phase 1: align Z to the crate's center (pulsed, see above) ---
  console.log(`[selfcheck] aligning z: pulsing ${zAdjustKey} until z within 1m of ${crateCenter.z}`);
  const posAfterZAlign = await pulseKeyUntil(zAdjustKey, (p) => p && Math.abs(p.z - crateCenter.z) < 1);
  console.log("[selfcheck] position after z-align:", posAfterZAlign);

  // --- Phase 2: run toward the crate (approach key) until settled against
  // its blocked edge (case (a) ground-level-still-blocked regression
  // evidence) — poll until x stops changing between consecutive samples
  // (pinned against the crate) or is within 0.05m of the expected blocked
  // edge. ---
  console.log(`[selfcheck] approaching crate: holding ${approachKey} until pinned near blocked edge x=${blockedEdgeX}`);
  const posAtEdge = await holdKeyUntil(
    approachKey,
    (p, prev) => Math.abs(p.x - blockedEdgeX) < 0.05 || (prev && Math.abs(p.x - prev.x) < 1e-6),
  );
  console.log("[selfcheck] position settled at crate edge (approach key released after settling), no jump yet:", posAtEdge);
  await page.screenshot({ path: `${OUT_DIR}/01-ground-level-blocked-regression.png` });

  // Brief idle pause with no key/browser activity so any tick-loop backlog
  // from the CPU-contended sandbox (see holdKeyUntil()'s doc comment above)
  // clears before the timing-sensitive jump window below.
  await page.waitForTimeout(500);

  // --- Phase 3: jump, KEEP holding the approach key from the jump moment
  // through ~400ms total (inside the measured working window of
  // scripts/regression-crate-mount.ts: for a 2x2 crate, releasing forward
  // anywhere between ticks 6-9 after the jump tick, i.e. ~350-500ms of
  // TOTAL held-forward time from the jump, lands on top — releasing much
  // earlier, e.g. after only ~150-180ms, is BEFORE that window and
  // undershoots, landing back at the same spot instead of on the crate),
  // then release to land on top. Re-presses approachKey (holdKeyUntil()
  // above already released it once settled) together with Space on the
  // same tick, matching a real "run + jump" press. ---
  const lockedBeforeJump = await page.evaluate(() => document.pointerLockElement !== null);
  console.log("[selfcheck] pointer locked before jump phase:", lockedBeforeJump);
  const aliveBefore = resolvePosFull(observer, shortId);
  console.log("[selfcheck] full player state before jump:", aliveBefore);
  await page.keyboard.down(approachKey);
  await page.keyboard.down("Space");
  await page.waitForTimeout(30);
  await page.keyboard.up("Space");
  await page.waitForTimeout(370); // keep holding approachKey for the rest of the ~400ms working window
  await page.keyboard.up(approachKey);
  for (let i = 0; i < 9; i++) {
    await page.waitForTimeout(100);
    console.log(`[selfcheck] +${(i + 1) * 100}ms after jump attempt:`, resolvePosFull(observer, shortId));
  }

  const posOnTop = resolvePos(observer, shortId);
  console.log("[selfcheck] position after jump attempt:", posOnTop, `(expect y close to ${CRATE_HEIGHT})`);
  await page.screenshot({ path: `${OUT_DIR}/02-crate-mount-attempt.png` });

  // --- Phase 4: walk off the mounted crate's edge (if mounted) and fall
  // back down — pulsed (see pulseKeyUntil() doc comment above), poll until
  // y returns to (near) 0. ---
  const posAfterWalkoff = await pulseKeyUntil(approachKey, (p) => p && p.y <= 0.01, 120, 20);
  console.log("[selfcheck] position after walking off:", posAfterWalkoff, "(expect y back to 0)");
  await page.screenshot({ path: `${OUT_DIR}/03-walked-off-edge.png` });

  console.log("\n[selfcheck] console errors so far:", consoleErrors.length);
  for (const e of consoleErrors) console.log("  -", e);

  await browser.close();
  observer.ws.close();

  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        spawnPos,
        crateCenter,
        posAtEdge,
        posOnTop,
        posAfterWalkoff,
        mountedOnTop: posOnTop ? Math.abs(posOnTop.y - CRATE_HEIGHT) < 0.05 : false,
        consoleErrorCount: consoleErrors.length,
        outDir: OUT_DIR,
      },
      null,
      2,
    ),
  );

  process.exit(consoleErrors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[selfcheck] script crashed:", err);
  process.exit(2);
});
