// EPIC 32 live verification: real browser client + real WebSocket server +
// real Redis-backed economy, joining an actual "vs Bots" match. Confirms
// killing a bot grants zero gold to the human killer:
//   (a) server log has no "[economy] gold minted" line for that kill
//       (a "[economy] kill vs bot victim -> no reward" line instead), and
//   (b) the client's own goldHud (#goldValue, driven only by
//       economy_profile/economy_gold_update — see combatHud.ts) does not
//       change across the kill (explicit before/after read-out below).
//
// Aiming/firing at the bot is driven through the SAME real WebSocket
// connection the client itself opened (not synthetic mouse events) —
// instrumented via a page-level WebSocket subclass that both records every
// inbound message (for world_state / kill / economy_* inspection) and
// exposes .send() on the live instance, exactly like qa-epic18-hold-fire.mjs
// instruments inbound traffic. This reliably lands a kill against the AI's
// authoritative server position without depending on flaky headless mouse
// aiming, while every hit/kill/gold decision is still resolved entirely
// server-side (the client only sends input/fire intents, same protocol a
// real player's browser would send).

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const SERVER_PORT = 7780;
const CLIENT_PORT = 5196;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-32");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForReady(child, label, marker) {
  return new Promise((resolve, reject) => {
    let ready = false;
    const onData = (buf) => {
      const text = buf.toString();
      if (!ready && text.includes(marker)) {
        ready = true;
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`${label} exited before ready (code ${code})`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error(`${label} did not become ready`));
    }, 15000);
  });
}

function stop(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
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

function yawTowards(dx, dz) {
  return Math.atan2(-dx, -dz);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let serverLog = "";
  const server = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), ["server/src/index.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (b) => {
    serverLog += b.toString();
  });
  server.stderr.on("data", (b) => {
    serverLog += b.toString();
  });

  const client = spawn(
    join(CLIENT_ROOT, "node_modules", ".bin", "vite"),
    ["--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
    {
      cwd: CLIENT_ROOT,
      env: { ...process.env, VITE_CUBEWARS_WS_URL: `ws://127.0.0.1:${SERVER_PORT}` },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let browser;
  try {
    await Promise.all([
      waitForReady(server, "server", "cubewars game server listening"),
      waitForReady(client, "vite", `http://127.0.0.1:${CLIENT_PORT}/`),
    ]);

    browser = await chromium.launch({
      args: [
        "--use-gl=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--no-proxy-server",
        "--proxy-bypass-list=*",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    // Instrument the client's OWN WebSocket: record every inbound message,
    // and keep a handle to the live instance so this script can also SEND
    // (aim/fire) through the exact same real connection the client uses.
    await page.addInitScript(() => {
      window.__wsMessages = [];
      window.__ws = null;
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class InstrumentedWebSocket extends NativeWebSocket {
        constructor(...args) {
          super(...args);
          window.__ws = this;
          this.addEventListener("message", (event) => {
            try {
              window.__wsMessages.push(JSON.parse(event.data));
            } catch {
              // ignore non-JSON
            }
          });
        }
      };
    });

    const nickname = `Epic32Killer${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[epic32-qa] joining vs Bots as ${nickname}`);
    await page.goto(CLIENT_URL, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", {
      timeout: 5000,
    });
    await page.fill("#nicknameInput", nickname);
    await page.waitForFunction(() => !document.getElementById("modeBotsBtn")?.disabled, { timeout: 5000 });
    await page.click("#modeBotsBtn");
    await page.waitForFunction(() => document.getElementById("modeSelect")?.classList.contains("hidden"), {
      timeout: 5000,
    });

    // Wait for the initial economy_profile (join-time) so #goldValue reflects
    // the server-authored starting balance for this brand-new nickname.
    await page.waitForFunction(
      () => window.__wsMessages.some((m) => m.type === "economy_profile"),
      { timeout: 5000 },
    );
    await sleep(200);

    const goldBefore = await page.evaluate(() => document.getElementById("goldValue")?.textContent ?? null);
    const hudVisibleBefore = await page.evaluate(() => document.getElementById("goldHud")?.hidden === false);
    console.log(`[epic32-qa] goldHud BEFORE kill: text="${goldBefore}" visible=${hudVisibleBefore}`);
    await page.screenshot({ path: join(OUT_DIR, "01-before-kill-goldhud.png") });

    // --- Actively aim at + kill a bot, driven through the real client
    // socket (same protocol shape a real player's browser sends: `input`
    // then `fire`), using the server's own authoritative world_state
    // positions — exactly the technique qa-tester-combat-regression.mjs uses
    // over a raw WS, just reusing the client's real live connection instead
    // of opening a second one. ---
    const selfId = await page.evaluate(
      () => window.__wsMessages.find((m) => m.type === "welcome")?.playerId ?? null,
    );
    if (!selfId) throw new Error("missing welcome/self id");
    console.log(`[epic32-qa] selfId=${selfId}`);

    await page.evaluate(() => {
      window.__epic32AimFireTimers = [];
      const send = (obj) => window.__ws.send(JSON.stringify(obj));
      const getSelf = (id) => {
        const ws = window.__wsMessages.filter((m) => m.type === "world_state").pop();
        return ws?.players.find((p) => p.id === id) ?? null;
      };
      const getBots = (id) => {
        const ws = window.__wsMessages.filter((m) => m.type === "world_state").pop();
        return ws ? ws.players.filter((p) => p.id !== id && p.alive) : [];
      };
      window.__epic32NearestBot = (id) => {
        const self = getSelf(id);
        const bots = getBots(id);
        if (!self || bots.length === 0) return null;
        let best = bots[0];
        let bestD = Infinity;
        for (const b of bots) {
          const d = Math.hypot(b.position.x - self.position.x, b.position.z - self.position.z);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        return { bot: best, dist: bestD };
      };
      window.__epic32Send = send;
      window.__epic32GetSelf = getSelf;
    }, selfId);

    // Approach + aim + fire loop, driven from Node (not in-page setInterval)
    // so this script controls total duration deterministically. Both the
    // human and the bot have equivalent pistol stats at close range (see
    // regression:bot-aim-miss-rate: ~100% hit rate for bots at 3-10m), so a
    // single engagement can go either way — the human may die and respawn
    // (server auto-respawns after a few seconds) before landing the killing
    // blow. Loop across as many respawns as needed within a generous overall
    // deadline, watching for a "kill" event with attackerId === selfId
    // specifically (not just "any kill happened", which could be the bot
    // killing this human, or bot-vs-bot friendly state noise).
    const AIM_HZ_MS = 33;
    const FIRE_MS = 320; // just above pistol's 300ms cooldown
    let lastFireAt = 0;
    const deadline = Date.now() + 60000;
    let selfKillMsg = null;
    while (Date.now() < deadline && !selfKillMsg) {
      await page.evaluate(
        ({ myId }) => {
          const found = window.__epic32NearestBot(myId);
          const self = window.__epic32GetSelf(myId);
          if (!found || !self) {
            window.__epic32Send({ type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false });
            return;
          }
          const dx = found.bot.position.x - self.position.x;
          const dz = found.bot.position.z - self.position.z;
          const dy = found.bot.position.y - self.position.y;
          const horiz = Math.hypot(dx, dz);
          const yaw = Math.atan2(-dx, -dz);
          const pitch = Math.atan2(dy, Math.max(0.001, horiz));
          // Close distance if far, otherwise hold position and aim.
          const moveForward = horiz > 6 ? 1 : 0;
          window.__epic32Send({ type: "input", moveForward, moveRight: 0, yaw, pitch, jump: false });
        },
        { myId: selfId },
      );
      if (Date.now() - lastFireAt >= FIRE_MS) {
        await page.evaluate(() => window.__epic32Send({ type: "fire" }));
        lastFireAt = Date.now();
      }
      await sleep(AIM_HZ_MS);
      selfKillMsg = await page.evaluate(
        (myId) => window.__wsMessages.find((m) => m.type === "kill" && m.attackerId === myId) ?? null,
        selfId,
      );
      if (Date.now() % 1000 < AIM_HZ_MS) {
        const dbg = await page.evaluate(
          ({ myId }) => {
            const self = window.__epic32GetSelf(myId);
            const found = window.__epic32NearestBot(myId);
            return {
              self: self?.position,
              selfAlive: self?.alive,
              selfHealth: self?.health,
              dist: found?.dist,
              hits: window.__wsMessages.filter((m) => m.type === "hit").length,
              fireBroadcasts: window.__wsMessages.filter((m) => m.type === "fire_broadcast" && m.shooterId === myId).length,
            };
          },
          { myId: selfId },
        );
        console.log("[epic32-qa][debug]", JSON.stringify(dbg));
      }
    }

    if (!selfKillMsg) {
      await page.screenshot({ path: join(OUT_DIR, "02-fail-no-kill.png") });
      throw new Error("did not observe a self-attacker kill event within the deadline (bot kill live-verification inconclusive)");
    }

    const killMsg = selfKillMsg;
    console.log(`[epic32-qa] kill event observed:`, JSON.stringify(killMsg));

    // Give the server a beat to run grantKillGold() and (if it were going
    // to) push an economy_gold_update — this is exactly the message the bug
    // used to send unconditionally.
    await sleep(500);

    const goldMessagesAfterKill = await page.evaluate(
      () => window.__wsMessages.filter((m) => m.type === "economy_gold_update" || m.type === "economy_profile").length,
    );
    const goldAfter = await page.evaluate(() => document.getElementById("goldValue")?.textContent ?? null);
    console.log(`[epic32-qa] goldHud AFTER kill: text="${goldAfter}"`);
    console.log(`[epic32-qa] economy_gold_update/economy_profile messages seen (join + post-kill total): ${goldMessagesAfterKill}`);
    await page.screenshot({ path: join(OUT_DIR, "03-after-kill-goldhud.png") });

    // Save the full captured message log + server stdout/stderr excerpt for
    // Tester's own inspection.
    const allMsgs = await page.evaluate(() => window.__wsMessages);
    await writeFile(join(OUT_DIR, "ws-messages.json"), JSON.stringify(allMsgs, null, 2));
    await writeFile(join(OUT_DIR, "server-log.txt"), serverLog);

    const goldMintedLines = serverLog
      .split("\n")
      .filter((l) => l.includes("[economy] gold minted") && l.includes(`kill ${selfId}`));
    const noRewardLines = serverLog
      .split("\n")
      .filter((l) => l.includes("[economy] kill vs bot victim -> no reward") && l.includes(selfId));
    console.log(`[epic32-qa] server "gold minted" lines for this kill: ${goldMintedLines.length}`);
    console.log(`[epic32-qa] server "no reward" lines for this kill: ${noRewardLines.length}`);

    // --- Assertions ---
    if (goldBefore !== goldAfter) {
      throw new Error(`goldHud changed across bot kill: before="${goldBefore}" after="${goldAfter}"`);
    }
    if (goldMintedLines.length > 0) {
      throw new Error(`server logged a gold-minted line for a bot-victim kill: ${JSON.stringify(goldMintedLines)}`);
    }
    if (noRewardLines.length === 0) {
      throw new Error("server did not log the expected '[economy] kill vs bot victim -> no reward' line");
    }
    if (consoleErrors.length > 0) {
      throw new Error(`browser console errors detected: ${JSON.stringify(consoleErrors)}`);
    }

    console.log("[epic32-qa] PASS: bot-victim kill granted zero gold (HUD unchanged, no gold-minted log line, explicit no-reward log line present)");
  } finally {
    await browser?.close();
    await Promise.all([stop(client), stop(server)]);
  }
}

main().catch((err) => {
  console.error("[epic32-qa] FAIL", err);
  process.exit(1);
});
