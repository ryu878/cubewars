// Tester (Trusya) independent visual QA for EPIC 10. Own script (not a
// re-run of scripts/qa-epic10-programmer-selfcheck.mjs), reusing only the
// proven navigation-math patterns already established in that script and
// scripts/qa-epic06-playwright.mjs (documented CDP pointer-lock movementX
// limitation: Page A's yaw stays fixed at spawn yaw=0, "south"/-z facing;
// navigation is via WASD relative to that fixed forward).
//
// Captures: pistol/rifle/GL viewmodel idle + fire (for a direct pistol-vs-
// rifle visual comparison, the weakest distinction Programmer flagged),
// idle-sway sequence (4 frames over ~1.2s while moving, to actually SEE
// animation, not just one static frame), empty-viewmodel dimming, world
// pickup shapes (rifle/GL/armor at play distance), a wood wall, a brick
// wall + sky gradient, and a light regression pass (movement, jump, HUD).

import { chromium } from "playwright";
import WebSocket from "ws";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5173";
const WS_URL = "ws://localhost:7777";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-10-tester";

await mkdir(OUT_DIR, { recursive: true });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function connectPuppet(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { label, ws, playerId: null, messages: [] };
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      state.messages.push(msg);
      if (msg.type === "welcome") state.playerId = msg.playerId;
    });
    ws.on("open", () => {
      const check = setInterval(() => {
        if (state.playerId) { clearInterval(check); ws.send(JSON.stringify({ type: "join", mode: "public" })); resolve(state); }
      }, 20);
      setTimeout(() => { clearInterval(check); if (!state.playerId) reject(new Error(`${label}: no welcome`)); }, 3000);
    });
    ws.on("error", reject);
  });
}
function findPlayer(state, id) {
  const worldStates = state.messages.filter((m) => m.type === "world_state");
  const last = worldStates[worldStates.length - 1];
  return last ? last.players.find((p) => p.id === id) ?? null : null;
}

function regionOfX(x) { if (x <= -20) return "A"; if (x >= 20) return "B"; return "MID"; }
function isTunnelColumn(x, z) { return regionOfX(x) === "MID" && z > 8; }
function buildSafeRoute(startPos, targetX, targetZ) {
  const startRegion = startPos ? regionOfX(startPos.x) : "MID";
  const targetRegion = regionOfX(targetX);
  const waypoints = [];
  const targetInTunnel = isTunnelColumn(targetX, targetZ);
  const startInTunnel = startPos ? isTunnelColumn(startPos.x, startPos.z) : false;
  if (targetInTunnel && !startInTunnel) {
    if (startPos && Math.abs(startPos.z) > 3) waypoints.push({ x: startPos.x, z: 0 });
    if (startRegion !== "A") waypoints.push({ x: 0, z: 3 });
    waypoints.push({ x: -24, z: 0 });
    waypoints.push({ x: -30, z: 16 });
    waypoints.push({ x: -18, z: 16 });
  } else if (startInTunnel && !targetInTunnel) {
    waypoints.push({ x: -30, z: 16 });
    waypoints.push({ x: -24, z: 0 });
    if (targetRegion !== "A") waypoints.push({ x: 0, z: 3 });
  } else if (startRegion !== targetRegion) {
    if (startPos && Math.abs(startPos.z) > 3) waypoints.push({ x: startPos.x, z: 0 });
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
    const dx = targetX - me.position.x, dz = targetZ - me.position.z;
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
    const ok = await walkPageATo(page, resolvePos, wp.x, wp.z, fixedYaw, { timeoutMs: 25000, arriveDist: isLast ? (opts.arriveDist ?? 2.5) : 2.5 });
    if (!ok) console.warn(`[tester-qa] stalled en route to waypoint`, wp);
    arrived = arrived && ok;
  }
  return arrived;
}

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

async function main() {
  console.log(`[tester-qa] navigating to ${CLIENT_URL}`);
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });

  const statusText = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const shortId = statusText.match(/player ([0-9a-f]{8})/)?.[1];
  if (!shortId) throw new Error("could not read player short id from status bar");
  console.log("[tester-qa] status:", statusText);

  await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await page.click("#modePublicBtn");
  await page.waitForTimeout(300);
  console.log("[tester-qa] mode-select: joined Multiplayer (public) via #modePublicBtn");

  const box = await page.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  console.log("[tester-qa] pointer locked:", locked);

  const observer = await connectPuppet("Observer");
  await sleep(300);
  function resolvePos() {
    const worldStates = observer.messages.filter((m) => m.type === "world_state");
    const last = worldStates[worldStates.length - 1];
    return last ? last.players.find((p) => p.id.startsWith(shortId)) ?? null : null;
  }
  const fixedYaw = resolvePos()?.yaw ?? 0;
  console.log("[tester-qa] fixed yaw:", fixedYaw);

  const shots = {};
  function note(name) { shots[name] = `${OUT_DIR}/${name}.png`; }

  // --- 1. Pistol viewmodel idle (baseline reference) ---
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT_DIR}/01-pistol-idle.png` });
  note("01-pistol-idle");

  // --- 2. Idle-sway sequence: 4 frames while standing still, ~350ms apart,
  // to directly compare and confirm the viewmodel visibly moves (not just
  // "code exists"). ---
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${OUT_DIR}/02-sway-frame-${i}.png` });
  }
  console.log("[tester-qa] captured 4 idle-sway frames (02-sway-frame-0..3.png)");

  // --- 3. Pistol fire (flash + recoil) ---
  await page.mouse.down();
  await page.mouse.up();
  await page.screenshot({ path: `${OUT_DIR}/03-pistol-fire.png` });
  note("03-pistol-fire");
  await page.waitForTimeout(400);

  // --- 4. Rifle pickup (active, at play distance) then equip ---
  console.log("\n[tester-qa] -> rifle pickup vantage");
  await walkPageAToViaPath(page, resolvePos, -34, 24, fixedYaw, { arriveDist: 1.5 });
  await walkPageATo(page, resolvePos, -42, 24, fixedYaw, { arriveDist: 1.2, timeoutMs: 15000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/04-pickup-rifle-active.png` });
  note("04-pickup-rifle-active");

  await walkPageAToViaPath(page, resolvePos, -42, 20, fixedYaw, { arriveDist: 1.3 });
  const hudRifle = await waitForHudWeapon(page, "Rifle");
  console.log("[tester-qa] HUD after rifle pickup:", hudRifle);

  // --- 5. Rifle viewmodel idle + fire (KEY comparison target vs. pistol) ---
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/05-rifle-idle.png` });
  note("05-rifle-idle");
  await page.mouse.down();
  await page.mouse.up();
  await page.screenshot({ path: `${OUT_DIR}/06-rifle-fire.png` });
  note("06-rifle-fire");
  await page.waitForTimeout(400);

  // --- 6. GL pickup (active) then equip ---
  console.log("\n[tester-qa] -> GL pickup vantage");
  await walkPageAToViaPath(page, resolvePos, 0, 6, fixedYaw, { arriveDist: 1.5 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/07-pickup-gl-active.png` });
  note("07-pickup-gl-active");

  await walkPageAToViaPath(page, resolvePos, 0, 0.5, fixedYaw, { arriveDist: 1.3 });
  const hudGl = await waitForHudWeapon(page, "Grenade Launcher");
  console.log("[tester-qa] HUD after GL pickup:", hudGl);

  // --- 7. GL viewmodel idle + fire ---
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/08-gl-idle.png` });
  note("08-gl-idle");
  await page.mouse.down();
  await page.mouse.up();
  await page.screenshot({ path: `${OUT_DIR}/09-gl-fire.png` });
  note("09-gl-fire");
  await page.waitForTimeout(1600);

  // --- 8. Armor pickup (active) ---
  console.log("\n[tester-qa] -> armor pickup vantage");
  await walkPageAToViaPath(page, resolvePos, -10, 20, fixedYaw, { arriveDist: 1.5 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/10-pickup-armor-active.png` });
  note("10-pickup-armor-active");

  // --- 9. Wood wall (mid_wall_south) ---
  console.log("\n[tester-qa] -> mid lane wood wall vantage");
  await walkPageAToViaPath(page, resolvePos, 2, 2, fixedYaw, { arriveDist: 1.2 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/11-wall-wood.png` });
  note("11-wall-wood");

  // --- 10. Brick wall + sky gradient ---
  console.log("\n[tester-qa] -> Site A brick wall + sky vantage");
  await walkPageAToViaPath(page, resolvePos, -34, -20, fixedYaw, { arriveDist: 1.5 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT_DIR}/12-wall-brick-and-sky.png` });
  note("12-wall-brick-and-sky");

  // --- 11. Look up for a clean sky-only gradient shot ---
  // Small mouse move to pitch the camera upward, away from any wall geometry.
  await page.mouse.move(cx, cy - 250, { steps: 8 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT_DIR}/13-sky-lookup.png` });
  note("13-sky-lookup");
  await page.mouse.move(cx, cy + 250, { steps: 8 }); // restore pitch
  await page.waitForTimeout(200);

  // --- 12. Empty-ammo viewmodel dimming: drain GL ammo (small cap: 2 after one pickup) ---
  console.log("\n[tester-qa] draining GL ammo for the empty-viewmodel dim check...");
  let empty = false;
  for (let i = 0; i < 6 && !empty; i++) {
    await page.mouse.down();
    await page.mouse.up();
    await sleep(1550);
    const isEmpty = await page.evaluate(() => document.getElementById("weaponHud")?.dataset.empty ?? "false");
    if (isEmpty === "true") empty = true;
  }
  await page.screenshot({ path: `${OUT_DIR}/14-gl-empty-dimmed.png` });
  note("14-gl-empty-dimmed");
  console.log("[tester-qa] empty reached:", empty);

  // --- 13. Light regression: movement + jump ---
  console.log("\n[tester-qa] regression: movement + jump");
  const posBeforeMove = resolvePos()?.position;
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(700);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(150);
  const posAfterMove = resolvePos()?.position;
  const moveDist = posBeforeMove && posAfterMove
    ? Math.hypot(posAfterMove.x - posBeforeMove.x, posAfterMove.z - posBeforeMove.z)
    : 0;
  console.log("[tester-qa] movement distance over 700ms W-hold:", moveDist.toFixed(2));

  await page.screenshot({ path: `${OUT_DIR}/15-regression-movement.png` });
  note("15-regression-movement");

  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT_DIR}/16-regression-jump-midair.png` });
  note("16-regression-jump-midair");
  await page.waitForTimeout(600);

  console.log("\n[tester-qa] console errors so far:", consoleErrors.length);
  for (const e of consoleErrors) console.log("  -", e);

  await browser.close();
  observer.ws.close();

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({
    hudRifle, hudGl, emptyReached: empty, moveDist, consoleErrorCount: consoleErrors.length, screenshots: shots,
  }, null, 2));

  process.exit(consoleErrors.length > 0 ? 1 : 0);
}

main().catch((err) => { console.error("[tester-qa] script crashed:", err); process.exit(2); });
