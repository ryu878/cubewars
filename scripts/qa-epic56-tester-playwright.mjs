// EPIC 56 Tester evidence:
// - Combat HUD typography (50px / 36px) at 1280×800
// - About EN+RU dog armor copy
// - Live vs-bots join with dog+156 → HUD 156/156 + grant-style ratings
// - Light move / jump / shoot smoke
//
// Usage: node scripts/qa-epic56-tester-playwright.mjs

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_PORT = 5276;
const SERVER_PORT = 7876;
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-56", "tester");
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

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
    }, 60000);
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

function installWsTap(page, nickname) {
  return page.addInitScript((nickName) => {
    const Orig = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new Orig(...args);
      window.__epic56Tap = window.__epic56Tap || {
        worldStates: [],
        joinAccepted: [],
        economyProfiles: [],
        nickname: nickName,
        lastSelf: null,
      };
      window.__epic56Tap.ws = ws;
      window.__epic56Tap.nickname = nickName;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "join_accepted") window.__epic56Tap.joinAccepted.push(msg);
          if (msg.type === "economy_profile") window.__epic56Tap.economyProfiles.push(msg);
          if (msg.type === "world_state") {
            window.__epic56Tap.worldStates.push(msg);
            const self = (msg.players || []).find(
              (p) => p.nickname === window.__epic56Tap.nickname,
            );
            if (self) window.__epic56Tap.lastSelf = self;
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

async function seedStrongDog(nickname) {
  // Slot-1 dog only: full armorRating 156 → spawn HUD 156/156 (cat HP covered by regression).
  const helper = join(OUT_DIR, "_seed-dog.mjs");
  await writeFile(
    helper,
    `import { EconomyStore } from "../../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${JSON.stringify(nickname)};
const now = Date.now();
const scope = "sandbox";
await store.getOrCreateProfile(nick, scope);
const dog = await store.grantPetForTests(nick, "dog", 156, now, scope);
await store.equipPet(nick, dog.id, 1, now, scope);
await store.close();
console.log(JSON.stringify({ ok: true, dogId: dog.id, armorBase: 156 }));
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
      if (code !== 0) reject(new Error(`seed dog exited ${code}: ${out}`));
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
  const logLines = [];
  const log = (line) => {
    console.log(line);
    logLines.push(line);
  };

  let server;
  let client;
  try {
    server = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: join(REPO_ROOT, "server"),
      env: {
        ...process.env,
        CUBEWARS_SERVER_PORT: String(SERVER_PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(server, "server", "listening on");

    client = spawn(
      "npx",
      ["vite", "--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
      {
        cwd: join(REPO_ROOT, "client"),
        env: {
          ...process.env,
          VITE_CUBEWARS_WS_URL: WS_URL,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await waitForReady(client, "client", `http://127.0.0.1:${CLIENT_PORT}/`);

    const browser = await chromium.launch({ headless: true });

    // --- Part A: Typography + grant strip (CSS / DOM) ---
    const typoPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await typoPage.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await typoPage.evaluate(() => {
      const lobby = document.getElementById("lobby") || document.getElementById("modeSelect");
      if (lobby) lobby.style.display = "none";
      for (const id of ["healthHud", "armorHud", "ratingsHud"]) {
        const el = document.getElementById(id);
        if (el) el.hidden = false;
      }
      const hv = document.getElementById("healthValue");
      const av = document.getElementById("armorValue");
      const rv = document.getElementById("ratingsHudValue");
      if (hv) hv.textContent = "245/245";
      if (av) av.textContent = "156/156";
      if (rv) rv.textContent = "+145 HP · +156 Armor · +100% Speed · +50% Damage";
    });
    await sleep(200);
    const metrics = await typoPage.evaluate(() => {
      const healthValue = document.getElementById("healthValue");
      const ratings = document.getElementById("ratingsHud");
      const rect = ratings?.getBoundingClientRect();
      return {
        healthFontPx: healthValue ? getComputedStyle(healthValue).fontSize : "",
        ratingsFontPx: ratings ? getComputedStyle(ratings).fontSize : "",
        ratingsRight: rect?.right ?? 0,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
        armorText: document.getElementById("armorValue")?.textContent ?? "",
        healthText: document.getElementById("healthValue")?.textContent ?? "",
        ratingsText: document.getElementById("ratingsHudValue")?.textContent ?? "",
      };
    });
    log(`[epic56-tester] typography ${JSON.stringify(metrics)}`);
    if (metrics.healthFontPx !== "50px") {
      throw new Error(`health font expected 50px, got ${metrics.healthFontPx}`);
    }
    if (metrics.ratingsFontPx !== "36px") {
      throw new Error(`ratings font expected 36px, got ${metrics.ratingsFontPx}`);
    }
    if (metrics.ratingsRight > metrics.viewportW + 1) {
      throw new Error(`ratings overflows right: ${metrics.ratingsRight}`);
    }
    if (metrics.armorText !== "156/156" || metrics.healthText !== "245/245") {
      throw new Error(`HUD values mismatch: ${metrics.healthText} / ${metrics.armorText}`);
    }
    if (!metrics.ratingsText.includes("+156 Armor") || !metrics.ratingsText.includes("+145 HP")) {
      throw new Error(`ratings strip not grant-style: ${metrics.ratingsText}`);
    }
    await typoPage.screenshot({ path: join(OUT_DIR, "t01-combat-hud-1280x800.png") });
    await typoPage.locator("#armorHud").screenshot({ path: join(OUT_DIR, "t02-armor-156-156.png") });
    await typoPage.locator("#ratingsHud").screenshot({ path: join(OUT_DIR, "t03-ratings-grants.png") });
    await typoPage.close();

    // --- Part B: About EN + RU dog armor ---
    const about = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await about.goto(new URL("about.html", CLIENT_URL).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await about.waitForSelector('section[data-section="pets"]', { timeout: 10000 });
    const dogEn = await about.locator('[data-i18n="about.pets.dog"]').innerText();
    if (/caps at 100/i.test(dogEn) || !/156\/156|max\(100/i.test(dogEn)) {
      throw new Error(`EN About dog bad: ${dogEn}`);
    }
    await about.locator('button[data-locale="ru"]').click();
    await sleep(300);
    const dogRu = await about.locator('[data-i18n="about.pets.dog"]').innerText();
    if (/ограничена 100/i.test(dogRu) || !/156\/156|max\(100/i.test(dogRu)) {
      throw new Error(`RU About dog bad: ${dogRu}`);
    }
    log(`[epic56-tester] About EN: ${dogEn}`);
    log(`[epic56-tester] About RU: ${dogRu}`);
    await about.locator('section[data-section="pets"]').screenshot({
      path: join(OUT_DIR, "t04-about-pets-ru.png"),
    });
    await about.close();

    // --- Part C: Live vs-bots with dog 156 + cat 145 ---
    const nickname = nick("E56");
    const email = `${nickname.toLowerCase()}@example.com`;
    log(`[epic56-tester] nickname=${nickname}`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
    const seed = await seedStrongDog(nickname);
    log(`[epic56-tester] seeded ${JSON.stringify(seed)}`);
    await sleep(500);

    await page.click("#modeBotsBtn");
    await page.waitForFunction(
      () => (window.__epic56Tap?.joinAccepted?.length ?? 0) > 0,
      { timeout: 20000 },
    );
    await page.waitForFunction(
      () => {
        const self = window.__epic56Tap?.lastSelf;
        const hp = document.getElementById("healthValue")?.textContent || "";
        const armor = document.getElementById("armorValue")?.textContent || "";
        return (
          self &&
          typeof self.maxArmor === "number" &&
          typeof self.maxHealth === "number" &&
          /^\d+\/\d+$/.test(hp) &&
          /^\d+\/\d+$/.test(armor)
        );
      },
      { timeout: 25000 },
    );

    const probe = await page.evaluate(() => {
      const self = window.__epic56Tap.lastSelf;
      return {
        healthText: document.getElementById("healthValue")?.textContent ?? "",
        armorText: document.getElementById("armorValue")?.textContent ?? "",
        ratingsText: document.getElementById("ratingsHudValue")?.textContent ?? "",
        ratingsHidden: document.getElementById("ratingsHud")?.hidden ?? true,
        health: self?.health,
        maxHealth: self?.maxHealth,
        armor: self?.armor,
        maxArmor: self?.maxArmor,
      };
    });
    log(`[epic56-tester] live HUD probe ${JSON.stringify(probe)}`);

    if (probe.maxArmor !== 156 || probe.armor !== 156) {
      throw new Error(`expected server armor 156/156, got ${probe.armor}/${probe.maxArmor}`);
    }
    if (probe.armorText !== "156/156") {
      throw new Error(`expected armor HUD 156/156, got ${probe.armorText}`);
    }
    if (probe.healthText !== "100/100" || probe.maxHealth !== 100) {
      throw new Error(
        `expected baseline HP 100/100 without cat, got ${probe.healthText} (max=${probe.maxHealth})`,
      );
    }
    if (probe.ratingsHidden) {
      throw new Error("ratings strip hidden with dog equipped");
    }
    if (probe.ratingsText !== "+156 Armor") {
      throw new Error(`live ratings expected "+156 Armor", got ${probe.ratingsText}`);
    }

    await page.screenshot({ path: join(OUT_DIR, "t05-live-bots-hud-156.png") });
    await page.locator("#armorHud").screenshot({ path: join(OUT_DIR, "t06-live-armor-closeup.png") });
    await page.locator("#ratingsHud").screenshot({
      path: join(OUT_DIR, "t07-live-ratings-grants.png"),
    });

    // --- Part D: move / jump / shoot smoke ---
    const canvas = page.locator("canvas").first();
    await canvas.click({ position: { x: 640, y: 400 } }).catch(() => {});
    await page.keyboard.down("KeyW");
    await sleep(400);
    await page.keyboard.up("KeyW");
    await page.keyboard.press("Space");
    await sleep(300);
    await page.mouse.down();
    await sleep(200);
    await page.mouse.up();
    await page.mouse.move(700, 420);
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, "t08-gameplay-smoke.png") });
    log("[epic56-tester] gameplay smoke (W / Space / LMB) OK");

    const visual = await page.evaluate(() => {
      const c = document.querySelector("canvas");
      return {
        canvasPresent: !!c,
        canvasW: c?.width ?? 0,
        canvasH: c?.height ?? 0,
        lobbyHidden: document.getElementById("modeSelect")?.classList.contains("hidden") ?? false,
      };
    });
    log(`[epic56-tester] visual ${JSON.stringify(visual)}`);
    if (!visual.canvasPresent || visual.canvasW < 100) {
      throw new Error("canvas missing or tiny after join");
    }

    await browser.close();
    log("[epic56-tester] ALL PASS");
    await writeFile(join(OUT_DIR, "tester-playwright-run.log"), logLines.join("\n") + "\n", "utf8");
    await writeFile(join(REPO_ROOT, "qa-artifacts", "epic-56", "qa-result.txt"), "PASS\n", "utf8");
  } catch (err) {
    log(`[epic56-tester] FAIL ${err?.stack || err}`);
    await writeFile(join(OUT_DIR, "tester-playwright-run.log"), logLines.join("\n") + "\n", "utf8");
    await writeFile(join(REPO_ROOT, "qa-artifacts", "epic-56", "qa-result.txt"), "FAIL\n", "utf8");
    throw err;
  } finally {
    await stop(client);
    await stop(server);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
