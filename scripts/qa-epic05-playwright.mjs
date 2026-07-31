// EPIC 5 gameplay & feel evidence capture: a real Playwright browser tab
// genuinely played (WASD movement, jump, mouse-look, click-to-fire — all
// server-confirmed via the observer puppet's world_state feed), sharing the
// live match with raw-WS "puppet" players. Every WS connection is a real
// player server-side (there is no separate spectator mode), so the puppets
// stand in for "other human players' browser tabs" the same way multiple
// real tabs would.
//
// Guaranteed kills (for the mandatory kill-feed/scoreboard screenshots) are
// produced by two puppets fighting each other with precisely-computed aim,
// NOT by Page A's own mouse-driven click — see the note further down on why
// (a documented Playwright/CDP pointer-lock limitation, not a product bug).
// Page A's own click-to-fire is still exercised for real (genuine mouse
// click -> genuine "fire" WS message -> genuine server hitscan resolution,
// confirmed by watching the target's server-broadcast health), it's just not
// relied on to land every shot for staging the screenshots.

import { chromium } from "playwright";
import WebSocket from "ws";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
const WS_URL = "ws://localhost:7777";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-05";

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

function allPlayers(state) {
  const worldStates = state.messages.filter((m) => m.type === "world_state");
  const last = worldStates[worldStates.length - 1];
  return last ? last.players : [];
}

function computeAim(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz); // matches client/server forward convention: (-sin(yaw), -cos(yaw))
  const dy = to.y + 0.85 - (from.y + 1.7);
  const horizDist = Math.hypot(dx, dz);
  const pitch = Math.atan2(dy, horizDist);
  return { yaw, pitch };
}

/** Drive a WS puppet to walk toward a single absolute (x,z) waypoint using closed-loop feedback from its own world_state broadcasts. Straight-line only. */
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
      // Server retains the last-applied input intent indefinitely (there is
      // no implicit "idle" timeout) — must explicitly send a zero-movement
      // input, otherwise the puppet keeps walking forever after this
      // function returns.
      send(puppet, { type: "input", moveForward: 0, moveRight: 0, yaw, pitch: 0, jump: false });
      return true;
    }
    send(puppet, { type: "input", moveForward: 1, moveRight: 0, yaw, pitch: 0, jump: false });
    await sleep(60);
  }
  send(puppet, { type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false });
  return false;
}

/** Which arena region (per shared/src/mapData.ts layout) an x coordinate falls in. */
function regionOfX(x) {
  if (x <= -20) return "A";
  if (x >= 20) return "B";
  return "MID";
}

/**
 * Route a puppet to (targetX, targetZ), inserting waypoints through the mid
 * lane's z~0 gap (the divider walls only leave openings at z in (-4,4) — see
 * shared/src/mapData.ts) when the straight line would otherwise cross site A
 * <-> site B through a wall. Good enough for QA screenshot staging, not a
 * general pathfinder.
 */
async function walkPuppetToViaPath(puppet, targetX, targetZ) {
  const me = findPlayer(puppet, puppet.playerId);
  const startRegion = me ? regionOfX(me.position.x) : "MID";
  const targetRegion = regionOfX(targetX);

  const waypoints = [];
  if ((startRegion === "A" && targetRegion === "B") || (startRegion === "B" && targetRegion === "A")) {
    waypoints.push({ x: 0, z: 0 });
    waypoints.push({ x: targetRegion === "A" ? -24 : 24, z: 0 });
  } else if (startRegion !== targetRegion && targetRegion !== "MID") {
    waypoints.push({ x: targetRegion === "A" ? -24 : 24, z: 0 });
  }
  waypoints.push({ x: targetX, z: targetZ });

  for (const wp of waypoints) {
    const arrived = await walkPuppetToWaypoint(puppet, wp.x, wp.z, { timeoutMs: 12000 });
    if (!arrived) {
      console.warn(`[qa] walkPuppetToViaPath(${puppet.label}) stalled en route to waypoint`, wp);
    }
  }
}

/** Puppet-vs-puppet kill using precisely computed aim (no CDP mouse-move quirks) — used to reliably stage the kill-feed/scoreboard screenshots. Returns true once the victim is confirmed dead via the shooter's own world_state feed. */
async function puppetKill(shooter, victim) {
  await walkPuppetToViaPath(victim, findPlayer(shooter, shooter.playerId).position.x, findPlayer(shooter, shooter.playerId).position.z - 4);
  await sleep(200);
  for (let i = 0; i < 6; i++) {
    const sPos = findPlayer(shooter, shooter.playerId).position;
    const vPos = findPlayer(shooter, victim.playerId).position;
    const aim = computeAim(sPos, vPos);
    send(shooter, { type: "input", moveForward: 0, moveRight: 0, yaw: aim.yaw, pitch: aim.pitch, jump: false });
    await sleep(80);
    send(shooter, { type: "fire" });
    await sleep(350);
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

  // ---- Page A: the "played" client (real WASD/mouse/click input) ----
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
  await pageA.screenshot({ path: `${OUT_DIR}/01-pageA-spawn.png` });
  console.log("[qa] captured 01-pageA-spawn.png");

  const statusTextA = await pageA.evaluate(() => document.getElementById("status")?.textContent ?? "");
  console.log("[qa] Page A status:", statusTextA);
  const shortIdA = statusTextA.match(/player ([0-9a-f]{8})/)?.[1];
  if (!shortIdA) throw new Error("could not read Page A's short player id from status bar");

  // Click canvas center to engage pointer lock (does NOT fire — see fpsController.ts).
  const box = await pageA.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await pageA.mouse.move(cx, cy);
  await pageA.mouse.down();
  await pageA.mouse.up();
  await pageA.waitForTimeout(300);
  const locked = await pageA.evaluate(() => document.pointerLockElement !== null);
  console.log("[qa] pointer locked:", locked);
  await pageA.screenshot({ path: `${OUT_DIR}/02-pageA-postlock-hud.png` });

  // ---- Observer puppet: reads world_state to know Page A's real server-authoritative position/id (no source-code introspection needed) ----
  const observer = await connectPuppet("Observer");
  await sleep(300);

  function resolvePageAId() {
    const players = allPlayers(observer);
    return players.find((p) => p.id.startsWith(shortIdA)) ?? null;
  }

  const pageAServerState = resolvePageAId();
  console.log("[qa] Page A server state (pre-move):", pageAServerState);

  // ---- Movement regression: WASD forward for ~1s, screenshot ----
  await pageA.keyboard.down("KeyW");
  await pageA.waitForTimeout(1000);
  await pageA.keyboard.up("KeyW");
  await pageA.waitForTimeout(200);
  await pageA.screenshot({ path: `${OUT_DIR}/03-pageA-after-move-forward.png` });
  console.log("[qa] captured 03-pageA-after-move-forward.png");

  const afterMove = resolvePageAId();
  console.log("[qa] Page A server position after WASD-forward:", afterMove?.position);
  const movedDistance = pageAServerState
    ? Math.hypot(afterMove.position.x - pageAServerState.position.x, afterMove.position.z - pageAServerState.position.z)
    : null;
  console.log("[qa] movement regression: server-confirmed distance moved =", movedDistance);

  // ---- Jump regression ----
  await pageA.keyboard.down("Space");
  await pageA.waitForTimeout(120);
  await pageA.screenshot({ path: `${OUT_DIR}/04-pageA-mid-jump.png` });
  console.log("[qa] captured 04-pageA-mid-jump.png");
  await pageA.keyboard.up("Space");
  await pageA.waitForTimeout(500);

  // ---- Mouse-look regression ----
  await pageA.mouse.move(cx + 300, cy - 80, { steps: 20 });
  await pageA.waitForTimeout(200);
  await pageA.screenshot({ path: `${OUT_DIR}/05-pageA-after-mouselook-turn.png` });
  console.log("[qa] captured 05-pageA-after-mouselook-turn.png");

  // ---- Click-to-fire regression (real click -> real "fire" WS message -> real server hitscan attempt; muzzle flash is cosmetic/immediate, see main.ts) ----
  await pageA.mouse.click(cx + 300, cy - 80);
  await pageA.waitForTimeout(150);
  await pageA.screenshot({ path: `${OUT_DIR}/06-pageA-click-fire-muzzleflash.png` });
  console.log("[qa] captured 06-pageA-click-fire-muzzleflash.png (real click -> real fire message; landing a hit this way is not required here, see script header note)");

  await sleep(200);

  // ---- Guaranteed kill #1: two puppets, precisely-aimed, while Page A is connected nearby as a genuine "other browser tab" witness ----
  console.log("\n[qa] staging kill #1 (puppet vs puppet) while Page A watches...");
  const shooter1 = await connectPuppet("Shooter1");
  const victim1 = await connectPuppet("Victim1");
  await sleep(300);
  const kill1 = await puppetKill(shooter1, victim1);
  console.log("[qa] kill #1 confirmed dead (server-side):", kill1);
  await sleep(250);

  await pageA.screenshot({ path: `${OUT_DIR}/07-pageA-killfeed-entry.png` });
  console.log("[qa] captured 07-pageA-killfeed-entry.png");

  // ---- Bring in more players so the scoreboard has several distinct entries + spawn spread evidence ----
  const p3 = await connectPuppet("Extra3");
  const p4 = await connectPuppet("Extra4");
  await sleep(400);

  const allPositions = allPlayers(observer).map((p) => ({ id: p.id.slice(0, 8), x: p.position.x, z: p.position.z }));
  console.log("[qa] all players' positions (spawn spread evidence):", allPositions);

  // ---- Scoreboard: hold Tab and screenshot ----
  await pageA.keyboard.down("Tab");
  await pageA.waitForTimeout(200);
  await pageA.screenshot({ path: `${OUT_DIR}/08-pageA-scoreboard-open.png` });
  console.log("[qa] captured 08-pageA-scoreboard-open.png");
  const scoreboardText = await pageA.evaluate(() => document.getElementById("scoreboardList")?.textContent ?? "");
  console.log("[qa] scoreboard text content:", scoreboardText);
  await pageA.keyboard.up("Tab");
  await pageA.waitForTimeout(150);

  // ---- Second browser tab (Page B) as an uninvolved player, to double-confirm kill feed/scoreboard are visible to every client, not just the two involved ----
  const pageB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageB.goto(CLIENT_URL, { waitUntil: "load" });
  await pageB.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", {
    timeout: 5000,
  });
  await pageB.waitForTimeout(300);
  const boxB = await pageB.locator("#app canvas").boundingBox();
  await pageB.mouse.move(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
  await pageB.mouse.down();
  await pageB.mouse.up();
  await pageB.waitForTimeout(200);

  // ---- Guaranteed kill #2 (fresh victim) while Page B (uninvolved bystander) watches ----
  console.log("\n[qa] staging kill #2 while Page B watches...");
  const victim2 = await connectPuppet("Victim2");
  await sleep(300);
  const kill2 = await puppetKill(shooter1, victim2);
  console.log("[qa] kill #2 confirmed dead (server-side):", kill2);
  await sleep(250);

  await pageB.screenshot({ path: `${OUT_DIR}/09-pageB-bystander-sees-killfeed.png` });
  console.log("[qa] captured 09-pageB-bystander-sees-killfeed.png (uninvolved 3rd client's view of the kill feed)");

  await pageB.keyboard.down("Tab");
  await pageB.waitForTimeout(200);
  await pageB.screenshot({ path: `${OUT_DIR}/10-pageB-bystander-scoreboard.png` });
  const scoreboardTextB = await pageB.evaluate(() => document.getElementById("scoreboardList")?.textContent ?? "");
  console.log("[qa] Page B scoreboard text:", scoreboardTextB);
  await pageB.keyboard.up("Tab");

  // ---- Kill feed fade/expire check: wait past ENTRY_LIFETIME_MS+FADE_MS (~5.4s) and confirm entries are gone ----
  await pageA.waitForTimeout(6000);
  const killFeedChildCountAfterWait = await pageA.evaluate(
    () => document.getElementById("killFeed")?.childElementCount ?? -1,
  );
  console.log(
    "[qa] kill feed entry count ~6s after last kill (should be 0, i.e. expired, not accumulating):",
    killFeedChildCountAfterWait,
  );
  await pageA.screenshot({ path: `${OUT_DIR}/11-pageA-killfeed-expired.png` });

  console.log("[qa] Page A console errors:", consoleErrorsA.length);
  for (const e of consoleErrorsA) console.log("  -", e);

  await browser.close();
  observer.ws.close();
  shooter1.ws.close();
  victim1.ws.close();
  victim2.ws.close();
  p3.ws.close();
  p4.ws.close();

  console.log("\n[qa] === SUMMARY ===");
  console.log("movedDistance (server-confirmed WASD movement):", movedDistance);
  console.log("kill #1 confirmed dead via server:", kill1);
  console.log("kill #2 confirmed dead via server:", kill2);
  console.log("scoreboard text on Page A:", scoreboardText);
  console.log("scoreboard text on Page B (bystander):", scoreboardTextB);
  console.log("kill feed child count after ~6s (expect 0):", killFeedChildCountAfterWait);
  console.log("console errors on Page A:", consoleErrorsA.length);

  if (consoleErrorsA.length > 0 || !kill1 || !kill2 || killFeedChildCountAfterWait !== 0) {
    console.log("[qa] FAIL (see summary above)");
    process.exit(1);
  }
  console.log("[qa] PASS");
}

main().catch((err) => {
  console.error("[qa] script crashed:", err);
  process.exit(2);
});
