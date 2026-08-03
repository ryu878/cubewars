// EPIC 10 Programmer self-check (Pusya): NOT the formal Tester QA pass —
// a quick visual sanity/self-review before handoff, per the assignment's
// "actually LOOK at what you built" instruction. Captures viewmodel
// screenshots for all 3 weapons (idle + firing), world pickup shapes
// (rifle/GL/armor), a wood wall, a brick wall, the gradient sky, and runs a
// pistol-vs-pistol kill to confirm the new ~20-hit pistol TTK works and
// logs server-side hit/damage lines for cross-check.
//
// Reuses the navigation/puppet patterns established in
// scripts/qa-epic06-playwright.mjs (same pointer-lock/CDP movementX
// limitation applies: Page A's yaw stays fixed at spawn's yaw=0, i.e.
// facing world -z/"south" — navigation is via discrete WASD combinations
// relative to that fixed forward, not by turning).

import { chromium } from "playwright";
import WebSocket from "ws";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5173";
const WS_URL = "ws://localhost:7777";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-10-programmer-selfcheck";

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
          // Post-EPIC 9: every connection must "join" a mode before any
          // other gameplay message is accepted (server/src/index.ts
          // notJoinedDropTracker) — join the SAME "public" match pageA joins
          // below so puppets and pageA share one match.
          ws.send(JSON.stringify({ type: "join", mode: "public" }));
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

function regionOfX(x) {
  if (x <= -20) return "A";
  if (x >= 20) return "B";
  return "MID";
}

/**
 * The "MID" x-band (|x|<20) covers TWO disjoint reachable areas that are
 * NOT directly connected to each other: the mid lane (z in [-4,4]) and the
 * tunnel corridor (z in [12,20]) — the z in (4,12) strip between them is a
 * sealed, unreachable void (see shared/src/mapData.ts layout comment). A
 * naive "same x-region -> straight line" route (as an earlier version of
 * this script did) walks the player face-first into mid_wall_north/
 * divider_west_mid's corner and gets stuck there. z>8 unambiguously
 * distinguishes the two (partitions the void down the middle).
 */
function isTunnelColumn(x, z) {
  return regionOfX(x) === "MID" && z > 8;
}

function buildSafeRoute(startPos, targetX, targetZ) {
  const startRegion = startPos ? regionOfX(startPos.x) : "MID";
  const targetRegion = regionOfX(targetX);
  const waypoints = [];
  const targetInTunnel = isTunnelColumn(targetX, targetZ);
  const startInTunnel = startPos ? isTunnelColumn(startPos.x, startPos.z) : false;

  if (targetInTunnel && !startInTunnel) {
    // Tunnel-column targets are only reachable via a site's tunnel-entrance
    // gap (x=-20 or x=20, z in (12,20)) — always detour through Site A's
    // open interior, then cross into the tunnel column, regardless of
    // whether start/target both nominally read as "MID" by x alone.
    if (startPos && Math.abs(startPos.z) > 3) waypoints.push({ x: startPos.x, z: 0 });
    if (startRegion !== "A") waypoints.push({ x: 0, z: 3 });
    waypoints.push({ x: -24, z: 0 });
    waypoints.push({ x: -30, z: 16 });
    waypoints.push({ x: -18, z: 16 });
  } else if (startInTunnel && !targetInTunnel) {
    // Reverse: leave the tunnel column back through Site A into the mid lane/elsewhere.
    waypoints.push({ x: -30, z: 16 });
    waypoints.push({ x: -24, z: 0 });
    if (targetRegion !== "A") waypoints.push({ x: 0, z: 3 });
  } else if (startRegion !== targetRegion) {
    if (startPos && Math.abs(startPos.z) > 3) {
      waypoints.push({ x: startPos.x, z: 0 });
    }
    if ((startRegion === "A" && targetRegion === "B") || (startRegion === "B" && targetRegion === "A")) {
      waypoints.push({ x: 0, z: 3 });
      waypoints.push({ x: targetRegion === "A" ? -24 : 24, z: 0 });
    } else if (targetRegion !== "MID") {
      waypoints.push({ x: targetRegion === "A" ? -24 : 24, z: 0 });
    } else {
      waypoints.push({ x: 0, z: 0 });
    }
  }
  waypoints.push({ x: targetX, z: targetZ });
  return waypoints;
}

async function walkPuppetToViaPath(puppet, targetX, targetZ) {
  const me = findPlayer(puppet, puppet.playerId);
  const waypoints = buildSafeRoute(me ? me.position : null, targetX, targetZ);
  for (const wp of waypoints) {
    const arrived = await walkPuppetToWaypoint(puppet, wp.x, wp.z, { timeoutMs: 15000 });
    if (!arrived) console.warn(`[qa] walkPuppetToViaPath(${puppet.label}) stalled en route to waypoint`, wp);
  }
}

/** See scripts/qa-epic06-playwright.mjs's identical helper doc comment for the CDP pointer-lock movementX limitation this works around. */
async function walkPageATo(page, resolvePos, targetX, targetZ, fixedYaw, opts = {}) {
  const arriveDist = opts.arriveDist ?? 2.5;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const deadline = Date.now() + timeoutMs;
  const forwardX = -Math.sin(fixedYaw), forwardZ = -Math.cos(fixedYaw);
  const rightX = Math.cos(fixedYaw), rightZ = -Math.sin(fixedYaw);
  let arrived = false;
  let heldW = false, heldS = false, heldA = false, heldD = false;
  async function setKeys(w, s, a, d) {
    if (w !== heldW) { await (w ? page.keyboard.down("KeyW") : page.keyboard.up("KeyW")); heldW = w; }
    if (s !== heldS) { await (s ? page.keyboard.down("KeyS") : page.keyboard.up("KeyS")); heldS = s; }
    if (a !== heldA) { await (a ? page.keyboard.down("KeyA") : page.keyboard.up("KeyA")); heldA = a; }
    if (d !== heldD) { await (d ? page.keyboard.down("KeyD") : page.keyboard.up("KeyD")); heldD = d; }
  }
  while (Date.now() < deadline) {
    const me = resolvePos();
    if (!me) { await sleep(100); continue; }
    const dx = targetX - me.position.x;
    const dz = targetZ - me.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < arriveDist) { arrived = true; break; }
    const dirX = dx / dist, dirZ = dz / dist;
    const dotForward = dirX * forwardX + dirZ * forwardZ;
    const dotRight = dirX * rightX + dirZ * rightZ;
    const threshold = 0.25;
    await setKeys(dotForward > threshold, dotForward < -threshold, dotRight < -threshold, dotRight > threshold);
    await sleep(140);
  }
  await setKeys(false, false, false, false);
  return arrived;
}

async function walkPageAToViaPath(page, resolvePos, targetX, targetZ, fixedYaw, opts = {}) {
  const me = resolvePos();
  const waypoints = buildSafeRoute(me ? me.position : null, targetX, targetZ);
  let arrived = true;
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const isLast = i === waypoints.length - 1;
    const ok = await walkPageATo(page, resolvePos, wp.x, wp.z, fixedYaw, {
      timeoutMs: 25000,
      arriveDist: isLast ? (opts.arriveDist ?? 2.5) : 2.5,
    });
    if (!ok) console.warn(`[qa] walkPageAToViaPath stalled en route to waypoint`, wp);
    arrived = arrived && ok;
  }
  return arrived;
}

/** Poll the weapon HUD until it starts with the expected weapon name, up to timeoutMs — avoids racing a pickup's server round trip (proximity consumed server-side before the client's LoadoutMessage/HUD update has actually arrived). */
async function waitForHudWeapon(page, expectedPrefix, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let hud = "";
  while (Date.now() < deadline) {
    hud = await page.evaluate(() => document.getElementById("weaponHud")?.textContent ?? "");
    if (hud.startsWith(expectedPrefix)) return hud;
    await sleep(200);
  }
  return hud;
}

async function puppetKill(shooter, victim, opts = {}) {
  const maxShots = opts.maxShots ?? 25;
  const fireIntervalMs = opts.fireIntervalMs ?? 320;
  await walkPuppetToViaPath(victim, findPlayer(shooter, shooter.playerId).position.x, findPlayer(shooter, shooter.playerId).position.z - 4);
  await sleep(200);
  let shots = 0;
  for (let i = 0; i < maxShots; i++) {
    const sPos = findPlayer(shooter, shooter.playerId).position;
    const vPos = findPlayer(shooter, victim.playerId).position;
    const aim = computeAim(sPos, vPos);
    send(shooter, { type: "input", moveForward: 0, moveRight: 0, yaw: aim.yaw, pitch: aim.pitch, jump: false });
    await sleep(60);
    send(shooter, { type: "fire" });
    shots++;
    await sleep(fireIntervalMs);
    const v = findPlayer(shooter, victim.playerId);
    if (v && !v.alive) return { killed: true, shots };
  }
  return { killed: false, shots };
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

  // EPIC 9 Story 9.2: mode-select overlay blocks all input until a mode is
  // chosen — join "Multiplayer" (public) so the raw-WS puppets below (also
  // joining mode "public") land in the same match as Page A.
  await pageA.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await pageA.click("#modePublicBtn");
  await pageA.waitForTimeout(300);

  const box = await pageA.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await pageA.mouse.move(cx, cy);
  await pageA.mouse.down();
  await pageA.mouse.up();
  await pageA.waitForTimeout(300);
  const locked = await pageA.evaluate(() => document.pointerLockElement !== null);
  console.log("[qa] pointer locked:", locked);

  const observer = await connectPuppet("Observer");
  await sleep(300);
  function resolvePageAId() {
    const worldStates = observer.messages.filter((m) => m.type === "world_state");
    const last = worldStates[worldStates.length - 1];
    if (!last) return null;
    return last.players.find((p) => p.id.startsWith(shortIdA)) ?? null;
  }
  const pageAState = resolvePageAId();
  const pageAFixedYaw = pageAState?.yaw ?? 0;
  console.log("[qa] Page A fixed yaw for this session (should be ~0, facing -z):", pageAFixedYaw);

  // ---- 1. Pistol viewmodel, idle ----
  await pageA.waitForTimeout(600); // let idle sway animate a bit
  await pageA.screenshot({ path: `${OUT_DIR}/01-viewmodel-pistol-idle.png` });
  console.log("[qa] captured 01-viewmodel-pistol-idle.png");

  // ---- 2. Pistol fire (flash + recoil) ----
  await pageA.mouse.down();
  await pageA.mouse.up();
  await pageA.screenshot({ path: `${OUT_DIR}/02-viewmodel-pistol-fire.png` });
  console.log("[qa] captured 02-viewmodel-pistol-fire.png");
  await pageA.waitForTimeout(400);

  // ---- 3. World pickup: rifle (active, before consuming) ----
  console.log("\n[qa] walking to a vantage north of weapon_rifle_site_a for an active rifle-pickup shot...");
  await walkPageAToViaPath(pageA, resolvePageAId, -34, 24, pageAFixedYaw, { arriveDist: 1.5 });
  await walkPageATo(pageA, resolvePageAId, -42, 24, pageAFixedYaw, { arriveDist: 1.2, timeoutMs: 15000 });
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: `${OUT_DIR}/03-pickup-rifle-active.png` });
  console.log("[qa] captured 03-pickup-rifle-active.png (elongated rifle silhouette expected)");

  // Walk in to consume + equip the rifle.
  await walkPageAToViaPath(pageA, resolvePageAId, -42, 20, pageAFixedYaw, { arriveDist: 1.3 });
  const hudRifle = await waitForHudWeapon(pageA, "Rifle");
  console.log("[qa] weapon HUD after rifle pickup (waited for it to actually land):", hudRifle);

  // ---- 4. Rifle viewmodel idle + fire ----
  await pageA.screenshot({ path: `${OUT_DIR}/04-viewmodel-rifle-idle.png` });
  console.log("[qa] captured 04-viewmodel-rifle-idle.png");
  await pageA.mouse.down();
  await pageA.mouse.up();
  await pageA.screenshot({ path: `${OUT_DIR}/05-viewmodel-rifle-fire.png` });
  console.log("[qa] captured 05-viewmodel-rifle-fire.png");
  await pageA.waitForTimeout(400);

  // ---- 5. World pickup: grenade launcher (active, before consuming) ----
  console.log("\n[qa] walking to a vantage for an active GL-pickup shot (weapon_gl_mid at 0,0)...");
  await walkPageAToViaPath(pageA, resolvePageAId, 0, 6, pageAFixedYaw, { arriveDist: 1.5 });
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: `${OUT_DIR}/06-pickup-grenade-launcher-active.png` });
  console.log("[qa] captured 06-pickup-grenade-launcher-active.png (bulky GL silhouette expected)");

  await walkPageAToViaPath(pageA, resolvePageAId, 0, 0.5, pageAFixedYaw, { arriveDist: 1.3 });
  const hudGl = await waitForHudWeapon(pageA, "Grenade Launcher");
  console.log("[qa] weapon HUD after GL pickup (should auto-equip, tier2 > rifle tier1):", hudGl);

  // ---- 6. GL viewmodel idle + fire ----
  await pageA.screenshot({ path: `${OUT_DIR}/07-viewmodel-gl-idle.png` });
  console.log("[qa] captured 07-viewmodel-gl-idle.png");
  await pageA.mouse.down();
  await pageA.mouse.up();
  await pageA.screenshot({ path: `${OUT_DIR}/08-viewmodel-gl-fire.png` });
  console.log("[qa] captured 08-viewmodel-gl-fire.png");
  await pageA.waitForTimeout(1600); // GL cooldown before anything else fires it again

  // ---- 7. World pickup: armor (active) ----
  console.log("\n[qa] walking to a vantage near armor_tunnel_west (-10,16) for an active armor-pickup shot...");
  await walkPageAToViaPath(pageA, resolvePageAId, -10, 20, pageAFixedYaw, { arriveDist: 1.5 });
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: `${OUT_DIR}/09-pickup-armor-active.png` });
  console.log("[qa] captured 09-pickup-armor-active.png (hex plate + boss silhouette expected)");

  // ---- 8. Wood wall (mid_wall_south, facing south from inside the mid lane) ----
  console.log("\n[qa] walking into the mid lane to face mid_wall_south (wood texture)...");
  await walkPageAToViaPath(pageA, resolvePageAId, 2, 2, pageAFixedYaw, { arriveDist: 1.2 });
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: `${OUT_DIR}/10-wall-wood-mid_wall_south.png` });
  console.log("[qa] captured 10-wall-wood-mid_wall_south.png");

  // ---- 9. Brick wall (outer_south, facing south from inside Site A) + gradient sky visible in the same shot's upper half ----
  console.log("\n[qa] walking into Site A's open south area to face outer_south (brick texture)...");
  await walkPageAToViaPath(pageA, resolvePageAId, -34, -20, pageAFixedYaw, { arriveDist: 1.5 });
  await pageA.waitForTimeout(300);
  await pageA.screenshot({ path: `${OUT_DIR}/11-wall-brick-outer_south-and-sky.png` });
  console.log("[qa] captured 11-wall-brick-outer_south-and-sky.png (brick wall ahead, gradient sky in upper half)");

  // ---- 10. Empty-ammo viewmodel dimming: drain GL ammo (small cap, cheap to drain) ----
  console.log("\n[qa] draining GL ammo to 0 for the empty-viewmodel dim check...");
  {
    let empty = false;
    for (let i = 0; i < 8 && !empty; i++) {
      await pageA.mouse.down();
      await pageA.mouse.up();
      await sleep(1550); // GL cooldown 1500ms
      const isEmpty = await pageA.evaluate(() => document.getElementById("weaponHud")?.dataset.empty ?? "false");
      if (isEmpty === "true") empty = true;
    }
    await pageA.screenshot({ path: `${OUT_DIR}/12-viewmodel-gl-empty-dimmed.png` });
    console.log("[qa] captured 12-viewmodel-gl-empty-dimmed.png, empty reached:", empty);
  }

  console.log("[qa] Page A console errors so far:", consoleErrorsA.length);
  for (const e of consoleErrorsA) console.log("  -", e);

  // ---- 11. Regression: pistol-vs-pistol kill at the new ~20-hit TTK (raw-WS puppets, server-authoritative) ----
  console.log("\n[qa] staging a pistol-vs-pistol kill to confirm the new ~20-hit TTK and that damage/kill still works end to end...");
  const shooter = await connectPuppet("Shooter");
  const victim = await connectPuppet("Victim");
  await sleep(300);
  const killResult = await puppetKill(shooter, victim, { maxShots: 25, fireIntervalMs: 320 });
  console.log("[qa] pistol kill result:", killResult, "(expect killed=true, shots close to 20)");

  await browser.close();
  observer.ws.close();
  shooter.ws.close();
  victim.ws.close();

  console.log("\n[qa] === SUMMARY ===");
  console.log("hudRifle:", hudRifle);
  console.log("hudGl:", hudGl);
  console.log("pistol kill:", killResult);
  console.log("console errors:", consoleErrorsA.length);

  if (consoleErrorsA.length > 0 || !killResult.killed) {
    console.log("[qa] FAIL (see summary above)");
    process.exit(1);
  }
  console.log("[qa] PASS");
}

main().catch((err) => {
  console.error("[qa] script crashed:", err);
  process.exit(2);
});
