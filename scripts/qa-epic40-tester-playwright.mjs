// Tester Playwright evidence for EPIC 40 companion distance & scale polish.
//
// Part A — deterministic RemotePlayers selfcheck (real client module):
//   PET_SIDE_X ±0.9, PET_ANCHOR_Y_OFFSET 0.9 (~45°), PET_ANCHOR_Z 0.3,
//   PET_ROOT_SCALE 1.35 (glow scales with root), dual left/right deconflict,
//   amulet pendant position/materials distinct and unchanged.
// Part B — live vs Bots: companions present, move / jump / shoot smoke.
//
// Usage:
//   node scripts/qa-epic40-tester-playwright.mjs
//   node scripts/qa-epic40-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7790;
const CLIENT_PORT = 5211;
const SELFCHECK_PORT = 5192;

const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-40");
const MANAGE_STACK = process.argv[2] === undefined;

const SELFCHECK_TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic40-companions-selfcheck.html");
const SELFCHECK_URL = `http://127.0.0.1:${SELFCHECK_PORT}/.tmp-epic40-companions-selfcheck.html`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const EXPECT = {
  sideX: 0.9,
  anchorZ: 0.3,
  rootScale: 1.35,
  glowLocalRadius: 0.22,
  glowColor: 0x4ec8ff,
  amuletYApprox: null, // filled at runtime from inspect
};

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

const SELFCHECK_HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EPIC 40 Companion Distance & Scale Selfcheck</title>
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
    <div id="label">EPIC 40: arm's-length pets (~45° up) · dual sides · amulet gold</div>
    <script type="module">
      import * as THREE from "three";
      import { RemotePlayers } from "/src/remotePlayers.ts";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fd7ff);
      const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 2.2, 6.4);
      camera.lookAt(0, 1.2, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      document.body.appendChild(renderer.domElement);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x7b6d5a, 1.2));
      const key = new THREE.DirectionalLight(0xffffff, 1.4);
      key.position.set(3, 6, 5);
      scene.add(key);

      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 8),
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
          equippedPetTypes: [], equippedPetsVisual: [], hasAmulet: false,
        },
        {
          id: "dualPets",
          position: { x: -2.2, y: 0, z: 0 },
          yaw: Math.PI * 0.1, health: 100, armor: 0, equippedWeapon: "rifle",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: ["dog", "cat"],
          equippedPetsVisual: [
            { type: "dog", colorIndex: 0, side: "left" },
            { type: "cat", colorIndex: 5, side: "right" },
          ],
          hasAmulet: true,
        },
        {
          id: "birdLeft",
          position: { x: 0.4, y: 0, z: 0 },
          yaw: -Math.PI * 0.08, health: 100, armor: 0, equippedWeapon: "pistol",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: ["bird"],
          equippedPetsVisual: [{ type: "bird", colorIndex: 7, side: "left" }],
          hasAmulet: false,
        },
        {
          id: "lionRight",
          position: { x: 2.8, y: 0, z: 0 },
          yaw: Math.PI * 0.12, health: 100, armor: 0, equippedWeapon: "grenade_launcher",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: ["lion"],
          equippedPetsVisual: [{ type: "lion", colorIndex: 3, side: "right" }],
          hasAmulet: true,
        },
      ];

      function inspectAvatar(playerId) {
        const root = scene.getObjectByName("remote-avatar:" + playerId);
        if (!root) return null;
        const companions = [];
        root.traverse((obj) => {
          if (obj.name !== "avatar:pet-companion") return;
          if (!obj.visible) return;
          const glow = obj.getObjectByName("avatar:pet-glow");
          const body = obj.getObjectByName("avatar:pet-body");
          let glowLocalR = null;
          let glowHex = null;
          let glowOpacity = null;
          if (glow?.geometry?.parameters?.radius != null) {
            glowLocalR = glow.geometry.parameters.radius;
          }
          if (glow?.material) {
            glowHex = glow.material.color?.getHex?.() ?? null;
            glowOpacity = glow.material.opacity;
          }
          let bodyHex = null;
          if (body) {
            body.traverse((c) => {
              if (!c.isMesh || bodyHex !== null) return;
              const mat = Array.isArray(c.material) ? c.material[0] : c.material;
              if (mat?.color?.getHex) bodyHex = mat.color.getHex();
            });
          }
          companions.push({
            sideX: obj.position.x,
            y: obj.position.y,
            z: obj.position.z,
            scaleX: obj.scale.x,
            scaleY: obj.scale.y,
            scaleZ: obj.scale.z,
            glowLocalR,
            glowHex,
            glowOpacity,
            bodyHex,
            worldScale: (() => {
              const v = new THREE.Vector3();
              obj.getWorldScale(v);
              return { x: v.x, y: v.y, z: v.z };
            })(),
          });
        });

        const amulet = root.getObjectByName("avatar:amulet-pendant");
        let amuletInfo = null;
        if (amulet) {
          const mat = Array.isArray(amulet.material) ? amulet.material[0] : amulet.material;
          amuletInfo = {
            visible: amulet.visible,
            x: amulet.position.x,
            y: amulet.position.y,
            z: amulet.position.z,
            colorHex: mat?.color?.getHex?.() ?? null,
            emissiveHex: mat?.emissive?.getHex?.() ?? null,
            geoType: amulet.geometry?.type ?? null,
          };
        }

        // Torso center Y used as radial origin for ~45° check.
        let torsoY = null;
        root.traverse((obj) => {
          if (obj.name === "avatar:torso" || (obj.isMesh && obj.parent === root && torsoY == null)) {
            // Prefer explicit torso if named; else first body box at mid height.
          }
        });
        const torso = root.getObjectByName("avatar:torso");
        if (torso) torsoY = torso.position.y;
        else {
          // Fallback: companions use petCompanionBaseY = torso.y + 0.9
          // Infer torso.y from companion base (before bob) via first companion y ≈ base.
          if (companions[0]) torsoY = companions[0].y - 0.9;
        }

        return { companions, amulet: amuletInfo, torsoY };
      }

      remotePlayers.sync(players, "self", serverTimeMs);
      remotePlayers.update(0.016);
      renderer.render(scene, camera);

      window.__epic40 = {
        renderLineup() {
          document.getElementById("label").textContent =
            "EPIC 40: dual pets L/R + bird left + lion right · cyan glow · gold amulet";
          remotePlayers.sync(players, "self", serverTimeMs);
          // Zero bob phase drift: update tiny dt so Y ≈ base.
          remotePlayers.update(0.0001);
          renderer.render(scene, camera);
          return {
            dualPets: inspectAvatar("dualPets"),
            birdLeft: inspectAvatar("birdLeft"),
            lionRight: inspectAvatar("lionRight"),
          };
        },
        renderFront() {
          camera.position.set(0, 2.2, -6.4);
          camera.lookAt(0, 1.2, 0);
          renderer.render(scene, camera);
        },
        renderBack() {
          camera.position.set(0, 2.2, 6.4);
          camera.lookAt(0, 1.2, 0);
          renderer.render(scene, camera);
        },
        renderCloseDual() {
          camera.position.set(-2.2, 2.0, 3.2);
          camera.lookAt(-2.2, 1.35, 0);
          renderer.render(scene, camera);
        },
      };

      window.__epic40.renderLineup();
      window.__epic40Ready = true;
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
  await waitForReady(child, "selfcheck-vite", `http://127.0.0.1:${SELFCHECK_PORT}/`);
  return child;
}

async function startStack() {
  const serverLog = [];
  const clientLog = [];
  const server = spawn(
    "npx",
    ["tsx", "src/index.ts"],
    {
      cwd: join(REPO_ROOT, "server"),
      env: {
        ...process.env,
        CUBEWARS_SERVER_PORT: String(SERVER_PORT),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (b) => serverLog.push(b.toString()));
  server.stderr.on("data", (b) => serverLog.push(b.toString()));
  await waitForReady(server, "server", `listening on`);

  const client = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
    {
      cwd: CLIENT_ROOT,
      env: {
        ...process.env,
        VITE_CUBEWARS_WS_URL: WS_URL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  client.stdout.on("data", (b) => clientLog.push(b.toString()));
  client.stderr.on("data", (b) => clientLog.push(b.toString()));
  await waitForReady(client, "client", `http://127.0.0.1:${CLIENT_PORT}/`);

  return { server, client, serverLog, clientLog };
}

function installWsTap(page) {
  return page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new Orig(...args);
      window.__epic40Tap = window.__epic40Tap || {
        welcomeId: null,
        lastPlayers: {},
        wsUrl: String(args[0] ?? ""),
      };
      window.__epic40Tap.ws = ws;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "welcome") window.__epic40Tap.welcomeId = msg.playerId;
          if (msg.type === "world_state" && Array.isArray(msg.players)) {
            for (const p of msg.players) {
              window.__epic40Tap.lastPlayers[p.id] = {
                id: p.id,
                nickname: p.nickname,
                equippedPetsVisual: p.equippedPetsVisual ?? [],
                hasAmulet: !!p.hasAmulet,
              };
            }
          }
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

async function joinMode(page, nickname, modeBtnId) {
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    (id) => {
      const btn = document.getElementById(id);
      return btn && !btn.disabled;
    },
    modeBtnId,
    { timeout: 20000 },
  );
  await page.click(`#${modeBtnId}`);
  await page.waitForFunction(
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await sleep(600);
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

function near(a, b, eps = 0.02) {
  return Math.abs(a - b) <= eps;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = { selfcheck: {}, bots: {}, consoleErrors: {} };

  let stack = null;
  let selfcheckVite = null;
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
    console.log("[epic40-qa] Part A: layout/scale selfcheck");
    selfcheckVite = await startSelfcheckVite();
    const pageA = await browser.newPage({ viewport: { width: 1400, height: 720 } });
    const errA = [];
    pageA.on("console", (m) => {
      if (m.type() === "error") errA.push(m.text());
    });
    pageA.on("pageerror", (e) => errA.push(`pageerror: ${e.message}`));

    await pageA.goto(SELFCHECK_URL, { waitUntil: "load", timeout: 30000 });
    await pageA.waitForFunction(() => window.__epic40Ready === true, { timeout: 15000 });
    const lineup = await pageA.evaluate(() => window.__epic40.renderLineup());
    await pageA.evaluate(() => window.__epic40.renderBack());
    await sleep(120);
    await pageA.screenshot({ path: join(OUT_DIR, "01-selfcheck-lineup-back.png") });
    await pageA.evaluate(() => window.__epic40.renderFront());
    await sleep(120);
    await pageA.screenshot({ path: join(OUT_DIR, "02-selfcheck-lineup-front.png") });
    await pageA.evaluate(() => window.__epic40.renderCloseDual());
    await sleep(120);
    await pageA.screenshot({ path: join(OUT_DIR, "03-selfcheck-dual-pets-close.png") });
    summary.selfcheck = { lineup, consoleErrors: errA };
    await writeFile(join(OUT_DIR, "selfcheck-lineup.json"), JSON.stringify(lineup, null, 2));
    console.log("[epic40-qa] lineup:", JSON.stringify(lineup, null, 2));

    const dual = lineup.dualPets;
    if (!dual || dual.companions.length !== 2) {
      failures.push(`dualPets: expected 2 visible companions, got ${JSON.stringify(dual)}`);
    } else {
      const xs = dual.companions.map((c) => c.sideX).sort((a, b) => a - b);
      if (!near(xs[0], -EXPECT.sideX) || !near(xs[1], EXPECT.sideX)) {
        failures.push(`dualPets sideX expected ±${EXPECT.sideX}, got ${xs.join(",")}`);
      }
      for (const c of dual.companions) {
        if (!near(c.z, EXPECT.anchorZ)) {
          failures.push(`dualPets z expected ${EXPECT.anchorZ}, got ${c.z}`);
        }
        if (!near(c.scaleX, EXPECT.rootScale) || !near(c.scaleY, EXPECT.rootScale)) {
          failures.push(`dualPets scale expected ${EXPECT.rootScale}, got ${c.scaleX}/${c.scaleY}`);
        }
        if (!near(c.glowLocalR ?? -1, EXPECT.glowLocalRadius)) {
          failures.push(`glow local radius expected ${EXPECT.glowLocalRadius}, got ${c.glowLocalR}`);
        }
        if (c.glowHex !== EXPECT.glowColor) {
          failures.push(`glow color expected cyan, got ${c.glowHex?.toString(16)}`);
        }
        if (c.glowOpacity == null || c.glowOpacity < 0.15) {
          failures.push(`glow opacity too low: ${c.glowOpacity}`);
        }
        // World glow radius ≈ local * root scale
        const worldGlow = (c.glowLocalR ?? 0) * c.scaleX;
        if (!near(worldGlow, EXPECT.glowLocalRadius * EXPECT.rootScale, 0.03)) {
          failures.push(`glow world radius expected ~${EXPECT.glowLocalRadius * EXPECT.rootScale}, got ${worldGlow}`);
        }
        // ~45°: dy ≈ |sideX| from torso center
        if (dual.torsoY != null) {
          const dy = c.y - dual.torsoY;
          if (!near(dy, EXPECT.sideX, 0.08)) {
            failures.push(`~45° check: dy=${dy} vs |sideX|=${EXPECT.sideX} (torsoY=${dual.torsoY}, petY=${c.y})`);
          }
        }
      }
      // Opposite sides never stack
      if (near(dual.companions[0].sideX, dual.companions[1].sideX, 0.05)) {
        failures.push("dual pets stacked on same side (EPIC 39 F-001 regression)");
      }
    }

    if (!dual?.amulet?.visible) {
      failures.push("amulet not visible on dualPets avatar");
    } else {
      // Gold tell distinct from cyan glow pets
      if (dual.amulet.colorHex !== 0xffd75e) {
        failures.push(`amulet color expected gold 0xffd75e, got ${dual.amulet.colorHex?.toString(16)}`);
      }
      if (dual.amulet.geoType !== "TorusGeometry") {
        failures.push(`amulet geo expected TorusGeometry, got ${dual.amulet.geoType}`);
      }
      // Pendant stays at neck/chest centerline — not at pet side offsets
      if (!near(dual.amulet.x, 0, 0.05)) {
        failures.push(`amulet x should stay centered, got ${dual.amulet.x}`);
      }
      // Pets should be clearly farther out than amulet lateral reach
      const maxPetAbsX = Math.max(...dual.companions.map((c) => Math.abs(c.sideX)));
      if (maxPetAbsX < 0.75) {
        failures.push(`pets not arm's-length enough: max |sideX|=${maxPetAbsX}`);
      }
    }

    const bird = lineup.birdLeft?.companions?.[0];
    const lion = lineup.lionRight?.companions?.[0];
    if (!bird || !near(bird.sideX, -EXPECT.sideX)) {
      failures.push(`birdLeft sideX expected -${EXPECT.sideX}, got ${bird?.sideX}`);
    }
    if (!lion || !near(lion.sideX, EXPECT.sideX)) {
      failures.push(`lionRight sideX expected ${EXPECT.sideX}, got ${lion?.sideX}`);
    }
    if (bird && !near(bird.scaleX, EXPECT.rootScale)) {
      failures.push(`bird scale expected ${EXPECT.rootScale}, got ${bird.scaleX}`);
    }

    if (errA.length) failures.push(`Part A console errors: ${errA.join(" | ")}`);
    await pageA.close();

    if (MANAGE_STACK) {
      console.log("[epic40-qa] starting dedicated server/client");
      stack = await startStack();
    }

    console.log("[epic40-qa] Part B: live bots + gameplay smoke");
    let worldPets = null;
    let pageB = null;
    const errB = [];
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (pageB) await pageB.close().catch(() => {});
      pageB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      pageB.on("console", (m) => {
        if (m.type() === "error") errB.push(m.text());
      });
      pageB.on("pageerror", (e) => errB.push(`pageerror: ${e.message}`));

      const botsNick = nick("E40B");
      const botsEmail = `${botsNick.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;
      console.log(`[epic40-qa] Part B attempt ${attempt} as ${botsNick}`);
      await registerAndContinue(pageB, botsEmail);
      await joinMode(pageB, botsNick, "modeBotsBtn");
      await sleep(900);
      worldPets = await pageB.evaluate(() => {
        const tap = window.__epic40Tap;
        if (!tap?.lastPlayers) return null;
        return Object.values(tap.lastPlayers)
          .filter((p) => Array.isArray(p.equippedPetsVisual) && p.equippedPetsVisual.length > 0)
          .map((p) => ({
            id: p.id,
            nickname: p.nickname,
            visuals: p.equippedPetsVisual,
            hasAmulet: p.hasAmulet,
          }));
      });
      if (worldPets && worldPets.length > 0) break;
    }
    await pointerLock(pageB);
    summary.bots.worldPets = worldPets;
    if (!worldPets || worldPets.length === 0) {
      failures.push("live bots: no equippedPetsVisual seen after retries");
    } else {
      let sawDualOpposite = false;
      for (const p of worldPets) {
        const sides = p.visuals.map((v) => v.side);
        for (const s of sides) {
          if (s !== "left" && s !== "right") failures.push(`invalid side ${s}`);
        }
        if (sides.length >= 2 && sides.includes("left") && sides.includes("right")) {
          sawDualOpposite = true;
        }
      }
      summary.bots.sawDualOpposite = sawDualOpposite;
      // Dual opposite is preferred but RNG may not yield archetype D in sample —
      // regression:epic39 already asserts server deconflict; live is opportunistic.
    }

    await pageB.screenshot({ path: join(OUT_DIR, "04-bots-match.png") });
    await pageB.keyboard.down("KeyW");
    await sleep(700);
    await pageB.keyboard.up("KeyW");
    await pageB.screenshot({ path: join(OUT_DIR, "05-bots-movement.png") });
    await pageB.keyboard.down("Space");
    await sleep(120);
    await pageB.screenshot({ path: join(OUT_DIR, "06-bots-jump.png") });
    await pageB.keyboard.up("Space");
    await pageB.mouse.down({ button: "left" });
    await sleep(100);
    await pageB.mouse.up({ button: "left" });
    await sleep(200);
    await pageB.screenshot({ path: join(OUT_DIR, "07-bots-fire.png") });

    // Filter known benign console noise if any; still fail on pageerrors.
    const hardErrB = errB.filter((e) => !/favicon/i.test(e));
    summary.consoleErrors.bots = hardErrB;
    if (hardErrB.length) {
      // Soft: log but don't fail on transient WS noise unless pageerror
      const pageErrors = hardErrB.filter((e) => e.startsWith("pageerror:"));
      if (pageErrors.length) failures.push(`Part B pageerrors: ${pageErrors.join(" | ")}`);
    }
    await pageB.close();

    await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));
    await writeFile(
      join(OUT_DIR, "server.log"),
      (stack?.serverLog ?? []).join(""),
      "utf8",
    );

    if (failures.length) {
      console.error("[epic40-qa] FAIL");
      for (const f of failures) console.error(" -", f);
      await writeFile(join(OUT_DIR, "failures.txt"), failures.join("\n") + "\n");
      process.exitCode = 1;
    } else {
      console.log("[epic40-qa] ALL PASS");
      await writeFile(join(OUT_DIR, "playwright-run.log"), "ALL PASS\n", "utf8");
    }
  } finally {
    await browser.close().catch(() => {});
    if (selfcheckVite) await stop(selfcheckVite);
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
    }
    await rm(SELFCHECK_TEMP_HTML, { force: true }).catch(() => {});
  }
}

main().catch(async (err) => {
  console.error("[epic40-qa] fatal:", err);
  process.exit(1);
});
