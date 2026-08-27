// EPIC 52 Tester Playwright: lobby EN/RU, persistence, default locale, About AC.
//
// Usage:
//   node scripts/qa-epic52-tester-playwright.mjs
//   node scripts/qa-epic52-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const PARENT_ARTIFACTS = join(
  REPO_ROOT,
  "..",
  "..",
  "..",
  "qa-artifacts",
  "epic-52",
);

const SERVER_PORT = 7852;
const CLIENT_PORT = 5252;
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let server;
  let client;
  const notes = [];
  const results = [];

  try {
    if (MANAGE_STACK) {
      ({ server, client } = await startStack());
    }

    const browser = await chromium.launch({ headless: true });

    // --- AC1/AC2/AC4/AC5: lobby switcher, flip, maps, footer ---
    {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
      });
      const page = await context.newPage();
      const consoleErrors = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      // Seed EN once (do not use addInitScript — it would overwrite on reload).
      await page.evaluate(() => localStorage.setItem("cubewars.locale", "en"));
      await page.reload({ waitUntil: "networkidle", timeout: 60000 });
      await page.waitForSelector("#modeSelect:not(.hidden)", { timeout: 30000 });
      await sleep(600);

      const switcher = page.locator("#modeSelect .locale-switcher");
      assert((await switcher.count()) === 1, "EN|RU switcher missing on lobby");
      assert(await page.locator('button[data-locale="en"]').isVisible(), "EN button missing");
      assert(await page.locator('button[data-locale="ru"]').isVisible(), "RU button missing");
      results.push("AC1 switcher visible: PASS");

      const enSubtitle = (await page.locator("#modeSelect .mode-select-box > p").first().textContent())?.trim();
      const enQuick = (await page.locator("#modePublicBtn").textContent())?.trim();
      const enMaps = await page.locator("#mapSelect option").allTextContents();
      notes.push(`EN subtitle: ${enSubtitle}`);
      notes.push(`EN quick join: ${enQuick}`);
      notes.push(`EN maps: ${enMaps.slice(0, 3).join(" | ")}`);
      assert(
        enSubtitle?.includes("Sign in") || enSubtitle?.includes("nickname"),
        `Expected EN subtitle, got: ${enSubtitle}`,
      );

      const footerLinks = await page.locator(".lobby-footer a, #modeSelect footer a, a.lobby-changelog, a.lobby-about, a.lobby-telegram").evaluateAll((els) =>
        els.map((a) => ({
          text: (a.textContent || "").trim(),
          href: a.getAttribute("href"),
          className: a.className,
        })),
      );
      // Prefer explicit classes
      const changelog = await page.locator("a.lobby-changelog").getAttribute("href");
      const about = await page.locator("a.lobby-about").getAttribute("href");
      const telegram = await page.locator("a.lobby-telegram").getAttribute("href");
      notes.push(`Footer hrefs: changelog=${changelog} about=${about} telegram=${telegram}`);
      assert(changelog === "/changelog.html", `Changelog href expected /changelog.html got ${changelog}`);
      assert(about === "/about.html", `About href expected /about.html got ${about}`);
      assert(telegram && telegram.includes("t.me"), `Telegram href missing/invalid: ${telegram}`);
      // Order: Changelog, About, Telegram in DOM
      const footerOrder = await page.locator("a.lobby-changelog, a.lobby-about, a.lobby-telegram").evaluateAll((els) =>
        els.map((a) => a.className),
      );
      notes.push(`Footer order classes: ${footerOrder.join(" → ")}`);
      assert(
        footerOrder[0]?.includes("changelog") &&
          footerOrder[1]?.includes("about") &&
          footerOrder[2]?.includes("telegram"),
        `Footer order wrong: ${footerOrder.join(",")}`,
      );
      results.push("AC5 footer About beside Changelog/Telegram → /about.html: PASS");

      await page.screenshot({ path: join(OUT_DIR, "01-lobby-en.png"), fullPage: true });

      // Switch to RU without full reload
      await page.click('button[data-locale="ru"]');
      await sleep(500);
      const stored = await page.evaluate(() => localStorage.getItem("cubewars.locale"));
      assert(stored === "ru", `Expected cubewars.locale=ru after click, got ${stored}`);

      const ruSubtitle = (await page.locator("#modeSelect .mode-select-box > p").first().textContent())?.trim();
      const ruQuick = (await page.locator("#modePublicBtn").textContent())?.trim();
      const ruAboutLink = (await page.locator("a.lobby-about").textContent())?.trim();
      const ruMaps = await page.locator("#mapSelect option").allTextContents();
      notes.push(`RU subtitle: ${ruSubtitle}`);
      notes.push(`RU quick join: ${ruQuick}`);
      notes.push(`RU about link: ${ruAboutLink}`);
      notes.push(`RU maps: ${ruMaps.slice(0, 3).join(" | ")}`);
      assert(ruSubtitle && /[А-Яа-яЁё]/.test(ruSubtitle), `Expected Cyrillic subtitle, got: ${ruSubtitle}`);
      assert(ruQuick && /[А-Яа-яЁё]/.test(ruQuick), `Expected Cyrillic quick join, got: ${ruQuick}`);
      assert(
        ruMaps.some((t) => /[А-Яа-яЁё]/.test(t)),
        `Expected Cyrillic map names (displayNameRu), got: ${ruMaps.join(" | ")}`,
      );
      results.push("AC1 strings flip without reload: PASS");
      results.push("AC4 map picker displayNameRu when ru: PASS");

      await page.screenshot({ path: join(OUT_DIR, "02-lobby-ru.png"), fullPage: true });
      await page.screenshot({
        path: join(OUT_DIR, "03-lobby-ru-map-picker.png"),
        clip: { x: 320, y: 160, width: 560, height: 480 },
      });

      // Pause menu chrome spot-check (open overlay via DOM — may be hidden until match; still check data-i18n applied)
      const pauseTitle = (await page.locator("#pauseMenu [data-i18n='pause.title'], #pauseOverlay [data-i18n='pause.title'], [data-i18n='pause.title']").first().textContent())?.trim();
      const invTitle = (await page.locator("[data-i18n='inv.title']").first().textContent())?.trim();
      notes.push(`Pause title (locale-applied): ${pauseTitle}`);
      notes.push(`Inventory title (locale-applied): ${invTitle}`);
      assert(pauseTitle && /[А-Яа-яЁё]/.test(pauseTitle), `Pause title not RU: ${pauseTitle}`);
      assert(invTitle && /[А-Яа-яЁё]/.test(invTitle), `Inventory title not RU: ${invTitle}`);
      results.push("Spot-check pause/inventory chrome RU: PASS");

      // Persistence across reload
      await page.reload({ waitUntil: "networkidle", timeout: 60000 });
      await page.waitForSelector("#modeSelect:not(.hidden)", { timeout: 30000 });
      await sleep(500);
      const storedAfterReload = await page.evaluate(() => localStorage.getItem("cubewars.locale"));
      const subtitleAfterReload = (await page.locator("#modeSelect .mode-select-box > p").first().textContent())?.trim();
      notes.push(`After reload locale=${storedAfterReload} subtitle=${subtitleAfterReload}`);
      assert(storedAfterReload === "ru", `Persistence failed: cubewars.locale=${storedAfterReload}`);
      assert(
        subtitleAfterReload && /[А-Яа-яЁё]/.test(subtitleAfterReload),
        `UI not RU after reload: ${subtitleAfterReload}`,
      );
      results.push("AC2 cubewars.locale persists across reload: PASS");
      await page.screenshot({ path: join(OUT_DIR, "06-lobby-ru-after-reload.png"), fullPage: true });

      if (consoleErrors.length) {
        notes.push(`WARN console errors on lobby path: ${consoleErrors.slice(0, 5).join(" | ")}`);
      } else {
        results.push("No console errors on lobby path: PASS");
      }

      await context.close();
    }

    // --- AC3: default saved → browser ru* → en ---
    {
      // No saved + browser ru → ru
      const ctxRu = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: "ru-RU",
      });
      await ctxRu.addInitScript(() => {
        try {
          localStorage.removeItem("cubewars.locale");
        } catch {
          /* ignore */
        }
      });
      const pageRu = await ctxRu.newPage();
      await pageRu.goto(CLIENT_URL, { waitUntil: "networkidle", timeout: 60000 });
      await pageRu.waitForSelector("#modeSelect:not(.hidden)", { timeout: 30000 });
      await sleep(500);
      const defaultRu = await pageRu.evaluate(() => ({
        stored: localStorage.getItem("cubewars.locale"),
        lang: document.documentElement.lang,
        subtitle: document.querySelector("#modeSelect .mode-select-box > p")?.textContent?.trim(),
      }));
      notes.push(`Default browser ru*: stored=${defaultRu.stored} lang=${defaultRu.lang} subtitle=${defaultRu.subtitle}`);
      // Saved key may remain unset until user clicks; UI should still be RU via resolveInitialLocale
      assert(
        defaultRu.lang === "ru" || (defaultRu.subtitle && /[А-Яа-яЁё]/.test(defaultRu.subtitle)),
        `Expected default RU from browser, got ${JSON.stringify(defaultRu)}`,
      );
      await pageRu.screenshot({ path: join(OUT_DIR, "07-default-browser-ru.png"), fullPage: true });
      await ctxRu.close();
      results.push("AC3 default browser ru* → ru: PASS");

      // No saved + browser en → en
      const ctxEn = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        locale: "en-US",
      });
      await ctxEn.addInitScript(() => {
        try {
          localStorage.removeItem("cubewars.locale");
        } catch {
          /* ignore */
        }
      });
      const pageEn = await ctxEn.newPage();
      await pageEn.goto(CLIENT_URL, { waitUntil: "networkidle", timeout: 60000 });
      await pageEn.waitForSelector("#modeSelect:not(.hidden)", { timeout: 30000 });
      await sleep(500);
      const defaultEn = await pageEn.evaluate(() => ({
        stored: localStorage.getItem("cubewars.locale"),
        lang: document.documentElement.lang,
        subtitle: document.querySelector("#modeSelect .mode-select-box > p")?.textContent?.trim(),
      }));
      notes.push(`Default browser en: stored=${defaultEn.stored} lang=${defaultEn.lang} subtitle=${defaultEn.subtitle}`);
      assert(
        defaultEn.lang === "en" ||
          (defaultEn.subtitle && /Sign in|nickname/i.test(defaultEn.subtitle || "")),
        `Expected default EN from browser, got ${JSON.stringify(defaultEn)}`,
      );
      await pageEn.screenshot({ path: join(OUT_DIR, "08-default-browser-en.png"), fullPage: true });
      await ctxEn.close();
      results.push("AC3 default browser non-ru → en: PASS");
    }

    // --- AC6: About page ---
    {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
      });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("cubewars.locale", "ru");
        } catch {
          /* ignore */
        }
      });
      const page = await context.newPage();
      await page.goto(new URL("/about.html", CLIENT_URL).href, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await sleep(400);

      const titleRu = (await page.locator("h1").textContent())?.trim();
      const lastUpdated = (await page.locator("#lastUpdated").textContent())?.trim();
      notes.push(`About title RU: ${titleRu}`);
      notes.push(`About last updated: ${lastUpdated}`);
      assert(titleRu === "Об игре", `Expected About RU title, got ${titleRu}`);
      assert(lastUpdated && /2026-08-27/.test(lastUpdated), `Last updated missing/wrong: ${lastUpdated}`);

      const requiredSections = [
        "modes",
        "maps",
        "weapons",
        "pets",
        "economy",
        "spawn",
        "pause",
        "hotkeys",
        "pools",
      ];
      for (const id of requiredSections) {
        const count = await page.locator(`section[data-section="${id}"]`).count();
        assert(count === 1, `Missing About section: ${id}`);
      }
      results.push("AC6 About required sections present: PASS");

      const images = await page.locator("main img").evaluateAll((imgs) =>
        imgs.map((img) => ({
          src: img.getAttribute("src"),
          naturalWidth: img.naturalWidth,
          complete: img.complete,
        })),
      );
      notes.push(`About images: ${JSON.stringify(images)}`);
      assert(images.length >= 5, `Expected ≥5 About images, got ${images.length}`);
      assert(
        images.every((img) => img.complete && img.naturalWidth > 0),
        `Some About images failed to load: ${JSON.stringify(images)}`,
      );
      results.push("AC6 About images load: PASS");

      // Pet mapping spot-check
      const petsText = (await page.locator('section[data-section="pets"]').innerText())?.trim();
      assert(/собак|armor|брон/i.test(petsText || ""), `Pets section missing dog/armor mapping: ${petsText?.slice(0, 200)}`);
      assert(/кот|HP|здоров/i.test(petsText || ""), `Pets section missing cat/HP: ${petsText?.slice(0, 200)}`);

      await page.screenshot({ path: join(OUT_DIR, "04-about-ru.png"), fullPage: true });

      await page.click('button[data-locale="en"]');
      await sleep(300);
      const titleEn = (await page.locator("h1").textContent())?.trim();
      const lastUpdatedEn = (await page.locator("#lastUpdated").textContent())?.trim();
      notes.push(`About title EN: ${titleEn}`);
      notes.push(`About last updated EN: ${lastUpdatedEn}`);
      assert(titleEn === "About the game", `Expected About EN title, got ${titleEn}`);
      assert(/Last updated:\s*2026-08-27/.test(lastUpdatedEn || ""), `EN Last updated wrong: ${lastUpdatedEn}`);
      const storedAbout = await page.evaluate(() => localStorage.getItem("cubewars.locale"));
      assert(storedAbout === "en", `About locale switch should persist en, got ${storedAbout}`);
      results.push("AC6 About locale-aware + Last updated: PASS");

      await page.screenshot({ path: join(OUT_DIR, "05-about-en.png"), fullPage: true });
      await page.locator('section[data-section="pets"]').scrollIntoViewIfNeeded();
      await sleep(200);
      await page.locator('section[data-section="pets"]').screenshot({
        path: join(OUT_DIR, "09-about-en-pets-section.png"),
      });

      await context.close();
    }

    await browser.close();

    const summary = ["EPIC 52 Tester QA", ...results, "", "NOTES:", ...notes];
    await writeFile(join(OUT_DIR, "notes.txt"), summary.join("\n") + "\n", "utf8");
    await writeFile(join(OUT_DIR, "qa-result.txt"), "PASS\n", "utf8");

    // Sync to parent repo qa-artifacts if worktree path resolves
    try {
      await mkdir(PARENT_ARTIFACTS, { recursive: true });
      for (const name of [
        "01-lobby-en.png",
        "02-lobby-ru.png",
        "03-lobby-ru-map-picker.png",
        "04-about-ru.png",
        "05-about-en.png",
        "06-lobby-ru-after-reload.png",
        "07-default-browser-ru.png",
        "08-default-browser-en.png",
        "09-about-en-pets-section.png",
        "notes.txt",
        "qa-result.txt",
      ]) {
        await cp(join(OUT_DIR, name), join(PARENT_ARTIFACTS, name));
      }
      notes.push(`Synced artifacts to ${PARENT_ARTIFACTS}`);
    } catch (err) {
      notes.push(`WARN parent artifact sync failed: ${err}`);
      await writeFile(join(OUT_DIR, "notes.txt"), summary.concat([`WARN parent sync: ${err}`]).join("\n") + "\n", "utf8");
    }

    console.log(summary.join("\n"));
    console.log("EPIC 52 tester evidence written to", OUT_DIR);
  } finally {
    if (MANAGE_STACK) {
      await stop(client);
      await stop(server);
    }
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(join(OUT_DIR, "qa-result.txt"), `FAIL\n${err}\n`, "utf8");
  } catch {
    /* ignore */
  }
  process.exit(1);
});
