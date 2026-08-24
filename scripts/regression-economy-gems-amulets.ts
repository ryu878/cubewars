// EPIC 25 regression: gems socket uniqueness, amulet slot2 + 40% contrib,
// shard craft, repair kits, death penalties, kill loot copies, rating math.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEATH_EFFECTIVENESS_FACTOR,
  ECONOMY_CAPS,
  GEM_VALUE_MAX,
  GEM_VALUE_MIN,
  REPAIR_KIT_SOFT_CAP,
  aggregateEquippedRatings,
  applyDeathEffectivenessDecay,
  shouldGrantAmuletDrop,
  shouldGrantGemDrop,
  shouldGrantRepairKitDrop,
  shouldGrantShard,
} from "@cubewars/shared";
import { EconomyActionError, EconomyStore } from "../server/src/economy/index.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cubewars-economy-gems-"));
const dbPath = path.join(tmpDir, "economy.sqlite");

// --- Shared math ---
assert.equal(DEATH_EFFECTIVENESS_FACTOR, 0.9);
assert.equal(applyDeathEffectivenessDecay(100), 90);
assert.equal(applyDeathEffectivenessDecay(1), 1);
assert.equal(GEM_VALUE_MIN, 5);
assert.equal(GEM_VALUE_MAX, 100);

// Dog base 100 + armor gem 50 on slot1; health gem 30 off-axis; slot2 lion 100 at 40%.
assert.equal(
  aggregateEquippedRatings(
    [
      {
        type: "dog",
        baseValue: 100,
        equipSlot: 1,
        gems: { armor: 50, health: 30 },
      },
      { type: "lion", baseValue: 100, equipSlot: 2 },
    ],
    true,
  ).armorRating,
  150,
);
assert.equal(
  aggregateEquippedRatings(
    [
      {
        type: "dog",
        baseValue: 100,
        equipSlot: 1,
        gems: { armor: 50, health: 30 },
      },
      { type: "lion", baseValue: 100, equipSlot: 2 },
    ],
    true,
  ).healthRating,
  30,
);
assert.equal(
  aggregateEquippedRatings(
    [
      {
        type: "dog",
        baseValue: 100,
        equipSlot: 1,
        gems: { armor: 50, health: 30 },
      },
      { type: "lion", baseValue: 100, equipSlot: 2 },
    ],
    true,
  ).damageRating,
  40,
);
assert.equal(
  aggregateEquippedRatings([{ type: "lion", baseValue: 100, equipSlot: 2 }], false).damageRating,
  0,
  "slot2 ignored without amulet",
);

assert.equal(shouldGrantGemDrop(0, true, 0), true);
assert.equal(shouldGrantGemDrop(ECONOMY_CAPS.gems, true, 0), false);
assert.equal(shouldGrantGemDrop(0, false, 0), false);
assert.equal(shouldGrantAmuletDrop(0, true, 0), true);
assert.equal(shouldGrantAmuletDrop(ECONOMY_CAPS.amulets, true, 0), false);
assert.equal(shouldGrantRepairKitDrop(0, 0), true);
assert.equal(shouldGrantRepairKitDrop(REPAIR_KIT_SOFT_CAP, 0), false);
assert.equal(shouldGrantShard(0, 0, true, false), true);
assert.equal(shouldGrantShard(0, 0, true, true), false);
assert.equal(shouldGrantShard(ECONOMY_CAPS.amulets, 0, true, false), false);

const store = EconomyStore.open(dbPath);
const now = 2_000_000;

// --- Socket uniqueness per type ---
const pet = store.grantPetForTests("GemOwner", "dog", 100, now);
const gemArmor = store.grantGem("GemOwner", "armor", 40, now);
const gemArmor2 = store.grantGem("GemOwner", "armor", 50, now);
const gemHealth = store.grantGem("GemOwner", "health", 25, now);
store.socketGem("GemOwner", gemArmor.id, pet.id, now);
assert.throws(() => store.socketGem("GemOwner", gemArmor2.id, pet.id, now), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "type_occupied");
  return true;
});
store.socketGem("GemOwner", gemHealth.id, pet.id, now);
store.equipPet("GemOwner", pet.id, 1, now);
let full = store.getFullProfile("GemOwner");
assert.equal(full.ratings.armorRating, 140);
assert.equal(full.ratings.healthRating, 25);
assert.equal(full.slot2Enabled, false);

// Cross-profile socket reject.
store.getOrCreateProfile("OtherGem");
assert.throws(() => store.socketGem("OtherGem", gemArmor2.id, pet.id, now), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "cross_profile");
  return true;
});

// --- Amulet enables slot2; 40% second pet ---
const amulet = store.grantAmulet("GemOwner", 10, now);
store.equipAmulet("GemOwner", amulet.id, now);
full = store.getFullProfile("GemOwner");
assert.equal(full.slot2Enabled, true);

const pet2 = store.grantPetForTests("GemOwner", "lion", 100, now);
store.equipPet("GemOwner", pet2.id, 2, now);
full = store.getFullProfile("GemOwner");
assert.equal(full.ratings.damageRating, 40);
assert.equal(full.ratings.armorRating, 140);

// Unequip amulet forces slot2 unequip.
store.unequipAmulet("GemOwner", amulet.id, now);
full = store.getFullProfile("GemOwner");
assert.equal(full.slot2Enabled, false);
assert.ok(full.pets.every((p) => p.equipSlot !== 2));
assert.throws(() => store.equipPet("GemOwner", pet2.id, 2, now), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "slot2_disabled");
  return true;
});

// Re-equip amulet + slot2 for death tests.
store.equipAmulet("GemOwner", amulet.id, now);
store.equipPet("GemOwner", pet2.id, 2, now);

// --- Craft 10 shards → amulet ---
store.getOrCreateProfile("Crafter");
for (let i = 0; i < 10; i++) store.addShard("Crafter", 1, now);
assert.equal(store.getFullProfile("Crafter").shardCount, 10);
const crafted = store.craftAmulet("Crafter", now);
assert.equal(crafted.durability, 10);
assert.equal(store.getFullProfile("Crafter").shardCount, 0);
assert.throws(() => store.craftAmulet("Crafter", now), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "insufficient_shards");
  return true;
});

// --- Repair kit ---
store.grantRepairKit("GemOwner", now);
const beforeDur = store.getFullProfile("GemOwner").amulets.find((a) => a.id === amulet.id)!.durability;
// Damage durability via death once first? Or set by repairing from lower.
// Equip amulet already at 10 — repair should stay at 10 and still consume kit.
store.repairAmulet("GemOwner", amulet.id, now);
assert.equal(
  store.getFullProfile("GemOwner").amulets.find((a) => a.id === amulet.id)!.durability,
  beforeDur,
);
assert.equal(store.getFullProfile("GemOwner").repairKitCount, 0);

// Lower durability by applying death once, then repair.
store.applyHumanDeathPenalties("GemOwner", now);
full = store.getFullProfile("GemOwner");
const afterDeathAmulet = full.amulets.find((a) => a.equipped);
assert.ok(afterDeathAmulet);
assert.equal(afterDeathAmulet!.durability, 9);
// Pets decayed: dog 100→90, lion 100→90; gems armor 40→36, health 25→22.
const dog = full.pets.find((p) => p.id === pet.id)!;
const lion = full.pets.find((p) => p.id === pet2.id)!;
assert.equal(dog.baseValue, 90);
assert.equal(lion.baseValue, 90);
const gems = full.gems.filter((g) => g.petId === pet.id);
assert.equal(gems.find((g) => g.gemType === "armor")!.value, 36);
assert.equal(gems.find((g) => g.gemType === "health")!.value, 22);

store.grantRepairKit("GemOwner", now);
store.repairAmulet("GemOwner", amulet.id, now);
assert.equal(
  store.getFullProfile("GemOwner").amulets.find((a) => a.id === amulet.id)!.durability,
  10,
);

// Destroy amulet at durability 0 after 10 deaths from 10.
for (let i = 0; i < 10; i++) {
  store.applyHumanDeathPenalties("GemOwner", now + i);
}
full = store.getFullProfile("GemOwner");
assert.equal(full.amulets.length, 0);
assert.equal(full.slot2Enabled, false);
assert.ok(full.pets.every((p) => p.equipSlot !== 2));

// --- Kill loot copies (victim keeps gems/amulets) ---
const victim = store.getOrCreateProfile("LootVictim");
const vPet = store.grantPetForTests("LootVictim", "cat", 80, now);
const vGem = store.grantGem("LootVictim", "health", 60, now);
store.socketGem("LootVictim", vGem.id, vPet.id, now);
store.equipPet("LootVictim", vPet.id, 1, now);
const vAmulet = store.grantAmulet("LootVictim", 7, now);
store.equipAmulet("LootVictim", vAmulet.id, now);

store.getOrCreateProfile("LootKiller");
const drops = store.tryKillItemDrops(
  "LootKiller",
  true,
  { egg: 1, stimulator: 1, gem: 0, amulet: 0, repairKit: 0 },
  now,
  { nickname: "LootVictim", alreadyGrantedShard: false },
);
assert.ok(drops.gem, "gem loot copy at roll 0");
assert.equal(drops.gem!.gemType, "health");
assert.equal(drops.gem!.value, 60);
assert.equal(drops.shard, true, "shard when victim has amulet");
assert.ok(drops.amulet, "amulet loot copy at roll 0");
assert.equal(drops.amulet!.durability, 7);
assert.equal(drops.repairKit, true);

// Victim still has original gem + amulet (copy, not steal).
const victimFull = store.getFullProfile("LootVictim");
assert.equal(victimFull.gems.length, 1);
assert.equal(victimFull.amulets.length, 1);
assert.equal(victimFull.amulets[0]!.durability, 7);

// Shard once-per-victim: alreadyGrantedShard blocks second grant.
const drops2 = store.tryKillItemDrops(
  "LootKiller",
  true,
  { egg: 1, stimulator: 1, gem: 1, amulet: 1, repairKit: 1 },
  now,
  { nickname: "LootVictim", alreadyGrantedShard: true },
);
assert.equal(drops2.shard, false);

// Loot gem is a bag copy (not socketed); socket then unsocket.
assert.equal(drops.gem!.petId, null);
store.socketGem("LootKiller", drops.gem!.id, store.grantPetForTests("LootKiller", "bird", 10, now).id, now);
store.unsocketGem("LootKiller", drops.gem!.id, now);
assert.equal(store.getFullProfile("LootKiller").gems.find((g) => g.id === drops.gem!.id)!.petId, null);

store.close();
const reopened = EconomyStore.open(dbPath);
const restored = reopened.getFullProfile("LootKiller");
assert.ok(restored.gems.length >= 1);
assert.ok(restored.shardCount >= 1);
reopened.close();

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("[economy-gems-amulets] PASS");
