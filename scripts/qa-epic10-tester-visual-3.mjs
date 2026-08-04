// Tester (Trusya) minimal follow-up: get the armor-pickup world-mesh shot
// and a clean face-on wood-wall shot. Previous run (visual-2) got the
// puppet wedged in the Site A NW corner (outer_west x=-46 / outer_north
// z=26) after the rifle-fire test -- this run avoids that region entirely
// (stays well clear of z>20 and x<-40) and defensively clears all held
// keys at the very start in case of any key-state desync from a prior
// script/session.

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
  const timeoutMs = opts.timeoutMs ?? 18000;
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

async function main() {
  console.log(`[tester-qa3] navigating to ${CLIENT_URL}`);
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // Defensive: clear any stuck key state from the OS/browser before doing anything else.
  for (const k of ["KeyW", "KeyS", "KeyA", "KeyD"]) await page.keyboard.up(k);

  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 10000 });
  const statusText = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const shortId = statusText.match(/player ([0-9a-f]{8})/)?.[1];
  if (!shortId) throw new Error("could not read player short id");
  console.log("[tester-qa3] status:", statusText);

  await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await page.click("#modePublicBtn");
  await page.waitForTimeout(300);

  const box = await page.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);

  const observer = await connectPuppet("Observer3");
  await sleep(300);
  function resolvePos() {
    const worldStates = observer.messages.filter((m) => m.type === "world_state");
    const last = worldStates[worldStates.length - 1];
    return last ? last.players.find((p) => p.id.startsWith(shortId)) ?? null : null;
  }
  const fixedYaw = resolvePos()?.yaw ?? 0;
  const spawnPos = resolvePos()?.position;
  console.log("[tester-qa3] fixed yaw:", fixedYaw, "spawn pos:", spawnPos);

  // Route to armor_tunnel_west (-10,16), staying well clear of any wall
  // (never approaching z>20 or x<-40): align z=0 -> x=-24,z=0 -> x=-24,z=16
  // (open Site A interior column, no wall on this line) -> x=-18,z=16
  // (crossing the tunnel-entrance gap) -> x=-10,z=16 (target).
  const legs = [
    { x: spawnPos.x, z: 0 },
    { x: -24, z: 0 },
    { x: -24, z: 16 },
    { x: -18, z: 16 },
    { x: -10, z: 16 },
  ];
  for (const wp of legs) {
    const ok = await walkPageATo(page, resolvePos, wp.x, wp.z, fixedYaw, { timeoutMs: 15000, arriveDist: 2.0 });
    const pos = resolvePos()?.position;
    console.log("[tester-qa3] leg to", wp, "arrived=", ok, "pos=", pos && { x: pos.x.toFixed(1), z: pos.z.toFixed(1) });
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/10c-pickup-armor-active.png` });
  console.log("[tester-qa3] captured 10c-pickup-armor-active.png");

  // Route back to mid lane for a clean face-on wood-wall shot
  // (mid_wall_south, z=-4, ARENA_GEOMETRY index 10 = even = wood):
  // x=-18,z=16 -> x=-24,z=16 -> x=-24,z=0 -> x=-2,z=0 -> x=-2,z=2 (facing -z/south toward the wall).
  const legs2 = [
    { x: -18, z: 16 },
    { x: -24, z: 16 },
    { x: -24, z: 0 },
    { x: -2, z: 0 },
    { x: -2, z: 2 },
  ];
  for (const wp of legs2) {
    const ok = await walkPageATo(page, resolvePos, wp.x, wp.z, fixedYaw, { timeoutMs: 15000, arriveDist: 2.0 });
    const pos = resolvePos()?.position;
    console.log("[tester-qa3] leg to", wp, "arrived=", ok, "pos=", pos && { x: pos.x.toFixed(1), z: pos.z.toFixed(1) });
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/11c-wall-wood.png` });
  console.log("[tester-qa3] captured 11c-wall-wood.png");

  console.log("\n[tester-qa3] console errors:", consoleErrors.length);
  for (const e of consoleErrors) console.log("  -", e);

  await browser.close();
  observer.ws.close();
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ consoleErrorCount: consoleErrors.length }, null, 2));
  process.exit(0);
}

main().catch((err) => { console.error("[tester-qa3] crashed:", err); process.exit(2); });
