// EPIC 17 regression: PlayerState must carry the server-authoritative
// equipped weapon so remote avatars can render the held weapon.

import assert from "node:assert/strict";
import { PlayerRegistry } from "../server/src/playerRegistry.js";

const registry = new PlayerRegistry();
const player = registry.spawn("player-a");

let state = registry.toWorldState().find((item) => item.id === player.id);
assert.equal(state?.equippedWeapon, "pistol", "fresh spawn should broadcast pistol");

const pickupResult = registry.applyPickup(player.id, "weapon", "rifle");
assert.equal(pickupResult.applied, true, "rifle pickup should apply");
assert.equal(pickupResult.autoSwitchedTo, "rifle", "higher-tier rifle pickup should auto-equip");

state = registry.toWorldState().find((item) => item.id === player.id);
assert.equal(state?.equippedWeapon, "rifle", "world state should reflect authoritative rifle equip");

const switched = registry.cycleWeapon(player.id);
assert.equal(switched, true, "cycling from rifle should switch to another owned weapon");

state = registry.toWorldState().find((item) => item.id === player.id);
assert.equal(state?.equippedWeapon, "pistol", "world state should update after server-side weapon switch");

console.log("[playerstate-equipped-weapon] PASS");
