// EPIC 18 live QA: verifies pistol hold-to-fire through the real browser
// client and real WebSocket server. The server remains authoritative; this
// script counts server fire_broadcast echoes from the local player's socket.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const SERVER_PORT = 7780;
const CLIENT_PORT = 5178;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-18-hold-fire");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForReady(child, label, marker) {
  return new Promise((resolve, reject) => {
    let ready = false;
    const onData = (buf) => {
      const text = buf.toString();
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
    }, 10000);
  });
}

function stop(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
      resolve();
    }, 3000);
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const server = spawn(join(REPO_ROOT, "node_modules", ".bin", "tsx"), ["server/src/index.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const client = spawn(
    join(CLIENT_ROOT, "node_modules", ".bin", "vite"),
    ["--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
    {
      cwd: CLIENT_ROOT,
      env: { ...process.env, VITE_CUBEWARS_WS_URL: `ws://127.0.0.1:${SERVER_PORT}` },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let browser;
  try {
    await Promise.all([
      waitForReady(server, "server", "cubewars game server listening"),
      waitForReady(client, "vite", `http://127.0.0.1:${CLIENT_PORT}/`),
    ]);

    browser = await chromium.launch({
      args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
    await page.addInitScript(() => {
      window.__wsMessages = [];
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class InstrumentedWebSocket extends NativeWebSocket {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", (event) => {
            try {
              window.__wsMessages.push(JSON.parse(event.data));
            } catch {
              // ignore non-JSON
            }
          });
        }
      };
    });

    await page.goto(CLIENT_URL, { waitUntil: "load" });
    await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });
    await page.fill("#nicknameInput", "HoldTester");
    await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
    await page.click("#modePublicBtn");
    await page.waitForFunction(() => document.getElementById("modeSelect")?.classList.contains("hidden"), { timeout: 5000 });
    await sleep(500);

    const canvasBox = await page.locator("#app canvas").boundingBox();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
    await page.waitForFunction(() => document.pointerLockElement !== null, { timeout: 5000 });
    await sleep(650);

    const beforeClick = await page.evaluate(() => ({
      selfId: window.__wsMessages.find((m) => m.type === "welcome")?.playerId,
      count: window.__wsMessages.filter(
        (m) => m.type === "fire_broadcast" && m.shooterId === window.__wsMessages.find((x) => x.type === "welcome")?.playerId,
      ).length,
    }));

    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await sleep(650);
    const afterClick = await page.evaluate(() => {
      const selfId = window.__wsMessages.find((m) => m.type === "welcome")?.playerId;
      return {
        selfId,
        count: window.__wsMessages.filter((m) => m.type === "fire_broadcast" && m.shooterId === selfId).length,
      };
    });

    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.mouse.down();
    await sleep(1300);
    await page.mouse.up();
    await sleep(500);
    await page.screenshot({ path: join(OUT_DIR, "01-pistol-hold-fire.png") });

    const after = await page.evaluate(() => {
      const selfId = window.__wsMessages.find((m) => m.type === "welcome")?.playerId;
      return {
        selfId,
        count: window.__wsMessages.filter((m) => m.type === "fire_broadcast" && m.shooterId === selfId).length,
      };
    });
    const acceptedClick = afterClick.count - beforeClick.count;
    const acceptedDuringHold = after.count - afterClick.count;
    console.log("[hold-fire] selfId:", after.selfId);
    console.log("[hold-fire] accepted single-click fire_broadcast:", acceptedClick);
    console.log("[hold-fire] accepted fire_broadcast during hold:", acceptedDuringHold);
    console.log("[hold-fire] console errors:", consoleErrors.length);
    for (const error of consoleErrors) console.log("  -", error);

    if (!after.selfId) throw new Error("missing welcome/self id");
    if (acceptedClick !== 1) {
      throw new Error(`expected 1 accepted pistol shot from a normal click, got ${acceptedClick}`);
    }
    if (acceptedDuringHold < 2 || acceptedDuringHold > 4) {
      throw new Error(`expected 2-4 accepted pistol shots during ~1.3s hold, got ${acceptedDuringHold}`);
    }
    if (consoleErrors.length > 0) throw new Error("browser console errors detected");
    console.log("[hold-fire] PASS");
  } finally {
    await browser?.close();
    await Promise.all([stop(client), stop(server)]);
  }
}

main().catch((err) => {
  console.error("[hold-fire] FAIL", err);
  process.exit(1);
});
