// Tester (Trusya) follow-up: correctly test grenade-launcher 1-hit finisher
// on a chipped target (fixes a weapon-cycle bookkeeping bug in the first
// pass of qa-epic10-tester-damage.mjs's TEST 3b -- that script accidentally
// fired pistol-then-rifle instead of rifle/pistol-then-GL due to a cycle-
// order miscalculation, though the damage numbers it got were internally
// consistent with 5/20 dmg either way).

import WebSocket from "ws";

const WS_URL = "ws://localhost:7777";
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function connectPuppet(label, mode) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { label, ws, playerId: null, messages: [], lastWorld: null };
    ws.on("message", (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      state.messages.push(msg);
      if (msg.type === "welcome") state.playerId = msg.playerId;
      if (msg.type === "world_state") state.lastWorld = msg;
    });
    ws.on("open", () => {
      const check = setInterval(() => {
        if (state.playerId) {
          clearInterval(check);
          ws.send(JSON.stringify({ type: "join", mode }));
          resolve(state);
        }
      }, 20);
      setTimeout(() => { clearInterval(check); if (!state.playerId) reject(new Error(`${label}: no welcome`)); }, 3000);
    });
    ws.on("error", reject);
  });
}
function send(state, msg) { state.ws.send(JSON.stringify(msg)); }
function findPlayer(state, id) { return state.lastWorld ? state.lastWorld.players.find((p) => p.id === id) ?? null : null; }
async function waitFor(fn, timeoutMs = 5000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const v = fn(); if (v) return v; await sleep(intervalMs); }
  return null;
}
async function walkTo(puppet, targetX, targetZ, opts = {}) {
  const arriveDist = opts.arriveDist ?? 1.2;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const me = findPlayer(puppet, puppet.playerId);
    if (!me) { await sleep(60); continue; }
    const dx = targetX - me.position.x, dz = targetZ - me.position.z;
    const dist = Math.hypot(dx, dz);
    const yaw = Math.atan2(-dx, -dz);
    if (dist <= arriveDist) { send(puppet, { type: "input", moveForward: 0, moveRight: 0, yaw, pitch: 0, jump: false }); return true; }
    send(puppet, { type: "input", moveForward: 1, moveRight: 0, yaw, pitch: 0, jump: false });
    await sleep(60);
  }
  return false;
}
function computeAim(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const dy = (to.y + 0.85) - (from.y + 1.7);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { yaw, pitch };
}
async function aimAndHold(shooter, targetId) {
  const me = findPlayer(shooter, shooter.playerId);
  const target = findPlayer(shooter, targetId);
  const { yaw, pitch } = computeAim(me.position, target.position);
  send(shooter, { type: "input", moveForward: 0, moveRight: 0, yaw, pitch, jump: false });
  await sleep(80);
}
async function fireOnce(shooter, cooldownMs) {
  send(shooter, { type: "fire" });
  await sleep(cooldownMs + 40);
}
function lastLoadout(state) {
  const l = state.messages.filter((m) => m.type === "loadout");
  return l[l.length - 1];
}
async function cycleTo(shooter, expectedWeapon, maxTries = 3) {
  for (let i = 0; i < maxTries; i++) {
    if (lastLoadout(shooter)?.equippedWeapon === expectedWeapon) return true;
    send(shooter, { type: "switch_weapon" });
    await sleep(200);
  }
  return lastLoadout(shooter)?.equippedWeapon === expectedWeapon;
}

async function main() {
  const shooter = await connectPuppet("shooter3b", "public");
  const victim = await connectPuppet("victim3b", "public");
  await waitFor(() => findPlayer(shooter, shooter.playerId) && findPlayer(shooter, victim.playerId));

  console.log("=== TEST 3b (fixed): GL 1-hit finisher on a chipped target ===");
  // Pick up rifle (tier1, auto-equips since starting weapon is pistol tier0).
  await walkTo(shooter, -42, 20, { arriveDist: 1.0, timeoutMs: 20000 });
  await sleep(400);
  console.log("loadout after rifle pickup:", lastLoadout(shooter));

  // Pick up GL too (tier2, auto-equips over rifle).
  await walkTo(shooter, 0, 0, { arriveDist: 1.0, timeoutMs: 20000 });
  await sleep(400);
  console.log("loadout after GL pickup:", lastLoadout(shooter));

  // Explicitly cycle to rifle: owned=[pistol,rifle,grenade_launcher], tier order.
  // Current = GL(idx2). One cycle -> pistol(idx0). Second cycle -> rifle(idx1).
  const gotRifle = await cycleTo(shooter, "rifle");
  console.log("cycled to rifle:", gotRifle, lastLoadout(shooter));
  if (!gotRifle) throw new Error("failed to cycle to rifle");

  let vp = findPlayer(shooter, victim.playerId).position;
  await walkTo(shooter, vp.x + 3, vp.z, { arriveDist: 2.0, timeoutMs: 20000 });
  await sleep(200);

  const before = findPlayer(shooter, victim.playerId);
  console.log("victim before chip:", before.health, before.armor, before.alive);

  // Chip with rifle (20 dmg) down below 70 remaining -- 2 rifle hits: 100->80->60.
  await aimAndHold(shooter, victim.playerId);
  await fireOnce(shooter, 280);
  console.log("victim after 1 rifle hit:", findPlayer(shooter, victim.playerId));
  await aimAndHold(shooter, victim.playerId);
  await fireOnce(shooter, 280);
  const chipped = findPlayer(shooter, victim.playerId);
  console.log("victim after 2 rifle hits (chipped, expect 60hp, alive):", chipped.health, chipped.armor, chipped.alive);

  if (!chipped.alive) throw new Error("victim died during chip phase -- adjust test");
  if (chipped.health > 70) throw new Error(`chip phase left ${chipped.health}hp, not under the 70-dmg GL finisher threshold`);

  // Switch to GL: rifle(idx1) -> GL(idx2), one cycle.
  const gotGl = await cycleTo(shooter, "grenade_launcher");
  console.log("cycled to GL:", gotGl, lastLoadout(shooter));
  if (!gotGl) throw new Error("failed to cycle to grenade_launcher");

  // Server's per-connection fire-cooldown gate uses the CURRENTLY EQUIPPED
  // weapon's cooldown against the last ACCEPTED fire regardless of which
  // weapon fired then (server/src/index.ts) -- switching to GL right after
  // a rifle shot means we must still wait out GL's full 1500ms cooldown
  // from that last shot, not fire immediately. Wait it out explicitly.
  await sleep(1700);
  await aimAndHold(shooter, victim.playerId);
  await fireOnce(shooter, 1550);
  const finished = findPlayer(shooter, victim.playerId);
  console.log(`victim after 1 GL finisher hit (chipped @ ${chipped.health}hp -> expect dead):`, finished.health, finished.armor, finished.alive);

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify({
    chippedHealth: chipped.health,
    chippedAlive: chipped.alive,
    finisherAlive: finished.alive,
    finisherHealth: finished.health,
  }, null, 2));

  shooter.ws.close();
  victim.ws.close();
  process.exit(0);
}

main().catch((err) => { console.error("FATAL", err); process.exit(1); });
