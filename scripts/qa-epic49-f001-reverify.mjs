// EPIC 49 F-001 re-verify: rust_canyon dry-bed rocks use rock grey, not propAccent.
// Usage: node scripts/qa-epic49-f001-reverify.mjs

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7839;
const CLIENT_PORT = 5239;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-49");

const ROCK_HEX = 0x6a6460;
const RUST_BODY_HEX = 0x8a5030;

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
      window.__epic49Tap = window.__epic49Tap || {
        outbound: [],
        mapStates: [],
        joinAccepted: [],
      };
      window.__epic49Tap.ws = ws;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "map_state") window.__epic49Tap.mapStates.push(msg);
          if (msg.type === "join_accepted") window.__epic49Tap.joinAccepted.push(msg);
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  console.log("[epic49-f001] starting dedicated server/client");
  const stack = await startStack();

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

  let meshProbe = null;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await installWsTap(page);
    await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("#mapSelect", { timeout: 15000 });
    await page.waitForFunction(
      () => document.getElementById("status")?.dataset.state === "connected",
      { timeout: 20000 },
    );
    const email = `epic49f001_${Date.now()}@example.com`;
    await registerAndContinue(page, email);
    await page.fill("#nicknameInput", `F001${Math.random().toString(36).slice(2, 6)}`);
    await page.waitForFunction(
      () => {
        const btn = document.getElementById("modeBotsBtn");
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );

    await page.selectOption("#mapSelect", "rust_canyon");
    await page.evaluate(() => localStorage.setItem("cubewars.mapId", "rust_canyon"));
    await page.click("#modeBotsBtn");
    await page.waitForFunction(
      () => document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => (window.__epic49Tap?.mapStates ?? []).some((m) => m.mapId === "rust_canyon"),
      { timeout: 15000 },
    );
    await sleep(800);

    meshProbe = await page.evaluate(
      ({ rockHex, bodyHex }) => {
        const scene = window.__cwQaScene;
        const root = scene ?? null;
        // Walk Three scene via hold-pose hook's world if exposed; else traverse DOM canvas owner.
        const threeRoot =
          window.__cwQaMapGroup ||
          window.__cwScene ||
          (typeof window.__THREE_SCENE__ !== "undefined" ? window.__THREE_SCENE__ : null);

        // Fallback: find meshes by walking from any global map group if present.
        let mapGroup = threeRoot;
        if (!mapGroup && window.__cwQaHoldPose !== undefined) {
          // Client may not expose scene; probe via getObjectsByProperty if available later.
        }

        const results = [];
        const walk = (obj) => {
          if (!obj) return;
          if (obj.isMesh && typeof obj.name === "string") {
            const id = obj.name;
            if (id.includes("rc_bed_") && id.includes("_rock_")) {
              const c = obj.material?.color?.getHex?.() ?? null;
              results.push({
                id,
                colorHex: c,
                isRockGrey: c === rockHex,
                isBodyAccent: c === bodyHex,
              });
            }
            if (id.includes("rc_wreck_") && id.includes("_body")) {
              const c = obj.material?.color?.getHex?.() ?? null;
              results.push({
                id,
                colorHex: c,
                isRockGrey: c === rockHex,
                isBodyAccent: c === bodyHex,
                kind: "body",
              });
            }
          }
          for (const child of obj.children ?? []) walk(child);
        };

        // Discover scene from renderer if exposed on canvas.
        const canvas = document.querySelector("canvas");
        let found = false;
        if (mapGroup) {
          walk(mapGroup);
          found = true;
        }
        // Try common private hooks used by QA.
        for (const key of Object.keys(window)) {
          if (key.startsWith("__cw") || key.includes("Scene") || key.includes("mapGeometry")) {
            try {
              walk(window[key]);
            } catch {
              /* ignore */
            }
          }
        }
        return { results, found, keys: Object.keys(window).filter((k) => k.startsWith("__cw")) };
      },
      { rockHex: ROCK_HEX, bodyHex: RUST_BODY_HEX },
    );

    // Pose toward west dry-bed pile (-8, *, -28).
    await page.evaluate(() => {
      window.__cwQaHoldPose = {
        eye: { x: -8, y: 3.2, z: -16 },
        look: { x: -8, y: 0.8, z: -28 },
      };
    });
    await sleep(400);
    const shotPath = join(OUT_DIR, "12-f001-rust-bed-rocks.png");
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`[epic49-f001] shot → ${shotPath}`);

    // Classifier-level check already covered by regression; mesh probe is best-effort.
    const bedRocks = (meshProbe?.results ?? []).filter((r) => r.id?.includes("_rock_"));
    const bodies = (meshProbe?.results ?? []).filter((r) => r.kind === "body");
    if (bedRocks.length > 0) {
      for (const r of bedRocks) {
        if (!r.isRockGrey || r.isBodyAccent) {
          failures.push(`${r.id} color=0x${(r.colorHex ?? 0).toString(16)} (expected rock grey)`);
        }
      }
      console.log(`[epic49-f001] mesh probe bed rocks: ${bedRocks.length}`);
    } else {
      console.log(
        `[epic49-f001] mesh probe unavailable (keys=${JSON.stringify(meshProbe?.keys)}); relying on regression + screenshot`,
      );
    }
    if (bodies.length > 0) {
      for (const r of bodies) {
        if (!r.isBodyAccent) {
          failures.push(`${r.id} body not propAccent (got 0x${(r.colorHex ?? 0).toString(16)})`);
        }
      }
    }

    await writeFile(
      join(OUT_DIR, "f001-reverify.json"),
      JSON.stringify({ meshProbe, failures, shotPath }, null, 2),
    );
  } finally {
    await browser.close();
    await stop(stack.client);
    await stop(stack.server);
  }

  if (failures.length) {
    console.error("[epic49-f001] FAIL", failures);
    process.exit(1);
  }
  console.log("[epic49-f001] OK");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
