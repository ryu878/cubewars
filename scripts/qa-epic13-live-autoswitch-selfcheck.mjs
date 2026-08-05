// EPIC 13 Story 13.1/13.2 Programmer self-check (Pusya): NOT the formal
// Tester QA pass — a live end-to-end smoke test that drives the actual
// client<->server WebSocket protocol (join/input/fire/switch_weapon), not
// just the whitebox regression script (scripts/regression-weapon-autoswitch.ts,
// which calls PlayerRegistry directly and never exercises server/src/match.ts's
// logging or server/src/index.ts's message handling at all). This is what
// actually proves the new `auto-switch (...)` log lines fire from real
// gameplay traffic, matching the existing `switch:`-line style.
//
// No browser needed — fire()'s auto-switch behavior does not depend on
// whether a shot actually lands (see playerRegistry.ts fire() doc comment),
// so this drives a bare `ws` client with real "input" messages to walk a
// puppet player to the map's real rifle weapon/ammo pickups
// (shared/src/pickups.ts PICKUP_SPAWN_POINTS) and fires repeatedly.
//
// Run against an already-running dev server (npm run dev --workspace=server,
// default ws://localhost:7777): `node scripts/qa-epic13-live-autoswitch-selfcheck.mjs`
// Watch the server's own stdout/log for the new `auto-switch (...)` lines
// while this runs — this script itself only asserts on the client-visible
// `loadout` messages (equippedWeapon/ammo), which is what a client actually
// sees; the log line assertions are done by grepping the server log
// separately (see EPIC 13 handoff for the captured excerpt).

import WebSocket from "ws";

const WS_URL = process.argv[2] ?? "ws://localhost:7777";
const MOVE_SPEED = 13.3; // MOVEMENT.maxSpeed (shared/src/index.ts)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { ws, playerId: null, messages: [], loadouts: [] };
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      state.messages.push(msg);
      if (msg.type === "welcome") state.playerId = msg.playerId;
      if (msg.type === "loadout") state.loadouts.push(msg);
    });
    ws.on("open", () => {
      const check = setInterval(() => {
        if (state.playerId) {
          clearInterval(check);
          ws.send(JSON.stringify({ type: "join", mode: "public" }));
          resolve(state);
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        if (!state.playerId) reject(new Error("no welcome"));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

function lastPosition(state) {
  const worldStates = state.messages.filter((m) => m.type === "world_state");
  const last = worldStates[worldStates.length - 1];
  const p = last?.players.find((p) => p.id === state.playerId);
  return p ? p.position : null;
}

function lastLoadout(state) {
  return state.loadouts[state.loadouts.length - 1] ?? null;
}

/** Send a steady stream of "input" messages steering toward (targetX, targetZ), polling our own broadcast position, until within `radius` or `maxMs` elapses. */
async function walkTo(state, targetX, targetZ, radius = 1.0, maxMs = 15000) {
  const start = Date.now();
  let inputTimer;
  const sendInput = () => {
    const pos = lastPosition(state);
    if (!pos) return;
    const dx = targetX - pos.x;
    const dz = targetZ - pos.z;
    // forwardX = -sin(yaw), forwardZ = -cos(yaw) (matches server/client
    // convention, see playerRegistry.ts stepPlayer()) — solve for yaw so
    // forward points at (dx, dz).
    const yaw = Math.atan2(-dx, -dz);
    state.ws.send(JSON.stringify({ type: "input", moveForward: 1, moveRight: 0, yaw, pitch: 0, jump: false }));
  };
  inputTimer = setInterval(sendInput, 50);
  while (Date.now() - start < maxMs) {
    await sleep(100);
    const pos = lastPosition(state);
    if (pos) {
      const dist = Math.hypot(targetX - pos.x, targetZ - pos.z);
      if (dist <= radius) break;
    }
  }
  clearInterval(inputTimer);
  // Stop moving.
  state.ws.send(JSON.stringify({ type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false }));
  await sleep(300);
  return lastPosition(state);
}

async function fireOnce(state) {
  state.ws.send(JSON.stringify({ type: "fire" }));
}

async function main() {
  console.log(`[live-selfcheck] connecting to ${WS_URL}...`);
  const p = await connect();
  console.log(`[live-selfcheck] joined public match as ${p.playerId}`);
  await sleep(500);

  const spawnPos = lastPosition(p);
  console.log("[live-selfcheck] spawn position:", spawnPos);
  console.log("[live-selfcheck] initial loadout:", lastLoadout(p));

  // Real map pickup coordinates (shared/src/pickups.ts PICKUP_SPAWN_POINTS) —
  // pick the site nearer to spawn.
  const west = spawnPos.x < 0;
  const rifleWeaponPickup = west ? { x: -42, z: 20 } : { x: 42, z: -20 };
  const rifleAmmoPickup = west ? { x: -42, z: -20 } : { x: 42, z: 20 };
  console.log(
    `[live-selfcheck] targeting weapon pickup at (${rifleWeaponPickup.x},${rifleWeaponPickup.z}), ammo pickup at (${rifleAmmoPickup.x},${rifleAmmoPickup.z})`,
  );

  console.log("[live-selfcheck] walking to rifle weapon pickup...");
  const posAtWeaponPickup = await walkTo(p, rifleWeaponPickup.x, rifleWeaponPickup.z);
  await sleep(500);
  console.log("[live-selfcheck] position at weapon pickup:", posAtWeaponPickup);
  console.log("[live-selfcheck] loadout after weapon pickup:", lastLoadout(p));

  const afterPickupLoadout = lastLoadout(p);
  if (afterPickupLoadout?.equippedWeapon !== "rifle") {
    console.log("[live-selfcheck] FAIL: expected auto-equip onto rifle on first-time unlock, got:", afterPickupLoadout);
    process.exit(1);
  }
  console.log(`[live-selfcheck] PASS: auto-equipped rifle on first-time pickup, ammo=${afterPickupLoadout.ammo}`);

  // Fire repeatedly (250ms cooldown, shared/src/weapons.ts rifle.cooldownMs)
  // until ammo depletes and Story 13.1's auto-switch-down kicks in.
  console.log(`[live-selfcheck] firing rifle (starting ammo=${afterPickupLoadout.ammo}) until dry...`);
  const startAmmo = afterPickupLoadout.ammo;
  for (let i = 0; i < startAmmo + 2; i++) {
    await fireOnce(p);
    await sleep(280);
    const lo = lastLoadout(p);
    console.log(`[live-selfcheck]   shot ${i + 1}: equipped=${lo?.equippedWeapon}, ammo=${lo?.ammo}`);
    if (lo?.equippedWeapon === "pistol") break;
  }

  const afterDryLoadout = lastLoadout(p);
  if (afterDryLoadout?.equippedWeapon !== "pistol") {
    console.log("[live-selfcheck] FAIL: expected auto-switch-down to pistol after rifle ran dry, got:", afterDryLoadout);
    process.exit(1);
  }
  console.log("[live-selfcheck] PASS: auto-switched down to pistol after rifle ran dry.");

  console.log("[live-selfcheck] walking to rifle ammo pickup...");
  const posAtAmmoPickup = await walkTo(p, rifleAmmoPickup.x, rifleAmmoPickup.z);
  await sleep(500);
  console.log("[live-selfcheck] position at ammo pickup:", posAtAmmoPickup);
  const afterRefillLoadout = lastLoadout(p);
  console.log("[live-selfcheck] loadout after ammo refill:", afterRefillLoadout);

  if (afterRefillLoadout?.equippedWeapon !== "rifle" || !(afterRefillLoadout.ammo > 0)) {
    console.log("[live-selfcheck] FAIL: expected auto-equip back onto rifle on ammo refill, got:", afterRefillLoadout);
    process.exit(1);
  }
  console.log(`[live-selfcheck] PASS: auto-equipped back onto rifle on ammo refill, ammo=${afterRefillLoadout.ammo}.`);

  console.log("[live-selfcheck] sending manual switch_weapon (E) right after the auto-switch...");
  p.ws.send(JSON.stringify({ type: "switch_weapon" }));
  await sleep(300);
  const afterManualCycle = lastLoadout(p);
  console.log("[live-selfcheck] loadout after manual cycle:", afterManualCycle);
  if (afterManualCycle?.equippedWeapon === afterRefillLoadout.equippedWeapon) {
    console.log("[live-selfcheck] FAIL: manual switch_weapon did not change equipped weapon.");
    process.exit(1);
  }
  console.log(`[live-selfcheck] PASS: manual cycle changed equipped weapon to ${afterManualCycle.equippedWeapon}, unaffected by the prior auto-switches.`);

  p.ws.close();
  console.log("\n[live-selfcheck] ALL LIVE CHECKS PASSED.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[live-selfcheck] script crashed:", err);
  process.exit(2);
});
