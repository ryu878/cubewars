// Tester Playwright evidence for EPIC 36 spawn protection.
//
// Part A — deterministic RemotePlayers selfcheck (real client module):
//   protected vs unprotected avatars side-by-side, then opacity restore.
// Part B — live bots match: join immediately → translucent bot avatars +
//   SPAWN PROTECTED HUD; wait past window → full opacity + HUD gone.
// Part C — live public two-client: both join same deathmatch; HUD on both;
//   movement / jump / shoot smoke.
// Part D — live endless spot-check: SPAWN PROTECTED HUD on join.
//
// Usage: node scripts/qa-epic36-tester-playwright.mjs <clientUrl> <outDir>

import { chromium } from "playwright";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const CLIENT_URL = process.argv[2] ?? "http://127.0.0.1:5196";
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-36");

const SELFCHECK_TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic36-spawn-protection-selfcheck.html");
const SELFCHECK_PORT = 5188;
const SELFCHECK_URL = `http://127.0.0.1:${SELFCHECK_PORT}/.tmp-epic36-spawn-protection-selfcheck.html`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const SELFCHECK_HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EPIC 36 Spawn Protection Opacity Selfcheck</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #9fd7ff; }
      canvas { display: block; }
      #label {
        position: absolute; left: 12px; top: 10px; z-index: 2;
        font: 600 14px/1.3 ui-sans-serif, system-ui, sans-serif;
        color: #10233a; background: rgba(255,255,255,0.72); padding: 6px 10px; border-radius: 6px;
      }
    </style>
  </head>
  <body>
    <div id="label">left = protected (opacity 0.35) · right = normal</div>
    <script type="module">
      import * as THREE from "three";
      import { RemotePlayers } from "/src/remotePlayers.ts";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fd7ff);
      const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 1.9, 5.4);
      camera.lookAt(0, 1.1, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      document.body.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x7b6d5a, 1.2));
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(3, 6, 5);
      scene.add(key);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 8),
        new THREE.MeshStandardMaterial({ color: 0xd7c37f, roughness: 0.85 }),
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      const remotePlayers = new RemotePlayers(scene);
      const serverTimeMs = 50_000;
      const players = [
        {
          id: "self",
          position: { x: 0, y: 0, z: 20 },
          yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: [], hasAmulet: false,
        },
        {
          id: "protected",
          position: { x: -1.6, y: 0, z: 0 },
          yaw: Math.PI * 0.15, health: 100, armor: 0, equippedWeapon: "rifle",
          alive: true, spawnProtectedUntilMs: serverTimeMs + 5000,
          equippedPetTypes: [], hasAmulet: false,
        },
        {
          id: "open",
          position: { x: 1.6, y: 0, z: 0 },
          yaw: -Math.PI * 0.15, health: 100, armor: 0, equippedWeapon: "pistol",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: [], hasAmulet: false,
        },
      ];

      function sampleOpacity(playerId) {
        const root = scene.getObjectByName("remote-avatar:" + playerId);
        if (!root) return null;
        let opacity = null;
        root.traverse((obj) => {
          if (opacity !== null) return;
          if (!obj.isMesh) return;
          const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
          if (mat && "opacity" in mat) opacity = mat.opacity;
        });
        return opacity;
      }

      remotePlayers.sync(players, "self", serverTimeMs);
      remotePlayers.update(0.016);
      renderer.render(scene, camera);

      window.__epic36 = {
        renderProtectedPair() {
          document.getElementById("label").textContent =
            "left = protected (opacity 0.35) · right = normal";
          players[1].spawnProtectedUntilMs = serverTimeMs + 5000;
          players[2].spawnProtectedUntilMs = 0;
          remotePlayers.sync(players, "self", serverTimeMs);
          remotePlayers.update(0.016);
          renderer.render(scene, camera);
          return {
            protectedOpacity: sampleOpacity("protected"),
            openOpacity: sampleOpacity("open"),
          };
        },
        renderAfterWindow() {
          document.getElementById("label").textContent =
            "both unprotected — opacity restored to 1.0";
          // Advance serverTime past the previous deadline; client must follow
          // broadcast comparison only (no free-running local timer).
          const later = serverTimeMs + 6000;
          players[1].spawnProtectedUntilMs = serverTimeMs + 5000; // past relative to later
          players[2].spawnProtectedUntilMs = 0;
          remotePlayers.sync(players, "self", later);
          remotePlayers.update(0.016);
          renderer.render(scene, camera);
          return {
            protectedOpacity: sampleOpacity("protected"),
            openOpacity: sampleOpacity("open"),
          };
        },
      };

      window.__epic36.renderProtectedPair();
      window.__epic36Ready = true;
    </script>
  </body>
</html>`;

async function startSelfcheckVite() {
  await writeFile(SELFCHECK_TEMP_HTML, SELFCHECK_HTML, "utf8");
  const child = spawn(
    "npx",
    ["vite", "--port", String(SELFCHECK_PORT), "--strictPort", "--host", "127.0.0.1"],
    { cwd: CLIENT_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  let ready = false;
  const onData = (buf) => {
    const s = buf.toString();
    if (s.includes("Local:") || s.includes("ready")) ready = true;
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

async function joinMode(page, nickname, modeBtnId) {
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#nicknameInput", { timeout: 10000 });
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "connected",
    { timeout: 10000 },
  );
  await page.waitForFunction(
    (id) => {
      const btn = document.getElementById(id);
      return btn && !btn.disabled;
    },
    modeBtnId,
    { timeout: 10000 },
  );
  await page.click(`#${modeBtnId}`);
  await page.waitForFunction(
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 10000 },
  );
}

async function pointerLock(page) {
  const box = await page.locator("#app canvas").boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(200);
  return page.evaluate(() => document.pointerLockElement !== null);
}

async function hudProtectionVisible(page) {
  return page.evaluate(() => {
    const el = document.getElementById("spawnProtectionHud");
    return Boolean(el && !el.hidden);
  });
}

async function hudProtectionText(page) {
  return page.evaluate(() => {
    const el = document.getElementById("spawnProtectionHud");
    const val = document.getElementById("spawnProtectionValue");
    if (!el || el.hidden) return null;
    return `${el.textContent?.trim() ?? ""}|${val?.textContent ?? ""}`;
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const summary = {
    selfcheck: {},
    bots: {},
    public: {},
    endless: {},
    consoleErrors: {},
  };

  // ---------- Part A: deterministic opacity ----------
  console.log("[epic36-qa] Part A: RemotePlayers opacity selfcheck");
  const vite = await startSelfcheckVite();
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  try {
    const pageSelf = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pageSelf.goto(SELFCHECK_URL, { waitUntil: "load", timeout: 30000 });
    await pageSelf.waitForFunction(() => window.__epic36Ready === true, { timeout: 15000 });
    const pair = await pageSelf.evaluate(() => window.__epic36.renderProtectedPair());
    await pageSelf.screenshot({ path: join(OUT_DIR, "01-selfcheck-protected-vs-open.png") });
    const after = await pageSelf.evaluate(() => window.__epic36.renderAfterWindow());
    await pageSelf.screenshot({ path: join(OUT_DIR, "02-selfcheck-opacity-restored.png") });
    summary.selfcheck = { pair, after };
    console.log("[epic36-qa] selfcheck opacities protected/open:", pair, "after:", after);
    await pageSelf.close();

    if (Math.abs(pair.protectedOpacity - 0.35) > 0.02 || Math.abs(pair.openOpacity - 1) > 0.02) {
      throw new Error(`selfcheck protected-pair opacity unexpected: ${JSON.stringify(pair)}`);
    }
    if (Math.abs(after.protectedOpacity - 1) > 0.02 || Math.abs(after.openOpacity - 1) > 0.02) {
      throw new Error(`selfcheck restore opacity unexpected: ${JSON.stringify(after)}`);
    }

    // ---------- Part B: live bots (remote transparency + HUD) ----------
    console.log("[epic36-qa] Part B: live bots match");
    const pageBots = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errBots = [];
    pageBots.on("console", (m) => {
      if (m.type() === "error") errBots.push(m.text());
    });
    pageBots.on("pageerror", (e) => errBots.push(`pageerror: ${e.message}`));

    await joinMode(pageBots, "TrusyaBots", "modeBotsBtn");
    // Capture ASAP while bots + local player are still inside the 2s window.
    await sleep(350);
    const botsHudEarly = await hudProtectionVisible(pageBots);
    const botsHudText = await hudProtectionText(pageBots);
    await pointerLock(pageBots);
    await pageBots.screenshot({ path: join(OUT_DIR, "03-bots-spawn-protected-hud-and-ghosts.png") });
    summary.bots.hudEarly = botsHudEarly;
    summary.bots.hudText = botsHudText;
    console.log("[epic36-qa] bots HUD early:", botsHudEarly, botsHudText);

    // Movement + look smoke while protected window ticks down.
    await pageBots.keyboard.down("KeyW");
    await sleep(700);
    await pageBots.keyboard.up("KeyW");
    await pageBots.keyboard.down("Space");
    await sleep(120);
    await pageBots.screenshot({ path: join(OUT_DIR, "04-bots-jump-midair.png") });
    await pageBots.keyboard.up("Space");
    await pageBots.mouse.down({ button: "left" });
    await sleep(80);
    await pageBots.mouse.up({ button: "left" });
    await sleep(200);
    await pageBots.screenshot({ path: join(OUT_DIR, "05-bots-fire-smoke.png") });

    // Wait past spawnProtectionMs (2s) + buffer — HUD must clear; bots opaque.
    await sleep(2500);
    const botsHudLate = await hudProtectionVisible(pageBots);
    await pageBots.screenshot({ path: join(OUT_DIR, "06-bots-after-protection-window.png") });
    summary.bots.hudLate = botsHudLate;
    summary.consoleErrors.bots = errBots;
    console.log("[epic36-qa] bots HUD after window (expect false):", botsHudLate);
    await pageBots.close();

    if (!botsHudEarly) throw new Error("bots: SPAWN PROTECTED HUD missing on join");
    if (botsHudLate) throw new Error("bots: SPAWN PROTECTED HUD still visible after window");

    // ---------- Part C: live public two-client ----------
    console.log("[epic36-qa] Part C: live public two-client");
    const pageA = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errPublic = [];
    for (const [label, page] of [
      ["A", pageA],
      ["B", pageB],
    ]) {
      page.on("console", (m) => {
        if (m.type() === "error") errPublic.push(`${label}: ${m.text()}`);
      });
      page.on("pageerror", (e) => errPublic.push(`${label} pageerror: ${e.message}`));
    }

    // Stagger joins so A can look at B while B is still protected.
    await joinMode(pageA, "TrusyaA", "modePublicBtn");
    await sleep(2200); // A protection expires
    await joinMode(pageB, "TrusyaB", "modePublicBtn");
    await sleep(300);
    const aHud = await hudProtectionVisible(pageA);
    const bHud = await hudProtectionVisible(pageB);
    const bHudText = await hudProtectionText(pageB);
    await pointerLock(pageA);
    await pointerLock(pageB);
    await pageB.screenshot({ path: join(OUT_DIR, "07-public-client-b-spawn-protected-hud.png") });
    await pageA.screenshot({ path: join(OUT_DIR, "08-public-client-a-observer.png") });
    summary.public = { aHudAfterOwnWindow: aHud, bHudOnJoin: bHud, bHudText };
    console.log("[epic36-qa] public HUD A(after own window)/B(on join):", aHud, bHud, bHudText);

    await pageA.keyboard.down("KeyW");
    await sleep(900);
    await pageA.keyboard.up("KeyW");
    await pageA.screenshot({ path: join(OUT_DIR, "09-public-movement.png") });
    await pageA.keyboard.down("Space");
    await sleep(120);
    await pageA.screenshot({ path: join(OUT_DIR, "10-public-jump.png") });
    await pageA.keyboard.up("Space");
    await pageA.mouse.down({ button: "left" });
    await sleep(80);
    await pageA.mouse.up({ button: "left" });
    await sleep(150);
    await pageA.screenshot({ path: join(OUT_DIR, "11-public-fire-smoke.png") });

    await sleep(2200);
    const bHudLate = await hudProtectionVisible(pageB);
    await pageB.screenshot({ path: join(OUT_DIR, "12-public-client-b-after-window.png") });
    summary.public.bHudLate = bHudLate;
    summary.consoleErrors.public = errPublic;
    await pageA.close();
    await pageB.close();

    if (aHud) throw new Error("public A: HUD still visible after own protection window");
    if (!bHud) throw new Error("public B: SPAWN PROTECTED HUD missing on join");
    if (bHudLate) throw new Error("public B: HUD still visible after window");

    // ---------- Part D: endless spot-check ----------
    console.log("[epic36-qa] Part D: endless mode spot-check");
    const pageEndless = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errEndless = [];
    pageEndless.on("console", (m) => {
      if (m.type() === "error") errEndless.push(m.text());
    });
    pageEndless.on("pageerror", (e) => errEndless.push(`pageerror: ${e.message}`));
    await joinMode(pageEndless, "TrusyaEnd", "modeEndlessBtn");
    await sleep(300);
    const endlessHud = await hudProtectionVisible(pageEndless);
    await pointerLock(pageEndless);
    await pageEndless.screenshot({ path: join(OUT_DIR, "13-endless-spawn-protected-hud.png") });
    await pageEndless.keyboard.down("KeyW");
    await sleep(600);
    await pageEndless.keyboard.up("KeyW");
    await pageEndless.screenshot({ path: join(OUT_DIR, "14-endless-movement.png") });
    summary.endless = { hudOnJoin: endlessHud };
    summary.consoleErrors.endless = errEndless;
    console.log("[epic36-qa] endless HUD on join:", endlessHud);
    await pageEndless.close();

    if (!endlessHud) throw new Error("endless: SPAWN PROTECTED HUD missing on join");

    const errorCount =
      errBots.length + errPublic.length + errEndless.length;
    summary.consoleErrorCount = errorCount;
    await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));

    console.log("\n[epic36-qa] === SUMMARY ===");
    console.log(JSON.stringify(summary, null, 2));
    if (errorCount > 0) {
      console.log("[epic36-qa] FAIL: console errors present");
      process.exit(1);
    }
    console.log("[epic36-qa] PASS");
  } finally {
    await browser.close().catch(() => {});
    vite.kill("SIGTERM");
    await rm(SELFCHECK_TEMP_HTML, { force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("[epic36-qa] script crashed:", err);
  process.exit(2);
});
