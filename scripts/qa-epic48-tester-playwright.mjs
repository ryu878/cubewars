// Tester Playwright evidence for EPIC 48 — pickup density + map select.
//
// Checks:
//   1) Fresh lobby: no empty Base public match ("No games yet")
//   2) Quick Join public with rust_canyon → map_state not Base
//   3) vs Bots glass_dome → map_state not Base
//   4) ESC Change Map → fuel_depot (leave→rejoin) loads that map
//   5) Light gameplay smoke: move / jump / shoot on rust_canyon
//   6) Screenshots under qa-artifacts/epic-48/
//
// Usage:
//   node scripts/qa-epic48-tester-playwright.mjs
//   node scripts/qa-epic48-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7820;
const CLIENT_PORT = 5220;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-48");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

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
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
      }
      resolve();
    }, 3000);
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
      window.__epic48Tap = window.__epic48Tap || {
        welcomeId: null,
        outbound: [],
        lobbies: [],
        mapStates: [],
        joinAccepted: [],
        leaveAcks: [],
        lastSelf: null,
      };
      window.__epic48Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic48Tap.outbound.push(msg);
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "welcome") window.__epic48Tap.welcomeId = msg.playerId;
          if (msg.type === "lobby_state") window.__epic48Tap.lobbies.push(msg);
          if (msg.type === "map_state") window.__epic48Tap.mapStates.push(msg);
          if (msg.type === "join_accepted") window.__epic48Tap.joinAccepted.push(msg);
          if (msg.type === "leave_match_ack") window.__epic48Tap.leaveAcks.push(msg);
          if (msg.type === "world_state" && Array.isArray(msg.players)) {
            const selfId = window.__epic48Tap.welcomeId;
            const self = msg.players.find((p) => p.id === selfId);
            if (self) {
              window.__epic48Tap.lastSelf = {
                id: self.id,
                position: self.position,
                alive: self.alive,
                yaw: self.yaw,
              };
            }
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
  const email = `epic48_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
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

async function selectMap(page, mapId) {
  await page.selectOption("#mapSelect", mapId);
  await page.evaluate((id) => localStorage.setItem("cubewars.mapId", id), mapId);
}

function summarizeMap(mapState) {
  if (!mapState) return null;
  const ids = (mapState.geometry ?? []).map((b) => String(b.id));
  return {
    mapId: mapState.mapId ?? null,
    boxCount: ids.length,
    pickupCount: (mapState.pickups ?? mapState.pickupPoints ?? []).length || null,
    hasBase: ids.some((id) => id.startsWith("base_")),
    hasRc: ids.some((id) => id.startsWith("rc_")),
    hasGd: ids.some((id) => id.startsWith("gd_")),
    hasFd: ids.some((id) => id.startsWith("fd_")),
    sampleIds: ids.slice(0, 8),
  };
}

async function lastMapSummary(page) {
  return page.evaluate(() => {
    const states = window.__epic48Tap?.mapStates ?? [];
    const mapState = states.at(-1) ?? null;
    if (!mapState) return null;
    const ids = (mapState.geometry ?? []).map((b) => String(b.id));
    const pickups = mapState.pickups ?? mapState.pickupPoints ?? [];
    return {
      mapId: mapState.mapId ?? null,
      boxCount: ids.length,
      pickupCount: Array.isArray(pickups) ? pickups.length : null,
      hasBase: ids.some((id) => id.startsWith("base_")),
      hasRc: ids.some((id) => id.startsWith("rc_")),
      hasGd: ids.some((id) => id.startsWith("gd_")),
      hasFd: ids.some((id) => id.startsWith("fd_")),
      sampleIds: ids.slice(0, 8),
    };
  });
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = {
    emptyLobby: null,
    publicRust: null,
    botsGlass: null,
    escChangeMap: null,
    gameplay: null,
    consoleErrors: [],
  };

  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic48-qa] starting dedicated server/client");
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
    const consoleErrors = summary.consoleErrors;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    const lobbyNick = nick("E48L");
    await openLobby(page, lobbyNick);

    // --- 1) Empty lobby: no Base trap ---
    await page.waitForFunction(
      () => (window.__epic48Tap?.lobbies ?? []).length > 0,
      { timeout: 10000 },
    );
    const emptyLobby = await page.evaluate(() => {
      const last = (window.__epic48Tap?.lobbies ?? []).at(-1);
      const listText = document.getElementById("lobbyList")?.textContent?.trim() ?? "";
      return {
        matchCount: last?.matches?.length ?? -1,
        matches: (last?.matches ?? []).map((m) => ({
          id: m.id,
          mapId: m.mapId,
          players: m.players,
        })),
        listText: listText.slice(0, 200),
      };
    });
    summary.emptyLobby = emptyLobby;
    if (emptyLobby.matchCount !== 0) {
      failures.push(`expected empty lobby at boot, got ${emptyLobby.matchCount} matches`);
    }
    if (/Game 1.*Base.*0\/8/i.test(emptyLobby.listText)) {
      failures.push("empty Base lobby trap still visible");
    }
    await page.screenshot({
      path: join(OUT_DIR, "01-lobby-empty-no-base-trap.png"),
      fullPage: true,
    });
    console.log("[epic48-qa] empty lobby captured");

    // --- 2) Public Quick Join rust_canyon ---
    await selectMap(page, "rust_canyon");
    await page.click("#modePublicBtn");
    await page.waitForFunction(
      () => document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => (window.__epic48Tap?.mapStates ?? []).length > 0,
      { timeout: 15000 },
    );
    await sleep(500);

    const publicRust = await page.evaluate(() => {
      const joins = (window.__epic48Tap?.outbound ?? []).filter((m) => m.type === "join");
      const lastJoin = joins.at(-1) ?? null;
      const accepted = (window.__epic48Tap?.joinAccepted ?? []).at(-1) ?? null;
      const mapState = (window.__epic48Tap?.mapStates ?? []).at(-1) ?? null;
      const ids = (mapState?.geometry ?? []).map((b) => String(b.id));
      const pickups = mapState?.pickups ?? mapState?.pickupPoints ?? [];
      return {
        joinMapId: lastJoin?.mapId ?? null,
        acceptedMapId: accepted?.mapId ?? null,
        mapId: mapState?.mapId ?? null,
        boxCount: ids.length,
        pickupCount: Array.isArray(pickups) ? pickups.length : null,
        hasBase: ids.some((id) => id.startsWith("base_")),
        hasRc: ids.some((id) => id.startsWith("rc_")),
        sampleIds: ids.slice(0, 8),
      };
    });
    summary.publicRust = publicRust;
    if (publicRust.joinMapId !== "rust_canyon") {
      failures.push(`public join mapId=${publicRust.joinMapId}`);
    }
    if (publicRust.acceptedMapId !== "rust_canyon") {
      failures.push(`public join_accepted.mapId=${publicRust.acceptedMapId}`);
    }
    if (publicRust.mapId !== "rust_canyon" || !publicRust.hasRc || publicRust.hasBase) {
      failures.push(`public map_state not rust_canyon: ${JSON.stringify(publicRust)}`);
    }
    // Pickup spawn list is densify/catalog (verified by regression:epic48);
    // live map_state may omit pickups (pickup_state is separate).

    await pointerLock(page);
    await sleep(300);
    await page.screenshot({ path: join(OUT_DIR, "02-public-rust-canyon-spawn.png") });
    console.log("[epic48-qa] public rust_canyon captured");

    // Gameplay smoke on rust_canyon
    const beforePos = await page.evaluate(() => window.__epic48Tap?.lastSelf?.position ?? null);
    await page.keyboard.down("KeyW");
    await sleep(700);
    await page.keyboard.up("KeyW");
    await sleep(200);
    const afterMove = await page.evaluate(() => window.__epic48Tap?.lastSelf?.position ?? null);
    await page.screenshot({ path: join(OUT_DIR, "03-public-rust-movement.png") });

    await page.keyboard.down("Space");
    await sleep(150);
    await page.screenshot({ path: join(OUT_DIR, "04-public-rust-jump.png") });
    await page.keyboard.up("Space");
    await sleep(200);

    await page.mouse.down({ button: "left" });
    await sleep(120);
    await page.mouse.up({ button: "left" });
    await sleep(250);
    await page.screenshot({ path: join(OUT_DIR, "05-public-rust-fire.png") });

    const moved =
      beforePos &&
      afterMove &&
      (Math.abs(beforePos.x - afterMove.x) > 0.2 || Math.abs(beforePos.z - afterMove.z) > 0.2);
    summary.gameplay = { beforePos, afterMove, moved };
    if (!moved) failures.push("movement smoke did not change position");

    // Wide visual sanity (camera pose if supported)
    await page.evaluate(() => {
      window.__cwQaHoldPose = {
        eye: { x: 0, y: 28, z: 70 },
        look: { x: 0, y: 0, z: 0 },
      };
    });
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, "06-public-rust-wide-pickups.png") });
    await page.evaluate(() => {
      window.__cwQaHoldPose = null;
    });

    // Exit to lobby
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("pauseMenu")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    await page.click("#pauseExitLobbyBtn");
    await page.waitForFunction(
      () => !document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 10000 },
    );
    await sleep(400);

    // --- 3) Bots glass_dome ---
    await page.evaluate(() => {
      if (window.__epic48Tap) {
        window.__epic48Tap.mapStates = [];
        window.__epic48Tap.joinAccepted = [];
        window.__epic48Tap.outbound = [];
        window.__epic48Tap.leaveAcks = [];
      }
    });
    await selectMap(page, "glass_dome");
    await page.fill("#nicknameInput", nick("E48B"));
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
      () => (window.__epic48Tap?.mapStates ?? []).length > 0,
      { timeout: 15000 },
    );
    await sleep(500);

    const botsGlass = await lastMapSummary(page);
    const botsAccepted = await page.evaluate(
      () => (window.__epic48Tap?.joinAccepted ?? []).at(-1)?.mapId ?? null,
    );
    summary.botsGlass = { ...botsGlass, acceptedMapId: botsAccepted };
    if (botsAccepted !== "glass_dome") {
      failures.push(`bots join_accepted.mapId=${botsAccepted}`);
    }
    if (!botsGlass || botsGlass.mapId !== "glass_dome" || !botsGlass.hasGd || botsGlass.hasBase) {
      failures.push(`bots map_state not glass_dome: ${JSON.stringify(botsGlass)}`);
    }
    await page.screenshot({ path: join(OUT_DIR, "07-bots-glass-dome.png") });
    console.log("[epic48-qa] bots glass_dome captured");

    // --- 4) ESC Change Map → fuel_depot ---
    const mapStatesBeforeChange = await page.evaluate(
      () => (window.__epic48Tap?.mapStates ?? []).length,
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("pauseMenu")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    await page.screenshot({ path: join(OUT_DIR, "08-esc-pause-change-map.png") });
    // Change Map toggles the map panel; Confirm sends change_map.
    await page.click("#pauseChangeMapBtn");
    await page.waitForSelector("#pauseMapSelect", { state: "visible", timeout: 5000 });
    await page.selectOption("#pauseMapSelect", "fuel_depot");
    await page.click("#pauseMapConfirmBtn");
    await page.waitForFunction(
      (before) => (window.__epic48Tap?.mapStates ?? []).length > before,
      mapStatesBeforeChange,
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 15000 },
    );
    await sleep(600);

    const escChange = await page.evaluate(() => {
      const joins = (window.__epic48Tap?.outbound ?? []).filter((m) => m.type === "join");
      const lastJoin = joins.at(-1) ?? null;
      const mapState = (window.__epic48Tap?.mapStates ?? []).at(-1) ?? null;
      const accepted = (window.__epic48Tap?.joinAccepted ?? []).at(-1) ?? null;
      const ids = (mapState?.geometry ?? []).map((b) => String(b.id));
      return {
        joinMapId: lastJoin?.mapId ?? null,
        acceptedMapId: accepted?.mapId ?? null,
        mapId: mapState?.mapId ?? null,
        hasBase: ids.some((id) => id.startsWith("base_")),
        hasFd: ids.some((id) => id.startsWith("fd_")),
        leaveAcks: (window.__epic48Tap?.leaveAcks ?? []).length,
        sampleIds: ids.slice(0, 8),
      };
    });
    summary.escChangeMap = escChange;
    if (escChange.joinMapId !== "fuel_depot") {
      failures.push(`ESC change join mapId=${escChange.joinMapId}`);
    }
    if (escChange.mapId !== "fuel_depot" || !escChange.hasFd || escChange.hasBase) {
      failures.push(`ESC change map_state not fuel_depot: ${JSON.stringify(escChange)}`);
    }
    if (escChange.leaveAcks < 1) failures.push("ESC change-map missing leave_match_ack");
    await page.screenshot({ path: join(OUT_DIR, "09-esc-rejoin-fuel-depot.png") });
    console.log("[epic48-qa] ESC change-map fuel_depot captured");

    // Filter noisy WebGL/swiftshader console noise from hard failures
    const hardErrors = consoleErrors.filter(
      (e) =>
        !/WebGL|swiftshader|GPU|favicon|ResizeObserver/i.test(e) &&
        !/Failed to load resource/i.test(e),
    );
    if (hardErrors.length) {
      failures.push(`console errors: ${hardErrors.slice(0, 5).join(" | ")}`);
    }

    await writeFile(
      join(OUT_DIR, "summary.json"),
      JSON.stringify({ failures, summary }, null, 2),
    );
    await writeFile(
      join(OUT_DIR, "playwright-run.log"),
      failures.length ? `FAIL\n${failures.join("\n")}\n` : "ALL PASS\n",
      "utf8",
    );

    console.log("[epic48-qa] summary", JSON.stringify(summary, null, 2));
    if (failures.length) {
      console.error("[epic48-qa] FAIL", failures);
      process.exitCode = 1;
    } else {
      console.log("[epic48-qa] PASS");
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
  console.error("[epic48-qa] FATAL", err);
  process.exit(1);
});
