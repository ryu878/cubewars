// EPIC 49 Playwright: wide shots of all 8 catalog maps (bots join).
//
// Usage:
//   node scripts/qa-epic49-programmer-playwright.mjs
//   node scripts/qa-epic49-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7831;
const CLIENT_PORT = 5231;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-49");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const MAP_IDS = [
  "base",
  "rust_canyon",
  "glass_dome",
  "dead_station",
  "fuel_depot",
  "crystal_cave",
  "abyss_bridge",
  "elite_quarter",
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nick(prefix) {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${prefix}${suffix}`.slice(0, 16);
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
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("exit", finish);
    try {
      child.kill("SIGKILL");
    } catch {
      finish();
    }
    setTimeout(finish, 1500);
  });
}

async function startStack() {
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(REPO_ROOT, "server"),
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(server, "server", `listening on`);

  const client = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
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
      window.__epic49Tap = window.__epic49Tap || {
        outbound: [],
        mapStates: [],
        joinAccepted: [],
        leaveAcks: [],
      };
      window.__epic49Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic49Tap.outbound.push(msg);
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "map_state") window.__epic49Tap.mapStates.push(msg);
          if (msg.type === "join_accepted") window.__epic49Tap.joinAccepted.push(msg);
          if (msg.type === "leave_match_ack") window.__epic49Tap.leaveAcks.push(msg);
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

async function openLobby(page, nickname) {
  await installWsTap(page);
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#mapSelect", { timeout: 15000 });
  await page.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "connected",
    { timeout: 20000 },
  );
  const email = `epic49_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  await registerAndContinue(page, email);
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("modeBotsBtn");
      return btn && !btn.disabled;
    },
    { timeout: 20000 },
  );
}

async function leaveToLobby(page) {
  await page.evaluate(() => {
    window.__cwQaHoldPose = null;
  });
  // Prefer sending leave_match directly — more reliable than Esc+UI in headless.
  const sent = await page.evaluate(() => {
    const ws = window.__epic49Tap?.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "leave_match" }));
      return true;
    }
    return false;
  });
  if (!sent) {
    await page.locator("canvas").click({ position: { x: 640, y: 400 } }).catch(() => {});
    await sleep(200);
    await page.keyboard.press("Escape");
    await page
      .waitForFunction(
        () => document.getElementById("pauseMenu")?.classList.contains("visible"),
        { timeout: 5000 },
      )
      .catch(() => {});
    await page.click("#pauseExitLobbyBtn");
  }
  await page.waitForFunction(
    () => (window.__epic49Tap?.leaveAcks ?? []).length > 0,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => !document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await sleep(400);
  await page.evaluate(() => {
    if (window.__epic49Tap) {
      window.__epic49Tap.mapStates = [];
      window.__epic49Tap.joinAccepted = [];
      window.__epic49Tap.leaveAcks = [];
      window.__epic49Tap.outbound = [];
    }
  });
}

async function joinMapAndShot(page, mapId, index) {
  const beforeCount = await page.evaluate(() => (window.__epic49Tap?.mapStates ?? []).length);
  await page.selectOption("#mapSelect", mapId);
  await page.evaluate((id) => localStorage.setItem("cubewars.mapId", id), mapId);
  await page.click("#modeBotsBtn");
  await page.waitForFunction(
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await page.waitForFunction(
    (prev) => (window.__epic49Tap?.mapStates ?? []).length > prev,
    beforeCount,
    { timeout: 15000 },
  );
  await sleep(700);

  const info = await page.evaluate(() => {
    const mapState = (window.__epic49Tap?.mapStates ?? []).at(-1) ?? null;
    const accepted = (window.__epic49Tap?.joinAccepted ?? []).at(-1) ?? null;
    const walls = (mapState?.geometry ?? []).filter((b) => b.kind === "wall");
    const maxWallH = walls.reduce((m, b) => Math.max(m, b.size?.y ?? 0), 0);
    return {
      mapId: mapState?.mapId ?? accepted?.mapId ?? null,
      boxCount: mapState?.geometry?.length ?? 0,
      maxWallH,
    };
  });

  // Elevated mid-range view: taller walls + fog dissolve into sky (not face-planted into a near wall).
  await page.evaluate(() => {
    window.__cwQaHoldPose = {
      eye: { x: 0, y: 5.5, z: 46 },
      look: { x: 0, y: 3.2, z: 0 },
    };
  });
  await sleep(350);
  const shotPath = join(OUT_DIR, `${String(index).padStart(2, "0")}-${mapId}.png`);
  await page.screenshot({ path: shotPath, fullPage: false });
  await page.evaluate(() => {
    window.__cwQaHoldPose = null;
  });
  console.log(
    `[epic49-qa] shot ${mapId} → ${shotPath} (boxes=${info.boxCount}, maxWallH=${info.maxWallH})`,
  );
  return {
    mapId,
    expected: mapId,
    got: info.mapId,
    boxCount: info.boxCount,
    maxWallH: info.maxWallH,
    shotPath,
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const results = [];
  const failures = [];

  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic49-qa] starting dedicated server/client");
    stack = await startStack();
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
    ],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const nickname = nick("E49");
    await openLobby(page, nickname);

    for (let i = 0; i < MAP_IDS.length; i++) {
      const mapId = MAP_IDS[i];
      const row = await joinMapAndShot(page, mapId, i + 1);
      results.push(row);
      if (row.got !== mapId) {
        failures.push(`${mapId}: map_state mapId=${row.got}`);
      }
      if ((row.maxWallH ?? 0) < 5.5) {
        failures.push(`${mapId}: max wall height ${row.maxWallH} (expected ~6)`);
      }
      if (i < MAP_IDS.length - 1) {
        await leaveToLobby(page);
      }
    }
  } finally {
    await browser.close();
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
    }
  }

  const summary = { results, failures };
  await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  if (failures.length) {
    console.error("[epic49-qa] FAIL", failures);
    process.exit(1);
  }
  console.log("[epic49-qa] OK — 8 map wide shots written");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
