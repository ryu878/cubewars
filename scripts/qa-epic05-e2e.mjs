// Scripted raw-WS E2E test for EPIC 5 (kill feed, scoreboard, spawn distribution,
// server authority). Drives players via input messages to known positions/aim,
// so we don't depend on imprecise headless mouse-aim to land a hit.

import WebSocket from "ws";

const WS_URL = "ws://localhost:7777";

function connect(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { label, ws, playerId: null, messages: [], scoreboards: [], kills: [] };
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      state.messages.push(msg);
      if (msg.type === "welcome") state.playerId = msg.playerId;
      if (msg.type === "scoreboard") state.scoreboards.push(msg);
      if (msg.type === "kill") state.kills.push(msg);
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
        if (!state.playerId) reject(new Error(`${label}: no welcome received`));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

function send(state, msg) {
  state.ws.send(JSON.stringify(msg));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Returns the flattened {x,y,z,health,alive} for this connection's own player from its latest world_state, or null. */
function lastPos(state) {
  const worldStates = state.messages.filter((m) => m.type === "world_state");
  const last = worldStates[worldStates.length - 1];
  if (!last) return null;
  const p = last.players.find((pl) => pl.id === state.playerId);
  if (!p) return null;
  return { x: p.position.x, y: p.position.y, z: p.position.z, health: p.health, alive: p.alive };
}

/** Returns the flattened position/health/alive for an arbitrary player id, as seen in `state`'s latest world_state. */
function findPlayer(state, id) {
  const worldStates = state.messages.filter((m) => m.type === "world_state");
  const last = worldStates[worldStates.length - 1];
  if (!last) return null;
  const p = last.players.find((pl) => pl.id === id);
  if (!p) return null;
  return { x: p.position.x, y: p.position.y, z: p.position.z, health: p.health, alive: p.alive };
}

function computeAim(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  // client/server convention: forward = (-sin(yaw), -cos(yaw))
  const yaw = Math.atan2(-dx, -dz);
  const dy = to.y + 0.85 - (from.y + 1.7); // aim roughly at victim torso vs shooter eye
  const horizDist = Math.hypot(dx, dz);
  const pitch = Math.atan2(dy, horizDist);
  return { yaw, pitch };
}

async function main() {
  const results = { pass: [], fail: [] };
  function check(name, cond, detail) {
    if (cond) {
      results.pass.push(name);
      console.log(`[PASS] ${name}`);
    } else {
      results.fail.push(`${name}${detail ? " -- " + detail : ""}`);
      console.log(`[FAIL] ${name} ${detail ? "-- " + detail : ""}`);
    }
  }

  // ===== Test 1: kill feed visible to bystander + scoreboard update =====
  console.log("\n=== Test 1: kill feed to all clients (incl bystander), scoreboard update ===");
  const p1 = await connect("P1(shooter)");
  const p2 = await connect("P2(victim)");
  const bystander = await connect("Bystander");
  await sleep(300);

  console.log("P1 id", p1.playerId, "P2 id", p2.playerId, "Bystander id", bystander.playerId);

  const p1pos = lastPos(p1);
  const p2pos = lastPos(p2);
  console.log("p1 pos", p1pos, "p2 pos", p2pos);

  const aim = computeAim(p1pos, p2pos);
  console.log("computed aim", aim);
  for (let i = 0; i < 5; i++) {
    send(p1, { type: "input", moveForward: 0, moveRight: 0, yaw: aim.yaw, pitch: aim.pitch, jump: false });
    await sleep(60);
  }

  for (let i = 0; i < 6; i++) {
    send(p1, { type: "fire" });
    await sleep(350); // respect FIRE_COOLDOWN_MS=300
    const p2now = findPlayer(p1, p2.playerId);
    console.log(`  shot ${i + 1}: p2 health=${p2now?.health}, alive=${p2now?.alive}`);
    if (p2now && !p2now.alive) break;
  }
  await sleep(300);

  const p1KillMsgs = p1.kills.filter((k) => k.attackerId === p1.playerId && k.victimId === p2.playerId);
  const p2KillMsgs = p2.kills.filter((k) => k.attackerId === p1.playerId && k.victimId === p2.playerId);
  const bystanderKillMsgs = bystander.kills.filter((k) => k.attackerId === p1.playerId && k.victimId === p2.playerId);

  check("Shooter (P1) received KillEvent", p1KillMsgs.length >= 1);
  check("Victim (P2) received KillEvent", p2KillMsgs.length >= 1);
  check(
    "Bystander (uninvolved 3rd client) received KillEvent",
    bystanderKillMsgs.length >= 1,
    `bystander kill msgs: ${JSON.stringify(bystander.kills)}`,
  );

  const p1LastScore = p1.scoreboards[p1.scoreboards.length - 1];
  const bystanderLastScore = bystander.scoreboards[bystander.scoreboards.length - 1];
  const p1Score = p1LastScore?.players.find((p) => p.id === p1.playerId);
  const bystanderViewOfP1 = bystanderLastScore?.players.find((p) => p.id === p1.playerId);
  check("P1's own scoreboard shows kills>=1 after kill", (p1Score?.kills ?? 0) >= 1, `p1Score=${JSON.stringify(p1Score)}`);
  check(
    "Bystander's scoreboard also shows P1 kills>=1 (live update)",
    (bystanderViewOfP1?.kills ?? 0) >= 1,
    `bystanderView=${JSON.stringify(bystanderViewOfP1)}`,
  );

  // ===== Test 2: late joiner sees current scoreboard state immediately =====
  console.log("\n=== Test 2: late joiner sees current scoreboard state ===");
  const lateJoiner = await connect("LateJoiner");
  await sleep(200);
  const lateJoinerFirstScoreboard = lateJoiner.scoreboards[0];
  const lateJoinerViewOfP1 = lateJoinerFirstScoreboard?.players.find((p) => p.id === p1.playerId);
  check(
    "Late joiner's FIRST scoreboard message already shows P1 at correct kill count (not 0)",
    (lateJoinerViewOfP1?.kills ?? -1) >= 1,
    `lateJoinerFirstScoreboard=${JSON.stringify(lateJoinerFirstScoreboard)}`,
  );
  check(
    "Late joiner appears in the scoreboard themself at 0 kills",
    lateJoinerFirstScoreboard?.players.find((p) => p.id === lateJoiner.playerId)?.kills === 0,
  );

  // ===== Test 3: leave removes player from scoreboard =====
  console.log("\n=== Test 3: disconnect removes player from scoreboard ===");
  const beforeCount = bystander.scoreboards[bystander.scoreboards.length - 1].players.length;
  lateJoiner.ws.close();
  await sleep(300);
  const afterScoreboard = bystander.scoreboards[bystander.scoreboards.length - 1];
  const stillThere = afterScoreboard.players.find((p) => p.id === lateJoiner.playerId);
  check(
    "Disconnected player removed from other clients' scoreboard",
    !stillThere,
    `afterScoreboard=${JSON.stringify(afterScoreboard)}`,
  );
  check(
    "Scoreboard player count decreased by 1 after disconnect",
    afterScoreboard.players.length === beforeCount - 1,
    `before=${beforeCount} after=${afterScoreboard.players.length}`,
  );

  // ===== Test 5: server authority — can't fake a KillEvent or influence own kill count via raw message =====
  console.log("\n=== Test 5: server authority against fabricated client messages ===");
  const beforeKills = p1.scoreboards[p1.scoreboards.length - 1].players.find((p) => p.id === p1.playerId)?.kills ?? 0;
  send(p1, { type: "kill", attackerId: p1.playerId, victimId: p2.playerId });
  send(p1, { type: "scoreboard", players: [{ id: p1.playerId, kills: 9999 }] });
  await sleep(500);
  const afterKills = p1.scoreboards[p1.scoreboards.length - 1].players.find((p) => p.id === p1.playerId)?.kills ?? 0;
  const bystanderSawFakeScore = bystander.scoreboards.some(
    (sb) => sb.players.find((p) => p.id === p1.playerId)?.kills === 9999,
  );
  check(
    "Client-forged 'kill'/'scoreboard' messages do not change server-tracked kill count",
    afterKills === beforeKills,
    `before=${beforeKills} after=${afterKills}`,
  );
  check("Client-forged 'scoreboard' message with kills=9999 never gets rebroadcast to other clients", !bystanderSawFakeScore);

  p1.ws.close();
  p2.ws.close();
  bystander.ws.close();
  await sleep(300);

  // ===== Test 6: spawn distribution across many simultaneous connections =====
  console.log("\n=== Test 6: spawn anti-clustering with many simultaneous players ===");
  const N = 6;
  const players = [];
  for (let i = 0; i < N; i++) {
    players.push(await connect(`Spawn${i}`));
    await sleep(150);
  }
  await sleep(300);
  const positions = players.map((pl) => lastPos(pl)).filter(Boolean);
  check("All 6 simultaneous connections got a spawn position", positions.length === N, `got ${positions.length}`);

  let minDist = Infinity;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const d = Math.hypot(positions[i].x - positions[j].x, positions[i].z - positions[j].z);
      if (d < minDist) minDist = d;
    }
  }
  console.log("Positions:", positions.map((p) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).join(" | "));
  console.log("Min pairwise distance:", minDist.toFixed(2));
  check(
    "Minimum pairwise spawn distance across 6 simultaneous players is reasonably separated (>= 8 units, no stacking)",
    minDist >= 8,
    `minDist=${minDist.toFixed(2)}`,
  );

  const p7 = await connect("Spawn7th-crowded");
  await sleep(300);
  const p7pos = lastPos(p7);
  let p7MinDist = Infinity;
  for (const pos of positions) {
    const d = Math.hypot(p7pos.x - pos.x, p7pos.z - pos.z);
    if (d < p7MinDist) p7MinDist = d;
  }
  console.log("7th player (all spawns occupied) pos:", p7pos, "min dist to others:", p7MinDist.toFixed(2));
  check(
    "7th player in fully-occupied arena still lands with some separation (fallback to farthest point, not stacked)",
    p7MinDist > 2,
    `p7MinDist=${p7MinDist.toFixed(2)}`,
  );

  for (const pl of players) pl.ws.close();
  p7.ws.close();
  await sleep(300);

  // ===== Test 7: respawn distribution — kill one player repeatedly among several alive, check respawn spread =====
  console.log("\n=== Test 7: respawn spread among several alive players ===");
  const r1 = await connect("R1(shooter)");
  const r2 = await connect("R2(victim, repeat respawns)");
  const r3 = await connect("R3(bystander alive)");
  await sleep(300);
  const respawnPositions = [];
  const r2InitialPos = lastPos(r2);
  respawnPositions.push(r2InitialPos);

  for (let round = 0; round < 3; round++) {
    const r1pos = lastPos(r1);
    const r2pos = lastPos(r2);
    if (!r1pos || !r2pos) break;
    const a = computeAim(r1pos, r2pos);
    for (let i = 0; i < 3; i++) {
      send(r1, { type: "input", moveForward: 0, moveRight: 0, yaw: a.yaw, pitch: a.pitch, jump: false });
      await sleep(50);
    }
    for (let i = 0; i < 5; i++) {
      send(r1, { type: "fire" });
      await sleep(350);
      const r2now = findPlayer(r1, r2.playerId);
      if (r2now && !r2now.alive) break;
    }
    await sleep(3400); // COMBAT.respawnDelayMs = 3000, plus margin
    const newPos = lastPos(r2);
    respawnPositions.push(newPos);
    console.log(`Respawn ${round + 1}:`, newPos);
  }

  check(
    "Victim respawned multiple times with tracked positions",
    respawnPositions.filter(Boolean).length >= 3,
    `count=${respawnPositions.filter(Boolean).length}`,
  );
  let anyStacked = false;
  for (const rp of respawnPositions) {
    if (!rp) continue;
    const r1pos = lastPos(r1);
    if (r1pos) {
      const d = Math.hypot(rp.x - r1pos.x, rp.z - r1pos.z);
      if (d < 3) anyStacked = true;
    }
  }
  check("None of the victim's respawns landed within 3 units of the shooter's current position", !anyStacked);

  r1.ws.close();
  r2.ws.close();
  r3.ws.close();

  console.log("\n=== SUMMARY ===");
  console.log(`PASS: ${results.pass.length}, FAIL: ${results.fail.length}`);
  if (results.fail.length > 0) {
    console.log("Failures:");
    for (const f of results.fail) console.log(" - " + f);
  }
  process.exit(results.fail.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(2);
});
