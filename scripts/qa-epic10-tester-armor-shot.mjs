// Tester (Trusya) minimal follow-up: get an ACTIVE (not-yet-consumed)
// armor pickup mesh screenshot from a safe vantage distance (previous
// attempt walked all the way onto the pickup point, consuming it before
// the screenshot).

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
  console.log(`[armor-shot] navigating to ${CLIENT_URL}`);
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const k of ["KeyW", "KeyS", "KeyA", "KeyD"]) await page.keyboard.up(k);

  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 10000 });
  const statusText = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const shortId = statusText.match(/player ([0-9a-f]{8})/)?.[1];
  console.log("[armor-shot] status:", statusText);

  await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await page.click("#modePublicBtn");
  await page.waitForTimeout(300);

  const box = await page.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);

  const observer = await connectPuppet("ObserverArmor");
  await sleep(300);
  function resolvePos() {
    const worldStates = observer.messages.filter((m) => m.type === "world_state");
    const last = worldStates[worldStates.length - 1];
    return last ? last.players.find((p) => p.id.startsWith(shortId)) ?? null : null;
  }
  const fixedYaw = resolvePos()?.yaw ?? 0;
  const spawnPos = resolvePos()?.position;
  console.log("[armor-shot] fixed yaw:", fixedYaw, "spawn pos:", spawnPos);

  // Camera yaw is fixed facing SOUTH (-z) all session (CDP pointer-lock
  // limitation) -- so the vantage point must be NORTH of the target for it
  // to appear in frame at all, not just "nearby". armor_tunnel_west is at
  // (-10,16); approach from (-10,19) (~3 units north, inside the tunnel
  // gap z in (12,20), outside PICKUP_RADIUS 1.5) facing south toward it.
  const legs = [
    { x: spawnPos.x, z: 0 },
    { x: -24, z: 0 },
    { x: -24, z: 19 },
    { x: -18, z: 19 },
    { x: -10, z: 19 },
  ];
  for (const wp of legs) {
    const ok = await walkPageATo(page, resolvePos, wp.x, wp.z, fixedYaw, { timeoutMs: 15000, arriveDist: 1.5 });
    const pos = resolvePos()?.position;
    console.log("[armor-shot] leg to", wp, "arrived=", ok, "pos=", pos && { x: pos.x.toFixed(1), z: pos.z.toFixed(1) });
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT_DIR}/10d-pickup-armor-active.png` });
  console.log("[armor-shot] captured 10d-pickup-armor-active.png (active, pre-consumption)");

  await browser.close();
  observer.ws.close();
  process.exit(0);
}
main().catch((err) => { console.error("[armor-shot] crashed:", err); process.exit(2); });
