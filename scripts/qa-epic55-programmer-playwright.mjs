// EPIC 55 Playwright evidence: HUD current/max HP & armor, About weapons copy.
//
// Usage:
//   node scripts/qa-epic55-programmer-playwright.mjs
//   node scripts/qa-epic55-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7865;
const CLIENT_PORT = 5265;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-55");
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

function installWsTap(page, nickname) {
  return page.addInitScript((nick) => {
    const Orig = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new Orig(...args);
      window.__epic55Tap = window.__epic55Tap || {
        worldStates: [],
        joinAccepted: [],
        nickname: nick,
        lastSelf: null,
      };
      window.__epic55Tap.ws = ws;
      window.__epic55Tap.nickname = nick;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "join_accepted") window.__epic55Tap.joinAccepted.push(msg);
          if (msg.type === "world_state") {
            window.__epic55Tap.worldStates.push(msg);
            const selfNick = window.__epic55Tap.nickname;
            const self = (msg.players || []).find((p) => p.nickname === selfNick);
            if (self) window.__epic55Tap.lastSelf = self;
          }
        } catch {
          /* ignore */
        }
      });
      return ws;
    };
    window.WebSocket.prototype = Orig.prototype;
    Object.assign(window.WebSocket, Orig);
  }, nickname);
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

async function seedCat(nickname) {
  const helper = join(OUT_DIR, "_seed-cat.mjs");
  await writeFile(
    helper,
    `import { EconomyStore } from "../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${JSON.stringify(nickname)};
const now = Date.now();
const scope = "sandbox";
await store.getOrCreateProfile(nick, scope);
const cat = await store.grantPetForTests(nick, "cat", 145, now, scope);
await store.equipPet(nick, cat.id, 1, now, scope);
await store.close();
console.log(JSON.stringify({ ok: true, catId: cat.id, healthBonus: 145 }));
`,
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", helper], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (b) => {
      out += b.toString();
    });
    child.stderr.on("data", (b) => process.stderr.write(b));
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`seedCat exited ${code}`));
      else {
        try {
          resolve(JSON.parse(out.trim().split("\n").at(-1)));
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let server;
  let client;
  const logLines = [];
  const log = (line) => {
    console.log(line);
    logLines.push(line);
  };

  try {
    if (MANAGE_STACK) {
      ({ server, client } = await startStack());
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const nickname = nick("E55");
    const email = `${nickname.toLowerCase()}@example.com`;
    log(`[epic55] nickname=${nickname}`);
    await installWsTap(page, nickname);

    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("cubewars.locale", "en");
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await registerAndContinue(page, email);
    await page.waitForFunction(
      () => document.getElementById("status")?.dataset.state === "connected",
      { timeout: 15000 },
    );
    await page.fill("#nicknameInput", nickname);
    await seedCat(nickname);
    await sleep(400);

    await page.click("#modeBotsBtn");
    await page.waitForFunction(
      () => (window.__epic55Tap?.joinAccepted?.length ?? 0) > 0,
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => {
        const self = window.__epic55Tap?.lastSelf;
        const hp = document.getElementById("healthValue")?.textContent || "";
        const armor = document.getElementById("armorValue")?.textContent || "";
        return (
          self &&
          typeof self.maxHealth === "number" &&
          typeof self.maxArmor === "number" &&
          /^\d+\/\d+$/.test(hp) &&
          /^\d+\/\d+$/.test(armor)
        );
      },
      { timeout: 20000 },
    );

    const probe = await page.evaluate(() => {
      const self = window.__epic55Tap.lastSelf;
      return {
        healthText: document.getElementById("healthValue")?.textContent ?? "",
        armorText: document.getElementById("armorValue")?.textContent ?? "",
        health: self?.health,
        maxHealth: self?.maxHealth,
        armor: self?.armor,
        maxArmor: self?.maxArmor,
      };
    });
    log(`[epic55] HUD probe ${JSON.stringify(probe)}`);

    if (!/^\d+\/\d+$/.test(probe.healthText) || !/^\d+\/\d+$/.test(probe.armorText)) {
      throw new Error(`HUD not current/max: hp=${probe.healthText} armor=${probe.armorText}`);
    }
    if (probe.maxHealth < 200) {
      throw new Error(`expected pet-boosted maxHealth >= 200, got ${probe.maxHealth}`);
    }
    if (probe.maxArmor !== 100) {
      throw new Error(`expected maxArmor 100, got ${probe.maxArmor}`);
    }
    if (!probe.healthText.endsWith(`/${probe.maxHealth}`)) {
      throw new Error(`HUD max mismatch: ${probe.healthText} vs maxHealth=${probe.maxHealth}`);
    }

    await page.screenshot({ path: join(OUT_DIR, "01-hud-current-max-in-match.png") });
    await page.locator("#healthHud").screenshot({
      path: join(OUT_DIR, "02-health-hud-closeup.png"),
    });
    await page.locator("#armorHud").screenshot({
      path: join(OUT_DIR, "03-armor-hud-closeup.png"),
    });

    const about = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await about.goto(new URL("about.html", CLIENT_URL).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await about.waitForSelector('section[data-section="weapons"]', { timeout: 10000 });
    const weaponsBody = await about.locator('[data-i18n="about.weapons.body"]').innerText();
    if (!/ammo crates/i.test(weaponsBody) || !/current\/max/i.test(weaponsBody)) {
      throw new Error(`About weapons body missing ammo/HUD notes: ${weaponsBody.slice(0, 200)}`);
    }
    await about.locator('section[data-section="weapons"]').screenshot({
      path: join(OUT_DIR, "04-about-weapons-ammo-hud.png"),
    });
    await about.close();

    await browser.close();
    log("[epic55] ALL PASS");
    await writeFile(join(OUT_DIR, "playwright-run.log"), logLines.join("\n") + "\n", "utf8");
  } catch (err) {
    log(`[epic55] FAIL ${err?.stack || err}`);
    await writeFile(join(OUT_DIR, "playwright-run.log"), logLines.join("\n") + "\n", "utf8");
    throw err;
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
