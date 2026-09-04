// EPIC 60 Tester Playwright QA — weapon hold, pickups, avatar polish.
//
// Part A (deterministic): imports real viewmodel / pickups / remotePlayers
// modules and captures FP hands, armor vest, remote one/two-hand holds,
// avatar colors + pet/amulet attachment.
//
// Part B (live): vs-bots match — move, jump, shoot, FP screenshot, look at remotes.
//
// Usage:
//   node scripts/qa-epic60-tester-playwright.mjs
//   node scripts/qa-epic60-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const NODE =
  process.env.CUBEWARS_NODE ??
  "/usr/share/cursor/resources/app/resources/helpers/node";
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const VITE = join(CLIENT_ROOT, "node_modules", ".bin", "vite");

const SERVER_PORT = 7860;
const CLIENT_PORT = 5260;
const SELFCHECK_PORT = 5261;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-60");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic60-visual-selfcheck.html");
const SELFCHECK_URL = `http://127.0.0.1:${SELFCHECK_PORT}/.tmp-epic60-visual-selfcheck.html`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nick(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 16);
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
    try {
      child.kill("SIGTERM");
    } catch {
      resolve();
    }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 3000);
  });
}

async function capture(page, path) {
  try {
    const client = await page.context().newCDPSession(page);
    const { data } = await client.send("Page.captureScreenshot", { format: "png" });
    await writeFile(path, Buffer.from(data, "base64"));
    await client.detach().catch(() => {});
    return;
  } catch (err) {
    console.warn(`[qa] CDP screenshot failed (${err.message}); falling back`);
  }
  await page.screenshot({ path, timeout: 15000, animations: "disabled" });
}

const SELFCHECK_HTML = String.raw`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>EPIC 60 Weapon Hold Visual Selfcheck</title>
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
    <div id="label">EPIC 60 selfcheck</div>
    <script type="module">
      import * as THREE from "three";
      import { WeaponViewmodel } from "/src/viewmodel.ts";
      import { PickupRenderer } from "/src/pickups.ts";
      import { RemotePlayers } from "/src/remotePlayers.ts";
      import { WEAPON_ORDER } from "@cubewars/shared";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fd7ff);
      const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.05, 100);
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
        new THREE.PlaneGeometry(18, 10),
        new THREE.MeshStandardMaterial({ color: 0xd7c37f, roughness: 0.85 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, 0, -3);
      scene.add(ground);

      const viewmodel = new WeaponViewmodel(camera);
      const viewmodelRoot = camera.children[camera.children.length - 1];

      const pickups = new PickupRenderer(scene);
      // IDs from shared PICKUP_SPAWN_POINTS (Base densePickups — EPIC 48).
      const lineupIds = [
        "base_weapon_0", // rifle
        "base_weapon_1", // grenade_launcher
        "base_ammo_0",
        "base_ammo_1",
        "base_armor_0",
        "base_health_0",
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
        mesh.position.set((i - (lineupIds.length - 1) / 2) * 1.45, mesh.position.y, 0);
        mesh.rotation.y = -0.35;
        lineupRoot.add(mesh);
      });
      for (const [id, mesh] of byName) {
        if (!lineupIds.includes(id)) mesh.visible = false;
      }

      const remotePlayers = new RemotePlayers(scene);
      const remoteRoot = new THREE.Group();
      remoteRoot.position.set(0, 0, -5.5);
      scene.add(remoteRoot);

      function basePlayer(overrides) {
        return {
          id: "x",
          nickname: "x",
          position: { x: 0, y: 0, z: 0 },
          yaw: 0,
          health: 100,
          maxHealth: 100,
          armor: 0,
          maxArmor: 100,
          equippedWeapon: "pistol",
          equippedPetTypes: [],
          equippedPetsVisual: [],
          hasAmulet: false,
          avatarColors: { head: 0, torso: 1, hands: 2, legs: 3 },
          alive: true,
          spawnProtectedUntilMs: 0,
          ...overrides,
        };
      }

      const remotes = [
        basePlayer({
          id: "pistol",
          position: { x: -2.4, y: 0, z: 0 },
          yaw: Math.PI * 0.15,
          equippedWeapon: "pistol",
          avatarColors: { head: 2, torso: 5, hands: 8, legs: 11 },
          equippedPetTypes: ["dog"],
          equippedPetsVisual: [{ type: "dog", colorIndex: 2, side: "left" }],
          hasAmulet: false,
        }),
        basePlayer({
          id: "rifle",
          position: { x: 0, y: 0, z: 0 },
          yaw: Math.PI * 0.5,
          equippedWeapon: "rifle",
          avatarColors: { head: 4, torso: 7, hands: 1, legs: 9 },
          equippedPetTypes: ["cat"],
          equippedPetsVisual: [{ type: "cat", colorIndex: 4, side: "right" }],
          hasAmulet: true,
        }),
        basePlayer({
          id: "gl",
          position: { x: 2.4, y: 0, z: 0 },
          yaw: Math.PI * 0.85,
          equippedWeapon: "grenade_launcher",
          avatarColors: { head: 6, torso: 3, hands: 10, legs: 0 },
          equippedPetTypes: ["bird", "lion"],
          equippedPetsVisual: [
            { type: "bird", colorIndex: 1, side: "left" },
            { type: "lion", colorIndex: 6, side: "right" },
          ],
          hasAmulet: true,
        }),
      ];
      const selfStub = basePlayer({ id: "self", position: { x: 0, y: 0, z: 20 } });
      remotePlayers.sync([selfStub, ...remotes], "self", 1000);
      remotePlayers.update(0.016);

      // Reparent remote avatars under remoteRoot for framing.
      for (const child of [...scene.children]) {
        if (typeof child.name === "string" && child.name.startsWith("remote-avatar:")) {
          scene.remove(child);
          remoteRoot.add(child);
        }
      }

      let mode = "viewmodel";
      let elapsed = 0;

      function frame(dt) {
        elapsed += dt;
        viewmodel.update(dt);
        remotePlayers.update(dt);
        viewmodelRoot.visible = mode === "viewmodel";
        lineupRoot.visible = mode === "lineup" || mode === "armor";
        remoteRoot.visible = mode === "remotes" || mode === "remotes-run";

        if (mode === "viewmodel") {
          camera.position.set(0, 1.6, 0);
          camera.rotation.set(0, 0, 0);
        } else if (mode === "lineup") {
          camera.position.set(0, 1.55, 1.15);
          camera.lookAt(0, 0.55, -4.2);
        } else if (mode === "armor") {
          // base_armor_0 is lineup index 4 of 6 → x = (4 - 2.5) * 1.45 = +2.175
          camera.position.set(2.18, 1.15, -2.5);
          camera.lookAt(2.18, 0.55, -4.2);
        } else if (mode === "remotes" || mode === "remotes-run") {
          camera.position.set(0, 1.85, -2.2);
          camera.lookAt(0, 1.05, -5.5);
        }
        renderer.render(scene, camera);
      }

      function tick() {
        frame(1 / 60);
        requestAnimationFrame(tick);
      }
      tick();

      function findByName(root, name) {
        let found = null;
        root.traverse((obj) => {
          if (obj.name === name) found = obj;
        });
        return found;
      }

      function handCounts(weapon) {
        viewmodel.setWeapon(weapon);
        const group = viewmodelRoot.children.find((c) => c.visible) ?? viewmodelRoot.children[0];
        let right = 0;
        let left = 0;
        if (group) {
          group.traverse((obj) => {
            if (obj.name === "viewmodel:right-hand") right += 1;
            if (obj.name === "viewmodel:left-hand") left += 1;
          });
        }
        return { right, left };
      }

      function remoteChecks() {
        return remotes.map((p) => {
          const root = findByName(remoteRoot, "remote-avatar:" + p.id) ||
            remoteRoot.children.find((c) => c.name === "remote-avatar:" + p.id);
          if (!root) return { id: p.id, missing: true };
          const rightArm = findByName(root, "avatar:right-arm");
          const weaponAnchor = findByName(root, "avatar:weapon-anchor");
          const weaponName = "weapon:" + p.equippedWeapon;
          const weapon = findByName(root, weaponName);
          const amulet = findByName(root, "avatar:amulet-pendant");
          const pets = [];
          root.traverse((obj) => {
            if (obj.name === "avatar:pet-companion" && obj.visible) pets.push(true);
          });
          const parentIsRightArm =
            weaponAnchor && rightArm ? weaponAnchor.parent === rightArm : false;
          return {
            id: p.id,
            weapon: p.equippedWeapon,
            weaponVisible: Boolean(weapon?.visible),
            weaponParentedToRightArm: parentIsRightArm,
            rightArmPitch: rightArm?.rotation.x ?? null,
            leftArmPitch: findByName(root, "avatar:left-arm")?.rotation.x ?? null,
            amuletVisible: Boolean(amulet?.visible),
            visiblePets: pets.length,
            hasChestPlate: Boolean(findByName(root, "avatar:chest-plate")),
            hasShoulders: Boolean(findByName(root, "avatar:left-shoulder")) &&
              Boolean(findByName(root, "avatar:right-shoulder")),
          };
        });
      }

      window.__epic60 = {
        WEAPON_ORDER,
        setMode(next) { mode = next; },
        setWeapon(weapon) { viewmodel.setWeapon(weapon); },
        setEmpty(isEmpty) { viewmodel.setEmpty(isEmpty); },
        triggerFire(weapon) { viewmodel.triggerFire(weapon); },
        advance(seconds) {
          const steps = Math.max(1, Math.round(seconds * 60));
          for (let i = 0; i < steps; i++) frame(1 / 60);
        },
        handCounts,
        remoteChecks,
        advanceRunPose() {
          const running = remotes.map((p, i) => ({
            ...p,
            position: {
              x: p.position.x + (i === 1 ? 0.25 : 0),
              y: 0,
              z: p.position.z + (i === 0 ? -0.2 : i === 2 ? 0.25 : 0),
            },
          }));
          remotePlayers.sync([selfStub, ...running], "self", 1600);
          for (let i = 0; i < 20; i++) remotePlayers.update(1 / 60);
          // keep under remoteRoot
          for (const child of [...scene.children]) {
            if (typeof child.name === "string" && child.name.startsWith("remote-avatar:")) {
              scene.remove(child);
              remoteRoot.add(child);
            }
          }
        },
        ready: true,
      };

      document.getElementById("label").textContent = "EPIC 60 selfcheck ready";
    </script>
  </body>
</html>`;

async function startSelfcheckVite() {
  await writeFile(TEMP_HTML, SELFCHECK_HTML);
  const child = spawn(NODE, [VITE, "--host", "127.0.0.1", "--port", String(SELFCHECK_PORT), "--strictPort"], {
    cwd: CLIENT_ROOT,
    env: { ...process.env, FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(child, "selfcheck-vite", `http://127.0.0.1:${SELFCHECK_PORT}/`);
  return child;
}

async function startStack(serverLog) {
  const server = spawn(NODE, [TSX, "src/index.ts"], {
    cwd: join(REPO_ROOT, "server"),
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const onData = (buf) => {
    const text = buf.toString();
    serverLog.push(text);
    process.stdout.write(`[server] ${text}`);
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  await waitForReady(server, "server", "listening on");

  const client = spawn(
    NODE,
    [VITE, "--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
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
      window.__epic60Tap = window.__epic60Tap || {
        welcomeId: null,
        hits: [],
        mapStates: [],
        joinAccepted: [],
        worldStates: [],
        lastSelf: null,
        lastOthers: [],
      };
      window.__epic60Tap.ws = ws;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "welcome") window.__epic60Tap.welcomeId = msg.playerId;
          if (msg.type === "hit") window.__epic60Tap.hits.push(msg);
          if (msg.type === "map_state") window.__epic60Tap.mapStates.push(msg);
          if (msg.type === "join_accepted") window.__epic60Tap.joinAccepted.push(msg);
          if (msg.type === "world_state" && Array.isArray(msg.players)) {
            window.__epic60Tap.worldStates.push(msg);
            const selfId = window.__epic60Tap.welcomeId;
            const self = msg.players.find((p) => p.id === selfId);
            if (self) window.__epic60Tap.lastSelf = self;
            window.__epic60Tap.lastOthers = msg.players.filter((p) => p.id !== selfId && p.alive);
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

async function openLobby(page) {
  await installWsTap(page);
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#mapSelect", { timeout: 15000 });
  await page.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "connected",
    { timeout: 20000 },
  );
  const email = `epic60_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  await registerAndContinue(page, email);
}

async function joinBots(page, nickname) {
  await page.selectOption("#mapSelect", "base");
  await page.evaluate(() => localStorage.setItem("cubewars.mapId", "base"));
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
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => (window.__epic60Tap?.mapStates ?? []).length > 0,
    { timeout: 15000 },
  );
  await sleep(700);
}

async function pointerLock(page) {
  const box = await page.locator("#app canvas").boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(250);
  return page.evaluate(() => document.pointerLockElement !== null);
}

async function runSelfcheck(summary) {
  console.log("[qa] PART A — deterministic viewmodel / pickups / remotes");
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
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(SELFCHECK_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => window.__epic60?.ready === true, { timeout: 20000 });

    // FP pistol — one hand
    await page.evaluate(() => {
      window.__epic60.setMode("viewmodel");
      window.__epic60.setWeapon("pistol");
      window.__epic60.setEmpty(false);
      window.__epic60.advance(0.6);
    });
    const pistolHands = await page.evaluate(() => window.__epic60.handCounts("pistol"));
    await capture(page, join(OUT_DIR, "01-fp-pistol-one-hand.png"));
    console.log("[qa] pistol hands", pistolHands);
    if (pistolHands.right < 1) failures.push("FP pistol missing right hand");
    if (pistolHands.left !== 0) failures.push(`FP pistol should have no left hand, got ${pistolHands.left}`);

    await page.evaluate(() => {
      window.__epic60.triggerFire("pistol");
      window.__epic60.advance(0.02);
    });
    await capture(page, join(OUT_DIR, "02-fp-pistol-fire.png"));

    await page.evaluate(() => {
      window.__epic60.setEmpty(true);
      window.__epic60.advance(0.1);
    });
    await capture(page, join(OUT_DIR, "03-fp-pistol-empty-dim.png"));

    // FP rifle — two hands
    await page.evaluate(() => {
      window.__epic60.setEmpty(false);
      window.__epic60.setWeapon("rifle");
      window.__epic60.advance(0.5);
    });
    const rifleHands = await page.evaluate(() => window.__epic60.handCounts("rifle"));
    await capture(page, join(OUT_DIR, "04-fp-rifle-two-hand.png"));
    console.log("[qa] rifle hands", rifleHands);
    if (rifleHands.right < 1 || rifleHands.left < 1) {
      failures.push(`FP rifle needs both hands, got ${JSON.stringify(rifleHands)}`);
    }

    await page.evaluate(() => {
      window.__epic60.triggerFire("rifle");
      window.__epic60.advance(0.02);
    });
    await capture(page, join(OUT_DIR, "05-fp-rifle-fire.png"));

    // FP grenade launcher — two hands
    await page.evaluate(() => {
      window.__epic60.setWeapon("grenade_launcher");
      window.__epic60.advance(0.5);
    });
    const glHands = await page.evaluate(() => window.__epic60.handCounts("grenade_launcher"));
    await capture(page, join(OUT_DIR, "06-fp-gl-two-hand.png"));
    console.log("[qa] gl hands", glHands);
    if (glHands.right < 1 || glHands.left < 1) {
      failures.push(`FP GL needs both hands, got ${JSON.stringify(glHands)}`);
    }

    // Pickup lineup + armor closeup
    await page.evaluate(() => {
      window.__epic60.setMode("lineup");
      window.__epic60.advance(0.05);
    });
    await capture(page, join(OUT_DIR, "07-pickups-lineup.png"));

    await page.evaluate(() => {
      window.__epic60.setMode("armor");
      window.__epic60.advance(0.05);
    });
    await capture(page, join(OUT_DIR, "08-armor-vest-closeup.png"));

    // Remotes standing
    await page.evaluate(() => {
      window.__epic60.setMode("remotes");
      window.__epic60.advance(0.1);
    });
    await capture(page, join(OUT_DIR, "09-remotes-standing-holds.png"));
    const standingChecks = await page.evaluate(() => window.__epic60.remoteChecks());
    console.log("[qa] remote standing", JSON.stringify(standingChecks, null, 2));

    for (const c of standingChecks) {
      if (c.missing) {
        failures.push(`remote ${c.id} missing`);
        continue;
      }
      if (!c.weaponVisible) failures.push(`remote ${c.id} weapon not visible`);
      if (!c.weaponParentedToRightArm) failures.push(`remote ${c.id} weapon not parented to right arm`);
      if (!c.hasChestPlate || !c.hasShoulders) failures.push(`remote ${c.id} missing avatar polish parts`);
      if (c.weapon === "pistol") {
        // one-hand: left arm less raised than rifle/GL
        if (!(c.rightArmPitch < -0.4)) failures.push(`remote pistol right-arm pose weak (${c.rightArmPitch})`);
        if (!(c.leftArmPitch > -0.4)) failures.push(`remote pistol left arm should not be two-hand raised (${c.leftArmPitch})`);
      } else {
        if (!(c.leftArmPitch < -0.6)) failures.push(`remote ${c.id} left arm not in two-hand pose (${c.leftArmPitch})`);
        if (!(c.rightArmPitch < -0.7)) failures.push(`remote ${c.id} right arm not in two-hand pose (${c.rightArmPitch})`);
      }
    }

    const rifleRemote = standingChecks.find((c) => c.id === "rifle");
    const glRemote = standingChecks.find((c) => c.id === "gl");
    const pistolRemote = standingChecks.find((c) => c.id === "pistol");
    if (rifleRemote && !rifleRemote.amuletVisible) failures.push("rifle remote amulet not visible");
    if (glRemote && !glRemote.amuletVisible) failures.push("gl remote amulet not visible");
    if (pistolRemote && pistolRemote.visiblePets < 1) failures.push("pistol remote pet not visible");
    if (glRemote && glRemote.visiblePets < 2) failures.push(`gl remote expected 2 pets, got ${glRemote.visiblePets}`);

    // Remotes running
    await page.evaluate(() => {
      window.__epic60.setMode("remotes-run");
      window.__epic60.advanceRunPose();
      window.__epic60.advance(0.05);
    });
    await capture(page, join(OUT_DIR, "10-remotes-running-holds.png"));
    const runningChecks = await page.evaluate(() => window.__epic60.remoteChecks());
    for (const c of runningChecks) {
      if (c.missing) continue;
      if (!c.weaponParentedToRightArm) failures.push(`running remote ${c.id} weapon detached from right arm`);
      if (!c.weaponVisible) failures.push(`running remote ${c.id} weapon not visible`);
    }

    summary.selfcheck = {
      pistolHands,
      rifleHands,
      glHands,
      standingChecks,
      runningChecks,
      consoleErrors,
      failures,
      screenshots: [
        "01-fp-pistol-one-hand.png",
        "02-fp-pistol-fire.png",
        "03-fp-pistol-empty-dim.png",
        "04-fp-rifle-two-hand.png",
        "05-fp-rifle-fire.png",
        "06-fp-gl-two-hand.png",
        "07-pickups-lineup.png",
        "08-armor-vest-closeup.png",
        "09-remotes-standing-holds.png",
        "10-remotes-running-holds.png",
      ],
    };

    if (consoleErrors.length > 0) {
      failures.push(`selfcheck console errors: ${consoleErrors.join(" | ")}`);
    }
    if (failures.length > 0) {
      console.log("[qa] PART A FAIL:", failures);
      summary.selfcheckOk = false;
    } else {
      console.log("[qa] PART A PASS");
      summary.selfcheckOk = true;
    }
  } finally {
    await browser.close().catch(() => {});
    await stop(vite);
    await rm(TEMP_HTML, { force: true });
  }
  return summary.selfcheckOk !== false && (summary.selfcheck?.failures?.length ?? 0) === 0;
}

async function runLive(summary, serverLog) {
  console.log("[qa] PART B — live vs-bots smoke");
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
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await openLobby(page);
    const nickname = nick("e60_");
    await joinBots(page, nickname);
    const locked = await pointerLock(page);
    if (!locked) console.warn("[qa] pointer lock not acquired (continuing)");

    const before = await page.evaluate(() => window.__epic60Tap?.lastSelf ?? null);
    await page.keyboard.down("KeyW");
    await sleep(700);
    await page.keyboard.up("KeyW");
    await sleep(100);
    const afterMove = await page.evaluate(() => window.__epic60Tap?.lastSelf ?? null);
    const moved =
      before?.position &&
      afterMove?.position &&
      Math.hypot(afterMove.position.x - before.position.x, afterMove.position.z - before.position.z) > 0.15;
    if (!moved) failures.push("movement did not change position meaningfully");

    const yBefore = afterMove?.position?.y ?? 0;
    await page.keyboard.down("Space");
    await sleep(80);
    await page.keyboard.up("Space");
    await sleep(200);
    const midJump = await page.evaluate(() => window.__epic60Tap?.lastSelf ?? null);
    const jumped = (midJump?.position?.y ?? 0) > yBefore + 0.2;
    if (!jumped) failures.push(`jump did not leave ground (y ${yBefore} -> ${midJump?.position?.y})`);
    await sleep(600);

    await capture(page, join(OUT_DIR, "11-live-fp-pistol.png"));

    // Fire a few times
    const hitsBefore = await page.evaluate(() => (window.__epic60Tap?.hits ?? []).length);
    for (let i = 0; i < 4; i++) {
      await page.mouse.down();
      await sleep(40);
      await page.mouse.up();
      await sleep(220);
    }
    await sleep(300);
    await capture(page, join(OUT_DIR, "12-live-fp-after-fire.png"));

    // Cycle weapon with E (may stay pistol if only pistol owned — still OK)
    await page.keyboard.press("KeyE");
    await sleep(200);
    await page.keyboard.press("KeyE");
    await sleep(200);
    await capture(page, join(OUT_DIR, "13-live-fp-after-e-cycle.png"));

    // Look around / try to frame a remote bot
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => {
        document.dispatchEvent(
          new MouseEvent("mousemove", { bubbles: true, cancelable: true, movementX: 40, movementY: 0 }),
        );
      });
      await sleep(40);
    }
    await sleep(200);
    const others = await page.evaluate(() => window.__epic60Tap?.lastOthers ?? []);
    await capture(page, join(OUT_DIR, "14-live-look-remotes.png"));

    const hitsAfter = await page.evaluate(() => (window.__epic60Tap?.hits ?? []).length);
    const weaponHud = await page.evaluate(() => document.getElementById("weaponHud")?.textContent ?? "");
    const healthHud = await page.evaluate(() => document.getElementById("healthHud")?.textContent ?? "");

    summary.live = {
      moved,
      jumped,
      locked,
      othersCount: others.length,
      hitsDelta: hitsAfter - hitsBefore,
      weaponHud,
      healthHud,
      consoleErrors,
      failures,
      screenshots: [
        "11-live-fp-pistol.png",
        "12-live-fp-after-fire.png",
        "13-live-fp-after-e-cycle.png",
        "14-live-look-remotes.png",
      ],
    };

    if (!moved || !jumped) {
      /* already in failures */
    }
    // Hit registration is best-effort in bots match (may miss); fire path is OK if no crash.
    if (consoleErrors.length > 0) {
      // Filter known noisy WebGL warnings if any
      const serious = consoleErrors.filter((e) => !/WebGL|DEPRECATED/i.test(e));
      if (serious.length > 0) failures.push(`live console errors: ${serious.join(" | ")}`);
    }
    summary.live.failures = failures;
    summary.liveOk = failures.length === 0;
    if (summary.liveOk) console.log("[qa] PART B PASS");
    else console.log("[qa] PART B FAIL:", failures);
    return summary.liveOk;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const summary = {
    epic: 60,
    commit: null,
    clientOnlyDiff: true,
    selfcheckOk: false,
    liveOk: false,
  };
  const serverLog = [];
  let stack;

  try {
    const selfOk = await runSelfcheck(summary);
    if (MANAGE_STACK) {
      stack = await startStack(serverLog);
    }
    const liveOk = await runLive(summary, serverLog);
    summary.ok = selfOk && liveOk;

    await writeFile(join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
    await writeFile(join(OUT_DIR, "server.log"), serverLog.join(""));

    console.log("[qa] summary", JSON.stringify({ ok: summary.ok, selfcheckOk: summary.selfcheckOk, liveOk: summary.liveOk }, null, 2));
    if (!summary.ok) process.exitCode = 1;
  } finally {
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
