// EPIC 50 Playwright: half-size map wide shots + pet inventory clarity/icons.
//
// Usage:
//   node scripts/qa-epic50-programmer-playwright.mjs
//   node scripts/qa-epic50-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7850;
const CLIENT_PORT = 5250;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-50");
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
      window.__epic50Tap = window.__epic50Tap || {
        outbound: [],
        mapStates: [],
        joinAccepted: [],
        leaveAcks: [],
        profiles: [],
      };
      window.__epic50Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic50Tap.outbound.push(msg);
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "map_state") window.__epic50Tap.mapStates.push(msg);
          if (msg.type === "join_accepted") window.__epic50Tap.joinAccepted.push(msg);
          if (msg.type === "leave_match_ack") window.__epic50Tap.leaveAcks.push(msg);
          if (msg.type === "economy_profile") window.__epic50Tap.profiles.push(msg);
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
  const email = `epic50_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
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
  const sent = await page.evaluate(() => {
    const ws = window.__epic50Tap?.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "leave_match" }));
      return true;
    }
    return false;
  });
  if (!sent) {
    await page.keyboard.press("Escape");
    await page.click("#pauseExitLobbyBtn").catch(() => {});
  }
  await page.waitForFunction(
    () => (window.__epic50Tap?.leaveAcks ?? []).length > 0,
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => !document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await sleep(400);
  await page.evaluate(() => {
    if (window.__epic50Tap) {
      window.__epic50Tap.mapStates = [];
      window.__epic50Tap.joinAccepted = [];
      window.__epic50Tap.leaveAcks = [];
      window.__epic50Tap.outbound = [];
    }
  });
}

async function joinMapAndShot(page, mapId, index) {
  const beforeCount = await page.evaluate(() => (window.__epic50Tap?.mapStates ?? []).length);
  await page.selectOption("#mapSelect", mapId);
  await page.evaluate((id) => localStorage.setItem("cubewars.mapId", id), mapId);
  await page.click("#modeBotsBtn");
  await page.waitForFunction(
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await page.waitForFunction(
    (prev) => (window.__epic50Tap?.mapStates ?? []).length > prev,
    beforeCount,
    { timeout: 15000 },
  );
  await sleep(700);

  const info = await page.evaluate(() => {
    const mapState = (window.__epic50Tap?.mapStates ?? []).at(-1) ?? null;
    const accepted = (window.__epic50Tap?.joinAccepted ?? []).at(-1) ?? null;
    const walls = (mapState?.geometry ?? []).filter((b) => b.kind === "wall");
    const maxWallH = walls.reduce((m, b) => Math.max(m, b.size?.y ?? 0), 0);
    const bounds = mapState?.bounds ?? null;
    return {
      mapId: mapState?.mapId ?? accepted?.mapId ?? null,
      boxCount: mapState?.geometry?.length ?? 0,
      maxWallH,
      bounds,
    };
  });

  // Half-size arena: camera closer than EPIC 49 (eye z ~23 vs ~46).
  await page.evaluate(() => {
    window.__cwQaHoldPose = {
      eye: { x: 0, y: 5.5, z: 23 },
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
    `[epic50-qa] shot ${mapId} → ${shotPath} (boxes=${info.boxCount}, maxWallH=${info.maxWallH}, bounds=${JSON.stringify(info.bounds)})`,
  );
  return {
    mapId,
    expected: mapId,
    got: info.mapId,
    boxCount: info.boxCount,
    maxWallH: info.maxWallH,
    bounds: info.bounds,
    shotPath,
  };
}

async function seedPets(nickname) {
  const helper = join(OUT_DIR, "_seed-pets.mjs");
  await writeFile(
    helper,
    `import { EconomyStore } from "../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${JSON.stringify(nickname)};
const now = Date.now();
const scope = "deathmatch";
const dog = await store.grantPetForTests(nick, "dog", 156, now, scope);
const cat = await store.grantPetForTests(nick, "cat", 80, now, scope);
const bird = await store.grantPetForTests(nick, "bird", 40, now, scope);
const lion = await store.grantPetForTests(nick, "lion", 100, now, scope);
const gemArmor = await store.grantGem(nick, "armor", 20, now, undefined, scope);
const gemSpeed = await store.grantGem(nick, "speed", 10, now, undefined, scope);
await store.socketGem(nick, gemArmor.id, dog.id, now, scope);
await store.socketGem(nick, gemSpeed.id, dog.id, now, scope);
await store.equipPet(nick, dog.id, 1, now, scope);
await store.close();
console.log(JSON.stringify({ dogId: dog.id, catId: cat.id, birdId: bird.id, lionId: lion.id }));
`,
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", helper], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString();
    });
    child.stderr.on("data", (b) => {
      err += b.toString();
    });
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`seed failed: ${err || out}`));
      try {
        const line = out
          .trim()
          .split("\n")
          .filter((l) => l.startsWith("{"))
          .pop();
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`seed parse fail: ${out}\n${err}\n${e}`));
      }
    });
  });
}

async function capturePetInventory(page, nickname, failures) {
  await seedPets(nickname);

  await page.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "connected",
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => !document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 10000 },
  );
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("lobbyDeathmatchInventoryBtn");
      return btn && !btn.disabled;
    },
    { timeout: 20000 },
  );

  const profileBefore = await page.evaluate(() => (window.__epic50Tap?.profiles ?? []).length);
  await page.click("#lobbyDeathmatchInventoryBtn");
  await page.waitForFunction(
    () => document.getElementById("inventoryOverlay")?.classList.contains("visible"),
    { timeout: 10000 },
  );
  await page.waitForFunction(
    (prev) => (window.__epic50Tap?.profiles ?? []).length > prev,
    profileBefore,
    { timeout: 15000 },
  );
  // Soft wait for seeded pets to appear (may need one more open if race)
  const hasPets = await page
    .waitForFunction(
      () =>
        (window.__epic50Tap?.profiles ?? []).some(
          (p) => p.economyPool === "deathmatch" && (p.pets?.length ?? 0) >= 4,
        ),
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!hasPets) {
    // Close and reopen after seed settles
    await page.keyboard.press("Escape");
    await sleep(300);
    await page.click("#lobbyDeathmatchInventoryBtn");
    await page.waitForFunction(
      () =>
        (window.__epic50Tap?.profiles ?? []).some(
          (p) => p.economyPool === "deathmatch" && (p.pets?.length ?? 0) >= 4,
        ),
      { timeout: 15000 },
    );
  }
  await sleep(400);

  const bagPath = join(OUT_DIR, "09-pet-bag-icons.png");
  await page.screenshot({ path: bagPath, fullPage: false });

  const inspect = await page.evaluate(() => {
    const icons = [...document.querySelectorAll(".inv-icon-pet")].map((el) => el.className);
    const metas = [...document.querySelectorAll(".inv-item-pet .inv-item-meta, .inv-item.inv-item-pet .inv-item-meta")].map(
      (el) => (el.textContent || "").trim(),
    );
    // Fallback: any inv-item-meta under pet items
    const petMetas = [...document.querySelectorAll(".inv-item")].map((el) => {
      const icon = el.querySelector(".inv-icon-pet");
      if (!icon) return null;
      return {
        iconClass: icon.className,
        meta: (el.querySelector(".inv-item-meta")?.textContent || "").trim(),
      };
    }).filter(Boolean);
    const rail = (document.getElementById("inventoryRail")?.innerText || "").trim();
    return { icons, metas, petMetas, rail };
  });

  console.log("[epic50-qa] pet bag inspect", JSON.stringify(inspect, null, 2));

  for (const species of ["dog", "cat", "bird", "lion"]) {
    if (!inspect.icons.some((c) => c.includes(`inv-icon-pet-${species}`))) {
      failures.push(`missing pet icon class for ${species}`);
    }
  }
  if (inspect.icons.some((c) => c.includes("inv-icon-pet-eye"))) {
    failures.push("legacy pig-snout eye classes still present");
  }

  // Equip rail already has the socketed dog — assert grant copy there first.
  const railText = await page.evaluate(
    () => (document.getElementById("inventoryRail")?.innerText || "").trim(),
  );
  console.log("[epic50-qa] rail:", railText.replace(/\n/g, " | "));
  if (!/\+\d+\s+Armor/.test(railText)) {
    failures.push(`equip rail missing Armor grant: ${railText}`);
  }
  if (!/Gems:/.test(railText) || !/Total/.test(railText)) {
    failures.push(`equip rail missing gems/totals: ${railText}`);
  }
  const railPath = join(OUT_DIR, "11-pet-equip-rail.png");
  await page.screenshot({ path: railPath, fullPage: false });

  // Unequip dog so it returns to the bag, then click it for detail panel grants.
  const unequipped = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /unequip/i.test(b.textContent || ""),
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!unequipped) failures.push("could not click Unequip on pet rail");
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll(".inv-item")].some((el) =>
          el.querySelector(".inv-icon-pet-dog"),
        ),
      { timeout: 10000 },
    )
    .catch(() => failures.push("dog did not return to bag after unequip"));
  await sleep(300);

  const dogItem = page.locator(".inv-item").filter({ has: page.locator(".inv-icon-pet-dog") }).first();
  if ((await dogItem.count()) === 0) {
    failures.push("could not find dog pet cell after unequip");
  } else {
    await dogItem.click({ position: { x: 8, y: 8 } });
  }
  await sleep(500);

  const detailsText = await page.evaluate(
    () => (document.getElementById("inventoryDetails")?.innerText || "").trim(),
  );
  console.log("[epic50-qa] details:", detailsText.replace(/\n/g, " | "));
  if (!/\+\d+\s+Armor/.test(detailsText)) {
    failures.push(`detail missing Armor grant: ${detailsText}`);
  }
  if (!/Gems:/.test(detailsText) || !/Total/.test(detailsText)) {
    failures.push(`detail missing gems/totals: ${detailsText}`);
  }

  const detailPath = join(OUT_DIR, "10-pet-detail-grants.png");
  await page.screenshot({ path: detailPath, fullPage: false });

  return { bagPath, detailPath, railPath, inspect, detailsText, railText };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const results = [];
  const failures = [];

  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic50-qa] starting dedicated server/client");
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
    const nickname = nick("E50");
    await openLobby(page, nickname);

    // Story B first (fresh lobby connection), then Story A map shots.
    const pet = await capturePetInventory(page, nickname, failures);
    results.push({ pet });

    // Close lobby inventory before map joins (Escape alone may not dismiss it).
    await page.evaluate(() => {
      const close = document.getElementById("inventoryCloseBtn");
      if (close instanceof HTMLElement) close.click();
      const overlay = document.getElementById("inventoryOverlay");
      if (overlay) {
        overlay.classList.remove("visible");
        overlay.setAttribute("aria-hidden", "true");
      }
    });
    await page.keyboard.press("Escape").catch(() => {});
    await sleep(400);
    await page.waitForFunction(
      () => !document.getElementById("inventoryOverlay")?.classList.contains("visible"),
      { timeout: 5000 },
    ).catch(() => {});

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
      const b = row.bounds;
      if (!b || Math.abs(b.minX) !== 46 || Math.abs(b.maxX) !== 46 || Math.abs(b.minZ) !== 26 || Math.abs(b.maxZ) !== 26) {
        failures.push(`${mapId}: bounds not half-size (±46/±26): ${JSON.stringify(b)}`);
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
    console.error("[epic50-qa] FAIL", failures);
    process.exit(1);
  }
  console.log("[epic50-qa] OK — map + pet shots written");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
