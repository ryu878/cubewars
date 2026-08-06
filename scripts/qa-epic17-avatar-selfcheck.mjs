// EPIC 17 avatar renderer evidence. Starts a temporary Vite page that
// imports the real client/src/remotePlayers.ts module, renders three fake
// remote players with pistol/rifle/grenade-launcher props, advances the
// simple run animation, captures screenshots, and asserts the scene graph.
//
// Run: node scripts/qa-epic17-avatar-selfcheck.mjs

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic17-avatar-selfcheck.html");
const CLIENT_PORT = 5177;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/.tmp-epic17-avatar-selfcheck.html`;
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-17-avatar-selfcheck");

const HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EPIC 17 Avatar Selfcheck</title>
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
      const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 2.2, 6);
      camera.lookAt(0, 1, 0);

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
      const standing = [
        { id: "self", position: { x: 0, y: 0, z: 10 }, yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol", alive: true },
        { id: "pistol", position: { x: -2.3, y: 0, z: 0 }, yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol", alive: true },
        { id: "rifle", position: { x: 0, y: 0, z: 0 }, yaw: Math.PI / 2, health: 100, armor: 0, equippedWeapon: "rifle", alive: true },
        { id: "gl", position: { x: 2.3, y: 0, z: 0 }, yaw: Math.PI, health: 100, armor: 0, equippedWeapon: "grenade_launcher", alive: true },
      ];
      remotePlayers.sync(standing, "self", 1000);
      remotePlayers.update(0.016);
      renderer.render(scene, camera);

      function avatarRoots() {
        return scene.children.filter((child) => child.name.startsWith("remote-avatar:"));
      }

      function namedDescendants(root, prefix) {
        const out = [];
        root.traverse((obj) => {
          if (obj.name.startsWith(prefix)) out.push(obj.name);
        });
        return out;
      }

      window.__epic17StandingChecks = {
        avatarCount: avatarRoots().length,
        avatars: avatarRoots().map((root) => ({
          name: root.name,
          rotationY: root.rotation.y,
          parts: namedDescendants(root, "avatar:"),
          visibleWeapons: namedDescendants(root, "weapon:").filter((name) => {
            let found = null;
            root.traverse((obj) => {
              if (obj.name === name) found = obj;
            });
            return found?.visible;
          }),
        })),
      };

      window.__advanceRunPose = () => {
        const running = [
          standing[0],
          { ...standing[1], position: { x: -2.3, y: 0, z: -0.2 } },
          { ...standing[2], position: { x: 0.28, y: 0, z: 0 } },
          { ...standing[3], position: { x: 2.3, y: 0, z: 0.28 } },
        ];
        remotePlayers.sync(running, "self", 1050);
        for (let i = 0; i < 16; i++) remotePlayers.update(1 / 60);
        renderer.render(scene, camera);

        const roots = avatarRoots();
        window.__epic17RunningChecks = roots.map((root) => {
          let leftLeg = null;
          let rightLeg = null;
          root.traverse((obj) => {
            if (obj.name === "avatar:left-leg") leftLeg = obj;
            if (obj.name === "avatar:right-leg") rightLeg = obj;
          });
          return {
            name: root.name,
            leftLegScaleY: leftLeg?.scale.y,
            rightLegScaleY: rightLeg?.scale.y,
            leftLegZ: leftLeg?.position.z,
            rightLegZ: rightLeg?.position.z,
          };
        });
      };

      window.__render = () => renderer.render(scene, camera);
      window.__ready = true;
    </script>
  </body>
</html>`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(child, label, marker) {
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(TEMP_HTML, HTML, "utf8");

  const viteBin = join(CLIENT_ROOT, "node_modules", ".bin", "vite");
  const vite = spawn(viteBin, ["--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"], {
    cwd: CLIENT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let browser;
  try {
    await waitForServerReady(vite, "vite", `http://127.0.0.1:${CLIENT_PORT}/`);

    browser = await chromium.launch({
      args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(CLIENT_URL, { waitUntil: "load" });
    await page.waitForFunction(() => window.__ready === true, { timeout: 5000 });
    await sleep(300);
    await page.screenshot({ path: join(OUT_DIR, "01-standing-facing-and-weapons.png") });

    await page.evaluate(() => window.__advanceRunPose());
    await sleep(150);
    await page.screenshot({ path: join(OUT_DIR, "02-running-leg-alternation.png") });

    const standing = await page.evaluate(() => window.__epic17StandingChecks);
    const running = await page.evaluate(() => window.__epic17RunningChecks);
    console.log("[epic17] standing checks:", JSON.stringify(standing, null, 2));
    console.log("[epic17] running checks:", JSON.stringify(running, null, 2));
    console.log("[epic17] console errors:", consoleErrors.length);
    for (const error of consoleErrors) console.log("  -", error);

    const requiredParts = [
      "avatar:torso",
      "avatar:head",
      "avatar:left-arm",
      "avatar:right-arm",
      "avatar:left-leg",
      "avatar:right-leg",
      "avatar:face",
      "avatar:weapon-anchor",
    ];
    const checks = [
      { label: "renders three remote avatars, excluding self", pass: standing.avatarCount === 3 },
      {
        label: "every avatar has body parts and face markers",
        pass: standing.avatars.every((avatar) => requiredParts.every((part) => avatar.parts.includes(part))),
      },
      {
        label: "pistol/rifle/grenade launcher weapon props are visible",
        pass: ["weapon:pistol", "weapon:rifle", "weapon:grenade_launcher"].every((weapon) =>
          standing.avatars.some((avatar) => avatar.visibleWeapons.includes(weapon)),
        ),
      },
      {
        label: "avatars have distinct yaw rotations",
        pass: new Set(standing.avatars.map((avatar) => Math.round(avatar.rotationY * 100))).size === 3,
      },
      {
        label: "running pose alternates leg length or leg offset",
        pass: running.every(
          (avatar) =>
            Math.abs(avatar.leftLegScaleY - avatar.rightLegScaleY) > 0.05 ||
            Math.abs(avatar.leftLegZ - avatar.rightLegZ) > 0.05,
        ),
      },
      { label: "no browser console errors", pass: consoleErrors.length === 0 },
    ];

    let failed = false;
    console.log("\n=== EPIC 17 CHECKS ===");
    for (const check of checks) {
      console.log(`[${check.pass ? "PASS" : "FAIL"}] ${check.label}`);
      if (!check.pass) failed = true;
    }
    if (failed) process.exit(1);
    console.log("[epic17] PASS");
  } finally {
    await browser?.close();
    vite.kill("SIGTERM");
    await new Promise((resolve) => {
      vite.once("exit", () => resolve());
      setTimeout(() => resolve(), 3000);
    });
    await rm(TEMP_HTML, { force: true });
  }
}

main().catch(async (err) => {
  console.error("[epic17] FAIL", err);
  await rm(TEMP_HTML, { force: true });
  process.exit(2);
});
