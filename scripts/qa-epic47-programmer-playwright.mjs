// EPIC 47 Playwright: bots non-Base map + ESC pause menu Exit to Lobby.
//
// Usage:
//   node scripts/qa-epic47-programmer-playwright.mjs
//   node scripts/qa-epic47-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7799;
const CLIENT_PORT = 5219;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-47");
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
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already dead */
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
      window.__epic47Tap = window.__epic47Tap || {
        outbound: [],
        mapStates: [],
        joinAccepted: [],
        leaveAcks: [],
      };
      window.__epic47Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic47Tap.outbound.push(msg);
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "map_state") window.__epic47Tap.mapStates.push(msg);
          if (msg.type === "join_accepted") window.__epic47Tap.joinAccepted.push(msg);
          if (msg.type === "leave_match_ack") window.__epic47Tap.leaveAcks.push(msg);
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
  const email = `epic47_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = { botsMap: null, pauseMenu: null, exitLobby: null, changelog: null, changelogPage: null };

  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic47-qa] starting dedicated server/client");
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
    const nickname = nick("E47");
    await openLobby(page, nickname);

    await page.selectOption("#mapSelect", "rust_canyon");
    await page.evaluate(() => localStorage.setItem("cubewars.mapId", "rust_canyon"));
    await page.click("#modeBotsBtn");
    await page.waitForFunction(
      () => document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => (window.__epic47Tap?.mapStates ?? []).length > 0,
      { timeout: 15000 },
    );
    await sleep(400);

    const botsMap = await page.evaluate(() => {
      const joins = (window.__epic47Tap?.outbound ?? []).filter((m) => m.type === "join");
      const lastJoin = joins.at(-1) ?? null;
      const mapState = (window.__epic47Tap?.mapStates ?? []).at(-1) ?? null;
      const accepted = (window.__epic47Tap?.joinAccepted ?? []).at(-1) ?? null;
      const ids = (mapState?.geometry ?? []).map((b) => b.id);
      return {
        joinMapId: lastJoin?.mapId ?? null,
        acceptedMapId: accepted?.mapId ?? null,
        mapStateMapId: mapState?.mapId ?? null,
        hasRc: ids.some((id) => String(id).startsWith("rc_")),
        hasBase: ids.some((id) => String(id).startsWith("base_")),
        boxCount: ids.length,
      };
    });
    summary.botsMap = botsMap;
    if (botsMap.joinMapId !== "rust_canyon") failures.push(`join mapId=${botsMap.joinMapId}`);
    if (botsMap.mapStateMapId !== "rust_canyon") {
      failures.push(`map_state.mapId=${botsMap.mapStateMapId}`);
    }
    if (!botsMap.hasRc || botsMap.hasBase) failures.push("map_state geometry not rust_canyon");

    await page.screenshot({ path: join(OUT_DIR, "01-bots-rust-canyon.png") });

    // ESC opens pause menu
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("pauseMenu")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    const pauseVisible = await page.evaluate(() => {
      const el = document.getElementById("pauseMenu");
      const resume = document.getElementById("pauseResumeBtn");
      const exit = document.getElementById("pauseExitLobbyBtn");
      return {
        visible: !!el?.classList.contains("visible"),
        resume: !!resume,
        exit: !!exit,
        changeMap: !!document.getElementById("pauseChangeMapBtn"),
        inventory: !!document.getElementById("pauseInventoryBtn"),
        auction: !!document.getElementById("pauseAuctionBtn"),
      };
    });
    summary.pauseMenu = pauseVisible;
    if (!pauseVisible.visible) failures.push("pause menu not visible after ESC");
    for (const key of ["resume", "exit", "changeMap", "inventory", "auction"]) {
      if (!pauseVisible[key]) failures.push(`pause missing ${key}`);
    }
    await page.screenshot({ path: join(OUT_DIR, "02-esc-pause-menu.png") });

    await page.click("#pauseExitLobbyBtn");
    await page.waitForFunction(
      () => (window.__epic47Tap?.leaveAcks ?? []).length > 0,
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () => !document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 10000 },
    );
    const exitLobby = await page.evaluate(() => ({
      modeSelectHidden: document.getElementById("modeSelect")?.classList.contains("hidden") ?? true,
      pauseVisible: document.getElementById("pauseMenu")?.classList.contains("visible") ?? false,
      leaveAcks: (window.__epic47Tap?.leaveAcks ?? []).length,
    }));
    summary.exitLobby = exitLobby;
    if (exitLobby.modeSelectHidden) failures.push("mode-select still hidden after Exit to Lobby");
    if (exitLobby.pauseVisible) failures.push("pause menu still visible after exit");
    if (exitLobby.leaveAcks < 1) failures.push("no leave_match_ack");

    await page.screenshot({ path: join(OUT_DIR, "03-exit-to-lobby.png"), fullPage: true });

    // Changelog link near Telegram footer
    const changelog = await page.evaluate(() => {
      const link = document.querySelector("a.lobby-changelog");
      const telegram = document.querySelector("a.lobby-telegram");
      return {
        href: link?.getAttribute("href") ?? null,
        text: link?.textContent?.trim() ?? null,
        nearTelegram: !!(link && telegram && link.parentElement === telegram.parentElement),
      };
    });
    summary.changelog = changelog;
    if (changelog.href !== "/changelog.html") failures.push(`changelog href=${changelog.href}`);
    if (!changelog.nearTelegram) failures.push("changelog not near telegram footer");

    await page.goto(new URL("/changelog.html", CLIENT_URL).toString(), {
      waitUntil: "load",
      timeout: 20000,
    });
    await page.waitForSelector("#entries article", { timeout: 10000 });
    const changelogPage = await page.evaluate(() => {
      const articles = [...document.querySelectorAll("#entries article")];
      const nextDisabled = document.getElementById("nextBtn")?.disabled ?? true;
      return {
        count: articles.length,
        firstTitle: articles[0]?.querySelector("h2")?.textContent ?? null,
        nextEnabled: !nextDisabled,
      };
    });
    summary.changelogPage = changelogPage;
    if (changelogPage.count !== 10) failures.push(`changelog page1 count=${changelogPage.count}`);
    if (!String(changelogPage.firstTitle || "").includes("EPIC 47")) {
      failures.push("changelog not newest-first (expected EPIC 47 first)");
    }
    if (!changelogPage.nextEnabled) failures.push("changelog next disabled with >10 entries");
    await page.click("#nextBtn");
    await page.waitForFunction(
      () => (document.getElementById("pageMeta")?.textContent || "").includes("Page 2"),
      { timeout: 5000 },
    );
    await page.screenshot({ path: join(OUT_DIR, "04-changelog-page.png"), fullPage: true });

    await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify({ failures, summary }, null, 2));
    console.log("[epic47-qa] summary", JSON.stringify(summary, null, 2));
    if (failures.length) {
      console.error("[epic47-qa] FAIL", failures);
      process.exitCode = 1;
    } else {
      console.log("[epic47-qa] PASS");
    }
  } finally {
    await browser.close();
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
    }
  }
}

main().catch((err) => {
  console.error("[epic47-qa] FAIL", err);
  process.exit(1);
});
