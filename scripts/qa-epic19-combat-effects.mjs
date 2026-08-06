// EPIC 19 visual QA: imports the real CombatEffects module, renders
// pistol/rifle/grenade visuals and hit particles in a temporary Vite page,
// captures a screenshot, and samples canvas pixels for visible colors.

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic19-combat-effects.html");
const CLIENT_PORT = 5179;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/.tmp-epic19-combat-effects.html`;
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-19-combat-effects");

const HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EPIC 19 Combat Effects Selfcheck</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #030305; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <script type="module">
      import * as THREE from "three";
      import { CombatEffects } from "/src/combatEffects.ts";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x030305);
      const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 2.2, 8);
      camera.lookAt(0, 1.2, -5);

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(window.innerWidth, window.innerHeight);
      document.body.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x303040, 1.1));
      const light = new THREE.DirectionalLight(0xffffff, 1.5);
      light.position.set(4, 8, 5);
      scene.add(light);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 14),
        new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.z = -3;
      scene.add(ground);

      const effects = new CombatEffects(scene);
      effects.spawnShot("pistol", {
        origin: { x: -3, y: 1.45, z: 2 },
        end: { x: -3, y: 1.45, z: -8 },
        speed: 240,
      });
      effects.spawnShot("rifle", {
        origin: { x: 0, y: 1.45, z: 2 },
        end: { x: 0, y: 1.45, z: -8 },
        speed: 145,
      });
      effects.spawnShot("grenade_launcher", {
        origin: { x: 3, y: 1.35, z: 2 },
        end: { x: 3, y: 1.35, z: -8 },
        speed: 26,
      }, "qa-grenade");
      effects.spawnHit({ x: 0, y: 1.75, z: -3 }, "head");
      effects.spawnExplosion({ x: 3, y: 1.35, z: -4 });

      effects.update(1 / 60);
      renderer.render(scene, camera);

      function countNamed(prefix) {
        let count = 0;
        scene.traverse((obj) => {
          if (obj.name.startsWith(prefix)) count += 1;
        });
        return count;
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
        const counts = { red: 0, white: 0, cyan: 0, purple: 0, lit: 0 };
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 180) continue;
          if (r + g + b > 80) counts.lit += 1;
          if (r > 130 && g < 90 && b < 90) counts.red += 1;
          if (r > 180 && g > 180 && b > 180) counts.white += 1;
          if (r < 120 && g > 150 && b > 170) counts.cyan += 1;
          if (r > 110 && b > 150 && g < 120) counts.purple += 1;
        }
        return counts;
      }

      window.__epic19Checks = {
        projectileCount: countNamed("projectile:") + countNamed("shot:"),
        redParticleCount: scene.children.filter((child) => child.type === "Mesh").length,
        samplePixels,
      };
      window.__ready = true;
    </script>
  </body>
</html>`;

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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(TEMP_HTML, HTML, "utf8");

  const vite = spawn(
    join(CLIENT_ROOT, "node_modules", ".bin", "vite"),
    ["--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
    { cwd: CLIENT_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );

  let browser;
  try {
    await waitForReady(vite, "vite", `http://127.0.0.1:${CLIENT_PORT}/`);
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
    await page.screenshot({ path: join(OUT_DIR, "01-combat-effects.png") });

    const checks = await page.evaluate(async () => ({
      projectileCount: window.__epic19Checks.projectileCount,
      pixels: await window.__epic19Checks.samplePixels(),
    }));
    console.log("[epic19-effects] checks:", JSON.stringify(checks, null, 2));
    console.log("[epic19-effects] console errors:", consoleErrors.length);
    for (const error of consoleErrors) console.log("  -", error);

    if (checks.projectileCount < 3) throw new Error(`expected at least 3 projectile/shot visuals, got ${checks.projectileCount}`);
    if (checks.pixels.red < 20) throw new Error(`expected visible red hit particles, got ${checks.pixels.red} red pixels`);
    if (checks.pixels.white < 10) throw new Error(`expected visible white rifle pixels, got ${checks.pixels.white}`);
    if (checks.pixels.cyan < 10) throw new Error(`expected visible cyan pistol laser pixels, got ${checks.pixels.cyan}`);
    if (checks.pixels.purple < 10) throw new Error(`expected visible purple grenade pixels, got ${checks.pixels.purple}`);
    if (consoleErrors.length > 0) throw new Error("browser console errors detected");
    console.log("[epic19-effects] PASS");
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
  console.error("[epic19-effects] FAIL", err);
  await rm(TEMP_HTML, { force: true });
  process.exit(1);
});
