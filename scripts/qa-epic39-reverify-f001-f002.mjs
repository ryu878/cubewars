// EPIC 39 Critic re-verify (F-001 dual opposite sides, F-002 dispose path).
// Scoped evidence + light live regression. Usage:
//   node scripts/qa-epic39-reverify-f001-f002.mjs

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

const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-39-f001-f002");
const SELFCHECK_TEMP_HTML = join(CLIENT_ROOT, ".tmp-epic39-f001-f002-selfcheck.html");
const SELFCHECK_URL = `http://127.0.0.1:${SELFCHECK_PORT}/.tmp-epic39-f001-f002-selfcheck.html`;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

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
    <title>EPIC 39 F-001/F-002 Dual Companion Reverify</title>
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
    <div id="label">Dual equip: dog left + bird right (F-001)</div>
    <script type="module">
      import * as THREE from "three";
      import { RemotePlayers } from "/src/remotePlayers.ts";

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x9fd7ff);
      const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, 1.7, 4.2);
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
        new THREE.PlaneGeometry(10, 8),
        new THREE.MeshStandardMaterial({ color: 0xd7c37f, roughness: 0.85 }),
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      const remotePlayers = new RemotePlayers(scene);
      const serverTimeMs = 50_000;
      const dual = {
        id: "dualHero",
        position: { x: 0, y: 0, z: 0 },
        yaw: Math.PI * 0.08, health: 100, armor: 0, equippedWeapon: "rifle",
        alive: true, spawnProtectedUntilMs: 0,
        equippedPetTypes: ["dog", "bird"],
        equippedPetsVisual: [
          { type: "dog", colorIndex: 0, side: "left" },
          { type: "bird", colorIndex: 7, side: "right" },
        ],
        hasAmulet: true,
      };
      const players = [
        {
          id: "self",
          position: { x: 0, y: 0, z: 20 },
          yaw: 0, health: 100, armor: 0, equippedWeapon: "pistol",
          alive: true, spawnProtectedUntilMs: 0,
          equippedPetTypes: [], equippedPetsVisual: [], hasAmulet: false,
        },
        dual,
      ];

      function inspectDual() {
        const root = scene.getObjectByName("remote-avatar:dualHero");
        if (!root) return null;
        const companions = [];
        root.traverse((obj) => {
          if (obj.name !== "avatar:pet-companion" || !obj.visible) return;
          const body = obj.getObjectByName("avatar:pet-body");
          let bodyHex = null;
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
              if (mat?.color?.getHex) bodyHex = mat.color.getHex();
            });
          }
          let inferred = "unknown";
          if (spheres >= 2 && cones >= 1) inferred = "bird";
          else if (boxes >= 7) inferred = "dog";
          companions.push({ sideX: obj.position.x, bodyType: inferred, bodyHex, geo: { boxes, spheres, cones } });
        });
        return { companions };
      }

      function renderFrame() {
        remotePlayers.sync(players, "self", serverTimeMs);
        remotePlayers.update(0.016);
        renderer.render(scene, camera);
      }

      window.__epic39rev = {
        renderDualOpposite() {
          document.getElementById("label").textContent =
            "Dual equip: dog left + bird right (F-001 opposite sides)";
          dual.equippedPetsVisual = [
            { type: "dog", colorIndex: 0, side: "left" },
            { type: "bird", colorIndex: 7, side: "right" },
          ];
          dual.equippedPetTypes = ["dog", "bird"];
          renderFrame();
          return inspectDual();
        },
        renderDualFlipped() {
          document.getElementById("label").textContent =
            "Dual equip flipped: cat right + lion left (F-001)";
          dual.equippedPetsVisual = [
            { type: "cat", colorIndex: 5, side: "right" },
            { type: "lion", colorIndex: 3, side: "left" },
          ];
          dual.equippedPetTypes = ["cat", "lion"];
          renderFrame();
          return inspectDual();
        },
        /** Rebuild bodies (color/type churn) — exercises disposeCompanionSubtree (F-002). */
        rebuildChurn(times = 12) {
          for (let i = 0; i < times; i++) {
            const colorA = i % 8;
            const colorB = (i + 3) % 8;
            dual.equippedPetsVisual = [
              { type: i % 2 === 0 ? "dog" : "cat", colorIndex: colorA, side: "left" },
              { type: i % 2 === 0 ? "bird" : "lion", colorIndex: colorB, side: "right" },
            ];
            dual.equippedPetTypes = dual.equippedPetsVisual.map((v) => v.type);
            renderFrame();
          }
          return inspectDual();
        },
        renderFront() {
          camera.position.set(0, 1.7, -4.2);
          camera.lookAt(0, 1.05, 0);
          renderer.render(scene, camera);
        },
        renderBack() {
          camera.position.set(0, 1.7, 4.2);
          camera.lookAt(0, 1.05, 0);
          renderer.render(scene, camera);
        },
      };

      window.__epic39rev.renderDualOpposite();
      window.__epic39Ready = true;
    </script>
  </body>
</html>
`;

async function startSelfcheckVite() {
  await writeFile(SELFCHECK_TEMP_HTML, SELFCHECK_HTML, "utf8");
  const child = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(SELFCHECK_PORT), "--strictPort"],
    {
      cwd: CLIENT_ROOT,
      env: { ...process.env, BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForReady(child, "selfcheck-vite", `http://127.0.0.1:${SELFCHECK_PORT}/`);
  return child;
}

async function startStack() {
  const serverLog = [];
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(REPO_ROOT, "server"),
    env: {
      ...process.env,
      CUBEWARS_SERVER_PORT: String(SERVER_PORT),
      CUBEWARS_REDIS_URL: process.env.CUBEWARS_REDIS_URL || "redis://127.0.0.1:6379",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (b) => serverLog.push(b.toString()));
  server.stderr.on("data", (b) => serverLog.push(b.toString()));
  await waitForReady(server, "server", "listening on");

  const client = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
    {
      cwd: CLIENT_ROOT,
      env: {
        ...process.env,
        BROWSER: "none",
        VITE_CUBEWARS_WS_URL: WS_URL,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForReady(client, "client-vite", `http://127.0.0.1:${CLIENT_PORT}/`);
  return { server, client, serverLog };
}

function installWsTap(page) {
  return page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new Orig(...args);
      window.__epic39Tap = window.__epic39Tap || {
        welcomeId: null,
        lastPlayers: {},
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = { f001: {}, f002: {}, live: {}, consoleErrors: {} };

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
    console.log("[epic39-reverify] Part A: dual-equip opposite sides + dispose churn");
    selfcheckVite = await startSelfcheckVite();
    const pageA = await browser.newPage({ viewport: { width: 1200, height: 720 } });
    const errA = [];
    pageA.on("console", (m) => {
      if (m.type() === "error") errA.push(m.text());
    });
    pageA.on("pageerror", (e) => errA.push(`pageerror: ${e.message}`));

    await pageA.goto(SELFCHECK_URL, { waitUntil: "load", timeout: 30000 });
    await pageA.waitForFunction(() => window.__epic39Ready === true, { timeout: 15000 });

    const dualOpposite = await pageA.evaluate(() => window.__epic39rev.renderDualOpposite());
    await pageA.evaluate(() => window.__epic39rev.renderBack());
    await sleep(100);
    await pageA.screenshot({ path: join(OUT_DIR, "01-dual-dog-left-bird-right-back.png") });
    await pageA.evaluate(() => window.__epic39rev.renderFront());
    await sleep(100);
    await pageA.screenshot({ path: join(OUT_DIR, "02-dual-dog-left-bird-right-front.png") });

    const dualFlipped = await pageA.evaluate(() => window.__epic39rev.renderDualFlipped());
    await pageA.evaluate(() => window.__epic39rev.renderBack());
    await sleep(100);
    await pageA.screenshot({ path: join(OUT_DIR, "03-dual-cat-right-lion-left-back.png") });

    const afterChurn = await pageA.evaluate(() => window.__epic39rev.rebuildChurn(16));
    await pageA.evaluate(() => window.__epic39rev.renderBack());
    await sleep(100);
    await pageA.screenshot({ path: join(OUT_DIR, "04-after-dispose-churn-rebuild.png") });

    summary.f001 = { dualOpposite, dualFlipped };
    summary.f002 = { afterChurn, note: "rebuildChurn exercised disposeCompanionSubtree path; no console errors expected" };
    summary.consoleErrors.selfcheck = errA;

    const assertOpposite = (label, info) => {
      if (!info || !Array.isArray(info.companions) || info.companions.length !== 2) {
        failures.push(`${label}: expected 2 companions, got ${JSON.stringify(info)}`);
        return;
      }
      const xs = info.companions.map((c) => c.sideX);
      if (!(xs[0] < 0 && xs[1] > 0) && !(xs[0] > 0 && xs[1] < 0)) {
        failures.push(`${label}: sides not opposite (sideX=${JSON.stringify(xs)})`);
      }
      if (Math.abs(Math.abs(xs[0]) - 0.48) > 0.02 || Math.abs(Math.abs(xs[1]) - 0.48) > 0.02) {
        failures.push(`${label}: expected |sideX|≈0.48, got ${JSON.stringify(xs)}`);
      }
      if (xs[0] === xs[1]) failures.push(`${label}: stacked same sideX`);
    };

    assertOpposite("dualOpposite", dualOpposite);
    assertOpposite("dualFlipped", dualFlipped);
    assertOpposite("afterChurn", afterChurn);
    if (errA.length) failures.push(`selfcheck console errors: ${errA.join(" | ")}`);

    console.log("[epic39-reverify] dualOpposite:", JSON.stringify(dualOpposite));
    console.log("[epic39-reverify] dualFlipped:", JSON.stringify(dualFlipped));
    console.log("[epic39-reverify] afterChurn:", JSON.stringify(afterChurn));

    // ---------- Part B: light live regression — bots dual-equip opposite sides ----------
    console.log("[epic39-reverify] Part B: live bots dual-equip + move smoke");
    stack = await startStack();

    let uniqueDual = [];
    let errB = [];
    let pageB = null;
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (pageB) await pageB.close().catch(() => {});
      pageB = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      errB = [];
      pageB.on("console", (m) => {
        if (m.type() === "error") errB.push(m.text());
      });
      pageB.on("pageerror", (e) => errB.push(`pageerror: ${e.message}`));

      const botsNick = nick("R39");
      const botsEmail = `${botsNick.toLowerCase().replace(/[^a-z0-9]/g, "")}@example.com`;
      console.log(`[epic39-reverify] live attempt ${attempt} as ${botsNick}`);
      await registerAndContinue(pageB, botsEmail);
      await joinMode(pageB, botsNick, "modeBotsBtn");
      await sleep(1200);

      const dualFromTap = await pageB.evaluate(() => {
        const tap = window.__epic39Tap;
        if (!tap?.lastPlayers) return [];
        const out = [];
        for (const p of Object.values(tap.lastPlayers)) {
          const v = p.equippedPetsVisual;
          if (!Array.isArray(v) || v.length !== 2) continue;
          out.push({
            id: p.id,
            nickname: p.nickname,
            sides: [v[0].side, v[1].side],
            types: [v[0].type, v[1].type],
          });
        }
        return out;
      });
      uniqueDual = dualFromTap;
      if (uniqueDual.length > 0) break;
    }

    await pointerLock(pageB);
    await pageB.keyboard.down("KeyW");
    await sleep(700);
    await pageB.keyboard.up("KeyW");
    await pageB.screenshot({ path: join(OUT_DIR, "05-live-bots-move-smoke.png") });
    await pageB.keyboard.down("Space");
    await sleep(120);
    await pageB.screenshot({ path: join(OUT_DIR, "06-live-bots-jump-smoke.png") });
    await pageB.keyboard.up("Space");

    if (uniqueDual.length === 0) {
      failures.push(
        "live: no dual-equip equippedPetsVisual seen on any player (expected archetype D bots)",
      );
    } else {
      for (const s of uniqueDual) {
        if (s.sides[0] === s.sides[1]) {
          failures.push(`live dual-equip same side (F-001): ${JSON.stringify(s)}`);
        }
      }
      console.log("[epic39-reverify] live dual samples:", JSON.stringify(uniqueDual));
    }

    const serverJoined = stack.serverLog.join("");
    await writeFile(join(OUT_DIR, "server.log"), serverJoined);
    const botLoadoutLines = serverJoined
      .split("\n")
      .filter((l) => l.includes("loadout:") && l.includes("@c"));
    summary.live = {
      dualEquipSamples: uniqueDual,
      botLoadoutLines: botLoadoutLines.slice(0, 8),
      consoleErrors: errB.slice(0, 20),
    };
    if (errB.length) failures.push(`live console errors: ${errB.join(" | ")}`);
    await pageB.close().catch(() => {});
    await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));
    await writeFile(
      join(OUT_DIR, "playwright-run.log"),
      [
        `failures=${failures.length}`,
        ...failures.map((f) => `FAIL: ${f}`),
        failures.length ? "RESULT: FAIL" : "RESULT: ALL PASS",
      ].join("\n") + "\n",
    );

    if (failures.length) {
      console.error("[epic39-reverify] FAIL:");
      for (const f of failures) console.error(" -", f);
      process.exitCode = 1;
    } else {
      console.log("[epic39-reverify] ALL PASS");
    }
  } finally {
    await browser.close().catch(() => {});
    await stop(stack?.client);
    await stop(stack?.server);
    await stop(selfcheckVite);
    await rm(SELFCHECK_TEMP_HTML, { force: true });
  }
}

main().catch((err) => {
  console.error("[epic39-reverify] FATAL", err);
  process.exit(1);
});
