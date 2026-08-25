// Tester Playwright evidence for EPIC 39 visible companion pets.
//
// Part A — deterministic RemotePlayers selfcheck (real client module):
//   dog / cat / bird / lion silhouettes, left+right sides, palette colors,
//   cyan glow shells, spawn-protection opacity on companions.
// Part B — live vs Bots: companions on bots, move / jump / shoot smoke.
// Part C — inventory Pet colors: seed pet, swatches, set color, persist.
//
// Starts dedicated server/client. Usage:
//   node scripts/qa-epic39-tester-playwright.mjs
//   node scripts/qa-epic39-tester-playwright.mjs <clientUrl> <outDir>  # optional override (skips spawn)

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7789;
const CLIENT_PORT = 5210;
const SELFCHECK_PORT = 5191;

const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-39");
const MANAGE_STACK = process.argv[2] === undefined;

const SELFCHECK_TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic39-companions-selfcheck.html");
const SELFCHECK_URL = `http://127.0.0.1:${SELFCHECK_PORT}/.tmp-epic39-companions-selfcheck.html`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const PALETTE = [
  0x2d6cdf, 0x2b2d42, 0xf2c197, 0xff8c00, 0x9b30ff, 0xd32f2f, 0x2f6fae, 0x36c7e0,
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nick(prefix) {
  // Nickname max length is small (see shared/src/nickname.ts); keep short.
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
    <title>EPIC 39 Companion Pets Selfcheck</title>
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
    <div id="label">L→R: dog left · cat right · bird left · lion right (cyan glow)</div>
    <script type="module">
      import * as THREE from "three";
      import { RemotePlayers } from "/src/remotePlayers.ts";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fd7ff);
      const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 1.85, 6.2);
      camera.lookAt(0, 1.05, 0);

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
          id: "dogLeft",
          position: { x: -3.3, y: 0, z: 0 },
          yaw: Math.PI * 0.12, health: 100, armor: 0, equippedWeapon: "pistol",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: ["dog"],
          equippedPetsVisual: [{ type: "dog", colorIndex: 0, side: "left" }],
          hasAmulet: false,
        },
        {
          id: "catRight",
          position: { x: -1.1, y: 0, z: 0 },
          yaw: -Math.PI * 0.08, health: 100, armor: 0, equippedWeapon: "rifle",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: ["cat"],
          equippedPetsVisual: [{ type: "cat", colorIndex: 5, side: "right" }],
          hasAmulet: true,
        },
        {
          id: "birdLeft",
          position: { x: 1.1, y: 0, z: 0 },
          yaw: Math.PI * 0.1, health: 100, armor: 0, equippedWeapon: "pistol",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: ["bird"],
          equippedPetsVisual: [{ type: "bird", colorIndex: 7, side: "left" }],
          hasAmulet: false,
        },
        {
          id: "lionRight",
          position: { x: 3.3, y: 0, z: 0 },
          yaw: -Math.PI * 0.14, health: 100, armor: 0, equippedWeapon: "grenade_launcher",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: ["lion"],
          equippedPetsVisual: [{ type: "lion", colorIndex: 3, side: "right" }],
          hasAmulet: true,
        },
      ];

      function avatarRoots() {
        return scene.children.filter((c) => c.name && c.name.startsWith("remote-avatar:"));
      }

      function inspectAvatar(playerId) {
        const root = scene.getObjectByName("remote-avatar:" + playerId);
        if (!root) return null;
        const companions = [];
        root.traverse((obj) => {
          if (obj.name !== "avatar:pet-companion") return;
          const glow = obj.getObjectByName("avatar:pet-glow");
          const body = obj.getObjectByName("avatar:pet-body");
          let bodyHex = null;
          let bodyOpacity = null;
          let boxes = 0;
          let spheres = 0;
          let cones = 0;
          if (body) {
            body.traverse((c) => {
              if (!c.isMesh) return;
              const geo = c.geometry?.type;
              if (geo === "BoxGeometry") boxes += 1;
              if (geo === "SphereGeometry") spheres += 1;
              if (geo === "ConeGeometry") cones += 1;
              if (bodyHex !== null) return;
              const mat = Array.isArray(c.material) ? c.material[0] : c.material;
              if (mat?.color?.getHex) {
                bodyHex = mat.color.getHex();
                bodyOpacity = mat.opacity;
              }
            });
          }
          let inferred = "unknown";
          if (spheres >= 2 && cones >= 1) inferred = "bird";
          else if (spheres >= 1 && cones === 0 && boxes >= 5) inferred = "lion";
          else if (cones >= 2) inferred = "cat";
          else if (boxes >= 7) inferred = "dog";
          let glowHex = null;
          let glowOpacity = null;
          if (glow?.material) {
            glowHex = glow.material.color?.getHex?.() ?? null;
            glowOpacity = glow.material.opacity;
          }
          companions.push({
            visible: obj.visible,
            sideX: obj.position.x,
            bodyType: inferred,
            geo: { boxes, spheres, cones },
            bodyHex,
            bodyOpacity,
            glowHex,
            glowOpacity,
          });
        });
        let petOrbs = 0;
        root.traverse((obj) => {
          if (obj.name === "avatar:pet-orb") petOrbs += 1;
        });
        return { companions: companions.filter((c) => c.visible), petOrbs };
      }

      function sampleCompanionOpacity(playerId) {
        const info = inspectAvatar(playerId);
        if (!info || info.companions.length === 0) return null;
        return info.companions[0].bodyOpacity;
      }

      remotePlayers.sync(players, "self", serverTimeMs);
      remotePlayers.update(0.016);
      renderer.render(scene, camera);

      window.__epic39 = {
        renderLineup() {
          document.getElementById("label").textContent =
            "L→R: dog left · cat right · bird left · lion right (cyan glow)";
          for (const p of players) {
            if (p.id === "self") continue;
            p.spawnProtectedUntilMs = 0;
          }
          remotePlayers.sync(players, "self", serverTimeMs);
          remotePlayers.update(0.5);
          renderer.render(scene, camera);
          return {
            dogLeft: inspectAvatar("dogLeft"),
            catRight: inspectAvatar("catRight"),
            birdLeft: inspectAvatar("birdLeft"),
            lionRight: inspectAvatar("lionRight"),
          };
        },
        renderProtectedCompanions() {
          document.getElementById("label").textContent =
            "same lineup with spawn protection (companions fade with owner)";
          for (const p of players) {
            if (p.id === "self") continue;
            p.spawnProtectedUntilMs = serverTimeMs + 5000;
          }
          remotePlayers.sync(players, "self", serverTimeMs);
          remotePlayers.update(0.016);
          renderer.render(scene, camera);
          return {
            dogLeftOpacity: sampleCompanionOpacity("dogLeft"),
            catRightOpacity: sampleCompanionOpacity("catRight"),
            lionRight: inspectAvatar("lionRight"),
          };
        },
        renderFront() {
          camera.position.set(0, 1.85, -6.2);
          camera.lookAt(0, 1.05, 0);
          renderer.render(scene, camera);
        },
        renderBack() {
          camera.position.set(0, 1.85, 6.2);
          camera.lookAt(0, 1.05, 0);
          renderer.render(scene, camera);
        },
      };

      window.__epic39.renderLineup();
      window.__epic39Ready = true;
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
      window.__epic39Tap = window.__epic39Tap || {
        welcomeId: null,
        lastPlayers: {},
        profiles: [],
        wsUrl: String(args[0] ?? ""),
      };
      window.__epic39Tap.ws = ws;
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "welcome") window.__epic39Tap.welcomeId = msg.playerId;
          if (msg.type === "world_state" && Array.isArray(msg.players)) {
            for (const p of msg.players) {
              window.__epic39Tap.lastPlayers[p.id] = {
                id: p.id,
                nickname: p.nickname,
                equippedPetsVisual: p.equippedPetsVisual ?? [],
                equippedPetTypes: p.equippedPetTypes ?? [],
                spawnProtectedUntilMs: p.spawnProtectedUntilMs ?? 0,
              };
            }
          }
          if (msg.type === "economy_profile") {
            window.__epic39Tap.profiles.push(msg);
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
  const code = await page.locator("#accountRevealCode").innerText();
  await page.click("#accountContinueBtn");
  await page.waitForFunction(
    () =>
      document.getElementById("accountSignedIn") &&
      !document.getElementById("accountSignedIn").classList.contains("hidden"),
    { timeout: 10000 },
  );
  return code;
}

async function loginWithCode(page, email, code) {
  await installWsTap(page);
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#accountEmailInput", { timeout: 15000 });
  await page.fill("#accountEmailInput", email);
  await page.click("#accountEmailBtn");
  // Existing account → code step (not reveal).
  await page.waitForSelector("#accountCodeInput", { timeout: 15000 });
  await page.fill("#accountCodeInput", code);
  await page.click("#accountCodeBtn");
  await page.waitForFunction(
    () =>
      document.getElementById("accountSignedIn") &&
      !document.getElementById("accountSignedIn").classList.contains("hidden"),
    { timeout: 15000 },
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

async function seedPetAndEquip(nickname) {
  // Seed via production EconomyStore (same Redis prefix the live server uses).
  const helper = join(OUT_DIR, "_seed-pet.mjs");
  const escapedNick = JSON.stringify(nickname);
  await writeFile(
    helper,
    `import { EconomyStore } from "../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${escapedNick};
const now = Date.now();
const pet = await store.grantPetForTests(nick, "lion", 80, now, "sandbox");
const colored = await store.setPetColor(nick, pet.id, 2, now, "sandbox");
await store.equipPet(nick, pet.id, 1, now, "sandbox");
await store.close();
console.log(JSON.stringify({ petId: colored.id, colorIndex: colored.colorIndex, type: colored.type, scope: "sandbox" }));
`,
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", helper], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString();
    });
    child.stderr.on("data", (b) => {
      err += b.toString();
    });
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`seed failed: ${err || out}`));
      try {
        const line = out
          .trim()
          .split("\n")
          .filter((l) => l.startsWith("{"))
          .pop();
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`seed parse fail: ${out}\n${err}\n${e}`));
      }
    });
  });
}

async function readPetColor(nickname, petId) {
  const helper = join(OUT_DIR, "_read-pet-color.mjs");
  await writeFile(
    helper,
    `import { EconomyStore } from "../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${JSON.stringify(nickname)};
const full = await store.getFullProfile(nick, "sandbox");
const pet = full.pets.find((p) => p.id === ${Number(petId)});
await store.close();
console.log(JSON.stringify({ colorIndex: pet?.colorIndex ?? null, equipSlot: pet?.equipSlot ?? null, scope: "sandbox" }));
`,
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", helper], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString();
    });
    child.stderr.on("data", (b) => {
      err += b.toString();
    });
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`read pet failed: ${err || out}`));
      try {
        const line = out
          .trim()
          .split("\n")
          .filter((l) => l.startsWith("{"))
          .pop();
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`read parse fail: ${out}\n${err}\n${e}`));
      }
    });
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = { selfcheck: {}, bots: {}, inventory: {}, consoleErrors: {} };

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
    // ---------- Part A ----------
    console.log("[epic39-qa] Part A: companion lineup selfcheck");
    selfcheckVite = await startSelfcheckVite();
    const pageA = await browser.newPage({ viewport: { width: 1400, height: 720 } });
    const errA = [];
    pageA.on("console", (m) => {
      if (m.type() === "error") errA.push(m.text());
    });
    pageA.on("pageerror", (e) => errA.push(`pageerror: ${e.message}`));

    await pageA.goto(SELFCHECK_URL, { waitUntil: "load", timeout: 30000 });
    await pageA.waitForFunction(() => window.__epic39Ready === true, { timeout: 15000 });
    const lineup = await pageA.evaluate(() => window.__epic39.renderLineup());
    await pageA.evaluate(() => window.__epic39.renderBack());
    await sleep(120);
    await pageA.screenshot({ path: join(OUT_DIR, "01-selfcheck-companions-back.png") });
    await pageA.evaluate(() => window.__epic39.renderFront());
    await sleep(120);
    await pageA.screenshot({ path: join(OUT_DIR, "02-selfcheck-companions-front.png") });
    const protectedInfo = await pageA.evaluate(() => window.__epic39.renderProtectedCompanions());
    await pageA.evaluate(() => window.__epic39.renderBack());
    await sleep(120);
    await pageA.screenshot({ path: join(OUT_DIR, "03-selfcheck-companions-spawn-protected.png") });
    summary.selfcheck = { lineup, protectedInfo, consoleErrors: errA };
    console.log("[epic39-qa] lineup:", JSON.stringify(lineup, null, 2));
    console.log("[epic39-qa] protected:", JSON.stringify(protectedInfo, null, 2));

    const expectSide = (info, sideXSign, typeName, colorIndex) => {
      if (!info || info.companions.length !== 1) {
        failures.push(`${typeName}: expected 1 visible companion, got ${JSON.stringify(info)}`);
        return;
      }
      if (info.petOrbs !== 0) failures.push(`${typeName}: legacy pet-orb still present`);
      const c = info.companions[0];
      if (!c.bodyType || c.bodyType !== typeName) {
        failures.push(`${typeName}: body type mismatch ${c.bodyType} geo=${JSON.stringify(c.geo)}`);
      }
      if (Math.sign(c.sideX) !== sideXSign) {
        failures.push(`${typeName}: expected side sign ${sideXSign}, got x=${c.sideX}`);
      }
      if (c.bodyHex !== PALETTE[colorIndex]) {
        failures.push(`${typeName}: color hex expected ${PALETTE[colorIndex].toString(16)} got ${c.bodyHex?.toString(16)}`);
      }
      if (c.glowHex !== 0x4ec8ff) {
        failures.push(`${typeName}: glow not cyan (got ${c.glowHex?.toString(16)})`);
      }
      if (c.glowOpacity == null || c.glowOpacity < 0.15) {
        failures.push(`${typeName}: glow opacity too low (${c.glowOpacity})`);
      }
    };

    expectSide(lineup.dogLeft, -1, "dog", 0);
    expectSide(lineup.catRight, 1, "cat", 5);
    expectSide(lineup.birdLeft, -1, "bird", 7);
    expectSide(lineup.lionRight, 1, "lion", 3);

    if (Math.abs((protectedInfo.dogLeftOpacity ?? 0) - 0.35) > 0.05) {
      failures.push(`protected companion opacity expected ~0.35, got ${protectedInfo.dogLeftOpacity}`);
    }
    if (errA.length) failures.push(`Part A console errors: ${errA.join(" | ")}`);
    await pageA.close();

    // ---------- Live stack ----------
    if (MANAGE_STACK) {
      console.log("[epic39-qa] starting dedicated server/client");
      stack = await startStack();
      console.log("[epic39-qa] server+client ready");
    }

    // ---------- Part B ----------
    console.log("[epic39-qa] Part B: live bots companions + gameplay");
    let worldPets = null;
    let pageB = null;
    const errB = [];
    // Retry a few bots joins — archetype A has no pets (RNG).
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (pageB) await pageB.close().catch(() => {});
      pageB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      pageB.on("console", (m) => {
        if (m.type() === "error") errB.push(m.text());
      });
      pageB.on("pageerror", (e) => errB.push(`pageerror: ${e.message}`));

      const botsNick = nick("E39B");
      const botsEmail = `${botsNick.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;
      console.log(`[epic39-qa] Part B attempt ${attempt} as ${botsNick}`);
      await registerAndContinue(pageB, botsEmail);
      await joinMode(pageB, botsNick, "modeBotsBtn");
      await sleep(900);
      worldPets = await pageB.evaluate(() => {
        const tap = window.__epic39Tap;
        if (!tap?.lastPlayers) return null;
        return Object.values(tap.lastPlayers)
          .filter((p) => Array.isArray(p.equippedPetsVisual) && p.equippedPetsVisual.length > 0)
          .map((p) => ({
            id: p.id,
            nickname: p.nickname,
            visuals: p.equippedPetsVisual,
          }));
      });
      if (worldPets && worldPets.length > 0) break;
    }
    await pointerLock(pageB);
    summary.bots.worldPets = worldPets;
    summary.bots.wsUrl = await pageB.evaluate(() => window.__epic39Tap?.wsUrl ?? null);
    if (!worldPets || worldPets.length === 0) {
      failures.push("live bots: no equippedPetsVisual seen on any player after retries");
    } else {
      for (const p of worldPets) {
        for (const v of p.visuals) {
          if (v.side !== "left" && v.side !== "right") {
            failures.push(`bot visual side invalid: ${JSON.stringify(v)}`);
          }
          if (!Number.isInteger(v.colorIndex) || v.colorIndex < 0 || v.colorIndex > 7) {
            failures.push(`bot visual colorIndex invalid: ${JSON.stringify(v)}`);
          }
        }
      }
      console.log("[epic39-qa] live bot pets sample:", JSON.stringify(worldPets.slice(0, 3)));
    }

    await pageB.screenshot({ path: join(OUT_DIR, "04-bots-match-companions.png") });
    await pageB.keyboard.down("KeyW");
    await sleep(700);
    await pageB.keyboard.up("KeyW");
    await pageB.screenshot({ path: join(OUT_DIR, "05-bots-movement.png") });
    await pageB.keyboard.down("Space");
    await sleep(120);
    await pageB.screenshot({ path: join(OUT_DIR, "06-bots-jump.png") });
    await pageB.keyboard.up("Space");
    await pageB.mouse.down({ button: "left" });
    await sleep(80);
    await pageB.mouse.up({ button: "left" });
    await sleep(200);
    await pageB.screenshot({ path: join(OUT_DIR, "07-bots-fire-smoke.png") });
    // Wait past spawn protection so companions are fully opaque on remotes.
    await sleep(2200);
    await pageB.screenshot({ path: join(OUT_DIR, "08-bots-after-protection.png") });
    summary.bots.consoleErrors = errB;
    if (errB.length) failures.push(`Part B console errors: ${errB.join(" | ")}`);
    await pageB.close();

    // Server log should mention bot pet colors (@cN).
    if (stack) {
      const joined = stack.serverLog.join("");
      await writeFile(join(OUT_DIR, "server.log"), joined);
      const botPetLines = joined.split("\n").filter((l) => l.includes("loadout:") && l.includes("@c"));
      summary.bots.botLoadoutLines = botPetLines.slice(0, 8);
      if (botPetLines.length === 0) {
        failures.push("server log missing bot loadout pet color markers (@cN)");
      } else {
        console.log("[epic39-qa] bot loadout sample:", botPetLines[0]);
      }
    }

    // ---------- Part C: inventory pet colors ----------
    console.log("[epic39-qa] Part C: inventory pet color swatches + persist");
    const invNick = nick("E39P");
    const invEmail = `${invNick.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;
    let seeded;
    try {
      seeded = await seedPetAndEquip(invNick);
      console.log("[epic39-qa] seeded pet", seeded);
    } catch (e) {
      failures.push(`seed pet failed: ${e?.message ?? e}`);
      seeded = null;
    }

    const pageC = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errC = [];
    pageC.on("console", (m) => {
      if (m.type() === "error") errC.push(m.text());
    });
    pageC.on("pageerror", (e) => errC.push(`pageerror: ${e.message}`));

    const invCode = await registerAndContinue(pageC, invEmail);
    await joinMode(pageC, invNick, "modeBotsBtn");
    await sleep(600);
    // Open inventory with I (escape pointer lock first if needed).
    await pageC.keyboard.press("Escape");
    await sleep(150);
    await pageC.keyboard.press("KeyI");
    await pageC.waitForSelector("#inventoryOverlay.visible", { timeout: 8000 }).catch(() => null);
    await sleep(300);
    await pageC.screenshot({ path: join(OUT_DIR, "09-inventory-pet-colors.png") });

    const petUi = await pageC.evaluate(() => {
      const rows = document.getElementById("inventoryPetColorRows");
      if (!rows) return { ok: false, reason: "missing inventoryPetColorRows" };
      const swatches = [...rows.querySelectorAll(".inv-swatch")];
      const selected = swatches.filter((s) => s.dataset.selected === "true");
      const headings = [...document.querySelectorAll("h3")].map((h) => h.textContent?.trim());
      return {
        ok: true,
        swatchCount: swatches.length,
        selectedCount: selected.length,
        headings,
        rowText: rows.textContent?.slice(0, 200) ?? "",
      };
    });
    summary.inventory.ui = petUi;
    console.log("[epic39-qa] pet color UI:", petUi);

    if (!petUi.ok) failures.push(petUi.reason);
    else if (seeded && petUi.swatchCount < 8) {
      failures.push(`expected >=8 pet color swatches, got ${petUi.swatchCount}`);
    } else if (!seeded && !/No pets yet/i.test(petUi.rowText || "") && petUi.swatchCount === 0) {
      failures.push("Pet colors section empty unexpectedly");
    }

    if (seeded && petUi.swatchCount >= 8) {
      // Click a different swatch (index 6).
      await pageC.evaluate(() => {
        const rows = document.getElementById("inventoryPetColorRows");
        const swatches = [...rows.querySelectorAll(".inv-swatch")];
        const target = swatches.find((s) => s.dataset.selected !== "true") ?? swatches[6];
        target?.click();
      });
      await sleep(500);
      await pageC.screenshot({ path: join(OUT_DIR, "10-inventory-pet-color-changed.png") });

      // Re-read from Redis for persistence.
      let persisted;
      try {
        persisted = await readPetColor(invNick, seeded.petId);
      } catch (e) {
        failures.push(`read pet after color set failed: ${e?.message ?? e}`);
        persisted = null;
      }
      summary.inventory.persistedColorIndex = persisted?.colorIndex ?? null;
      if (persisted == null || persisted.colorIndex == null) {
        failures.push("pet missing after color set");
      } else if (persisted.colorIndex === seeded.colorIndex) {
        failures.push(
          `pet color did not change after swatch click (still ${persisted.colorIndex}); check UI wiring`,
        );
      } else {
        console.log("[epic39-qa] persisted colorIndex", persisted.colorIndex);
      }

      // Rejoin via login (same email+code) and confirm swatch selection persists.
      await pageC.close();
      const pageC2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await loginWithCode(pageC2, invEmail, invCode);
      await joinMode(pageC2, invNick, "modeBotsBtn");
      await sleep(500);
      await pageC2.keyboard.press("Escape");
      await sleep(100);
      await pageC2.keyboard.press("KeyI");
      await pageC2.waitForSelector("#inventoryOverlay.visible", { timeout: 8000 }).catch(() => null);
      await sleep(400);
      await pageC2.screenshot({ path: join(OUT_DIR, "11-inventory-pet-color-persisted.png") });
      const after = await pageC2.evaluate(() => {
        const rows = document.getElementById("inventoryPetColorRows");
        const selected = [...(rows?.querySelectorAll('.inv-swatch[data-selected="true"]') ?? [])];
        return {
          selectedTitles: selected.map((s) => s.title),
          selectedCount: selected.length,
        };
      });
      summary.inventory.rejoin = after;
      await pageC2.close();
    } else {
      await pageC.close();
    }

    if (errC.length) failures.push(`Part C console errors: ${errC.join(" | ")}`);
    summary.consoleErrors.inventory = errC;

    await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));

    console.log("\n=== EPIC 39 CHECKS ===");
    if (failures.length === 0) {
      console.log("ALL PASS");
    } else {
      for (const f of failures) console.log("FAIL:", f);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("[epic39-qa] script crashed:", err);
    process.exitCode = 2;
  } finally {
    await browser.close().catch(() => {});
    if (selfcheckVite) await stop(selfcheckVite);
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
      await writeFile(join(OUT_DIR, "client.log"), (stack.clientLog || []).join("")).catch(() => {});
    }
    await rm(SELFCHECK_TEMP_HTML, { force: true }).catch(() => {});
  }
}

await main();
