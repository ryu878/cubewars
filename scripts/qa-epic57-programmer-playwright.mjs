// EPIC 57 Playwright evidence: crosshair cooldown ring ready vs recovering.
// Injects HUD DOM + CombatHud.setCooldownProgress — ring is CSS/SVG, not match-dependent.
//
// Usage:
//   node scripts/qa-epic57-programmer-playwright.mjs
//   node scripts/qa-epic57-programmer-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const CLIENT_PORT = 5267;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-57");
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
      const lobby = document.getElementById("lobby");
      if (lobby) lobby.style.display = "none";
      const mode = document.getElementById("modeSelect");
      if (mode) mode.style.display = "none";
      // Dark backdrop so the white ring is visible.
      document.body.style.background = "#1a1e24";
      const canvas = document.querySelector("canvas");
      if (canvas) canvas.style.opacity = "0.15";
    });
    await sleep(400);

    // Ready: progress 1 → opacity 0 (transparent full ring).
    await page.evaluate(() => {
      window.__cwQaCooldownProgress = 1;
    });
    await sleep(100);
    const readyPath = join(OUT_DIR, "cooldown-ring-ready.png");
    await page.screenshot({
      path: readyPath,
      clip: { x: 1280 / 2 - 80, y: 800 / 2 - 80, width: 160, height: 160 },
    });
    log(`wrote ${readyPath}`);

    // Recovering: half-filled visible ring.
    await page.evaluate(() => {
      window.__cwQaCooldownProgress = 0.5;
    });
    await sleep(100);
    // Crop a larger region around the crosshair so the ring is obvious.
    const recoveringPath = join(OUT_DIR, "cooldown-ring-recovering.png");
    await page.screenshot({
      path: recoveringPath,
      clip: { x: 1280 / 2 - 80, y: 800 / 2 - 80, width: 160, height: 160 },
    });
    log(`wrote ${recoveringPath}`);

    // Also full-frame with recovering ring for context.
    const recoveringFull = join(OUT_DIR, "cooldown-ring-recovering-full.png");
    await page.screenshot({ path: recoveringFull });
    log(`wrote ${recoveringFull}`);

    const metrics = await page.evaluate(() => {
      const arc = document.getElementById("cooldownRingArc");
      const cs = arc ? getComputedStyle(arc) : null;
      return {
        hasArc: !!arc,
        opacity: cs?.opacity ?? null,
        dashoffset: arc?.style.strokeDashoffset ?? null,
        qa: window.__cwQaCooldownProgress,
      };
    });
    log(`metrics ${JSON.stringify(metrics)}`);
    assertOk(metrics.hasArc, "cooldown ring arc must exist");
    assertOk(metrics.opacity === "0.85", "recovering ring must be visible");
    assertOk(metrics.qa === 0.5, "QA cooldown progress must stay pinned");

    await browser.close();
    await writeFile(join(OUT_DIR, "programmer-playwright.log"), logLines.join("\n") + "\n");
    log("EPIC 57 playwright evidence PASS");
  } finally {
    if (client) await stop(client);
  }
  // Vite child can keep the event loop alive after SIGKILL race — force exit.
  process.exit(0);
}

function assertOk(cond, msg) {
  if (!cond) throw new Error(msg);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
