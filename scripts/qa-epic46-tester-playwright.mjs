// Tester Playwright evidence for EPIC 46 — multi-map catalog, picker, Base, capacity.
//
// Checks:
//   1) Lobby #mapSelect lists all 8 catalog maps
//   2) Public match lobby row shows map display name
//   3) Join bots on Base → map_state includes building + car props; in-match screenshots
//   4) Join bots on Rust Canyon → distinct themed geometry; screenshot
//   5) Light gameplay smoke: move / jump / shoot on Base
//
// Usage:
//   node scripts/qa-epic46-tester-playwright.mjs
//   node scripts/qa-epic46-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7798;
const CLIENT_PORT = 5218;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-46");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const EXPECTED_MAP_IDS = [
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
      window.__epic46Tap = window.__epic46Tap || {
        welcomeId: null,
        outbound: [],
        lobbies: [],
        mapStates: [],
        joinAccepted: [],
        joinRejected: [],
        lastSelf: null,
        lastPlayers: null,
      };
      window.__epic46Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic46Tap.outbound.push(msg);
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "welcome") window.__epic46Tap.welcomeId = msg.playerId;
          if (msg.type === "lobby_state") window.__epic46Tap.lobbies.push(msg);
          if (msg.type === "map_state") window.__epic46Tap.mapStates.push(msg);
          if (msg.type === "join_accepted") window.__epic46Tap.joinAccepted.push(msg);
          if (msg.type === "join_rejected") window.__epic46Tap.joinRejected.push(msg);
          if (msg.type === "world_state" && Array.isArray(msg.players)) {
            window.__epic46Tap.lastPlayers = msg.players;
            const selfId = window.__epic46Tap.welcomeId;
            const self = msg.players.find((p) => p.id === selfId);
            if (self) {
              window.__epic46Tap.lastSelf = {
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

async function openLobby(page, nickname = null) {
  await installWsTap(page);
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#mapSelect", { timeout: 15000 });
  await page.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "connected",
    { timeout: 20000 },
  );
  const email = `epic46_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  await registerAndContinue(page, email);
  if (nickname) {
    await page.fill("#nicknameInput", nickname);
    await page.waitForFunction(
      () => {
        const btn = document.getElementById("modeBotsBtn");
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );
  } else {
    await page.waitForFunction(
      () => {
        const inv = document.getElementById("lobbyDeathmatchInventoryBtn");
        return inv && !inv.disabled;
      },
      { timeout: 20000 },
    );
  }
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
    () => (window.__epic46Tap?.mapStates ?? []).length > 0,
    { timeout: 15000 },
  );
}

async function joinPublic(page, nickname, mapId) {
  await selectMap(page, mapId);
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("modePublicBtn");
      return btn && !btn.disabled;
    },
    { timeout: 10000 },
  );
  await page.click("#modePublicBtn");
  await page.waitForFunction(
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => (window.__epic46Tap?.mapStates ?? []).length > 0,
    { timeout: 15000 },
  );
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

/** Matches client/src/fpsController.ts MOUSE_SENSITIVITY. */
const MOUSE_SENSITIVITY = 0.0025;

/** Local yaw mirror — server `lastSelf.yaw` lags behind synthetic mousemove. */
let qaLocalYaw = 0;

async function getSelf(page) {
  return page.evaluate(() => window.__epic46Tap?.lastSelf ?? null);
}

async function syncLocalYawFromSelf(page) {
  const self = await getSelf(page);
  if (typeof self?.yaw === "number") qaLocalYaw = self.yaw;
}

/** Rotate local yaw via synthetic mousemove (pointer-lock listener reads movementX). */
async function faceYaw(page, targetYaw) {
  let delta = targetYaw - qaLocalYaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  // yaw -= movementX * SENS ⇒ movementX = -delta / SENS
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
  // forwardX = -sin(yaw), forwardZ = -cos(yaw) → yaw = atan2(-dx, -dz)
  await faceYaw(page, Math.atan2(-dx, -dz));
}

async function walkMs(page, ms) {
  await page.keyboard.down("KeyW");
  await sleep(ms);
  await page.keyboard.up("KeyW");
  await sleep(80);
}

async function walkToward(page, tx, tz, { timeoutMs = 10000, stopDist = 2.2 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const self = await getSelf(page);
    if (!self?.position) break;
    const dx = tx - self.position.x;
    const dz = tz - self.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= stopDist) return self.position;
    await yawToward(page, tx, tz);
    await walkMs(page, Math.min(450, 100 + dist * 35));
  }
  return (await getSelf(page))?.position ?? null;
}

function summarizeMapState(mapState) {
  if (!mapState) return null;
  const ids = (mapState.geometry ?? []).map((b) => b.id);
  const kinds = {};
  for (const box of mapState.geometry ?? []) {
    kinds[box.kind] = (kinds[box.kind] ?? 0) + 1;
  }
  return {
    bounds: mapState.bounds ?? null,
    boxCount: ids.length,
    kinds,
    buildingIds: ids.filter((id) => /bld|building|door/i.test(id) || id.includes("base_bld")),
    carIds: ids.filter((id) => /car|wreck|shuttle|truck/i.test(id)),
    propCount: kinds.prop ?? 0,
    sampleIds: ids.slice(0, 12),
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = {
    mapPicker: null,
    lobbyList: null,
    baseMatch: null,
    rustCanyon: null,
    gameplay: null,
    consoleErrors: [],
  };

  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic46-qa] starting dedicated server/client");
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
    // --- Lobby map picker ---
    const pageLobby = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    pageLobby.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err}`));
    pageLobby.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await openLobby(pageLobby);
    const picker = await pageLobby.evaluate(() => {
      const select = document.getElementById("mapSelect");
      const options = [...(select?.options ?? [])].map((o) => ({
        value: o.value,
        label: o.textContent?.trim() ?? "",
      }));
      return {
        visible: Boolean(select) && select.offsetParent !== null,
        disabled: select?.disabled ?? true,
        optionCount: options.length,
        values: options.map((o) => o.value),
        labels: options.map((o) => o.label),
        selected: select?.value ?? null,
      };
    });
    summary.mapPicker = picker;
    if (!picker.visible) failures.push("mapSelect not visible in lobby");
    if (picker.optionCount !== 8) failures.push(`expected 8 maps, got ${picker.optionCount}`);
    for (const id of EXPECTED_MAP_IDS) {
      if (!picker.values.includes(id)) failures.push(`missing map option: ${id}`);
    }
    if (!picker.labels.some((l) => /Base/i.test(l))) failures.push("Base label missing");
    if (!picker.labels.some((l) => /Rust Canyon/i.test(l))) {
      failures.push("Rust Canyon label missing");
    }

    await selectMap(pageLobby, "base");
    await pageLobby.fill("#nicknameInput", nick("L46"));
    await pageLobby.screenshot({
      path: join(OUT_DIR, "01-lobby-map-picker.png"),
      fullPage: true,
    });
    console.log("[epic46-qa] lobby map picker captured");

    // --- Public match so lobby list shows map name ---
    const pagePublic = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    pagePublic.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err}`));
    await openLobby(pagePublic);
    const publicNick = nick("P46");
    await joinPublic(pagePublic, publicNick, "rust_canyon");
    await sleep(600);

    // Fresh lobby observer
    const pageList = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    pageList.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err}`));
    await openLobby(pageList);
    await pageList.waitForFunction(
      () => {
        const rows = document.querySelectorAll("#lobbyList .lobby-row");
        return rows.length > 0;
      },
      { timeout: 15000 },
    );
    const lobbyList = await pageList.evaluate(() => {
      const rows = [...document.querySelectorAll("#lobbyList .lobby-row")].map((row) =>
        row.textContent?.trim() ?? "",
      );
      const lastLobby = (window.__epic46Tap?.lobbies ?? []).at(-1);
      return {
        rows,
        matches: (lastLobby?.matches ?? []).map((m) => ({
          id: m.id,
          displayName: m.displayName,
          mapId: m.mapId,
          mapDisplayName: m.mapDisplayName,
          players: m.players,
          maxPlayers: m.maxPlayers,
        })),
      };
    });
    summary.lobbyList = lobbyList;
    const rustRow =
      lobbyList.rows.find((r) => /Rust Canyon|Ржавый/i.test(r)) ||
      lobbyList.matches.find((m) => m.mapId === "rust_canyon");
    if (!rustRow) failures.push("lobby list missing Rust Canyon map name");
    const cap8 = lobbyList.matches.some((m) => m.maxPlayers === 8);
    if (!cap8 && !lobbyList.rows.some((r) => /\/8\b/.test(r))) {
      failures.push("lobby list does not show capacity 8");
    }
    await pageList.screenshot({
      path: join(OUT_DIR, "02-lobby-list-map-name.png"),
      fullPage: true,
    });
    console.log("[epic46-qa] lobby list with map name captured");
    await pageList.close();
    await pagePublic.close();

    // --- Base in-match: building + car ---
    await pageLobby.evaluate(() => {
      if (window.__epic46Tap) {
        window.__epic46Tap.mapStates = [];
        window.__epic46Tap.outbound = [];
        window.__epic46Tap.joinAccepted = [];
      }
    });
    // Return to lobby if still on picker (public used other page). Reload for clean Base bots.
    await openLobby(pageLobby);
    const baseNick = nick("B46");
    await joinBots(pageLobby, baseNick, "base");
    await sleep(800);

    const baseMap = await pageLobby.evaluate(() => {
      const states = window.__epic46Tap?.mapStates ?? [];
      return states[states.length - 1] ?? null;
    });
    const baseSummary = summarizeMapState(baseMap);
    summary.baseMatch = {
      mapSummary: baseSummary,
      joinMapId: await pageLobby.evaluate(() => {
        const joins = (window.__epic46Tap?.outbound ?? []).filter((m) => m.type === "join");
        return joins[joins.length - 1]?.mapId ?? null;
      }),
      self: await pageLobby.evaluate(() => window.__epic46Tap?.lastSelf ?? null),
    };

    if (summary.baseMatch.joinMapId !== "base") {
      failures.push(`Base join mapId: ${summary.baseMatch.joinMapId}`);
    }
    if (!baseSummary || baseSummary.boxCount < 20) {
      failures.push(`Base map_state too small: ${JSON.stringify(baseSummary)}`);
    }
    if (!baseSummary?.buildingIds?.length) {
      failures.push("Base map_state missing building wall ids (base_bld_*)");
    }
    if (!baseSummary?.carIds?.length) {
      failures.push("Base map_state missing car prop ids (base_car_*)");
    }
    if ((baseSummary?.propCount ?? 0) < 4) {
      failures.push(`Base expected car props, propCount=${baseSummary?.propCount}`);
    }
    if (
      !baseSummary?.bounds ||
      Math.abs(baseSummary.bounds.minX) < 90 ||
      Math.abs(baseSummary.bounds.maxX) < 90
    ) {
      failures.push(`Base bounds not expanded: ${JSON.stringify(baseSummary?.bounds)}`);
    }

    const locked = await pointerLock(pageLobby);
    await sleep(300);
    await syncLocalYawFromSelf(pageLobby);
    await pageLobby.screenshot({ path: join(OUT_DIR, "03-base-in-match-spawn.png") });

    // Movement smoke immediately after spawn (before landmark walks).
    const beforePos = await pageLobby.evaluate(() => window.__epic46Tap?.lastSelf?.position ?? null);
    await pageLobby.keyboard.down("KeyW");
    await sleep(700);
    await pageLobby.keyboard.up("KeyW");
    await sleep(200);
    const afterMove = await pageLobby.evaluate(() => window.__epic46Tap?.lastSelf?.position ?? null);
    await pageLobby.screenshot({ path: join(OUT_DIR, "06-base-movement.png") });
    const moved =
      beforePos &&
      afterMove &&
      (Math.abs(beforePos.x - afterMove.x) > 0.2 || Math.abs(beforePos.z - afterMove.z) > 0.2);

    // --- F-002 landmark framing: temporary camera poses + best-effort walks ---
    // Poses do not depend on surviving bot fire; walks still record enterability
    // when the player reaches the building/car.
    const buildingDoor = { x: -68, z: -30 };
    const buildingInterior = { x: -72, z: -21 };
    const carTarget = { x: 58, z: -2 };

    async function holdQaPose(eye, look) {
      await pageLobby.evaluate(
        ({ eye: e, look: l }) => {
          window.__cwQaHoldPose = { eye: e, look: l };
        },
        { eye, look },
      );
      await sleep(150);
    }
    async function clearQaPose() {
      await pageLobby.evaluate(() => {
        window.__cwQaHoldPose = null;
      });
    }

    // Exterior → south door opening (look into the building through the gap).
    await holdQaPose(
      { x: -68, y: 1.7, z: -36 },
      { x: -68, y: 1.4, z: -22 },
    );
    await pageLobby.screenshot({ path: join(OUT_DIR, "04-base-building-approach.png") });

    // Readable car AABB silhouette from a clear north vantage.
    await holdQaPose(
      { x: 50, y: 2.2, z: 10 },
      { x: 58, y: 0.7, z: -2 },
    );
    await pageLobby.screenshot({ path: join(OUT_DIR, "05-base-car-area.png") });
    await clearQaPose();

    // Best-effort navigation for position evidence (bots may interrupt).
    await walkToward(pageLobby, buildingDoor.x, buildingDoor.z - 2.5, {
      timeoutMs: 6000,
      stopDist: 1.5,
    });
    const buildingApproachPos = await getSelf(pageLobby);
    // Enter via door center, then step to the known free interior sample.
    await walkToward(pageLobby, -68, -26, { timeoutMs: 4000, stopDist: 1.5 });
    await walkToward(pageLobby, buildingInterior.x, buildingInterior.z, {
      timeoutMs: 5000,
      stopDist: 1.8,
    });
    const buildingInteriorPos = await getSelf(pageLobby);

    await walkToward(pageLobby, -68, -6, { timeoutMs: 4000, stopDist: 2 });
    await walkToward(pageLobby, -42, 0, { timeoutMs: 5000, stopDist: 2 });
    await walkToward(pageLobby, 42, 0, { timeoutMs: 10000, stopDist: 2.5 });
    await walkToward(pageLobby, 48, 6, { timeoutMs: 5000, stopDist: 2 });
    const carAreaPos = await getSelf(pageLobby);

    await pageLobby.keyboard.down("Space");
    await sleep(150);
    await pageLobby.screenshot({ path: join(OUT_DIR, "07-base-jump.png") });
    await pageLobby.keyboard.up("Space");
    await sleep(200);

    await pageLobby.mouse.down({ button: "left" });
    await sleep(120);
    await pageLobby.mouse.up({ button: "left" });
    await sleep(250);
    await pageLobby.screenshot({ path: join(OUT_DIR, "08-base-fire.png") });

    const spawnPos = summary.baseMatch.self?.position ?? null;
    const endPos = await pageLobby.evaluate(() => window.__epic46Tap?.lastSelf?.position ?? null);
    const sessionMoved =
      spawnPos &&
      endPos &&
      (Math.abs(spawnPos.x - endPos.x) > 0.5 || Math.abs(spawnPos.z - endPos.z) > 0.5);

    const nearBuilding =
      buildingInteriorPos?.position &&
      Math.hypot(
        buildingInteriorPos.position.x - buildingInterior.x,
        buildingInteriorPos.position.z - buildingInterior.z,
      ) < 8;
    const nearCar =
      carAreaPos?.position &&
      Math.hypot(carAreaPos.position.x - carTarget.x, carAreaPos.position.z - carTarget.z) < 16;

    summary.gameplay = {
      pointerLocked: locked,
      beforePos,
      afterMove,
      moved: Boolean(moved),
      spawnPos,
      endPos,
      sessionMoved: Boolean(sessionMoved),
      buildingApproachPos: buildingApproachPos?.position ?? null,
      buildingInteriorPos: buildingInteriorPos?.position ?? null,
      carAreaPos: carAreaPos?.position ?? null,
      nearBuilding: Boolean(nearBuilding),
      nearCar: Boolean(nearCar),
      landmarkShots: {
        building: "04-base-building-approach.png (posed door opening)",
        car: "05-base-car-area.png (posed car silhouette)",
      },
    };
    if (!moved && !sessionMoved) {
      failures.push("movement did not change player position on Base");
    }
    // Landmark screenshot poses are the F-002 evidence gate; walks are best-effort
    // (bots can kill the player mid-route).
    console.log("[epic46-qa] Base in-match evidence captured");

    // --- Themed map: Rust Canyon ---
    const pageTheme = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    pageTheme.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err}`));
    await openLobby(pageTheme);
    const themeNick = nick("R46");
    await joinBots(pageTheme, themeNick, "rust_canyon");
    await sleep(800);
    const rustMap = await pageTheme.evaluate(() => {
      const states = window.__epic46Tap?.mapStates ?? [];
      return states[states.length - 1] ?? null;
    });
    const rustSummary = summarizeMapState(rustMap);
    const rustJoin = await pageTheme.evaluate(() => {
      const joins = (window.__epic46Tap?.outbound ?? []).filter((m) => m.type === "join");
      return joins[joins.length - 1]?.mapId ?? null;
    });
    summary.rustCanyon = { mapSummary: rustSummary, joinMapId: rustJoin };

    if (rustJoin !== "rust_canyon") failures.push(`Rust Canyon join mapId: ${rustJoin}`);
    if (!rustSummary || rustSummary.boxCount < 10) {
      failures.push(`Rust Canyon map_state too small: ${JSON.stringify(rustSummary)}`);
    }
    // Distinct from Base: should include wreck/tank props, not only base_bld
    const rustDistinct =
      (rustSummary?.carIds?.length ?? 0) > 0 ||
      (rustSummary?.sampleIds ?? []).some((id) => id.startsWith("rc_"));
    if (!rustDistinct) {
      failures.push("Rust Canyon geometry does not look themed (missing rc_* / wreck ids)");
    }
    if (
      baseSummary &&
      rustSummary &&
      JSON.stringify(baseSummary.sampleIds) === JSON.stringify(rustSummary.sampleIds)
    ) {
      failures.push("Rust Canyon geometry identical sample to Base — map_state may not swap");
    }

    await pointerLock(pageTheme);
    await pageTheme.keyboard.down("KeyW");
    await sleep(600);
    await pageTheme.keyboard.up("KeyW");
    await pageTheme.screenshot({ path: join(OUT_DIR, "09-rust-canyon-in-match.png") });
    console.log("[epic46-qa] Rust Canyon evidence captured");
    await pageTheme.close();
    await pageLobby.close();

    const hardErrors = consoleErrors.filter(
      (e) => !/favicon/i.test(e) && !/WebGL/i.test(e) && !/DEPRECATED/i.test(e),
    );
    summary.consoleErrors = hardErrors;
    const pageErrors = hardErrors.filter((e) => e.startsWith("pageerror:"));
    if (pageErrors.length) failures.push(`pageerrors: ${pageErrors.join(" | ")}`);

    await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));

    if (failures.length) {
      console.error("[epic46-qa] FAIL");
      for (const f of failures) console.error(" -", f);
      await writeFile(join(OUT_DIR, "failures.txt"), failures.join("\n") + "\n");
      process.exitCode = 1;
    } else {
      console.log("[epic46-qa] ALL PASS");
      await writeFile(join(OUT_DIR, "playwright-run.log"), "ALL PASS\n", "utf8");
    }
  } finally {
    await browser.close().catch(() => {});
    if (stack) {
      await Promise.race([
        (async () => {
          await stop(stack.client);
          await stop(stack.server);
        })(),
        sleep(5000),
      ]);
    }
  }
}

main()
  .catch(async (err) => {
    console.error("[epic46-qa] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Force exit — vite/tsx children can keep the event loop alive after SIGTERM.
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });
