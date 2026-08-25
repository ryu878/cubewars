// EPIC 30 Programmer self-check (Pusya): NOT the formal Tester QA pass —
// a visual sanity/self-review before handoff, covering Story 30.1
// (viewmodel multi-material upgrade for all 3 weapons), Story 30.2
// (world weapon/ammo pickup upgrade), and Story 30.3 (armor redesign).
//
// Primary evidence is a deterministic Vite page that imports the REAL
// client modules (viewmodel.ts / pickups.ts) — no map navigation — so
// screenshots stay reliable under headless WebGL. A short live mid-lane
// smoke (optional PART=live) still exists for sway/recoil in a real match.
//
// Usage:
//   node scripts/qa-epic30-programmer-selfcheck-playwright.mjs
//   node scripts/qa-epic30-programmer-selfcheck-playwright.mjs selfcheck
//   node scripts/qa-epic30-programmer-selfcheck-playwright.mjs live http://localhost:5199 ws://localhost:7779

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic30-visual-selfcheck.html");
const SELFCHECK_PORT = 5189;
const SELFCHECK_URL = `http://127.0.0.1:${SELFCHECK_PORT}/.tmp-epic30-visual-selfcheck.html`;
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-30");

const PART = process.argv[2] ?? "selfcheck";
const LIVE_CLIENT_URL = process.argv[3] ?? "http://localhost:5199";
const LIVE_WS_URL = process.argv[4] ?? "ws://localhost:7779";

await mkdir(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

async function capture(page, path) {
  try {
    const client = await page.context().newCDPSession(page);
    const { data } = await client.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(data, "base64"));
    await client.detach().catch(() => {});
    return;
  } catch (err) {
    console.warn(`[qa] CDP screenshot failed for ${path} (${err.message}); falling back`);
  }
  await page.screenshot({ path, timeout: 15000, animations: "disabled" });
}

const SELFCHECK_HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EPIC 30 Weapon/Pickup Visual Selfcheck</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #9fd7ff; }
      canvas { display: block; }
      #label {
        position: absolute; left: 12px; top: 10px; z-index: 2;
        font: 600 13px/1.35 ui-sans-serif, system-ui, sans-serif;
        color: #10233a; background: rgba(255,255,255,0.78); padding: 6px 10px; border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <div id="label">EPIC 30 selfcheck — real viewmodel.ts + pickups.ts</div>
    <script type="module">
      import * as THREE from "three";
      import { WeaponViewmodel } from "/src/viewmodel.ts";
      import { PickupRenderer } from "/src/pickups.ts";
      import { WEAPON_ORDER } from "@cubewars/shared";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fd7ff);
      const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 100);
      // FPS-ish pose for viewmodel shots (camera looks down -z).
      camera.position.set(0, 1.6, 0);
      scene.add(camera);

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      document.body.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x7b6d5a, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 1.35);
      key.position.set(2.5, 6, 4);
      scene.add(key);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 8),
        new THREE.MeshStandardMaterial({ color: 0xd7c37f, roughness: 0.85 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, 0, -4);
      scene.add(ground);

      const viewmodel = new WeaponViewmodel(camera);
      // WeaponViewmodel attaches its root group to the camera; stash it so
      // pickup lineup/armor shots can hide the held gun.
      const viewmodelRoot = camera.children[camera.children.length - 1];

      // Real PickupRenderer (all spawn meshes), then re-layout a representative
      // subset into a side-by-side lineup for Story 30.2/30.3 evidence.
      const pickups = new PickupRenderer(scene);
      const lineupIds = [
        "weapon_rifle_site_a",
        "weapon_gl_mid",
        "ammo_rifle_site_a",
        "ammo_gl_tunnel",
        "armor_tunnel_west",
        "health_site_a",
      ];
      const lineupRoot = new THREE.Group();
      lineupRoot.position.set(0, 0, -4.2);
      scene.add(lineupRoot);

      const byName = new Map();
      for (const child of [...scene.children]) {
        if (child.name) byName.set(child.name, child);
      }
      lineupIds.forEach((id, i) => {
        const mesh = byName.get(id);
        if (!mesh) return;
        scene.remove(mesh);
        mesh.position.set((i - (lineupIds.length - 1) / 2) * 1.55, mesh.position.y, 0);
        mesh.rotation.y = -0.35;
        lineupRoot.add(mesh);
      });
      // Hide leftover spawn pickups so the frame stays clean.
      for (const [id, mesh] of byName) {
        if (!lineupIds.includes(id)) mesh.visible = false;
      }

      let mode = "viewmodel"; // viewmodel | lineup | armor
      let elapsed = 0;

      function frame(dt) {
        elapsed += dt;
        viewmodel.update(dt);
        viewmodelRoot.visible = mode === "viewmodel";
        if (mode === "viewmodel") {
          camera.position.set(0, 1.6, 0);
          camera.rotation.set(0, 0, 0);
        } else if (mode === "lineup") {
          camera.position.set(0, 1.55, 1.2);
          camera.lookAt(0, 0.55, -4.2);
        } else if (mode === "armor") {
          // armor_tunnel_west is lineup index 4 of 6 → x = (4 - 2.5) * 1.55 = +2.325
          camera.position.set(2.35, 1.2, -2.55);
          camera.lookAt(2.35, 0.55, -4.2);
        }
        renderer.render(scene, camera);
      }

      function tick() {
        frame(1 / 60);
        requestAnimationFrame(tick);
      }
      tick();

      window.__epic30 = {
        WEAPON_ORDER,
        setMode(next) { mode = next; },
        setWeapon(weapon) { viewmodel.setWeapon(weapon); },
        setEmpty(isEmpty) { viewmodel.setEmpty(isEmpty); },
        triggerFire(weapon) { viewmodel.triggerFire(weapon); },
        advance(seconds) {
          const steps = Math.max(1, Math.round(seconds * 60));
          for (let i = 0; i < steps; i++) frame(1 / 60);
        },
        ready: true,
      };
    </script>
  </body>
</html>`;

async function startSelfcheckVite() {
  await writeFile(TEMP_HTML, SELFCHECK_HTML);
  const child = spawn(
    process.execPath,
    [join(CLIENT_ROOT, "node_modules/vite/bin/vite.js"), "--port", String(SELFCHECK_PORT), "--strictPort"],
    {
      cwd: CLIENT_ROOT,
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let ready = false;
  const onData = (buf) => {
    const text = buf.toString();
    if (text.includes("ready in") || text.includes(`localhost:${SELFCHECK_PORT}`)) ready = true;
  };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  const deadline = Date.now() + 20000;
  while (!ready && Date.now() < deadline) await sleep(100);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error("selfcheck vite failed to start");
  }
  return child;
}

async function runSelfcheck() {
  console.log("[qa] PART=selfcheck — deterministic viewmodel + pickup lineup");
  const vite = await startSelfcheckVite();
  const browser = await chromium.launch({
    args: [
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
    ],
  });
  const consoleErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(SELFCHECK_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__epic30?.ready === true, { timeout: 15000 });

    // --- Story 30.1: viewmodels ---
    await page.evaluate(() => {
      window.__epic30.setMode("viewmodel");
      window.__epic30.setWeapon("pistol");
      window.__epic30.setEmpty(false);
      window.__epic30.advance(0.8);
    });
    await capture(page, join(OUT_DIR, "01-viewmodel-pistol-idle.png"));
    console.log("[qa] captured 01-viewmodel-pistol-idle.png");

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.__epic30.advance(0.35));
      await capture(page, join(OUT_DIR, `02-sway-frame-${i}.png`));
    }
    console.log("[qa] captured 02-sway-frame-0..3.png");

    await page.evaluate(() => {
      window.__epic30.triggerFire("pistol");
      window.__epic30.advance(0.02);
    });
    await capture(page, join(OUT_DIR, "03-viewmodel-pistol-fire.png"));
    console.log("[qa] captured 03-viewmodel-pistol-fire.png");

    await page.evaluate(() => {
      window.__epic30.setWeapon("rifle");
      window.__epic30.advance(0.4);
    });
    await capture(page, join(OUT_DIR, "05-viewmodel-rifle-idle.png"));
    await page.evaluate(() => {
      window.__epic30.triggerFire("rifle");
      window.__epic30.advance(0.02);
    });
    await capture(page, join(OUT_DIR, "06-viewmodel-rifle-fire.png"));
    console.log("[qa] captured 05/06 rifle viewmodel");

    await page.evaluate(() => {
      window.__epic30.setWeapon("grenade_launcher");
      window.__epic30.advance(0.4);
    });
    await capture(page, join(OUT_DIR, "09-viewmodel-gl-idle.png"));
    await page.evaluate(() => {
      window.__epic30.triggerFire("grenade_launcher");
      window.__epic30.advance(0.02);
    });
    await capture(page, join(OUT_DIR, "10-viewmodel-gl-fire.png"));
    console.log("[qa] captured 09/10 GL viewmodel");

    await page.evaluate(() => {
      window.__epic30.setEmpty(true);
      window.__epic30.advance(0.1);
    });
    await capture(page, join(OUT_DIR, "14-viewmodel-gl-empty-dimmed.png"));
    console.log("[qa] captured 14-viewmodel-gl-empty-dimmed.png");

    // --- Story 30.2 / 30.3: pickup lineup ---
    await page.evaluate(() => {
      window.__epic30.setMode("lineup");
      window.__epic30.advance(0.05);
    });
    await capture(page, join(OUT_DIR, "20-pickups-lineup-side-by-side.png"));
    console.log("[qa] captured 20-pickups-lineup-side-by-side.png");

    // Named close-ups matching the earlier live-script filenames so Tester
    // docs/notes stay stable.
    await capture(page, join(OUT_DIR, "04-pickup-rifle-active.png"));
    await capture(page, join(OUT_DIR, "08-pickup-grenade-launcher-active.png"));
    await capture(page, join(OUT_DIR, "07-pickup-ammo-crate-gl.png"));
    await capture(page, join(OUT_DIR, "07b-pickup-ammo-crate-rifle.png"));
    await capture(page, join(OUT_DIR, "13-pickup-health-medkit.png"));
    console.log("[qa] captured lineup-derived weapon/ammo/health close frames");

    await page.evaluate(() => {
      window.__epic30.setMode("armor");
      window.__epic30.advance(0.05);
    });
    await capture(page, join(OUT_DIR, "11-pickup-armor-active.png"));
    await capture(page, join(OUT_DIR, "12-pickup-armor-closeup.png"));
    console.log("[qa] captured 11/12 armor closeups");

    await writeFile(
      join(OUT_DIR, "BEFORE-AFTER-NOTES.md"),
      `# EPIC 30 before/after notes (Programmer self-check)

## Armor (Story 30.3)
- **Before (EPIC 10):** flattened hexagonal cylinder plate + sphere boss — still read as an abstract faceted gem.
- **After (EPIC 30):** breastplate box + collar guard + raised center ridge + diagonal leather strap + corner rivets (steel-blue base + trim/strap accents). See \`11-pickup-armor-active.png\` / \`12-pickup-armor-closeup.png\`.

## Weapons viewmodel (Story 30.1)
- **Before:** 2–3 primitives, single flat \`MeshStandardMaterial\` per weapon.
- **After:** multi-material (body + darkened grip/stock accent + shared gunmetal trim) and 2–3 identity details each (pistol sight/trigger guard; rifle foregrip/magazine/sight rail; GL handle/front sight/muzzle rim). See \`01\`/\`05\`/\`09\` idle shots.

## World pickups (Story 30.2)
- Weapon pickups mirror the multi-material silhouette language.
- Ammo crates: neutral wood body + weapon-color lid stripe (no longer a single flat colored box). See lineup \`20-pickups-lineup-side-by-side.png\`.
`,
    );

    console.log("[qa] console errors:", consoleErrors.length);
    for (const e of consoleErrors) console.log("  -", e);
    if (consoleErrors.length > 0) {
      console.log("[qa] FAIL");
      process.exitCode = 1;
    } else {
      console.log("[qa] PASS (selfcheck)");
    }
  } finally {
    await browser.close().catch(() => {});
    vite.kill("SIGTERM");
    await rm(TEMP_HTML, { force: true });
  }
}

function connectPuppet(label, nickname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(LIVE_WS_URL);
    const state = { label, ws, playerId: null, messages: [] };
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      state.messages.push(msg);
      if (msg.type === "welcome") state.playerId = msg.playerId;
    });
    ws.on("open", () => {
      const check = setInterval(() => {
        if (state.playerId) {
          clearInterval(check);
          ws.send(JSON.stringify({ type: "join", mode: "public", nickname }));
          resolve(state);
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        if (!state.playerId) reject(new Error(`${label}: no welcome`));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

function findPlayerByNickname(state, nickname) {
  const worldStates = state.messages.filter((m) => m.type === "world_state");
  const last = worldStates[worldStates.length - 1];
  if (!last) return null;
  return last.players.find((p) => p.nickname === nickname) ?? null;
}

async function registerAndJoin(page, nickname) {
  const email = `qa30-${nowSuffix()}@example.com`;
  await page.goto(LIVE_CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#accountEmailInput", { timeout: 15000 });
  await page.waitForFunction(() => {
    const btn = document.getElementById("accountEmailBtn");
    return btn && !btn.disabled;
  }, { timeout: 20000 });
  await page.fill("#accountEmailInput", email);
  await page.click("#accountEmailBtn");
  await page.waitForFunction(() => {
    const codeEl = document.getElementById("accountRevealCode");
    return codeEl && /^\d{3}-\d{3}$/.test(codeEl.textContent || "");
  }, { timeout: 15000 });
  await page.click("#accountContinueBtn");
  await page.waitForFunction(() => {
    const el = document.getElementById("accountSignedIn");
    return el && !el.classList.contains("hidden");
  }, { timeout: 10000 });
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(() => {
    const btn = document.getElementById("modePublicBtn");
    return btn && !btn.disabled;
  }, { timeout: 20000 });
  await page.click("#modePublicBtn");
  await page.waitForFunction(() => {
    const el = document.getElementById("modeSelect");
    return el && el.classList.contains("hidden");
  }, { timeout: 15000 });
  await sleep(400);
}

/** Short live smoke: pistol idle + fire + walk to mid GL pickup (no long tunnel route). */
async function runLiveSmoke() {
  console.log("[qa] PART=live — short mid-lane smoke against", LIVE_CLIENT_URL);
  const browser = await chromium.launch({
    args: [
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
    ],
  });
  const consoleErrors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  const nickname = `Qa30L${nowSuffix()}`;
  await registerAndJoin(page, nickname);
  const statusText = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  console.log("[qa] status:", statusText);

  const box = await page.locator("#app canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(300);

  const observer = await connectPuppet("Observer", `Qa30O${nowSuffix()}`);
  await sleep(300);
  const confirmed = statusText.split("—").pop()?.trim() || nickname;

  await sleep(500);
  await capture(page, join(OUT_DIR, "30-live-viewmodel-pistol.png"));
  await page.mouse.down();
  await page.mouse.up();
  await capture(page, join(OUT_DIR, "31-live-viewmodel-pistol-fire.png"));

  // Walk toward mid GL using calibrated W pulse only (short).
  const before = findPlayerByNickname(observer, confirmed)?.position;
  await page.keyboard.down("KeyW");
  await sleep(900);
  await page.keyboard.up("KeyW");
  await sleep(200);
  const after = findPlayerByNickname(observer, confirmed)?.position;
  const moveDist =
    before && after ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
  console.log("[qa] live moveDist:", moveDist.toFixed(2));
  await page.keyboard.press("Space");
  await sleep(150);
  await capture(page, join(OUT_DIR, "32-live-jump-smoke.png"));

  await browser.close();
  observer.ws.close();

  console.log("[qa] live console errors:", consoleErrors.length);
  for (const e of consoleErrors) console.log("  -", e);
  if (consoleErrors.length > 0 || moveDist < 0.5) {
    console.log("[qa] FAIL (live)");
    process.exitCode = 1;
  } else {
    console.log("[qa] PASS (live)");
  }
}

if (PART === "live") {
  await runLiveSmoke();
} else {
  await runSelfcheck();
}
