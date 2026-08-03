// EPIC 8 gameplay & feel evidence capture: a real Playwright browser tab
// (Page A) genuinely played -- pointer-locked, WASD-walked, jumped (normal
// and boosted bunny-hop) -- alongside raw-WS "puppet" players standing in
// for other human browser tabs, following the exact pattern established in
// scripts/qa-epic05-playwright.mjs / scripts/qa-epic06-playwright.mjs.
//
// Captures: baseline position, post-movement position (new ~6.65 speed),
// normal-jump apex vantage, boosted-jump apex vantage (same fixed vantage
// point near a tall wall so the camera-height difference is visible via
// parallax, since pitch is fixed at 0 -- see the KNOWN ENVIRONMENT
// LIMITATION note below, carried from EPIC 6's script), plus a light
// regression pass (shoot/hit, kill feed, health/armor pickup HUD).

import { chromium } from "playwright";
import WebSocket from "ws";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
const WS_URL = "ws://localhost:7777";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-08";

await mkdir(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connectPuppet(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
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

function send(state, msg) {
  state.ws.send(JSON.stringify(msg));
}

function findPlayer(state, id) {
  const worldStates = state.messages.filter((m) => m.type === "world_state");
  const last = worldStates[worldStates.length - 1];
  if (!last) return null;
  return last.players.find((p) => p.id === id) ?? null;
}

function computeAim(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const dy = to.y + 0.85 - (from.y + 1.7);
  const horizDist = Math.hypot(dx, dz);
  const pitch = Math.atan2(dy, horizDist);
  return { yaw, pitch };
}

async function walkPuppetToWaypoint(puppet, targetX, targetZ, opts = {}) {
  const arriveDist = opts.arriveDist ?? 1.2;
  const timeoutMs = opts.timeoutMs ?? 12000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const me = findPlayer(puppet, puppet.playerId);
    if (!me) {
      await sleep(60);
      continue;
    }
    const dx = targetX - me.position.x;
    const dz = targetZ - me.position.z;
    const dist = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    if (dist <= arriveDist) {
      send(puppet, { type: "input", moveForward: 0, moveRight: 0, yaw, pitch: 0, jump: false });
      return true;
    }
    send(puppet, { type: "input", moveForward: 1, moveRight: 0, yaw, pitch: 0, jump: false });
    await sleep(60);
  }
  send(puppet, { type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false });
  return false;
}

/** Puppet-vs-puppet kill using precisely computed aim (regression check for EPIC 4/5, unaffected by EPIC 8's movement-only scope). */
async function puppetKill(shooter, victim, opts = {}) {
  const maxShots = opts.maxShots ?? 10;
  const fireIntervalMs = opts.fireIntervalMs ?? 350;
  await walkPuppetToWaypoint(victim, findPlayer(shooter, shooter.playerId).position.x, findPlayer(shooter, shooter.playerId).position.z - 4);
  await sleep(200);
  for (let i = 0; i < maxShots; i++) {
    const sPos = findPlayer(shooter, shooter.playerId).position;
    const vPos = findPlayer(shooter, victim.playerId).position;
    const aim = computeAim(sPos, vPos);
    send(shooter, { type: "input", moveForward: 0, moveRight: 0, yaw: aim.yaw, pitch: aim.pitch, jump: false });
    await sleep(80);
    send(shooter, { type: "fire" });
    await sleep(fireIntervalMs);
    const v = findPlayer(shooter, victim.playerId);
    if (v && !v.alive) return true;
  }
  return false;
}

async function main() {
  console.log(`[qa] navigating to ${CLIENT_URL}`);

  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });

  const pageA = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrorsA = [];
  pageA.on("console", (msg) => {
    if (msg.type() === "error") consoleErrorsA.push(msg.text());
  });
  pageA.on("pageerror", (err) => consoleErrorsA.push(`pageerror: ${err.message}`));

  await pageA.goto(CLIENT_URL, { waitUntil: "load" });
  await pageA.waitForTimeout(1000);
  await pageA.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", {
    timeout: 5000,
  });

  const statusTextA = await pageA.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const shortIdA = statusTextA.match(/player ([0-9a-f]{8})/)?.[1];
  if (!shortIdA) throw new Error("could not read Page A's short player id from status bar");
  console.log("[qa] Page A status:", statusTextA);

  const box = await pageA.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await pageA.mouse.move(cx, cy);
  await pageA.mouse.down();
  await pageA.mouse.up();
  await pageA.waitForTimeout(300);
  const locked = await pageA.evaluate(() => document.pointerLockElement !== null);
  console.log("[qa] pointer locked:", locked);

  await pageA.screenshot({ path: `${OUT_DIR}/01-initial-spawn.png` });
  console.log("[qa] captured 01-initial-spawn.png");

  // ---- Observer puppet: reads world_state to resolve Page A's server-authoritative id/position ----
  const observer = await connectPuppet("Observer");
  await sleep(300);
  function resolvePageA() {
    const worldStates = observer.messages.filter((m) => m.type === "world_state");
    const last = worldStates[worldStates.length - 1];
    if (!last) return null;
    return last.players.find((p) => p.id.startsWith(shortIdA)) ?? null;
  }
  const startState = resolvePageA();
  console.log("[qa] Page A server state at start:", startState);
  const pageAFixedYaw = startState?.yaw ?? 0;
  console.log("[qa] Page A fixed yaw (KNOWN LIMITATION: CDP synthetic pointer-lock mouse-move doesn't produce movementX in this sandbox, same as EPIC 5/6 QA runs -- yaw stays fixed at spawn value, navigation done via WASD-only relative to it):", pageAFixedYaw);

  // ---- Story 8.1: base speed evidence -- hold forward (real WASD keydown), measure real displacement over a real elapsed time ----
  console.log("\n[qa] holding W for 1000ms (real keydown), measuring real displacement for the new ~6.65 m/s speed...");
  const beforeMove = resolvePageA();
  const t0 = Date.now();
  await pageA.keyboard.down("KeyW");
  await sleep(1000);
  await pageA.keyboard.up("KeyW");
  const keyReleaseElapsed = (Date.now() - t0) / 1000; // measured across the actual held-key window only, not the settle wait below
  await sleep(200); // let the final world_state broadcast (post-release) arrive before reading position
  const afterMove = resolvePageA();
  const dist = Math.hypot(afterMove.position.x - beforeMove.position.x, afterMove.position.z - beforeMove.position.z);
  const elapsed = keyReleaseElapsed;
  console.log(`[qa] measured: dist=${dist.toFixed(3)}m over the ~${elapsed.toFixed(3)}s held-key window -> ~${(dist / elapsed).toFixed(3)} m/s (expect ~6.65, old baseline was 5)`);
  await pageA.screenshot({ path: `${OUT_DIR}/02-after-forward-movement.png` });
  console.log("[qa] captured 02-after-forward-movement.png");

  // ---- Position Page A a few units short of the south wall for jump-height parallax comparison ----
  // outer_south wall (z=-26, height 4) gives strong vertical parallax cues as
  // camera height changes (pitch stays 0/level throughout, per the CDP
  // limitation above): stopping SHORT of the wall (not walking into it) keeps
  // it framed in view rather than filling the whole screen with a flat
  // texture close-up, so the apex screenshots below show a real height cue
  // (wall's visible top edge/skyline shifts down-frame as the camera rises).
  console.log("\n[qa] walking Page A to a vantage a few units short of the south wall...");
  const WALL_STANDOFF_TARGET_Z = -21; // outer_south wall face is ~-25.6 (bounds -26 +-0.5, +radius 0.4); stop ~4.6 units short
  {
    const deadline = Date.now() + 8000;
    let arrived = false;
    while (Date.now() < deadline && !arrived) {
      const me = resolvePageA();
      if (!me) { await sleep(80); continue; }
      if (me.position.z <= WALL_STANDOFF_TARGET_Z) { arrived = true; break; }
      await pageA.keyboard.down("KeyW");
      await sleep(120);
      await pageA.keyboard.up("KeyW");
      await sleep(60);
    }
  }
  const nearWallState = resolvePageA();
  console.log("[qa] Page A vantage position (short of wall):", nearWallState?.position);
  await pageA.screenshot({ path: `${OUT_DIR}/03-vantage-before-jump.png` });
  console.log("[qa] captured 03-vantage-before-jump.png (grounded baseline vantage, wall framed ahead)");

  // ---- Story 8.2: normal single jump (unchanged baseline apex ~0.855) ----
  // Dynamically poll for the true apex (y stops increasing) rather than a
  // fixed guessed delay, so the screenshot lands exactly at peak height
  // regardless of small timing jitter between this script and the physics tick.
  async function pollForApex(maxWaitMs) {
    let bestY = -Infinity;
    let bestState = null;
    const deadline = Date.now() + maxWaitMs;
    let sawDescent = false;
    while (Date.now() < deadline && !sawDescent) {
      const s = resolvePageA();
      if (s) {
        if (s.position.y > bestY) {
          bestY = s.position.y;
          bestState = s;
        } else if (s.position.y < bestY - 0.005) {
          sawDescent = true;
        }
      }
      await sleep(25);
    }
    return bestState;
  }

  console.log("\n[qa] pressing Space once (normal jump), polling for true apex...");
  await pageA.keyboard.down("Space");
  await sleep(80);
  await pageA.keyboard.up("Space");
  const normalJumpState = await pollForApex(900);
  console.log("[qa] Page A y at normal-jump apex:", normalJumpState?.position?.y, "(expect ~0.855)");
  await pageA.screenshot({ path: `${OUT_DIR}/04-normal-jump-apex.png` });
  console.log("[qa] captured 04-normal-jump-apex.png");
  await sleep(1000); // let land fully before next test

  // ---- Story 8.2: bunny-hop boosted jump (genuine second Space press mid-air) ----
  console.log("\n[qa] pressing Space (jump), then a genuine second Space press mid-air (boost), polling for the true (higher) boosted apex...");
  await pageA.keyboard.down("Space");
  await sleep(80);
  await pageA.keyboard.up("Space");
  await sleep(150); // airborne
  await pageA.keyboard.down("Space"); // genuine second press = boost trigger
  await sleep(60);
  await pageA.keyboard.up("Space");
  const boostedJumpState = await pollForApex(1200);
  console.log("[qa] Page A y at boosted-jump apex:", boostedJumpState?.position?.y, "(compare to normal jump apex:", normalJumpState?.position?.y, "-- expect notably higher)");
  await pageA.screenshot({ path: `${OUT_DIR}/05-boosted-jump-apex.png` });
  console.log("[qa] captured 05-boosted-jump-apex.png (compare vantage/parallax to 04-normal-jump-apex.png -- should read visibly higher)");
  await sleep(1200); // let land

  // ---- Regression: EPIC 4/5 shoot + kill feed still functional (movement-adjacent code touched by EPIC 8 could plausibly regress this) ----
  console.log("\n[qa] regression: staging a puppet-vs-puppet kill to confirm shooting/kill-feed/scoreboard still work...");
  const shooter = await connectPuppet("Shooter");
  const victim = await connectPuppet("Victim");
  await sleep(300);
  const killed = await puppetKill(shooter, victim, { maxShots: 6, fireIntervalMs: 350 });
  console.log("[qa] regression kill confirmed dead (server-side):", killed);
  await sleep(300);
  await pageA.screenshot({ path: `${OUT_DIR}/06-regression-killfeed-scoreboard.png` });
  console.log("[qa] captured 06-regression-killfeed-scoreboard.png");

  // ---- Regression: EPIC 7 health/armor pickup HUD still functional ----
  console.log("\n[qa] regression: walking Page A toward health_site_a/health_site_b or armor pickups to confirm HUD armor/health still reflect pickups...");
  {
    const me = resolvePageA();
    const targetX = me.position.x < 0 ? -42 : 42; // nearest health pickup column
    const deadline = Date.now() + 10000;
    // crude straight walk attempt (fixed yaw, so only works if roughly aligned; best-effort regression check, not the primary EPIC 8 evidence)
    await pageA.keyboard.down("KeyW");
    await sleep(2500);
    await pageA.keyboard.up("KeyW");
  }
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: `${OUT_DIR}/07-regression-hud-after-more-movement.png` });
  console.log("[qa] captured 07-regression-hud-after-more-movement.png");

  console.log("[qa] Page A console errors:", consoleErrorsA.length);
  for (const e of consoleErrorsA) console.log("  -", e);

  await browser.close();
  observer.ws.close();
  shooter.ws.close();
  victim.ws.close();

  console.log("\n[qa] === SUMMARY ===");
  console.log("measured forward speed (m/s):", (dist / elapsed).toFixed(3));
  console.log("normal jump apex y:", normalJumpState?.position?.y);
  console.log("boosted jump apex y:", boostedJumpState?.position?.y);
  console.log("regression kill confirmed:", killed);
  console.log("console errors:", consoleErrorsA.length);

  if (consoleErrorsA.length > 0 || !killed) {
    console.log("[qa] FAIL (see summary above)");
    process.exit(1);
  }
  console.log("[qa] PASS");
}

main().catch((err) => {
  console.error("[qa] script crashed:", err);
  process.exit(2);
});
