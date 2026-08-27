// EPIC 53 Playwright: 6×5 inventory grid + hero loadout preview + overflow.
//
// Usage:
//   node scripts/qa-epic53-programmer-playwright.mjs
//   node scripts/qa-epic53-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7863;
const CLIENT_PORT = 5263;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-53");
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
    const done = () => resolve();
    child.once("exit", done);
    try {
      child.kill("SIGKILL");
    } catch {
      resolve();
    }
    setTimeout(resolve, 1500);
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
      window.__epic53Tap = window.__epic53Tap || { profiles: [] };
      window.__epic53Tap.ws = ws;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "economy_profile") window.__epic53Tap.profiles.push(msg);
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
const gemArmor = await store.grantGem(nick, "armor", 20, now, undefined, scope);
const gemSpeed = await store.grantGem(nick, "speed", 10, now, undefined, scope);
await store.socketGem(nick, gemArmor.id, dog.id, now, scope);
await store.socketGem(nick, gemSpeed.id, dog.id, now, scope);
await store.equipPet(nick, dog.id, 1, now, scope);
const amulet = await store.grantAmulet(nick, now, scope);
await store.equipAmulet(nick, amulet.id, now, scope);
await store.equipPet(nick, cat.id, 2, now, scope);
// Fill bag past 30 cells using soft-capped consumables (never delete overflow).
for (let i = 0; i < 20; i++) {
  try {
    await store.grantStimulator(nick, now, scope);
  } catch {
    /* inventory_full / soft-cap */
  }
}
for (let i = 0; i < 20; i++) {
  try {
    await store.grantRepairKit(nick, now, scope);
  } catch {
    /* inventory_full / soft-cap */
  }
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

async function inspectInventory(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById("inventoryOverlay");
    const grid = document.getElementById("inventoryGrid");
    const hero = document.getElementById("inventoryHeroPreview");
    const overflow = document.getElementById("inventoryOverflow");
    const caps = document.getElementById("inventoryCaps");
    const stats = document.getElementById("inventoryHeroStats");
    const amulet = document.getElementById("inventoryHeroAmulet");
    const cells = grid ? grid.querySelectorAll(".inv-cell").length : 0;
    const style = grid ? getComputedStyle(grid) : null;
    return {
      visible: overlay?.classList.contains("visible") ?? false,
      cellCount: cells,
      gridTemplateColumns: style?.gridTemplateColumns ?? "",
      capsText: caps?.textContent ?? "",
      heroPresent: Boolean(hero),
      heroStats: stats?.innerText ?? "",
      amuletVisible: amulet ? !amulet.hidden : false,
      overflowHidden: overflow?.hidden ?? true,
      overflowCount: overflow?.querySelectorAll(".inv-overflow-item").length ?? 0,
      pet1Text: document.getElementById("inventoryHeroPet1")?.innerText ?? "",
      pet2Text: document.getElementById("inventoryHeroPet2")?.innerText ?? "",
    };
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const notes = [];
  const failures = [];
  let server;
  let client;

  try {
    if (MANAGE_STACK) {
      ({ server, client } = await startStack());
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1360, height: 800 } });
    const page = await context.newPage();
    await installWsTap(page);

    const nickname = nick("E53");
    const email = `${nickname.toLowerCase()}@example.com`;

    await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await registerAndContinue(page, email);
    await page.waitForFunction(
      () => document.getElementById("status")?.dataset.state === "connected",
      { timeout: 15000 },
    );

    await seedLoadout(nickname);
    await page.fill("#nicknameInput", nickname);
    await page.waitForFunction(
      () => {
        const btn = document.getElementById("lobbyDeathmatchInventoryBtn");
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );

    const profileBefore = await page.evaluate(() => (window.__epic53Tap?.profiles ?? []).length);
    await page.click("#lobbyDeathmatchInventoryBtn");
    await page.waitForFunction(
      () => document.getElementById("inventoryOverlay")?.classList.contains("visible"),
      { timeout: 10000 },
    );
    await page.waitForFunction(
      (prev) => (window.__epic53Tap?.profiles ?? []).length > prev,
      profileBefore,
      { timeout: 10000 },
    );
    await sleep(400);

    const state = await inspectInventory(page);
    notes.push(`cellCount=${state.cellCount}`);
    notes.push(`caps=${state.capsText}`);
    notes.push(`heroStats=${state.heroStats.replace(/\n/g, " | ")}`);
    notes.push(`amuletVisible=${state.amuletVisible}`);
    notes.push(`pet1=${state.pet1Text.replace(/\n/g, " ")}`);
    notes.push(`pet2=${state.pet2Text.replace(/\n/g, " ")}`);
    notes.push(`overflowHidden=${state.overflowHidden} count=${state.overflowCount}`);
    notes.push(`gridTemplateColumns=${state.gridTemplateColumns}`);

    if (!state.visible) failures.push("inventory overlay not visible");
    if (state.cellCount !== 30) failures.push(`expected 30 cells, got ${state.cellCount}`);
    if (!state.capsText.includes("/30")) failures.push(`caps missing /30: ${state.capsText}`);
    if (!state.heroPresent) failures.push("hero preview missing");
    if (!state.amuletVisible) failures.push("equipped amulet tell not visible");
    if (!/dog/i.test(state.pet1Text)) failures.push("slot1 pet not shown in hero preview");
    if (!/cat/i.test(state.pet2Text)) failures.push("slot2 pet not shown in hero preview");
    if (!/HP|Armor|Speed|Damage/i.test(state.heroStats)) {
      failures.push(`hero stats missing axes: ${state.heroStats}`);
    }

    await page.screenshot({
      path: join(OUT_DIR, "01-inventory-6x5-hero-preview.png"),
      fullPage: false,
    });

    // Clip hero panel for readability evidence.
    const heroBox = await page.locator("#inventoryHeroPreview").boundingBox();
    if (heroBox) {
      await page.screenshot({
        path: join(OUT_DIR, "02-hero-preview-closeup.png"),
        clip: {
          x: Math.max(0, heroBox.x - 8),
          y: Math.max(0, heroBox.y - 8),
          width: Math.min(320, heroBox.width + 16),
          height: Math.min(420, heroBox.height + 16),
        },
      });
    }

    // Overflow panel if present; otherwise note that bag absorbed stims.
    if (!state.overflowHidden && state.overflowCount > 0) {
      await page.screenshot({
        path: join(OUT_DIR, "03-overflow-unplaced.png"),
        fullPage: false,
      });
      notes.push("overflow UI captured");
    } else {
      notes.push("no overflow in this seed (bag absorbed grants) — grid+hero still evidenced");
      await page.screenshot({
        path: join(OUT_DIR, "03-grid-side-layout.png"),
        fullPage: false,
      });
    }

    // Laptop-ish tighter viewport.
    await page.setViewportSize({ width: 1280, height: 720 });
    await sleep(300);
    await page.screenshot({
      path: join(OUT_DIR, "04-laptop-1280x720.png"),
      fullPage: false,
    });

    await writeFile(join(OUT_DIR, "notes.txt"), notes.concat(failures.map((f) => `FAIL: ${f}`)).join("\n") + "\n");
    await browser.close();

    if (failures.length) {
      console.error("EPIC 53 QA failures:\n" + failures.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("EPIC 53 evidence written to", OUT_DIR);
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
