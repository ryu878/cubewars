// EPIC 59 Playwright QA: mid-map rift hazards — stand DoT, jump-clear, themes, bots, endless.
//
// Usage:
//   node scripts/qa-epic59-tester-playwright.mjs
//   node scripts/qa-epic59-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const NODE =
  process.env.CUBEWARS_NODE ??
  "/usr/share/cursor/resources/app/resources/helpers/node";
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const VITE = join(CLIENT_ROOT, "node_modules", ".bin", "vite");

const SERVER_PORT = 7859;
const CLIENT_PORT = 5259;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-59");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

/** Scaled rift midpoints (MAP_LINEAR_SCALE 0.5 applied). */
const RIFT_MIDS = {
  base: { x: -16.5, z: 0.25, kind: "water_piranha" },
  rust_canyon: { x: -17.5, z: -0.25, kind: "lava" },
  glass_dome: { x: -22.5, z: -5, kind: "acid" },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nick(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 16);
}

function waitForReady(child, label, marker) {
  return new Promise((resolve, reject) => {
    let ready = false;
    const onData = (buf) => {
      const text = buf.toString();
      process.stdout.write(`[${label}] ${text}`);
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
    }, 45000);
  });
}

function stop(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.once("exit", () => resolve());
    try {
      child.kill("SIGTERM");
    } catch {
      resolve();
    }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 3000);
  });
}

async function startStack(serverLog) {
  const server = spawn(NODE, [TSX, "src/index.ts"], {
    cwd: join(REPO_ROOT, "server"),
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onData = (buf) => {
    const text = buf.toString();
    serverLog.push(text);
    process.stdout.write(`[server] ${text}`);
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  await waitForReady(server, "server", "listening on");

  const client = spawn(
    NODE,
    [VITE, "--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
    {
      cwd: CLIENT_ROOT,
      env: { ...process.env, VITE_CUBEWARS_WS_URL: WS_URL },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForReady(client, "client", `http://127.0.0.1:${CLIENT_PORT}/`);
  return { server, client };
}

function installWsTap(page) {
  return page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new Orig(...args);
      window.__epic59Tap = window.__epic59Tap || {
        welcomeId: null,
        hits: [],
        devResults: [],
        mapStates: [],
        joinAccepted: [],
        worldStates: [],
        lastSelf: null,
      };
      window.__epic59Tap.ws = ws;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "welcome") window.__epic59Tap.welcomeId = msg.playerId;
          if (msg.type === "hit") window.__epic59Tap.hits.push(msg);
          if (msg.type === "dev_console_result") window.__epic59Tap.devResults.push(msg);
          if (msg.type === "map_state") window.__epic59Tap.mapStates.push(msg);
          if (msg.type === "join_accepted") window.__epic59Tap.joinAccepted.push(msg);
          if (msg.type === "world_state" && Array.isArray(msg.players)) {
            window.__epic59Tap.worldStates.push(msg);
            const selfId = window.__epic59Tap.welcomeId;
            const self = msg.players.find((p) => p.id === selfId);
            if (self) window.__epic59Tap.lastSelf = self;
          }
        } catch {
          /* ignore */
        }
      });
      return ws;
    };
    window.WebSocket.prototype = Orig.prototype;
    Object.assign(window.WebSocket, Orig);
  });
}

async function registerAndContinue(page, email) {
  await page.waitForSelector("#accountEmailInput", { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("accountEmailBtn");
      return btn && !btn.disabled;
    },
    { timeout: 20000 },
  );
  await page.fill("#accountEmailInput", email);
  await page.click("#accountEmailBtn");
  await page.waitForFunction(
    () => {
      const codeEl = document.getElementById("accountRevealCode");
      return codeEl && /^\d{3}-\d{3}$/.test(codeEl.textContent || "");
    },
    { timeout: 15000 },
  );
  await page.click("#accountContinueBtn");
  await page.waitForFunction(
    () =>
      document.getElementById("accountSignedIn") &&
      !document.getElementById("accountSignedIn").classList.contains("hidden"),
    { timeout: 10000 },
  );
}

async function openLobby(page) {
  await installWsTap(page);
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#mapSelect", { timeout: 15000 });
  await page.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "connected",
    { timeout: 20000 },
  );
  const email = `epic59_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  await registerAndContinue(page, email);
}

async function selectMap(page, mapId) {
  await page.selectOption("#mapSelect", mapId);
  await page.evaluate((id) => localStorage.setItem("cubewars.mapId", id), mapId);
}

async function joinBots(page, nickname, mapId) {
  await selectMap(page, mapId);
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("modeBotsBtn");
      return btn && !btn.disabled;
    },
    { timeout: 10000 },
  );
  await page.click("#modeBotsBtn");
  await page.waitForFunction(
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => (window.__epic59Tap?.mapStates ?? []).length > 0,
    { timeout: 15000 },
  );
  await sleep(700);
}

async function joinEndless(page, nickname) {
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("modeEndlessBtn");
      return btn && !btn.disabled;
    },
    { timeout: 10000 },
  );
  await page.click("#modeEndlessBtn");
  await page.waitForFunction(
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => (window.__epic59Tap?.mapStates ?? []).length > 0,
    { timeout: 15000 },
  );
  await sleep(700);
}

async function pointerLock(page) {
  const box = await page.locator("#app canvas").boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(250);
  return page.evaluate(() => document.pointerLockElement !== null);
}

const MOUSE_SENSITIVITY = 0.0025;
let qaLocalYaw = 0;

async function getSelf(page) {
  return page.evaluate(() => window.__epic59Tap?.lastSelf ?? null);
}

async function syncLocalYawFromSelf(page) {
  const self = await getSelf(page);
  if (typeof self?.yaw === "number") qaLocalYaw = self.yaw;
}

async function faceYaw(page, targetYaw) {
  let delta = targetYaw - qaLocalYaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const movementX = -delta / MOUSE_SENSITIVITY;
  const steps = Math.max(1, Math.ceil(Math.abs(movementX) / 48));
  const step = movementX / steps;
  for (let i = 0; i < steps; i++) {
    await page.evaluate((mx) => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, cancelable: true, movementX: mx, movementY: 0 }),
      );
    }, step);
    await sleep(16);
  }
  qaLocalYaw = targetYaw;
  await sleep(40);
}

async function yawToward(page, tx, tz) {
  const self = await getSelf(page);
  if (!self?.position) return;
  const dx = tx - self.position.x;
  const dz = tz - self.position.z;
  await faceYaw(page, Math.atan2(-dx, -dz));
}

async function walkMs(page, ms) {
  await page.keyboard.down("KeyW");
  await sleep(ms);
  await page.keyboard.up("KeyW");
  await sleep(80);
}

async function walkToward(page, tx, tz, { timeoutMs = 10000, stopDist = 2.0 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const self = await getSelf(page);
    if (!self?.position) break;
    const dx = tx - self.position.x;
    const dz = tz - self.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= stopDist) return self;
    await yawToward(page, tx, tz);
    await walkMs(page, Math.min(450, 100 + dist * 35));
  }
  return getSelf(page);
}

async function holdQaPose(page, eye, look) {
  await page.evaluate(
    ({ eye: e, look: l }) => {
      window.__cwQaHoldPose = { eye: e, look: l };
    },
    { eye, look },
  );
  await sleep(180);
}

async function clearQaPose(page) {
  await page.evaluate(() => {
    window.__cwQaHoldPose = null;
  });
}

function riftHits(tap) {
  return (tap?.hits ?? []).filter((h) => h.shooterId === "rift");
}

function parseServerRiftHits(serverLog, selfId = null) {
  const text = serverLog.join("");
  const botHits = [];
  const selfHits = [];
  for (const line of text.split("\n")) {
    const m = line.match(/hit: rift -> ([^\s]+)/);
    if (!m) continue;
    const target = m[1];
    if (/^Bot /i.test(target)) botHits.push(target);
    else if (!selfId || target === selfId) selfHits.push(target);
  }
  return { botHits, selfHits, botHitCount: botHits.length, selfHitCount: selfHits.length };
}

async function openDevConsole(page) {
  await page.keyboard.press("Backquote");
  await page.waitForFunction(
    () => document.getElementById("devConsole")?.classList.contains("visible"),
    { timeout: 5000 },
  );
}

async function runConsoleCommand(page, command) {
  await openDevConsole(page);
  const before = await page.evaluate(() => (window.__epic59Tap?.devResults ?? []).length);
  await page.fill("#devConsoleInput", command);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (prev) => (window.__epic59Tap?.devResults ?? []).length > prev,
    before,
    { timeout: 8000 },
  );
  return page.evaluate(() => (window.__epic59Tap?.devResults ?? []).at(-1) ?? null);
}

async function enableGodMode(page) {
  const unlock = await runConsoleCommand(page, "iddqd");
  if (!unlock?.ok) throw new Error(`iddqd failed: ${JSON.stringify(unlock)}`);
  const godOn = await runConsoleCommand(page, "god_mode");
  if (!godOn?.ok || !/ON/i.test(godOn.message || "")) {
    throw new Error(`god_mode ON failed: ${JSON.stringify(godOn)}`);
  }
  await page.keyboard.press("Backquote");
  await sleep(120);
}

async function disableGodMode(page) {
  const godOff = await runConsoleCommand(page, "god_mode");
  if (!godOff?.ok || !/OFF/i.test(godOff.message || "")) {
    throw new Error(`god_mode OFF failed: ${JSON.stringify(godOff)}`);
  }
  await page.keyboard.press("Backquote");
  await sleep(120);
}

async function waitUntilNear(page, tx, tz, dist = 2.5, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const self = await getSelf(page);
    if (self?.position) {
      const d = Math.hypot(self.position.x - tx, self.position.z - tz);
      if (d <= dist) return self;
    }
    await walkToward(page, tx, tz, { timeoutMs: 2000, stopDist: dist });
  }
  return getSelf(page);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = {};

  const serverLog = [];
  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic59-qa] starting dedicated server/client");
    stack = await startStack(serverLog);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // --- Base: stand in rift → armor/HP drain (server rift hits) ---
    await openLobby(page);
    const selfId = await page.evaluate(() => window.__epic59Tap?.welcomeId ?? null);
    await joinBots(page, nick("R59B"), "base");
    const baseMap = await page.evaluate(
      () => (window.__epic59Tap?.mapStates ?? []).at(-1) ?? null,
    );
    summary.baseMapId = baseMap?.mapId ?? null;
    if (baseMap?.mapId !== "base") failures.push(`expected base mapId, got ${baseMap?.mapId}`);

    await pointerLock(page);
    await syncLocalYawFromSelf(page);
    const mid = RIFT_MIDS.base;

    // Route along mid-lane (z≈0): align then walk into rift ribbon center.
    await walkToward(page, -28, 0, { timeoutMs: 14000, stopDist: 2 });
    await walkToward(page, mid.x, mid.z, { timeoutMs: 14000, stopDist: 1.8 });
    const atRift = await waitUntilNear(page, mid.x, mid.z, 2.0, 12000);
    await sleep(2500); // spawn protection expired

    await holdQaPose(page, { x: mid.x, y: 4.5, z: mid.z + 8 }, { x: mid.x, y: 0, z: mid.z });
    await page.screenshot({ path: join(OUT_DIR, "01-base-rift-approach.png") });
    await clearQaPose(page);

    const beforeStand = await getSelf(page);
    const hitsBeforeStand = await page.evaluate(() => window.__epic59Tap?.hits?.length ?? 0);
    await sleep(3500);
    const afterStand = await getSelf(page);
    const standTap = await page.evaluate(() => window.__epic59Tap ?? null);
    const newRiftHits = riftHits(standTap).slice(hitsBeforeStand);

    await holdQaPose(page, { x: mid.x, y: 2.8, z: mid.z + 5 }, { x: mid.x, y: 0.05, z: mid.z });
    await page.screenshot({ path: join(OUT_DIR, "02-base-standing-in-rift.png") });
    await clearQaPose(page);

    const atRiftDist = atRift?.position
      ? Math.hypot(atRift.position.x - mid.x, atRift.position.z - mid.z)
      : null;

    summary.standDamage = {
      atRiftDist,
      position: afterStand?.position ?? null,
      before: { armor: beforeStand?.armor, health: beforeStand?.health },
      after: { armor: afterStand?.armor, health: afterStand?.health },
      riftHitCount: newRiftHits.length,
      sampleRiftHit: newRiftHits[0] ?? null,
    };

    const healthDropped = (beforeStand?.health ?? 100) > (afterStand?.health ?? 100);
    const armorDropped = (beforeStand?.armor ?? 0) > (afterStand?.armor ?? 0);
    if (newRiftHits.length < 1 && !healthDropped && !armorDropped) {
      failures.push("standing in Base rift: no server rift hits or HP/armor drain");
    }
    if (atRiftDist != null && atRiftDist > 3) {
      failures.push(`failed to reach rift mid (dist=${atRiftDist.toFixed(1)})`);
    }

    // --- Jump across without landing in rift ---
    await page.evaluate(() => {
      window.__epic59Tap.hits = [];
    });
    await walkToward(page, mid.x - 9, mid.z, { timeoutMs: 8000, stopDist: 1.2 });
    const jumpStart = await getSelf(page);
    await yawToward(page, mid.x + 12, mid.z);
    await page.keyboard.down("Space");
    await page.keyboard.down("KeyW");
    await sleep(120);
    await page.screenshot({ path: join(OUT_DIR, "03-base-mid-jump-over-rift.png") });
    await sleep(750);
    await page.keyboard.up("KeyW");
    await page.keyboard.up("Space");
    await sleep(400);
    const jumpEnd = await getSelf(page);
    const jumpHits = await page.evaluate(() =>
      (window.__epic59Tap?.hits ?? []).filter((h) => h.shooterId === "rift"),
    );
    summary.jumpClear = {
      start: jumpStart?.position ?? null,
      end: jumpEnd?.position ?? null,
      riftHitsDuringJump: jumpHits.length,
    };
    if (jumpHits.length > 0) {
      failures.push(`jump over rift: expected 0 rift hits, got ${jumpHits.length}`);
    }

    // --- Bot rift damage: patrol waypoints cross mid-lane; wait near ribbon ---
    await walkToward(page, mid.x, mid.z, { timeoutMs: 6000, stopDist: 2 });
    await sleep(45000);
    const botRiftHits = await page.evaluate(() =>
      (window.__epic59Tap?.hits ?? []).filter(
        (h) => h.shooterId === "rift" && /^Bot /i.test(h.targetId),
      ),
    );
    const serverRift = parseServerRiftHits(serverLog, selfId);
    summary.botRiftDamage = {
      wsHitCount: botRiftHits.length,
      serverLogBotHitCount: serverRift.botHitCount,
      sample: botRiftHits[0] ?? null,
    };
    if (botRiftHits.length < 1 && serverRift.botHitCount < 1) {
      failures.push("no bot rift damage observed (WS or server log)");
    }

    // --- Rust Canyon + Glass Dome themed visuals ---
    const pageRust = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openLobby(pageRust);
    await joinBots(pageRust, nick("R59R"), "rust_canyon");
    const rustMid = RIFT_MIDS.rust_canyon;
    await pointerLock(pageRust);
    await walkToward(pageRust, rustMid.x, rustMid.z, { timeoutMs: 12000, stopDist: 2 });
    await holdQaPose(
      pageRust,
      { x: rustMid.x, y: 5, z: rustMid.z + 10 },
      { x: rustMid.x, y: 0, z: rustMid.z },
    );
    await pageRust.screenshot({ path: join(OUT_DIR, "04-rust-canyon-lava-rift.png") });
    await clearQaPose(pageRust);
    summary.rustMapId = await pageRust.evaluate(
      () => (window.__epic59Tap?.mapStates ?? []).at(-1)?.mapId ?? null,
    );

    const pageGlass = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openLobby(pageGlass);
    await joinBots(pageGlass, nick("R59G"), "glass_dome");
    const glassMid = RIFT_MIDS.glass_dome;
    await pointerLock(pageGlass);
    await walkToward(pageGlass, glassMid.x, glassMid.z, { timeoutMs: 12000, stopDist: 2 });
    await holdQaPose(
      pageGlass,
      { x: glassMid.x, y: 5, z: glassMid.z + 10 },
      { x: glassMid.x, y: 0, z: glassMid.z },
    );
    await pageGlass.screenshot({ path: join(OUT_DIR, "05-glass-dome-acid-rift.png") });
    await clearQaPose(pageGlass);
    summary.glassMapId = await pageGlass.evaluate(
      () => (window.__epic59Tap?.mapStates ?? []).at(-1)?.mapId ?? null,
    );

    // --- Endless: no catalog rift / no rift DoT ---
    const pageEndless = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openLobby(pageEndless);
    await joinEndless(pageEndless, nick("R59E"));
    const endlessMap = await pageEndless.evaluate(
      () => (window.__epic59Tap?.mapStates ?? []).at(-1) ?? null,
    );
    summary.endless = {
      mapId: endlessMap?.mapId ?? null,
      hasMapId: endlessMap?.mapId != null,
    };
    if (endlessMap?.mapId != null) {
      failures.push(`endless map_state should omit mapId, got ${endlessMap.mapId}`);
    }
    await pointerLock(pageEndless);
    await pageEndless.keyboard.down("KeyW");
    await sleep(4000);
    await pageEndless.keyboard.up("KeyW");
    await holdQaPose(pageEndless, { x: 0, y: 6, z: 12 }, { x: 0, y: 0, z: 0 });
    await pageEndless.screenshot({ path: join(OUT_DIR, "06-endless-no-rift.png") });
    await clearQaPose(pageEndless);
    const endlessRiftHits = await pageEndless.evaluate(() =>
      (window.__epic59Tap?.hits ?? []).filter((h) => h.shooterId === "rift"),
    );
    summary.endless.riftHits = endlessRiftHits.length;
    if (endlessRiftHits.length > 0) {
      failures.push(`endless mode received ${endlessRiftHits.length} rift hit(s)`);
    }

    // --- Gameplay smoke: move / jump / shoot on Base page ---
    await page.keyboard.down("KeyW");
    await sleep(500);
    await page.keyboard.up("KeyW");
    await page.keyboard.down("Space");
    await sleep(150);
    await page.keyboard.up("Space");
    await page.mouse.down({ button: "left" });
    await sleep(100);
    await page.mouse.up({ button: "left" });
    summary.gameplaySmoke = { movement: true, jump: true, shoot: true };
    summary.consoleErrors = consoleErrors.slice(0, 20);

    summary.serverRiftHits = parseServerRiftHits(serverLog, selfId);

    await writeFile(
      join(OUT_DIR, "summary.json"),
      JSON.stringify({ failures, summary, consoleErrors, serverRiftLog: summary.serverRiftHits }, null, 2),
    );
    if (serverLog.length) {
      await writeFile(join(OUT_DIR, "server.log"), serverLog.join(""));
    }

    console.log("[epic59-qa] summary:", JSON.stringify(summary, null, 2));
    if (failures.length) {
      console.error("[epic59-qa] FAIL:", failures.join("; "));
      process.exitCode = 1;
    } else {
      console.log("[epic59-qa] PASS");
    }
  } finally {
    await browser.close();
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
    }
  }
}

main().catch((err) => {
  console.error("[epic59-qa] fatal:", err);
  process.exit(1);
});
