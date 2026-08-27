// EPIC 54 Playwright: recapture About page screenshots from current UI.
//
// Usage:
//   node scripts/qa-epic54-programmer-playwright.mjs
//   node scripts/qa-epic54-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const ABOUT_DIR = join(CLIENT_ROOT, "public", "about");

const SERVER_PORT = 7864;
const CLIENT_PORT = 5264;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-54");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const ABOUT_ASSETS = [
  "inventory.png",
  "pets-inventory.png",
  "modes.png",
  "maps.png",
  "combat.png",
  "auction.png",
  "pause.png",
  "gameplay.png",
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
      window.__epic54Tap = window.__epic54Tap || { profiles: [], joinAccepted: [], mapStates: [] };
      window.__epic54Tap.ws = ws;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "economy_profile") window.__epic54Tap.profiles.push(msg);
          if (msg.type === "join_accepted") window.__epic54Tap.joinAccepted.push(msg);
          if (msg.type === "map_state") window.__epic54Tap.mapStates.push(msg);
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

async function seedLoadout(nickname) {
  const helper = join(OUT_DIR, "_seed-loadout.mjs");
  await writeFile(
    helper,
    `import { EconomyStore } from "../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${JSON.stringify(nickname)};
const now = Date.now();
const scope = "deathmatch";
await store.getOrCreateProfile(nick, scope);
const dog = await store.grantPetForTests(nick, "dog", 156, now, scope);
const cat = await store.grantPetForTests(nick, "cat", 80, now, scope);
const bird = await store.grantPetForTests(nick, "bird", 40, now, scope);
const lion = await store.grantPetForTests(nick, "lion", 100, now, scope);
const gemArmor = await store.grantGem(nick, "armor", 20, now, undefined, scope);
const gemSpeed = await store.grantGem(nick, "speed", 10, now, undefined, scope);
const gemDamage = await store.grantGem(nick, "damage", 12, now, undefined, scope);
await store.socketGem(nick, gemArmor.id, dog.id, now, scope);
await store.socketGem(nick, gemSpeed.id, dog.id, now, scope);
await store.socketGem(nick, gemDamage.id, cat.id, now, scope);
await store.equipPet(nick, dog.id, 1, now, scope);
const amulet = await store.grantAmulet(nick, now, scope);
await store.equipAmulet(nick, amulet.id, now, scope);
await store.equipPet(nick, cat.id, 2, now, scope);
for (let i = 0; i < 18; i++) {
  try { await store.grantStimulator(nick, now, scope); } catch { /* soft-cap */ }
}
for (let i = 0; i < 12; i++) {
  try { await store.grantRepairKit(nick, now, scope); } catch { /* soft-cap */ }
}
await store.close();
console.log(JSON.stringify({ ok: true, dogId: dog.id, catId: cat.id, amuletId: amulet.id }));
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

async function saveBeforeCopies() {
  const beforeDir = join(OUT_DIR, "before");
  await mkdir(beforeDir, { recursive: true });
  for (const name of ABOUT_ASSETS) {
    await copyFile(join(ABOUT_DIR, name), join(beforeDir, name));
  }
}

async function openDeathmatchInventory(page) {
  const profileBefore = await page.evaluate(() => (window.__epic54Tap?.profiles ?? []).length);
  await page.click("#lobbyDeathmatchInventoryBtn");
  await page.waitForFunction(
    () => document.getElementById("inventoryOverlay")?.classList.contains("visible"),
    { timeout: 10000 },
  );
  await page.waitForFunction(
    (prev) => (window.__epic54Tap?.profiles ?? []).length > prev,
    profileBefore,
    { timeout: 15000 },
  );
  await sleep(500);
}

async function inspectInventory(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById("inventoryOverlay");
    const grid = document.getElementById("inventoryGrid");
    const hero = document.getElementById("inventoryHeroPreview");
    const caps = document.getElementById("inventoryCaps");
    const cells = grid ? grid.querySelectorAll(".inv-cell").length : 0;
    return {
      visible: overlay?.classList.contains("visible") ?? false,
      cellCount: cells,
      capsText: caps?.textContent ?? "",
      heroTitle: hero?.querySelector(".inv-hero-title")?.textContent ?? "",
      heroStats: document.getElementById("inventoryHeroStats")?.innerText ?? "",
      pet1: document.getElementById("inventoryHeroPet1")?.innerText ?? "",
      pet2: document.getElementById("inventoryHeroPet2")?.innerText ?? "",
      amuletVisible: (() => {
        const a = document.getElementById("inventoryHeroAmulet");
        return a ? !a.hidden : false;
      })(),
    };
  });
}

async function closeInventory(page) {
  const closeBtn = page.locator("#inventoryCloseBtn");
  if (await closeBtn.isVisible().catch(() => false)) {
    await closeBtn.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await page.waitForFunction(
    () => !document.getElementById("inventoryOverlay")?.classList.contains("visible"),
    { timeout: 8000 },
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(OUT_DIR, "after"), { recursive: true });
  await saveBeforeCopies();

  const notes = [];
  const failures = [];
  let server;
  let client;

  try {
    if (MANAGE_STACK) {
      ({ server, client } = await startStack());
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await installWsTap(page);

    const nickname = nick("E54");
    const email = `${nickname.toLowerCase()}@example.com`;

    await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("cubewars.locale", "en");
    });
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await registerAndContinue(page, email);
    await page.waitForFunction(
      () => document.getElementById("status")?.dataset.state === "connected",
      { timeout: 15000 },
    );
    await page.fill("#nicknameInput", nickname);
    await page.waitForFunction(
      () => {
        const btn = document.getElementById("lobbyDeathmatchInventoryBtn");
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );
    await sleep(600);

    // --- Lobby: modes + maps ---
    await page.screenshot({ path: join(OUT_DIR, "after", "modes.png"), fullPage: false });
    await page.locator("#mapSelect").focus();
    await page.locator("#mapSelect").evaluate((el) => {
      el.size = Math.min(8, el.options.length || 8);
    });
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, "after", "maps.png"), fullPage: false });
    await page.locator("#mapSelect").evaluate((el) => {
      el.size = 1;
    });
    notes.push("captured modes.png + maps.png from lobby");

    // --- Seed + inventory / pets-inventory ---
    await seedLoadout(nickname);
    await openDeathmatchInventory(page);

    // Ensure seed visible (reopen if race)
    const seeded = await page
      .waitForFunction(
        () =>
          (window.__epic54Tap?.profiles ?? []).some(
            (p) => p.economyPool === "deathmatch" && (p.pets?.length ?? 0) >= 2,
          ),
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!seeded) {
      await closeInventory(page);
      await sleep(300);
      await openDeathmatchInventory(page);
    }
    await sleep(400);

    const state = await inspectInventory(page);
    notes.push(`cellCount=${state.cellCount}`);
    notes.push(`caps=${state.capsText}`);
    notes.push(`heroTitle=${state.heroTitle}`);
    notes.push(`heroStats=${state.heroStats.replace(/\n/g, " | ")}`);
    notes.push(`pet1=${state.pet1.replace(/\n/g, " ")}`);
    notes.push(`pet2=${state.pet2.replace(/\n/g, " ")}`);
    notes.push(`amuletVisible=${state.amuletVisible}`);

    if (!state.visible) failures.push("inventory overlay not visible");
    if (state.cellCount !== 30) failures.push(`expected 30 cells, got ${state.cellCount}`);
    if (!state.capsText.includes("/30")) failures.push(`caps missing /30: ${state.capsText}`);
    if (!/loadout/i.test(state.heroTitle)) failures.push(`LOADOUT title missing: ${state.heroTitle}`);
    if (!state.amuletVisible) failures.push("equipped amulet not visible in loadout");
    if (!/dog/i.test(state.pet1)) failures.push("slot1 dog not shown");
    if (!/cat/i.test(state.pet2)) failures.push("slot2 cat not shown");
    if (/\/64|\bDR\b|8×8|8x8/i.test(state.capsText + state.heroStats)) {
      failures.push("stale 64/DR chrome still present in inventory UI text");
    }

    await page.screenshot({ path: join(OUT_DIR, "after", "inventory.png"), fullPage: false });
    await page.screenshot({ path: join(OUT_DIR, "after", "pets-inventory.png"), fullPage: false });
    await page.screenshot({
      path: join(OUT_DIR, "01-inventory-6x5-loadout.png"),
      fullPage: false,
    });

    const heroBox = await page.locator("#inventoryHeroPreview").boundingBox();
    if (heroBox) {
      await page.screenshot({
        path: join(OUT_DIR, "02-loadout-closeup.png"),
        clip: {
          x: Math.max(0, heroBox.x - 8),
          y: Math.max(0, heroBox.y - 8),
          width: Math.min(340, heroBox.width + 16),
          height: Math.min(460, heroBox.height + 16),
        },
      });
    }

    await closeInventory(page);

    // --- Auction from lobby ---
    await page.click("#lobbyAuctionBtn");
    await page.waitForFunction(
      () => document.getElementById("auctionOverlay")?.classList.contains("visible"),
      { timeout: 10000 },
    );
    await sleep(400);
    await page.screenshot({ path: join(OUT_DIR, "after", "auction.png"), fullPage: false });
    notes.push("captured auction.png from lobby Deathmatch auction");
    const auctionClose = page.locator("#auctionCloseBtn");
    if (await auctionClose.isVisible().catch(() => false)) {
      await auctionClose.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForFunction(
      () => !document.getElementById("auctionOverlay")?.classList.contains("visible"),
      { timeout: 8000 },
    );

    // --- vs Bots match: gameplay / combat / pause ---
    await page.selectOption("#mapSelect", "base");
    await page.click("#modeBotsBtn");
    await page.waitForFunction(
      () => (window.__epic54Tap?.joinAccepted ?? []).length > 0,
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 15000 },
    );
    await sleep(1200);

    // Click canvas to request pointer lock (best-effort in headless)
    await page.locator("canvas").click({ position: { x: 640, y: 400 } }).catch(() => {});
    await sleep(800);
    await page.screenshot({ path: join(OUT_DIR, "after", "gameplay.png"), fullPage: false });
    await page.screenshot({ path: join(OUT_DIR, "after", "combat.png"), fullPage: false });
    notes.push("captured gameplay.png + combat.png in vs Bots match");

    await page.keyboard.press("Escape");
    const pauseVisible = await page
      .waitForFunction(
        () => document.getElementById("pauseMenu")?.classList.contains("visible") === true,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!pauseVisible) failures.push("pause menu not visible after Escape");
    await sleep(400);
    await page.screenshot({ path: join(OUT_DIR, "after", "pause.png"), fullPage: false });
    notes.push("captured pause.png from ESC menu");

    // Promote after/ → committed about assets
    for (const name of ABOUT_ASSETS) {
      await copyFile(join(OUT_DIR, "after", name), join(ABOUT_DIR, name));
    }
    notes.push(`promoted ${ABOUT_ASSETS.length} PNGs into client/public/about/`);

    await writeFile(
      join(OUT_DIR, "notes.txt"),
      notes.concat(failures.map((f) => `FAIL: ${f}`)).join("\n") + "\n",
    );
    await browser.close();

    if (failures.length) {
      console.error("EPIC 54 QA failures:\n" + failures.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("EPIC 54 evidence written to", OUT_DIR);
    }
    console.log(notes.join("\n"));
  } finally {
    if (MANAGE_STACK) {
      await stop(client);
      await stop(server);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
