// Tester (Trusya): confirm EPIC 7 armor-absorbs-first math still works
// correctly at EPIC 10's new lower damage values. Victim walks to an armor
// pickup (+25 armor per pickup, up to 2 pickups = 50 armor here, since only
// two armor spawn points exist close together), shooter (pistol, 5 dmg)
// fires enough shots to drain armor then verify spillover onto health.

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
        if (state.playerId) { clearInterval(check); ws.send(JSON.stringify({ type: "join", mode })); resolve(state); }
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
async function fireOnce(shooter, cooldownMs) { send(shooter, { type: "fire" }); await sleep(cooldownMs + 40); }

// Multi-waypoint routing (map has disconnected regions -- a naive straight
// line can walk a puppet face-first into a wall corner and get stuck; see
// scripts/qa-epic10-programmer-selfcheck.mjs's identical buildSafeRoute()
// doc comment for the map-layout reasoning this is based on).
function regionOfX(x) {
  if (x <= -20) return "A";
  if (x >= 20) return "B";
  return "MID";
}
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
async function walkToViaPath(puppet, targetX, targetZ, opts = {}) {
  const me = findPlayer(puppet, puppet.playerId);
  const waypoints = buildSafeRoute(me ? me.position : null, targetX, targetZ);
  let allArrived = true;
  for (const wp of waypoints) {
    const ok = await walkTo(puppet, wp.x, wp.z, { timeoutMs: 15000, arriveDist: opts.arriveDist ?? 1.2 });
    if (!ok) console.warn(`[qa] walkToViaPath(${puppet.label}) stalled en route to waypoint`, wp);
    allArrived = allArrived && ok;
  }
  return allArrived;
}

async function main() {
  const shooter = await connectPuppet("armor-shooter", "public");
  const victim = await connectPuppet("armor-victim", "public");
  await waitFor(() => findPlayer(shooter, shooter.playerId) && findPlayer(shooter, victim.playerId));
  await waitFor(() => findPlayer(victim, victim.playerId));

  console.log("=== Armor absorption sanity check @ new damage values ===");
  // Victim walks to BOTH armor pickups (armor_tunnel_west @ -10,16 and
  // armor_tunnel_east @ 10,16) to pick up 2x25=50 armor.
  await walkToViaPath(victim, -10, 16, { arriveDist: 1.0 });
  await sleep(500);
  await walkToViaPath(victim, 10, 16, { arriveDist: 1.0 });
  await sleep(500);

  let vstate = findPlayer(shooter, victim.playerId);
  console.log("victim after armor pickups:", vstate);
  if (vstate.armor !== 50) {
    console.warn(`WARNING: expected 50 armor (2x25), got ${vstate.armor} -- proceeding anyway with whatever armor value resulted`);
  }
  const startArmor = vstate.armor;

  let vp = findPlayer(shooter, victim.playerId).position;
  const arrived = await walkToViaPath(shooter, vp.x + 2, vp.z, { arriveDist: 1.8 });
  console.log("shooter arrived near victim:", arrived, "shooter pos:", findPlayer(shooter, shooter.playerId)?.position);
  await sleep(200);

  // NOTE: this "public" match may have OTHER live players sharing it (a
  // real browser session was found already connected to :7777 -- NOT killed,
  // it looks like the user's own session, not test scaffolding), so raw
  // world_state armor/health diffing between our own polls is unreliable
  // (another player's shots on the same victim, or on us, would corrupt the
  // before/after deltas). Instead, attribute damage precisely via the
  // broadcast HitEvent (shared/src/index.ts) filtered to shooterId===our
  // shooter && targetId===our victim -- every client in the match receives
  // every hit broadcast, so this is exact ground truth regardless of any
  // other player's concurrent activity.
  function hitsFromShooterOnVictim() {
    return shooter.messages.filter(
      (m) => m.type === "hit" && m.shooterId === shooter.playerId && m.targetId === victim.playerId,
    );
  }
  const shotsBefore = hitsFromShooterOnVictim().length;

  let shots = 0;
  const maxShots = 30;
  while (shots < maxShots) {
    await aimAndHold(shooter, victim.playerId);
    await fireOnce(shooter, 320);
    shots++;
    const v = findPlayer(shooter, victim.playerId);
    if (!v || !v.alive) break;
  }

  const myHits = hitsFromShooterOnVictim().slice(shotsBefore);
  console.log(`\nMy shooter landed ${myHits.length} confirmed hits on the victim (of ${shots} fire attempts):`);
  let armorTrack = startArmor;
  let healthTrack = 100;
  let crossoverSeen = false;
  for (const h of myHits) {
    const armorBefore = armorTrack;
    // damage applied to armor first, spillover to health -- reconstruct from
    // HitEvent.damage (total dealt this hit) + targetHealth (health after).
    const healthAfter = h.targetHealth;
    const healthDropped = healthTrack - healthAfter;
    const armorAbsorbed = h.damage - healthDropped;
    armorTrack = Math.max(0, armorTrack - armorAbsorbed);
    console.log(
      `  hit: dmg=${h.damage}, armor ${armorBefore}->${armorTrack} (absorbed ${armorAbsorbed}), health ${healthTrack}->${healthAfter}`,
    );
    if (h.damage !== 5) console.error(`ANOMALY: expected pistol hit damage=5, got ${h.damage}`);
    if (armorBefore > 0 && armorTrack === 0 && healthDropped > 0) crossoverSeen = true;
    healthTrack = healthAfter;
  }

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify({
    startArmor,
    myConfirmedHits: myHits.length,
    fireAttempts: shots,
    crossoverSeen,
    finalHealth: healthTrack,
    finalArmor: armorTrack,
    finalAlive: findPlayer(shooter, victim.playerId)?.alive,
  }, null, 2));

  shooter.ws.close();
  victim.ws.close();
  process.exit(0);
}

main().catch((err) => { console.error("FATAL", err); process.exit(1); });
