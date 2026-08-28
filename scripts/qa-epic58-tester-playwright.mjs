// EPIC 58 Playwright evidence: green respawn beam VFX via QA hook.
//
// Usage:
//   node scripts/qa-epic58-tester-playwright.mjs
//   node scripts/qa-epic58-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

const CLIENT_PORT = 5278;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-58");
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

    await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.evaluate(() => {
      const lobby = document.getElementById("lobby");
      if (lobby) lobby.style.display = "none";
      const mode = document.getElementById("modeSelect");
      if (mode) mode.style.display = "none";
    });

    await page.evaluate(() => {
      const hook = window.__cwSpawnBeam;
      if (typeof hook !== "function") throw new Error("__cwSpawnBeam hook missing");
      hook(0, 0);
    });

    await sleep(200);
    await page.screenshot({ path: join(OUT_DIR, "01-spawn-beam-early.png"), fullPage: false });

    await sleep(800);
    await page.screenshot({ path: join(OUT_DIR, "02-spawn-beam-mid.png"), fullPage: false });

    const beamVisible = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return Boolean(canvas);
    });

    await writeFile(
      join(OUT_DIR, "summary.json"),
      JSON.stringify(
        {
          epic: 58,
          clientUrl: CLIENT_URL,
          beamHookInvoked: true,
          canvasPresent: beamVisible,
          screenshots: ["01-spawn-beam-early.png", "02-spawn-beam-mid.png"],
        },
        null,
        2,
      ),
    );

    log("EPIC 58 spawn beam Playwright evidence OK");
    await browser.close();
  } finally {
    await writeFile(join(OUT_DIR, "run.log"), `${logLines.join("\n")}\n`);
    if (client) await stop(client);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
