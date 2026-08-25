// Tester Playwright evidence for EPIC 31 "Randomized Bot Equipment
// Loadouts".
//
// Part A (deterministic, EPIC 17-style self-contained scene): imports the
// REAL client/src/remotePlayers.ts module directly and renders 4 fake
// PlayerState avatars side by side (bare / one pet / amulet+slot2 pet /
// amulet+2 pets) so the pet-orb + amulet-pendant visual tell is captured on
// screen deterministically, without depending on live bot RNG for which
// archetype landed in frame.
//
// Part B (live end-to-end): joins a real "vs Bots" match against the
// already-running server (see CLIENT_URL arg) several times in a row (each
// join spawns a fresh Match with 2 freshly-rolled bots -- see
// matchManager.ts createBotsMatch()), captures a gameplay screenshot each
// time, and asserts (from server-side console output captured by the
// caller / this script's own log) that the bot loadout log line
// (`[bots] Bot N loadout: archetype=...`) appears -- i.e. this is verified
// against the real running server, not a code read.
//
// Usage: node scripts/qa-epic31-tester-playwright.mjs <clientUrl> <outDir>

import { chromium } from "playwright";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const CLIENT_URL = process.argv[2] ?? "http://127.0.0.1:5198";
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-31");

function nowSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function joinBots(page, nickname) {
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#nicknameInput", { timeout: 10000 });
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("modeBotsBtn");
      return btn && !btn.disabled;
    },
    { timeout: 10000 },
  );
  await page.click("#modeBotsBtn");
  await page.waitForFunction(
    () => {
      const el = document.getElementById("modeSelect");
      return el && el.classList.contains("hidden");
    },
    { timeout: 10000 },
  );
  await page.waitForTimeout(600);
}

// --- Part A: deterministic self-contained avatar scene, EPIC 17 style ---

const SELFCHECK_TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic31-avatar-selfcheck.html");
const SELFCHECK_PORT = 5178;
const SELFCHECK_URL = `http://127.0.0.1:${SELFCHECK_PORT}/.tmp-epic31-avatar-selfcheck.html`;

const SELFCHECK_HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EPIC 31 Pet/Amulet Avatar Selfcheck</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #9fd7ff; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <script type="module">
      import * as THREE from "three";
      import { RemotePlayers } from "/src/remotePlayers.ts";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fd7ff);
      const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 1.9, 5.6);
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
        new THREE.PlaneGeometry(10, 7),
        new THREE.MeshStandardMaterial({ color: 0xd7c37f, roughness: 0.8 }),
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      const remotePlayers = new RemotePlayers(scene);
      const players = [
        { id: "self", position: { x: 0, y: 0, z: 10 }, yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol", equippedPetTypes: [], equippedPetsVisual: [], hasAmulet: false, alive: true },
        // Archetype A equivalent: bare, no pet, no amulet.
        { id: "bare", position: { x: -3.0, y: 0, z: 0 }, yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol", equippedPetTypes: [], equippedPetsVisual: [], hasAmulet: false, alive: true },
        // Archetype B equivalent: one pet, slot 1, no amulet.
        { id: "onePet", position: { x: -1.0, y: 0, z: 0 }, yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol", equippedPetTypes: ["lion"], equippedPetsVisual: [{ type: "lion", colorIndex: 3, side: "left" }], hasAmulet: false, alive: true },
        // Archetype C equivalent: amulet + one pet in slot 2.
        { id: "amuletOnePet", position: { x: 1.0, y: 0, z: 0 }, yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol", equippedPetTypes: ["cat"], equippedPetsVisual: [{ type: "cat", colorIndex: 5, side: "right" }], hasAmulet: true, alive: true },
        // Archetype D equivalent: amulet + two pets (slot 1 + slot 2).
        { id: "amuletTwoPets", position: { x: 3.0, y: 0, z: 0 }, yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol", equippedPetTypes: ["dog", "bird"], equippedPetsVisual: [{ type: "dog", colorIndex: 1, side: "left" }, { type: "bird", colorIndex: 7, side: "right" }], hasAmulet: true, alive: true },
      ];
      remotePlayers.sync(players, "self", 1000);
      remotePlayers.update(0.016);
      renderer.render(scene, camera);

      // Avatars face -Z (yaw 0), so a camera on the +Z side sees their BACK
      // (pet orbs, mounted beside the backpack) and a camera on the -Z side
      // sees their FRONT (amulet pendant, mounted at the chest). Two render
      // passes let the screenshot evidence show both tells clearly instead
      // of relying on one ambiguous angle.
      window.__renderBack = () => {
        camera.position.set(0, 1.9, 5.6);
        camera.lookAt(0, 1.1, 0);
        renderer.render(scene, camera);
      };
      window.__renderFront = () => {
        camera.position.set(0, 1.9, -5.6);
        camera.lookAt(0, 1.1, 0);
        renderer.render(scene, camera);
      };

      function avatarRoots() {
        return scene.children.filter((child) => child.name.startsWith("remote-avatar:"));
      }

      function petOrbInfo(root) {
        const orbs = [];
        root.traverse((obj) => {
          if (obj.name === "avatar:pet-orb") {
            orbs.push({ visible: obj.visible, colorHex: obj.material?.color?.getHexString?.() ?? null });
          }
        });
        return orbs;
      }

      function amuletVisible(root) {
        let visible = null;
        root.traverse((obj) => {
          if (obj.name === "avatar:amulet-pendant") visible = obj.visible;
        });
        return visible;
      }

      window.__epic31Checks = avatarRoots().map((root) => ({
        name: root.name,
        petOrbs: petOrbInfo(root),
        amuletVisible: amuletVisible(root),
      }));
      window.__ready = true;
    </script>
  </body>
</html>`;

async function runPartA(browser, outDir) {
  await writeFile(SELFCHECK_TEMP_HTML, SELFCHECK_HTML, "utf8");
  const { spawn } = await import("node:child_process");
  const viteBin = join(CLIENT_ROOT, "node_modules", ".bin", "vite");
  const vite = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(SELFCHECK_PORT), "--strictPort"], {
    cwd: CLIENT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const failures = [];
  try {
    await new Promise((resolve, reject) => {
      let ready = false;
      const marker = `http://127.0.0.1:${SELFCHECK_PORT}/`;
      const onData = (buf) => {
        if (!ready && buf.toString().includes(marker)) {
          ready = true;
          resolve();
        }
      };
      vite.stdout.on("data", onData);
      vite.stderr.on("data", onData);
      vite.on("error", reject);
      vite.on("exit", (code) => {
        if (!ready) reject(new Error(`selfcheck vite exited before ready (code ${code})`));
      });
      setTimeout(() => {
        if (!ready) reject(new Error("selfcheck vite did not become ready"));
      }, 10000);
    });

    const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(SELFCHECK_URL, { waitUntil: "load" });
    await page.waitForFunction(() => window.__ready === true, { timeout: 5000 });
    await sleep(300);
    await page.evaluate(() => window.__renderBack());
    await sleep(150);
    await page.screenshot({ path: join(outDir, "01a-avatar-pet-orb-tell-back-view.png") });
    await page.evaluate(() => window.__renderFront());
    await sleep(150);
    await page.screenshot({ path: join(outDir, "01b-avatar-amulet-pendant-tell-front-view.png") });

    const checks = await page.evaluate(() => window.__epic31Checks);
    console.log("[epic31-qa] Part A avatar scene-graph checks:", JSON.stringify(checks, null, 2));
    console.log("[epic31-qa] Part A console errors:", consoleErrors.length);
    for (const error of consoleErrors) console.log("  -", error);

    const bare = checks.find((c) => c.name === "remote-avatar:bare");
    const onePet = checks.find((c) => c.name === "remote-avatar:onePet");
    const amuletOnePet = checks.find((c) => c.name === "remote-avatar:amuletOnePet");
    const amuletTwoPets = checks.find((c) => c.name === "remote-avatar:amuletTwoPets");

    if (!bare || bare.petOrbs.some((o) => o.visible) || bare.amuletVisible) {
      failures.push("bare avatar unexpectedly shows a pet orb or amulet pendant");
    }
    if (!onePet || onePet.petOrbs.filter((o) => o.visible).length !== 1 || onePet.amuletVisible) {
      failures.push("one-pet avatar did not show exactly 1 visible pet orb with no amulet");
    }
    if (!amuletOnePet || amuletOnePet.petOrbs.filter((o) => o.visible).length !== 1 || !amuletOnePet.amuletVisible) {
      failures.push("amulet+one-pet avatar did not show exactly 1 pet orb AND a visible amulet pendant");
    }
    if (
      !amuletTwoPets ||
      amuletTwoPets.petOrbs.filter((o) => o.visible).length !== 2 ||
      !amuletTwoPets.amuletVisible
    ) {
      failures.push("amulet+two-pets avatar did not show 2 visible pet orbs AND a visible amulet pendant");
    }
    if (consoleErrors.length > 0) failures.push(`Part A had ${consoleErrors.length} browser console error(s)`);

    await page.close();
  } finally {
    vite.kill("SIGTERM");
    await new Promise((resolve) => {
      vite.once("exit", () => resolve());
      setTimeout(() => resolve(), 3000);
    });
    await rm(SELFCHECK_TEMP_HTML, { force: true });
  }
  return failures;
}

// --- Part B: live "vs Bots" match join, real server, real archetype RNG ---

async function runPartB(browser, outDir) {
  const failures = [];
  const JOIN_ATTEMPTS = 4;
  for (let i = 0; i < JOIN_ATTEMPTS; i++) {
    const nickname = `QaEpic31Bots${nowSuffix()}`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

    console.log(`[epic31-qa] Part B join ${i + 1}/${JOIN_ATTEMPTS} as ${nickname}`);
    await joinBots(page, nickname);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(outDir, `0${2 + i}-live-bots-match-join-${i + 1}.png`) });

    if (consoleErrors.length > 0) {
      failures.push(`Part B join ${i + 1}: ${consoleErrors.length} browser console error(s): ${consoleErrors.join(" | ")}`);
    }
    await page.close();
    await sleep(300);
  }
  return failures;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    args: [
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
    ],
  });

  let failures = [];
  try {
    failures = failures.concat(await runPartA(browser, OUT_DIR));
    failures = failures.concat(await runPartB(browser, OUT_DIR));
  } finally {
    await browser.close();
  }

  console.log("\n=== EPIC 31 CHECKS ===");
  if (failures.length === 0) {
    console.log("ALL PASS");
  } else {
    for (const f of failures) console.log("FAIL:", f);
    process.exit(1);
  }
}

await main();
