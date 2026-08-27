// EPIC 52 Playwright: lobby EN/RU switcher + About page evidence.
//
// Usage:
//   node scripts/qa-epic52-programmer-playwright.mjs
//   node scripts/qa-epic52-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7803;
const CLIENT_PORT = 5223;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-52");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let server;
  let client;
  const notes = [];

  try {
    if (MANAGE_STACK) {
      ({ server, client } = await startStack());
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Only seed EN when no preference exists yet (do not clobber later RU).
    await context.addInitScript(() => {
      try {
        if (!localStorage.getItem("cubewars.locale")) {
          localStorage.setItem("cubewars.locale", "en");
        }
      } catch {
        /* ignore */
      }
    });
    const page = await context.newPage();

    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => localStorage.setItem("cubewars.locale", "en"));
    await page.reload({ waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector("#modeSelect:not(.hidden)", { timeout: 30000 });
    await sleep(800);

    const enSubtitle = await page.locator("#modeSelect .mode-select-box > p").first().textContent();
    const mapOptionsEn = await page.locator("#mapSelect option").allTextContents();
    notes.push(`EN subtitle: ${enSubtitle}`);
    notes.push(`EN map sample: ${mapOptionsEn.slice(0, 3).join(" | ")}`);

    await page.screenshot({
      path: join(OUT_DIR, "01-lobby-en.png"),
      fullPage: true,
    });

    // Switch to RU without reload.
    await page.click('button[data-locale="ru"]');
    await sleep(500);
    const ruSubtitle = await page.locator("#modeSelect .mode-select-box > p").first().textContent();
    const mapOptionsRu = await page.locator("#mapSelect option").allTextContents();
    const aboutLink = await page.locator("a.lobby-about").textContent();
    notes.push(`RU subtitle: ${ruSubtitle}`);
    notes.push(`RU map sample: ${mapOptionsRu.slice(0, 3).join(" | ")}`);
    notes.push(`About footer: ${aboutLink}`);

    if (!ruSubtitle || /Sign in, choose/.test(ruSubtitle)) {
      throw new Error(`Expected Russian lobby subtitle after switch, got: ${ruSubtitle}`);
    }
    if (!mapOptionsRu.some((t) => /[А-Яа-яЁё]/.test(t))) {
      notes.push("WARN: no Cyrillic in map options (check displayNameRu coverage)");
    }

    await page.screenshot({
      path: join(OUT_DIR, "02-lobby-ru.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: join(OUT_DIR, "03-lobby-ru-map-picker.png"),
      clip: { x: 320, y: 180, width: 520, height: 420 },
    });

    // About page should inherit cubewars.locale=ru from localStorage.
    await page.evaluate(() => {
      localStorage.setItem("cubewars.locale", "ru");
    });
    await page.goto(new URL("/about.html", CLIENT_URL).href, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await sleep(400);
    const aboutTitle = await page.locator("h1").textContent();
    notes.push(`About title (ru expected): ${aboutTitle}`);
    if (aboutTitle !== "Об игре") {
      throw new Error(`Expected About RU title «Об игре», got: ${aboutTitle}`);
    }
    await page.screenshot({
      path: join(OUT_DIR, "04-about-ru.png"),
      fullPage: true,
    });

    await page.click('button[data-locale="en"]');
    await sleep(300);
    const aboutTitleEn = await page.locator("h1").textContent();
    notes.push(`About title (en): ${aboutTitleEn}`);
    await page.screenshot({
      path: join(OUT_DIR, "05-about-en.png"),
      fullPage: true,
    });

    await writeFile(join(OUT_DIR, "notes.txt"), notes.join("\n") + "\n", "utf8");
    await browser.close();
    console.log("EPIC 52 evidence written to", OUT_DIR);
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
