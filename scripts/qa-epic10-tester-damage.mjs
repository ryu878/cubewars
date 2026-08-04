// Tester (Trusya) independent WS-level verification of EPIC 10 damage
// rebalance. Not a reuse of Programmer's qa-epic10-*.mjs scripts (per
// instructions, write our own). Uses raw ws connections, joins "bots" mode
// per-test (isolated match, no interference from other puppets/humans),
// walks a shooter to a weapon pickup where needed, then fires at a
// stationary victim and inspects world_state health/armor/alive fields
// directly.

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
      setTimeout(() => {
        clearInterval(check);
        if (!state.playerId) reject(new Error(`${label}: no welcome`));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

function send(state, msg) { state.ws.send(JSON.stringify(msg)); }

function findPlayer(state, id) {
  if (!state.lastWorld) return null;
  return state.lastWorld.players.find((p) => p.id === id) ?? null;
}

async function waitFor(fn, timeoutMs = 5000, intervalMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = fn();
    if (v) return v;
    await sleep(intervalMs);
  }
  return null;
}

async function walkTo(puppet, targetX, targetZ, opts = {}) {
  const arriveDist = opts.arriveDist ?? 1.2;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const me = findPlayer(puppet, puppet.playerId);
    if (!me) { await sleep(60); continue; }
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
  return false;
}

function computeAim(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const dy = (to.y + 0.85) - (from.y + 1.7);
  const horizDist = Math.hypot(dx, dz);
  const pitch = Math.atan2(dy, horizDist);
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

async function fireUntilDeadOrCount(shooter, target, cooldownMs, maxShots) {
  let shots = 0;
  while (shots < maxShots) {
    await aimAndHold(shooter, target.playerId);
    await fireOnce(shooter, cooldownMs);
    shots++;
    const tp = findPlayer(shooter, target.playerId);
    if (!tp || !tp.alive) break;
  }
  return shots;
}

async function main() {
  const results = {};

  // ---- TEST 1: pistol, 20 hits to kill (5 dmg x 20 = 100) ----
  {
    const a = await connectPuppet("pistol-shooter", "bots");
    const b = await connectPuppet("pistol-victim", "bots");
    // both connect to SEPARATE bots matches (createBotsMatch per human) --
    // need them in the SAME match. bots mode creates a new match per human
    // unless matchId reused. Check: matchManager.createBotsMatch(playerId)
    // -- likely always new. So pistol test must use "public" mode instead,
    // with two puppets so they share the one public match.
    a.ws.close(); b.ws.close();
  }

  const shooter = await connectPuppet("shooter", "public");
  const victim = await connectPuppet("victim", "public");
  await waitFor(() => findPlayer(shooter, shooter.playerId) && findPlayer(shooter, victim.playerId));
  await waitFor(() => findPlayer(victim, victim.playerId) && findPlayer(victim, shooter.playerId));

  // Keep victim stationary (don't send any input -- stays at spawn).
  // Move shooter near victim (close range so raycast reliably connects even amid geometry).
  let victimPos = findPlayer(shooter, victim.playerId).position;
  await walkTo(shooter, victimPos.x + 2, victimPos.z, { arriveDist: 1.8 });
  await sleep(200);

  console.log("=== TEST 1: pistol damage/TTK ===");
  const before1 = findPlayer(shooter, victim.playerId);
  console.log("victim before:", before1.health, before1.armor, before1.alive);
  const shots1 = await fireUntilDeadOrCount(shooter, victim, 320, 25);
  const after1 = findPlayer(shooter, victim.playerId);
  console.log(`pistol: shots fired=${shots1}, victim alive=${after1.alive}, health=${after1.health}, armor=${after1.armor}`);
  results.pistolShotsToKill = shots1;
  results.pistolFinalAlive = after1.alive;

  shooter.ws.close();
  victim.ws.close();
  await sleep(300);

  await main2(results);
}

async function main2(results) {
  // ---- TEST 2: rifle, 5 hits to kill (20 dmg x 5 = 100) ----
  // Need shooter to own a rifle. Walk to weapon_rifle_site_a at (-42,0,20).
  const shooter = await connectPuppet("shooter2", "public");
  const victim = await connectPuppet("victim2", "public");
  await waitFor(() => findPlayer(shooter, shooter.playerId) && findPlayer(shooter, victim.playerId));

  console.log("=== TEST 2: rifle damage/TTK ===");
  await walkTo(shooter, -42, 20, { arriveDist: 1.0, timeoutMs: 20000 });
  await sleep(400);
  // Confirm rifle owned via HUD-equivalent server loadout broadcast -- check messages
  const loadoutMsgs = shooter.messages.filter((m) => m.type === "loadout");
  const lastLoadout = loadoutMsgs[loadoutMsgs.length - 1];
  console.log("shooter loadout after walking to rifle pickup:", lastLoadout);

  let victimPos = findPlayer(shooter, victim.playerId).position;
  await walkTo(shooter, victimPos.x + 3, victimPos.z, { arriveDist: 2.0, timeoutMs: 20000 });
  await sleep(200);

  const before2 = findPlayer(shooter, victim.playerId);
  console.log("victim before:", before2.health, before2.armor, before2.alive);
  const shots2 = await fireUntilDeadOrCount(shooter, victim, 280, 10);
  const after2 = findPlayer(shooter, victim.playerId);
  console.log(`rifle: shots fired=${shots2}, victim alive=${after2.alive}, health=${after2.health}, armor=${after2.armor}`);
  results.rifleShotsToKill = shots2;

  shooter.ws.close();
  victim.ws.close();
  await sleep(300);

  await main3(results);
}

async function main3(results) {
  // ---- TEST 3: grenade launcher, 2-hit kill from full, 1-hit finisher from chipped ----
  const shooter = await connectPuppet("shooter3", "public");
  const victimA = await connectPuppet("victimA3", "public"); // full-health target
  await waitFor(() => findPlayer(shooter, shooter.playerId) && findPlayer(shooter, victimA.playerId));

  console.log("=== TEST 3a: grenade launcher 2-hit-from-full ===");
  await walkTo(shooter, 0, 0, { arriveDist: 1.0, timeoutMs: 20000 }); // weapon_gl_mid
  await sleep(400);
  const loadoutMsgs = shooter.messages.filter((m) => m.type === "loadout");
  console.log("shooter loadout after walking to GL pickup:", loadoutMsgs[loadoutMsgs.length - 1]);

  let vaPos = findPlayer(shooter, victimA.playerId).position;
  await walkTo(shooter, vaPos.x + 3, vaPos.z, { arriveDist: 2.0, timeoutMs: 20000 });
  await sleep(200);

  const beforeA = findPlayer(shooter, victimA.playerId);
  console.log("victimA before:", beforeA.health, beforeA.armor, beforeA.alive);
  await aimAndHold(shooter, victimA.playerId);
  await fireOnce(shooter, 1550);
  const midA = findPlayer(shooter, victimA.playerId);
  console.log("victimA after 1 GL hit:", midA.health, midA.armor, midA.alive);
  results.glHit1Health = midA.health;
  results.glHit1Alive = midA.alive;

  if (midA.alive) {
    await aimAndHold(shooter, victimA.playerId);
    await fireOnce(shooter, 1550);
    const afterA = findPlayer(shooter, victimA.playerId);
    console.log("victimA after 2 GL hits:", afterA.health, afterA.armor, afterA.alive);
    results.glHit2Alive = afterA.alive;
  } else {
    results.glHit2Alive = false; // already dead after 1
    console.log("victimA died after just 1 GL hit (unexpected for full-health target)");
  }

  victimA.ws.close();

  // ---- TEST 3b: chipped target -- rifle-hit victim down to <70 hp, then 1 GL hit should finish ----
  console.log("=== TEST 3b: grenade launcher 1-hit finisher on chipped target ===");
  // walk shooter to rifle pickup, hit victimB once with rifle (20 dmg, ->80hp), then switch to GL and finish
  const victimB = await connectPuppet("victimB3", "public");
  await waitFor(() => findPlayer(shooter, victimB.playerId));

  await walkTo(shooter, -42, 20, { arriveDist: 1.0, timeoutMs: 20000 }); // pick up rifle (higher tier than GL? tier2 GL > tier1 rifle, so GL stays equipped -- need explicit switch)
  await sleep(400);
  // cycle weapon to rifle explicitly (E) since GL (tier2) auto-equip keeps GL equipped over rifle
  send(shooter, { type: "switch_weapon" });
  await sleep(200);
  let loadoutAfterSwitch = shooter.messages.filter((m) => m.type === "loadout").slice(-1)[0];
  console.log("loadout after switch_weapon (expect rifle):", loadoutAfterSwitch);

  let vbPos = findPlayer(shooter, victimB.playerId).position;
  await walkTo(shooter, vbPos.x + 3, vbPos.z, { arriveDist: 2.0, timeoutMs: 20000 });
  await sleep(200);
  const beforeB = findPlayer(shooter, victimB.playerId);
  console.log("victimB before rifle chip:", beforeB.health, beforeB.armor, beforeB.alive);
  await aimAndHold(shooter, victimB.playerId);
  await fireOnce(shooter, 280);
  const chippedB = findPlayer(shooter, victimB.playerId);
  console.log("victimB after 1 rifle hit (should be 80 hp):", chippedB.health, chippedB.armor, chippedB.alive);
  results.chipHealthAfterRifle = chippedB.health;

  // switch back to GL
  send(shooter, { type: "switch_weapon" });
  await sleep(200);
  loadoutAfterSwitch = shooter.messages.filter((m) => m.type === "loadout").slice(-1)[0];
  console.log("loadout after switch_weapon back (expect GL):", loadoutAfterSwitch);

  await aimAndHold(shooter, victimB.playerId);
  await fireOnce(shooter, 1550);
  const finishedB = findPlayer(shooter, victimB.playerId);
  console.log("victimB after 1 GL finisher hit:", finishedB.health, finishedB.armor, finishedB.alive);
  results.glFinisherAlive = finishedB.alive;

  shooter.ws.close();
  victimB.ws.close();

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(results, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
