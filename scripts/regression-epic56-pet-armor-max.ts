// EPIC 56 regression: pet armor raises maxArmor; HP / speed / damage integrity.
//
// Run: npx tsx scripts/regression-epic56-pet-armor-max.ts
// Exit non-zero on any failure.

import assert from "node:assert/strict";
import {
  COMBAT,
  armorBonusFromRatings,
  damageMultiplierFromRatings,
  formatRatingGrant,
  maxHealthBonusFromRatings,
  speedMultiplierFromRatings,
} from "@cubewars/shared";
import { PlayerRegistry } from "../server/src/playerRegistry.js";

function emptyRatings() {
  return { healthRating: 0, armorRating: 0, speedRating: 0, damageRating: 0 };
}

function freshPlayer(): { registry: PlayerRegistry; id: string } {
  const registry = new PlayerRegistry({
    getSpawnPoints: () => [{ x: 0, y: 0, z: 0 }],
    getGeometry: () => [],
  });
  const id = "epic56-p1";
  registry.spawnAt(id, { x: 0, y: 0, z: 0 }, id, id);
  return { registry, id };
}

// --- Shared math (no wrongful clamps) ---
assert.equal(armorBonusFromRatings(156), 156);
assert.equal(armorBonusFromRatings(22), 22);
assert.equal(speedMultiplierFromRatings(100), 2);
assert.equal(speedMultiplierFromRatings(200), 3);
assert.equal(damageMultiplierFromRatings(50), 1.5);
assert.equal(damageMultiplierFromRatings(200), 3);
assert.equal(formatRatingGrant("health", 145), "+145 HP");
assert.equal(formatRatingGrant("armor", 156), "+156 Armor");
assert.equal(formatRatingGrant("speed", 100), "+100% Speed");
assert.equal(formatRatingGrant("damage", 50), "+50% Damage");

// --- Dog 156 → 156/156 ---
{
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  registry.applyPetRatings(id, { ...emptyRatings(), armorRating: 156 });
  const state = registry.toWorldState().find((p) => p.id === id)!;
  assert.equal(player.maxArmor, 156);
  assert.equal(player.armor, 156);
  assert.equal(state.maxArmor, 156);
  assert.equal(state.armor, 156);
  console.log("[epic56] dog 156 → 156/156 OK");
}

// --- Dog 22 → 22/100 ---
{
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  registry.applyPetRatings(id, { ...emptyRatings(), armorRating: 22 });
  const state = registry.toWorldState().find((p) => p.id === id)!;
  assert.equal(player.maxArmor, COMBAT.maxArmor);
  assert.equal(player.armor, 22);
  assert.equal(state.maxArmor, 100);
  assert.equal(state.armor, 22);
  console.log("[epic56] dog 22 → 22/100 OK");
}

// --- No dog → 0/100 ---
{
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  const state = registry.toWorldState().find((p) => p.id === id)!;
  assert.equal(player.maxArmor, COMBAT.maxArmor);
  assert.equal(player.armor, 0);
  assert.equal(state.maxArmor, 100);
  assert.equal(state.armor, 0);
  console.log("[epic56] no dog → 0/100 OK");
}

// --- Armor pickup toward raised max (dog 156) ---
{
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  registry.applyPetRatings(id, { ...emptyRatings(), armorRating: 156 });
  player.armor = 140;
  const pickup = registry.applyPickup(id, "armor");
  assert.equal(pickup.applied, true);
  assert.equal(player.armor, Math.min(156, 140 + COMBAT.armorPickupAmount));
  // Already at max → no-op
  player.armor = 156;
  const noop = registry.applyPickup(id, "armor");
  assert.equal(noop.applied, false);
  console.log("[epic56] armor pickup uses player.maxArmor OK");
}

// --- Respawn restores pet armor / maxArmor ---
{
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  registry.applyPetRatings(id, { ...emptyRatings(), armorRating: 156 });
  // Kill then force respawn due.
  player.alive = false;
  player.respawnAtMs = Date.now() - 1;
  player.armor = 0;
  player.maxArmor = COMBAT.maxArmor; // stale; respawn must restore
  const outcomes = registry.processRespawns(Date.now());
  assert.equal(outcomes.length, 1);
  assert.equal(player.maxArmor, 156);
  assert.equal(player.armor, 156);
  assert.equal(player.health, player.maxHealth);
  console.log("[epic56] respawn dog 156 → 156/156 OK");
}

// --- Cat HP integrity (spawn/heal) ---
{
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  registry.applyPetRatings(id, { ...emptyRatings(), healthRating: 145 });
  assert.equal(player.maxHealth, COMBAT.maxHealth + maxHealthBonusFromRatings(145));
  assert.equal(player.health, 245);
  player.health = 80;
  const heal = registry.applyPickup(id, "health");
  assert.equal(heal.applied, true);
  assert.equal(player.health, 80 + COMBAT.healthPickupAmount);
  assert.ok(player.health > 100);
  assert.ok(player.health <= player.maxHealth);
  // Respawn full
  player.alive = false;
  player.respawnAtMs = Date.now() - 1;
  registry.processRespawns(Date.now());
  assert.equal(player.health, 245);
  assert.equal(player.maxHealth, 245);
  console.log("[epic56] cat HP spawn/heal/respawn OK");
}

// --- Speed / damage multipliers used by registry paths (no extra clamp) ---
{
  const { registry, id } = freshPlayer();
  registry.applyPetRatings(id, {
    healthRating: 0,
    armorRating: 0,
    speedRating: 100,
    damageRating: 50,
  });
  const player = registry.getPlayer(id)!;
  assert.equal(speedMultiplierFromRatings(player.petRatings.speedRating), 2);
  assert.equal(damageMultiplierFromRatings(player.petRatings.damageRating), 1.5);
  // High ratings stay unclamped in shared math
  assert.equal(speedMultiplierFromRatings(200), 3);
  assert.equal(damageMultiplierFromRatings(200), 3);
  console.log("[epic56] bird/lion multipliers unclamped OK");
}

console.log("[epic56-pet-armor-max] PASS");
