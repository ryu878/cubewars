// EPIC 57 Tester Playwright: About EN+RU, in-match hold-fire cadence, cooldown ring.
//
// Usage:
//   node scripts/qa-epic57-tester-playwright.mjs
//   node scripts/qa-epic57-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7867;
const CLIENT_PORT = 5268;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-57");
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
      window.__epic57Tap = window.__epic57Tap || {
        nickname: nick,
        joinAccepted: [],
        outboundFire: [],
        worldStates: [],
        lastSelf: null,
      };
      window.__epic57Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          if (msg.type === "fire") {
            window.__epic57Tap.outboundFire.push({ t: performance.now(), msg });
          }
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "join_accepted") window.__epic57Tap.joinAccepted.push(msg);
          if (msg.type === "world_state") {
            window.__epic57Tap.worldStates.push(msg);
            const self = (msg.players || []).find((p) => p.nickname === window.__epic57Tap.nickname);
            if (self) window.__epic57Tap.lastSelf = self;
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

function assertOk(cond, msg) {
  if (!cond) throw new Error(msg);
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

    // --- About EN + RU ---
    const about = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await about.goto(new URL("about.html", CLIENT_URL).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await about.evaluate(() => localStorage.setItem("cubewars.locale", "en"));
    await about.reload({ waitUntil: "domcontentloaded" });
    await about.waitForSelector('section[data-section="weapons"]', { timeout: 10000 });
    const enWeapons = await about.locator('[data-i18n="about.weapons.body"]').innerText();
    const enPools = await about.locator('[data-i18n="about.pools.body"]').innerText();
    assertOk(/Hold left-click/i.test(enWeapons), "EN About missing hold-fire");
    assertOk(/ring around the crosshair/i.test(enWeapons), "EN About missing cooldown ring");
    assertOk(/0\.2%/i.test(enPools), "EN About missing repair kit rarity");
    assertOk(/amulet can grant a shard/i.test(enPools), "EN About missing sandbox bot shards");
    await about.locator('section[data-section="weapons"]').screenshot({
      path: join(OUT_DIR, "about-weapons-en.png"),
    });
    log("About EN weapons/pools OK");

    await about.evaluate(() => localStorage.setItem("cubewars.locale", "ru"));
    await about.reload({ waitUntil: "domcontentloaded" });
    await about.waitForSelector('section[data-section="weapons"]', { timeout: 10000 });
    const ruWeapons = await about.locator('[data-i18n="about.weapons.body"]').innerText();
    const ruPools = await about.locator('[data-i18n="about.pools.body"]').innerText();
    assertOk(/Удерживайте ЛКМ/i.test(ruWeapons), "RU About missing hold-fire");
    assertOk(/Кольцо вокруг прицела/i.test(ruWeapons), "RU About missing cooldown ring");
    assertOk(/0\.2%/i.test(ruPools), "RU About missing repair kit rarity");
    assertOk(/осколок/i.test(ruPools), "RU About missing shard wording");
    await about.locator('section[data-section="weapons"]').screenshot({
      path: join(OUT_DIR, "about-weapons-ru.png"),
    });
    await about.locator('section[data-section="pools"]').screenshot({
      path: join(OUT_DIR, "about-pools-ru.png"),
    });
    log("About RU weapons/pools OK");
    await about.close();

    // --- In-match hold-fire + ring ---
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const nickname = nick("E57");
    const email = `${nickname.toLowerCase()}@example.com`;
    log(`[epic57] nickname=${nickname}`);
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
    await page.waitForFunction(() => !document.getElementById("modeBotsBtn")?.disabled, {
      timeout: 20000,
    });
    await page.click("#modeBotsBtn");
    await page.waitForFunction(() => (window.__epic57Tap?.joinAccepted?.length ?? 0) > 0, {
      timeout: 20000,
    });
    await page.waitForFunction(
      () => {
        const self = window.__epic57Tap?.lastSelf;
        return self && self.alive === true;
      },
      { timeout: 20000 },
    );

    // Wait out spawn protection (~2s) before hold-fire.
    await sleep(2500);

    const canvas = page.locator("#app canvas");
    const box = await canvas.boundingBox();
    assertOk(!!box, "canvas missing");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(200);
    // Second click: pointer should be locked → fire + start auto-fire.
    await page.mouse.down();
    await sleep(2200); // hold ~2.2s → expect ~4–5 pistol fires at 500ms
    await page.mouse.up();
    await sleep(150);

    const fireStats = await page.evaluate(() => {
      const fires = window.__epic57Tap?.outboundFire || [];
      const gaps = [];
      for (let i = 1; i < fires.length; i++) {
        gaps.push(fires[i].t - fires[i - 1].t);
      }
      const arc = document.getElementById("cooldownRingArc");
      const cs = arc ? getComputedStyle(arc) : null;
      return {
        fireCount: fires.length,
        gaps,
        hasArc: !!arc,
        opacity: cs?.opacity ?? null,
        dashoffset: arc?.style.strokeDashoffset ?? null,
        weaponText: document.getElementById("weaponValue")?.textContent ?? "",
        hp: document.getElementById("healthValue")?.textContent ?? "",
        locked: document.pointerLockElement !== null,
      };
    });
    log(`[epic57] fireStats ${JSON.stringify(fireStats)}`);

    assertOk(fireStats.fireCount >= 3, `expected >=3 hold-fire shots, got ${fireStats.fireCount}`);
    // Pistol cooldown 500ms. Local juice gate can skip one early interval tick
    // (interval vs lastLocalFireMs race) → gaps ~500–1000ms are expected.
    const badGaps = fireStats.gaps.filter((g) => g < 320 || g > 1100);
    assertOk(
      badGaps.length === 0,
      `pistol hold-fire gaps out of range: ${JSON.stringify(fireStats.gaps)}`,
    );
    const avgGap =
      fireStats.gaps.length > 0
        ? fireStats.gaps.reduce((a, b) => a + b, 0) / fireStats.gaps.length
        : 0;
    assertOk(avgGap > 400 && avgGap < 900, `pistol avg gap unexpected: ${avgGap}`);
    assertOk(fireStats.hasArc, "cooldown ring arc missing in-match");
    // Weapon HUD may be empty briefly; prefer fire evidence over label.

    await page.screenshot({ path: join(OUT_DIR, "in-match-hold-fire.png") });
    await page.screenshot({
      path: join(OUT_DIR, "in-match-crosshair-ring.png"),
      clip: { x: 1280 / 2 - 80, y: 800 / 2 - 80, width: 160, height: 160 },
    });

    // Juice gate: while mid-cooldown after a shot, rapid click must not spam fire.
    await page.evaluate(() => {
      window.__epic57Tap.outboundFire = [];
    });
    // Fire once then spam mousedown/up quickly within cooldown window.
    await page.mouse.down();
    await page.mouse.up();
    await sleep(40);
    for (let i = 0; i < 8; i++) {
      await page.mouse.down();
      await page.mouse.up();
      await sleep(30);
    }
    await sleep(100);
    const spamCount = await page.evaluate(() => window.__epic57Tap.outboundFire.length);
    log(`[epic57] mid-cooldown spam fire count=${spamCount}`);
    assertOk(spamCount <= 1, `expected <=1 fire during cooldown spam, got ${spamCount}`);

    // Movement smoke (WASD) via key events while locked if possible.
    await page.keyboard.down("KeyW");
    await sleep(300);
    await page.keyboard.up("KeyW");
    await page.keyboard.press("Space");
    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, "in-match-move-jump.png") });

    await browser.close();
    log("EPIC 57 tester playwright PASS");
    await writeFile(join(OUT_DIR, "tester-playwright.log"), logLines.join("\n") + "\n", "utf8");
  } catch (err) {
    log(`EPIC 57 tester playwright FAIL ${err?.stack || err}`);
    await writeFile(join(OUT_DIR, "tester-playwright.log"), logLines.join("\n") + "\n", "utf8");
    throw err;
  } finally {
    if (MANAGE_STACK) {
      await stop(client);
      await stop(server);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
