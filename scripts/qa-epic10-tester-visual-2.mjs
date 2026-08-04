// Tester (Trusya) follow-up run: the first visual pass
// (qa-epic10-tester-visual.mjs) got the shooter wedged into a wall corner
// while navigating Site A's crate maze via the generic diagonal
// buildSafeRoute() (the rifle pickup was never reached -- HUD stayed
// "Pistol" -- and every screenshot after the GL pickup shows the same
// frozen stuck corner). This script uses hand-picked, axis-only (never
// diagonal) waypoint chains specifically checked against
// shared/src/mapData.ts's ARENA_GEOMETRY box list to avoid clipping any
// crate/wall corner, to reliably reach: the rifle pickup (idle+fire), the
// armor pickup (world mesh shot), and a clean face-on wood-wall shot.

import { chromium } from "playwright";
import WebSocket from "ws";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
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

async function walkPageATo(page, resolvePos, targetX, targetZ, fixedYaw, opts = {}) {
  const arriveDist = opts.arriveDist ?? 2.0;
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

/** Walk a HAND-PICKED, axis-only waypoint chain (never diagonal -- avoids
 * cutting a crate/wall corner). Logs + retries a leg once if it fails to
 * arrive, rather than silently proceeding into a screenshot of nowhere. */
async function walkChain(page, resolvePos, fixedYaw, waypoints, label) {
  for (const wp of waypoints) {
    let ok = await walkPageATo(page, resolvePos, wp.x, wp.z, fixedYaw, { timeoutMs: 18000, arriveDist: 2.0 });
    if (!ok) {
      console.warn(`[tester-qa2] ${label}: retry leg`, wp);
      ok = await walkPageATo(page, resolvePos, wp.x, wp.z, fixedYaw, { timeoutMs: 12000, arriveDist: 2.5 });
    }
    const pos = resolvePos()?.position;
    console.log(`[tester-qa2] ${label}: leg to`, wp, "arrived=", ok, "actual pos=", pos && { x: pos.x.toFixed(1), z: pos.z.toFixed(1) });
  }
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
  console.log(`[tester-qa2] navigating to ${CLIENT_URL}`);
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 10000 });
  const statusText = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const shortId = statusText.match(/player ([0-9a-f]{8})/)?.[1];
  if (!shortId) throw new Error("could not read player short id");
  console.log("[tester-qa2] status:", statusText);

  await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await page.click("#modePublicBtn");
  await page.waitForTimeout(300);

  const box = await page.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);

  const observer = await connectPuppet("Observer2");
  await sleep(300);
  function resolvePos() {
    const worldStates = observer.messages.filter((m) => m.type === "world_state");
    const last = worldStates[worldStates.length - 1];
    return last ? last.players.find((p) => p.id.startsWith(shortId)) ?? null : null;
  }
  const fixedYaw = resolvePos()?.yaw ?? 0;
  const spawnPos = resolvePos()?.position;
  console.log("[tester-qa2] fixed yaw:", fixedYaw, "spawn pos:", spawnPos);

  // --- Cardinal-only route to weapon_rifle_site_a (-42, 20), checked
  // against ARENA_GEOMETRY to stay clear of every crate/wall corner:
  // 1) align z=0 at current x (mid gap is open for |z|<4)
  // 2) move along z=0 to x=-24 (through the mid-entrance gap at x=-20)
  // 3) move along x=-24 north to z=24 (clear column -- no Site A crate sits on x=-24 between z=0 and z=24: crate_a3 is at z=-14, off this range)
  // 4) move along z=24 west to x=-42 (clear row -- no crate at z~24)
  // 5) move south along x=-42 to z=20 (rifle pickup point)
  const toRifle = [
    { x: spawnPos.x, z: 0 },
    { x: -24, z: 0 },
    { x: -24, z: 24 },
    { x: -42, z: 24 },
    { x: -42, z: 20 },
  ];
  await walkChain(page, resolvePos, fixedYaw, toRifle, "-> rifle");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/04b-pickup-rifle-active.png` });
  console.log("[tester-qa2] captured 04b-pickup-rifle-active.png");

  const hudRifle = await waitForHudWeapon(page, "Rifle", 4000);
  console.log("[tester-qa2] HUD after rifle-pickup vantage:", hudRifle);
  if (!hudRifle.startsWith("Rifle")) {
    // Not yet close enough to consume -- nudge directly onto the point.
    await walkPageATo(page, resolvePos, -42, 20, fixedYaw, { arriveDist: 1.2, timeoutMs: 10000 });
    await sleep(300);
  }
  const hudRifle2 = await waitForHudWeapon(page, "Rifle", 4000);
  console.log("[tester-qa2] HUD after nudge-in:", hudRifle2);

  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/05b-rifle-idle.png` });
  await page.mouse.down();
  await page.mouse.up();
  await page.screenshot({ path: `${OUT_DIR}/06b-rifle-fire.png` });
  console.log("[tester-qa2] captured rifle idle/fire");
  await page.waitForTimeout(400);

  // --- Cardinal-only route to armor_tunnel_west (-10, 16):
  // 1) south along x=-42 to z=16
  // 2) east along z=16 to x=-18 (crosses the tunnel-entrance gap, x=-20, z in (12,20) -- z=16 is inside that gap)
  // 3) east along z=16 to x=-10 (armor point)
  const toArmor = [
    { x: -42, z: 16 },
    { x: -18, z: 16 },
    { x: -10, z: 16 },
  ];
  await walkChain(page, resolvePos, fixedYaw, toArmor, "-> armor");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/10b-pickup-armor-active.png` });
  console.log("[tester-qa2] captured 10b-pickup-armor-active.png");

  // --- Cardinal-only route back to the mid lane to face mid_wall_south (wood):
  // 1) west along z=16 back to x=-18 then -24 (leave tunnel column)
  // 2) south along x=-24 to z=0
  // 3) east along z=0 to x=-2 (mid lane open center, avoids crate_mid1 at (-8,-1.5)/crate_mid2 at (8,1.5) since path stays at z=0)
  const toMid = [
    { x: -18, z: 16 },
    { x: -24, z: 16 },
    { x: -24, z: 0 },
    { x: -2, z: 0 },
    { x: -2, z: 2 },
  ];
  await walkChain(page, resolvePos, fixedYaw, toMid, "-> mid lane wood wall");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/11b-wall-wood.png` });
  console.log("[tester-qa2] captured 11b-wall-wood.png");

  console.log("\n[tester-qa2] console errors:", consoleErrors.length);
  for (const e of consoleErrors) console.log("  -", e);

  await browser.close();
  observer.ws.close();

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ hudRifle: hudRifle2, consoleErrorCount: consoleErrors.length }, null, 2));
  process.exit(0);
}

main().catch((err) => { console.error("[tester-qa2] crashed:", err); process.exit(2); });
