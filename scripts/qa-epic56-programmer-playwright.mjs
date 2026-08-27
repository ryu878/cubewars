// EPIC 56 Playwright evidence: combat HUD typography (÷3 health/armor, ×3 ratings)
// at 1280×800. Injects HUD DOM state — typography is CSS, not match-dependent.
//
// Usage:
//   node scripts/qa-epic56-programmer-playwright.mjs
//   node scripts/qa-epic56-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const CLIENT_PORT = 5266;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-56");
const MANAGE_STACK = process.argv[2] === undefined;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

async function startClient() {
  const client = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(CLIENT_PORT)], {
    cwd: join(REPO_ROOT, "client"),
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(client, "client", "Local:");
  return client;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let client;
  const logLines = [];
  const log = (line) => {
    console.log(line);
    logLines.push(line);
  };

  try {
    if (MANAGE_STACK) {
      client = await startClient();
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.evaluate(() => {
      // Hide lobby chrome; force combat HUD regions visible with sample values.
      const lobby = document.getElementById("lobby");
      if (lobby) lobby.style.display = "none";
      const health = document.getElementById("healthHud");
      const armor = document.getElementById("armorHud");
      const ratings = document.getElementById("ratingsHud");
      const healthValue = document.getElementById("healthValue");
      const armorValue = document.getElementById("armorValue");
      const ratingsValue = document.getElementById("ratingsHudValue");
      if (health) health.hidden = false;
      if (armor) armor.hidden = false;
      if (ratings) ratings.hidden = false;
      if (healthValue) healthValue.textContent = "245/245";
      if (armorValue) armorValue.textContent = "156/156";
      if (ratingsValue) {
        ratingsValue.textContent = "+145 HP · +156 Armor · +100% Speed · +50% Damage";
      }
    });
    await sleep(200);

    const metrics = await page.evaluate(() => {
      const healthValue = document.getElementById("healthValue");
      const ratings = document.getElementById("ratingsHud");
      const hv = healthValue ? getComputedStyle(healthValue).fontSize : "";
      const rf = ratings ? getComputedStyle(ratings).fontSize : "";
      const rect = ratings?.getBoundingClientRect();
      return {
        healthFontPx: hv,
        ratingsFontPx: rf,
        ratingsRight: rect?.right ?? 0,
        ratingsBottom: rect?.bottom ?? 0,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
      };
    });
    log(`[epic56] metrics ${JSON.stringify(metrics)}`);

    if (metrics.healthFontPx !== "50px") {
      throw new Error(`expected health .hud-value 50px, got ${metrics.healthFontPx}`);
    }
    if (metrics.ratingsFontPx !== "36px") {
      throw new Error(`expected #ratingsHud 36px, got ${metrics.ratingsFontPx}`);
    }
    if (metrics.ratingsRight > metrics.viewportW + 1) {
      throw new Error(`ratings strip overflows right: right=${metrics.ratingsRight}`);
    }

    await page.screenshot({ path: join(OUT_DIR, "01-combat-hud-typography-1280x800.png") });
    await page.locator("#healthHud").screenshot({
      path: join(OUT_DIR, "02-health-hud-closeup.png"),
    });
    await page.locator("#armorHud").screenshot({
      path: join(OUT_DIR, "03-armor-hud-closeup.png"),
    });
    await page.locator("#ratingsHud").screenshot({
      path: join(OUT_DIR, "04-ratings-hud-closeup.png"),
    });

    const about = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await about.goto(new URL("about.html", CLIENT_URL).toString(), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await about.waitForSelector('section[data-section="pets"]', { timeout: 10000 });
    const dogText = await about.locator('[data-i18n="about.pets.dog"]').innerText();
    if (/caps at 100/i.test(dogText) || /ограничена 100/i.test(dogText)) {
      throw new Error(`About dog still says absolute cap-at-100: ${dogText}`);
    }
    if (!/max\(100/i.test(dogText) && !/156\/156/.test(dogText)) {
      throw new Error(`About dog missing raised-max wording: ${dogText}`);
    }
    await about.locator('section[data-section="pets"]').screenshot({
      path: join(OUT_DIR, "05-about-pets-dog-armor.png"),
    });
    await about.close();

    await browser.close();
    log("[epic56] ALL PASS");
    await writeFile(join(OUT_DIR, "playwright-run.log"), logLines.join("\n") + "\n", "utf8");
  } catch (err) {
    log(`[epic56] FAIL ${err?.stack || err}`);
    await writeFile(join(OUT_DIR, "playwright-run.log"), logLines.join("\n") + "\n", "utf8");
    throw err;
  } finally {
    if (MANAGE_STACK) {
      await stop(client);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
