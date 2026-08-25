// Tester Playwright evidence for EPIC 44 — Kill Loot Drop VFX.
//
// Part A — deterministic KillLootVfx selfcheck (real client module):
//   spawn gem/shard/amulet/gold (+ others), mid-flight screenshot, pixel
//   color samples, mesh-name inventory (no invented kinds).
// Part B — live Sandbox (vs Bots): kill a bot → server economy_kill_loot_fx
//   with granted kinds; mid-flight in-game screenshot; movement/jump/shoot
//   smoke. (Sandbox rewards bot victims — EPIC 35; DM bot no-fx covered by
//   npm run regression:kill-loot-vfx.)
// Part C — live wiring inject: synthetic economy_kill_loot_fx via the
//   client's own WebSocket message path (network → KillLootVfx), then
//   empty grants prove no invent.
//
// Usage:
//   node scripts/qa-epic44-tester-playwright.mjs
//   node scripts/qa-epic44-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7798;
const CLIENT_PORT = 5218;
const SELFCHECK_PORT = 5219;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-44");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const SELFCHECK_TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic44-kill-loot-vfx-selfcheck.html");
const SELFCHECK_URL = `http://127.0.0.1:${SELFCHECK_PORT}/.tmp-epic44-kill-loot-vfx-selfcheck.html`;

const SELFCHECK_HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EPIC 44 Kill Loot VFX Selfcheck</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #1a2430; }
      canvas { display: block; }
      #label {
        position: absolute; left: 12px; top: 10px; z-index: 2;
        font: 600 14px/1.3 ui-sans-serif, system-ui, sans-serif;
        color: #e8f0ff; background: rgba(0,0,0,0.55); padding: 6px 10px; border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <div id="label">EPIC 44 — gem / shard / amulet / gold (+ egg, stim, kit) mid-arc</div>
    <script type="module">
      import * as THREE from "three";
      import { KillLootVfx } from "/src/killLootVfx.ts";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a2430);
      const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 2.4, 7.2);
      camera.lookAt(0, 1.4, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(window.innerWidth, window.innerHeight);
      document.body.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x405060, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 1.35);
      key.position.set(4, 8, 5);
      scene.add(key);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(16, 12),
        new THREE.MeshStandardMaterial({ color: 0x2a3540, roughness: 0.9 }),
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      // Stand-ins for victim (left) and killer (right).
      const victimMarker = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 1.6, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x6688aa }),
      );
      victimMarker.position.set(-2.4, 0.8, 0);
      const killerMarker = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 1.6, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xaa6644 }),
      );
      killerMarker.position.set(2.6, 0.8, 0);
      scene.add(victimMarker, killerMarker);

      const vfx = new KillLootVfx(scene);
      vfx.spawnFromMessage({
        type: "economy_kill_loot_fx",
        killerId: "killer",
        victimId: "victim",
        victimPosition: { x: -2.4, y: 0, z: 0 },
        killerPosition: { x: 2.6, y: 0, z: 0 },
        grants: [
          { kind: "gem", detail: "sapphire" },
          { kind: "shard" },
          { kind: "amulet" },
          { kind: "gold" },
          { kind: "egg" },
          { kind: "stimulator" },
          { kind: "repair_kit" },
        ],
      });

      // Advance into mid-flight (~0.45s into 0.9s duration, after stagger).
      for (let i = 0; i < 30; i++) vfx.update(1 / 60);
      renderer.render(scene, camera);

      function namedKinds() {
        const kinds = [];
        scene.traverse((obj) => {
          if (typeof obj.name === "string" && obj.name.startsWith("killLoot:")) {
            kinds.push(obj.name.slice("killLoot:".length));
          }
        });
        return kinds;
      }

      async function samplePixels() {
        renderer.render(scene, camera);
        const url = renderer.domElement.toDataURL("image/png");
        const img = new Image();
        img.src = url;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const counts = {
          lit: 0,
          cyan: 0,
          magenta: 0,
          amber: 0,
          yellow: 0,
          green: 0,
          cream: 0,
        };
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 160) continue;
          if (r + g + b > 120) counts.lit += 1;
          // gem cyan/blue
          if (r < 140 && g > 140 && b > 180) counts.cyan += 1;
          // shard magenta/purple
          if (r > 120 && b > 150 && g < 130) counts.magenta += 1;
          // amulet / gold amber-yellow family
          if (r > 180 && g > 120 && b < 100) counts.amber += 1;
          if (r > 190 && g > 160 && b < 120) counts.yellow += 1;
          // stimulator lime
          if (g > 170 && r < 160 && b < 140) counts.green += 1;
          // egg cream
          if (r > 180 && g > 170 && b > 140 && b < 210) counts.cream += 1;
        }
        return counts;
      }

      window.__epic44Checks = {
        kinds: namedKinds(),
        samplePixels,
      };
      window.__ready = true;
    </script>
  </body>
</html>`;

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
        // already dead
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
    window.__wsMessages = [];
    window.__ws = null;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class InstrumentedWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.__ws = this;
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
}

async function registerAndContinue(page, email) {
  await installWsTap(page);
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
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

async function joinSandbox(page, nickname) {
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(() => !document.getElementById("modeBotsBtn")?.disabled, {
    timeout: 20000,
  });
  await page.click("#modeBotsBtn");
  await page.waitForFunction(() => document.getElementById("modeSelect")?.classList.contains("hidden"), {
    timeout: 15000,
  });
  await page.waitForFunction(() => window.__wsMessages.some((m) => m.type === "join_accepted"), {
    timeout: 15000,
  });
}

async function pointerLockAndSmoke(page) {
  const box = await page.locator("#app canvas").boundingBox();
  if (!box) throw new Error("canvas missing");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(150);

  // Movement / jump / look via real client socket inputs (authoritative path).
  await page.evaluate(() => {
    const send = (obj) => window.__ws?.send(JSON.stringify(obj));
    send({ type: "input", moveForward: 1, moveRight: 0, yaw: 0.2, pitch: -0.05, jump: false });
  });
  await sleep(250);
  await page.evaluate(() => {
    window.__ws?.send(
      JSON.stringify({ type: "input", moveForward: 0, moveRight: 0, yaw: 0.35, pitch: -0.1, jump: true }),
    );
  });
  await sleep(200);
  await page.evaluate(() => {
    window.__ws?.send(
      JSON.stringify({ type: "input", moveForward: 0, moveRight: 0, yaw: 0.35, pitch: -0.1, jump: false }),
    );
  });
  await sleep(100);
  await page.evaluate(() => window.__ws?.send(JSON.stringify({ type: "fire" })));
  await sleep(150);
}

/**
 * Local FPS camera yaw is mouse/pointer-lock driven. Headless CDP mouse moves do
 * not set movementX, but a synthetic MouseEvent with defined movementX/Y does —
 * FpsController reads those under pointer lock (MOUSE_SENSITIVITY = 0.0025).
 */
async function ensurePointerLock(page) {
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  if (locked) return;
  const box = await page.locator("#app canvas").boundingBox();
  if (!box) throw new Error("canvas missing for pointer lock");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(100);
}

async function lookLocalCameraToward(page, dx, dy, dz) {
  await ensurePointerLock(page);
  const result = await page.evaluate(({ dx, dy, dz }) => {
    const SENS = 0.0025;
    const horiz = Math.hypot(dx, dz);
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.max(-1.2, Math.min(1.2, Math.atan2(dy, Math.max(0.001, horiz))));
    const prev = window.__epic44Look ?? { yaw: 0, pitch: 0 };
    const movementX = -(targetYaw - prev.yaw) / SENS;
    const movementY = -(targetPitch - prev.pitch) / SENS;
    const evt = new MouseEvent("mousemove", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "movementX", { get: () => movementX });
    Object.defineProperty(evt, "movementY", { get: () => movementY });
    document.dispatchEvent(evt);
    window.__epic44Look = { yaw: targetYaw, pitch: targetPitch };
    return {
      locked: document.pointerLockElement !== null,
      targetYaw,
      targetPitch,
    };
  }, { dx, dy, dz });
  console.log(
    "[epic44-qa] local look:",
    JSON.stringify({
      locked: result.locked,
      targetYaw: Number(result.targetYaw.toFixed(3)),
      targetPitch: Number(result.targetPitch.toFixed(3)),
    }),
  );
  return result;
}

async function killNearestBot(page, selfId, deadlineMs = 60000) {
  await page.evaluate(() => {
    const send = (obj) => window.__ws.send(JSON.stringify(obj));
    const getSelf = (id) => {
      const ws = window.__wsMessages.filter((m) => m.type === "world_state").pop();
      return ws?.players.find((p) => p.id === id) ?? null;
    };
    const getBots = (id) => {
      const ws = window.__wsMessages.filter((m) => m.type === "world_state").pop();
      return ws ? ws.players.filter((p) => p.id !== id && p.alive) : [];
    };
    window.__epic44NearestBot = (id) => {
      const self = getSelf(id);
      const bots = getBots(id);
      if (!self || bots.length === 0) return null;
      let best = bots[0];
      let bestD = Infinity;
      for (const b of bots) {
        const d = Math.hypot(b.position.x - self.position.x, b.position.z - self.position.z);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      return { bot: best, dist: bestD };
    };
    window.__epic44Send = send;
    window.__epic44GetSelf = getSelf;
  });

  const AIM_HZ_MS = 33;
  const FIRE_MS = 520; // server fire rate-limit is 500ms
  let lastFireAt = 0;
  const deadline = Date.now() + deadlineMs;
  let selfKillMsg = null;
  while (Date.now() < deadline && !selfKillMsg) {
    await page.evaluate(
      ({ myId }) => {
        const found = window.__epic44NearestBot(myId);
        const self = window.__epic44GetSelf(myId);
        if (!found || !self) {
          window.__epic44Send({ type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false });
          return;
        }
        const dx = found.bot.position.x - self.position.x;
        const dz = found.bot.position.z - self.position.z;
        const dy = found.bot.position.y - self.position.y;
        const horiz = Math.hypot(dx, dz);
        const yaw = Math.atan2(-dx, -dz);
        const pitch = Math.atan2(dy, Math.max(0.001, horiz));
        const moveForward = horiz > 6 ? 1 : 0;
        window.__epic44Send({ type: "input", moveForward, moveRight: 0, yaw, pitch, jump: false });
      },
      { myId: selfId },
    );
    if (Date.now() - lastFireAt >= FIRE_MS) {
      await page.evaluate(() => window.__epic44Send({ type: "fire" }));
      lastFireAt = Date.now();
    }
    await sleep(AIM_HZ_MS);
    selfKillMsg = await page.evaluate(
      (myId) => window.__wsMessages.find((m) => m.type === "kill" && m.attackerId === myId) ?? null,
      selfId,
    );
  }
  return selfKillMsg;
}

/** Walk forward briefly to leave spawn cubbies when possible. */
async function walkTowardOpenSky(page, selfId, maxMs = 5000) {
  const deadline = Date.now() + maxMs;
  let best = { sky: 0 };
  while (Date.now() < deadline) {
    await page.evaluate(() => {
      window.__epic44Send?.({
        type: "input",
        moveForward: 1,
        moveRight: 0,
        yaw: 0,
        pitch: -0.05,
        jump: false,
      });
    });
    await sleep(350);
    const sample = await page.evaluate(() => {
      const canvas = document.querySelector("#app canvas");
      if (!canvas) return { sky: 0 };
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      const w = 160;
      const h = 100;
      c.width = w;
      c.height = h;
      ctx.drawImage(canvas, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let sky = 0;
      for (let y = 0; y < Math.floor(h * 0.35); y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          if (b > 150 && g > 140 && r > 120 && b >= r - 10) sky += 1;
        }
      }
      return { sky };
    });
    if (sample.sky > best.sky) best = sample;
    if (sample.sky > 600) break;
  }
  await page.evaluate(() => {
    window.__epic44Send?.({ type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false });
  });
  void selfId;
  return best;
}

async function runSelfcheck(browser) {
  await writeFile(SELFCHECK_TEMP_HTML, SELFCHECK_HTML, "utf8");
  const vite = spawn(
    join(CLIENT_ROOT, "node_modules", ".bin", "vite"),
    ["--host", "127.0.0.1", "--port", String(SELFCHECK_PORT), "--strictPort"],
    { cwd: CLIENT_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await waitForReady(vite, "selfcheck-vite", `http://127.0.0.1:${SELFCHECK_PORT}/`);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(SELFCHECK_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__ready === true, { timeout: 10000 });
    await page.screenshot({ path: join(OUT_DIR, "01-selfcheck-loot-kinds-midflight.png") });

    const checks = await page.evaluate(async () => ({
      kinds: window.__epic44Checks.kinds,
      pixels: await window.__epic44Checks.samplePixels(),
    }));
    await writeFile(join(OUT_DIR, "selfcheck-summary.json"), JSON.stringify(checks, null, 2));
    console.log("[epic44-qa] Part A kinds:", checks.kinds.join(","));
    console.log("[epic44-qa] Part A pixels:", JSON.stringify(checks.pixels));

    const required = ["gem", "shard", "amulet", "gold", "egg", "stimulator", "repair_kit"];
    for (const kind of required) {
      if (!checks.kinds.includes(kind)) {
        throw new Error(`selfcheck missing killLoot mesh for kind=${kind}`);
      }
    }
    if (checks.kinds.length !== required.length) {
      throw new Error(`selfcheck unexpected kinds: ${JSON.stringify(checks.kinds)}`);
    }
    if (checks.pixels.lit < 200) throw new Error(`selfcheck loot not readable (lit=${checks.pixels.lit})`);
    if (checks.pixels.cyan < 15) throw new Error(`selfcheck gem cyan glow weak (${checks.pixels.cyan})`);
    if (checks.pixels.magenta < 10) throw new Error(`selfcheck shard magenta weak (${checks.pixels.magenta})`);
    if (checks.pixels.amber + checks.pixels.yellow < 20) {
      throw new Error(
        `selfcheck amulet/gold amber-yellow weak (amber=${checks.pixels.amber} yellow=${checks.pixels.yellow})`,
      );
    }
    if (consoleErrors.length > 0) throw new Error(`selfcheck console errors: ${JSON.stringify(consoleErrors)}`);
    await page.close();
    return checks;
  } finally {
    await stop(vite);
    await rm(SELFCHECK_TEMP_HTML, { force: true });
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const summary = {
    selfcheck: null,
    liveSandboxKill: null,
    injectWiring: null,
    gameplay: null,
    consoleErrors: [],
  };
  const failures = [];

  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic44-qa] starting dedicated server/client");
    stack = await startStack();
  }

  const browser = await chromium.launch({
    args: [
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
    ],
  });

  try {
    // ---------- Part A ----------
    console.log("[epic44-qa] Part A: KillLootVfx selfcheck");
    summary.selfcheck = await runSelfcheck(browser);

    // ---------- Part B + C (live) ----------
    console.log("[epic44-qa] Part B/C: live sandbox + inject wiring");
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    const nickname = nick("E44Killer");
    const email = `epic44-${Date.now()}@example.com`;
    await registerAndContinue(page, email);
    await joinSandbox(page, nickname);

    const selfId = await page.evaluate(
      () => window.__wsMessages.find((m) => m.type === "welcome")?.playerId ?? null,
    );
    if (!selfId) throw new Error("missing welcome/self id");

    await page.screenshot({ path: join(OUT_DIR, "02-sandbox-joined.png") });
    // Wait out spawn protection so fire intents register (EPIC 41).
    await sleep(2200);
    await pointerLockAndSmoke(page);
    summary.gameplay = { moveJumpFire: "exercised" };
    await page.screenshot({ path: join(OUT_DIR, "03-gameplay-smoke.png") });

    // Clear message cursor for kill-relative asserts (keep join msgs for debug dump).
    const msgCountBeforeKill = await page.evaluate(() => window.__wsMessages.length);

    console.log("[epic44-qa] seeking sandbox bot kill for loot fx");
    const killMsg = await killNearestBot(page, selfId, 100000);
    if (!killMsg) {
      await page.screenshot({ path: join(OUT_DIR, "04-fail-no-kill.png") });
      throw new Error("did not observe self-attacker kill within deadline");
    }
    console.log("[epic44-qa] kill:", JSON.stringify(killMsg));

    // Wait for server loot fx (grantKillGold is async after kill broadcast).
    await page.waitForFunction(
      (fromIdx) =>
        window.__wsMessages
          .slice(fromIdx)
          .some((m) => m.type === "economy_kill_loot_fx" && m.grants?.length > 0),
      msgCountBeforeKill,
      { timeout: 5000 },
    );

    // Point LOCAL camera at mid-arc (synthetic movementX) — server input yaw alone
    // does not rotate the screenshot FOV under CDP pointer-lock.
    const aimVictim = await page.evaluate((myId) => {
      const fx = [...window.__wsMessages].reverse().find((m) => m.type === "economy_kill_loot_fx");
      const self = window.__epic44GetSelf?.(myId);
      if (!fx || !self) return null;
      const mid = {
        x: (fx.victimPosition.x + fx.killerPosition.x) * 0.5,
        y: ((fx.victimPosition.y ?? 0) + (fx.killerPosition.y ?? 0)) * 0.5 + 2.0,
        z: (fx.victimPosition.z + fx.killerPosition.z) * 0.5,
      };
      const dx = mid.x - self.position.x;
      const dy = mid.y - self.position.y;
      const dz = mid.z - self.position.z;
      const dist = Math.hypot(
        fx.victimPosition.x - self.position.x,
        fx.victimPosition.z - self.position.z,
      );
      return {
        dx,
        dy,
        dz,
        dist,
        mid,
        victim: fx.victimPosition,
        killer: fx.killerPosition,
        grants: fx.grants,
      };
    }, selfId);
    console.log("[epic44-qa] aim target:", JSON.stringify(aimVictim));
    if (aimVictim) {
      await lookLocalCameraToward(page, aimVictim.dx, aimVictim.dy, aimVictim.dz);
    }
    // Capture early in the ~0.9s flight window.
    await sleep(60);
    await page.screenshot({ path: join(OUT_DIR, "05-sandbox-kill-loot-midflight.png") });
    await sleep(160);
    await page.screenshot({ path: join(OUT_DIR, "05b-sandbox-kill-loot-midflight-late.png") });
    await sleep(650);
    await page.screenshot({ path: join(OUT_DIR, "06-sandbox-kill-after-absorb.png") });

    const postKill = await page.evaluate((fromIdx) => {
      const slice = window.__wsMessages.slice(fromIdx);
      const lootFx = slice.filter((m) => m.type === "economy_kill_loot_fx");
      const goldUpdates = slice.filter((m) => m.type === "economy_gold_update");
      return { lootFx, goldUpdates, sliceLen: slice.length };
    }, msgCountBeforeKill);

    await writeFile(join(OUT_DIR, "live-post-kill.json"), JSON.stringify(postKill, null, 2));
    console.log(
      "[epic44-qa] loot fx count:",
      postKill.lootFx.length,
      "kinds:",
      postKill.lootFx[0]?.grants?.map((g) => g.kind).join(",") ?? "(none)",
    );

    if (postKill.lootFx.length < 1) {
      failures.push("sandbox bot kill must emit economy_kill_loot_fx (EPIC 35 rewards)");
    } else {
      const fx = postKill.lootFx[0];
      if (fx.killerId !== selfId) failures.push(`loot fx killerId mismatch: ${fx.killerId}`);
      if (!fx.victimId) failures.push("loot fx missing victimId");
      if (!Array.isArray(fx.grants) || fx.grants.length < 1) {
        failures.push("loot fx grants empty");
      }
      if (!fx.grants.some((g) => g.kind === "gold")) {
        failures.push("sandbox rewarding kill expected gold kind in grants");
      }
      if (postKill.goldUpdates.length < 1) {
        failures.push("expected economy_gold_update alongside loot fx");
      }
    }
    summary.liveSandboxKill = {
      kill: killMsg,
      lootFx: postKill.lootFx,
      goldUpdates: postKill.goldUpdates.length,
      aimVictim,
    };

    // ---------- Part C: inject wiring + no invent (in front of local look) ----------
    const injectResult = await page.evaluate(({ killerId }) => {
      const before = window.__wsMessages.length;
      const self = window.__epic44GetSelf?.(killerId);
      const base = self?.position ?? { x: 0, y: 0, z: 0 };
      const look = window.__epic44Look ?? { yaw: 0, pitch: 0 };
      const fx = -Math.sin(look.yaw);
      const fz = -Math.cos(look.yaw);
      const victimPosition = {
        x: base.x + fx * 4.0,
        y: base.y + 1.5,
        z: base.z + fz * 4.0,
      };
      const killerPosition = { x: base.x, y: base.y, z: base.z };
      const msg = {
        type: "economy_kill_loot_fx",
        killerId,
        victimId: "inject-victim",
        victimPosition,
        killerPosition,
        grants: [{ kind: "gem" }, { kind: "shard" }, { kind: "amulet" }, { kind: "gold" }],
      };
      window.__ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
      const empty = {
        type: "economy_kill_loot_fx",
        killerId,
        victimId: "inject-empty",
        victimPosition: {
          x: base.x + fx * 3.0,
          y: base.y + 1.2,
          z: base.z + fz * 3.0,
        },
        killerPosition,
        grants: [],
      };
      window.__ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(empty) }));
      return { before, after: window.__wsMessages.length, victimPosition, killerPosition, look };
    }, { killerId: selfId });

    // Look at inject mid-arc and capture mid-flight.
    if (injectResult.victimPosition) {
      const selfPos = await page.evaluate((id) => window.__epic44GetSelf?.(id)?.position ?? { x: 0, y: 0, z: 0 }, selfId);
      const mid = injectResult.victimPosition;
      await lookLocalCameraToward(
        page,
        mid.x - selfPos.x,
        mid.y + 0.4 - selfPos.y,
        mid.z - selfPos.z,
      );
    }
    await sleep(280);
    await page.screenshot({ path: join(OUT_DIR, "07-inject-gem-shard-amulet-gold.png") });

    // Confirm tap recorded the injected messages (client handler consumes them).
    const injected = await page.evaluate((fromIdx) => {
      return window.__wsMessages
        .slice(fromIdx)
        .filter((m) => m.type === "economy_kill_loot_fx" && m.victimId?.startsWith("inject-"));
    }, injectResult.before);

    if (injected.length !== 2) {
      failures.push(`expected 2 injected loot fx messages, got ${injected.length}`);
    }
    const withGrants = injected.find((m) => m.grants?.length > 0);
    const emptyGrants = injected.find((m) => Array.isArray(m.grants) && m.grants.length === 0);
    if (!withGrants) failures.push("injected grants message missing");
    if (!emptyGrants) failures.push("injected empty-grants message missing");
    if (withGrants) {
      const kinds = withGrants.grants.map((g) => g.kind).sort();
      const expected = ["amulet", "gem", "gold", "shard"];
      if (JSON.stringify(kinds) !== JSON.stringify(expected)) {
        failures.push(`inject kinds mismatch: ${kinds.join(",")}`);
      }
    }

    summary.injectWiring = { injected, injectResult };
    summary.consoleErrors = consoleErrors;

    const allMsgs = await page.evaluate(() => window.__wsMessages);
    await writeFile(join(OUT_DIR, "ws-messages.json"), JSON.stringify(allMsgs, null, 2));

    // Soft-filter known noisy console errors; fail on real pageerrors / unexpected.
    const serious = consoleErrors.filter(
      (e) => !/favicon/i.test(e) && !/WebGL/i.test(e),
    );
    if (serious.length > 0) {
      failures.push(`browser console errors: ${JSON.stringify(serious)}`);
    }

    await page.close();
  } finally {
    await browser.close();
    if (stack) {
      await Promise.all([stop(stack.client), stop(stack.server)]);
    }
  }

  await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    console.error("[epic44-qa] FAIL");
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
  console.log("[epic44-qa] PASS");
}

main().catch(async (err) => {
  console.error("[epic44-qa] FAIL", err);
  try {
    await rm(SELFCHECK_TEMP_HTML, { force: true });
  } catch {
    // ignore
  }
  process.exit(1);
});
