// EPIC 25 regression: gems socket uniqueness, amulet slot2 + 40% contrib,
// shard craft, repair kits, death penalties, kill loot copies, rating math.

import assert from "node:assert/strict";
import {
  DEATH_EFFECTIVENESS_FACTOR,
  DROP_CHANCE,
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
import { openTestEconomyStore } from "./economy-test-helpers.js";

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
assert.equal(DROP_CHANCE.repairKit, 0.002, "EPIC 57: repair kits are rare");
assert.equal(shouldGrantShard(0, true, false), true);
assert.equal(shouldGrantShard(0, true, true), false);
assert.equal(shouldGrantShard(ECONOMY_CAPS.shards, true, false), false);
// Killer amulet count no longer gates shards (EPIC 57).
assert.equal(shouldGrantShard(0, true, false), true);


async function main(): Promise<void> {
  const store = await openTestEconomyStore();
  const now = 2_000_000;


// --- Socket uniqueness per type ---
const pet = await store.grantPetForTests("GemOwner", "dog", 100, now);
const gemArmor = await store.grantGem("GemOwner", "armor", 40, now);
const gemArmor2 = await store.grantGem("GemOwner", "armor", 50, now);
const gemHealth = await store.grantGem("GemOwner", "health", 25, now);
await store.socketGem("GemOwner", gemArmor.id, pet.id, now);
await assert.rejects(async () => store.socketGem("GemOwner", gemArmor2.id, pet.id, now), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "type_occupied");
  return true;
});
await store.socketGem("GemOwner", gemHealth.id, pet.id, now);
await store.equipPet("GemOwner", pet.id, 1, now);
let full = await store.getFullProfile("GemOwner");
assert.equal(full.ratings.armorRating, 140);
assert.equal(full.ratings.healthRating, 25);
assert.equal(full.slot2Enabled, false);

// Cross-profile socket reject.
await store.getOrCreateProfile("OtherGem");
await assert.rejects(async () => store.socketGem("OtherGem", gemArmor2.id, pet.id, now), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "cross_profile");
  return true;
});

// --- Amulet enables slot2; 40% second pet ---
const amulet = await store.grantAmulet("GemOwner", 10, now);
await store.equipAmulet("GemOwner", amulet.id, now);
full = await store.getFullProfile("GemOwner");
assert.equal(full.slot2Enabled, true);

const pet2 = await store.grantPetForTests("GemOwner", "lion", 100, now);
await store.equipPet("GemOwner", pet2.id, 2, now);
full = await store.getFullProfile("GemOwner");
assert.equal(full.ratings.damageRating, 40);
assert.equal(full.ratings.armorRating, 140);

// Unequip amulet forces slot2 unequip.
await store.unequipAmulet("GemOwner", amulet.id, now);
full = await store.getFullProfile("GemOwner");
assert.equal(full.slot2Enabled, false);
assert.ok(full.pets.every((p) => p.equipSlot !== 2));
await assert.rejects(async () => store.equipPet("GemOwner", pet2.id, 2, now), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "slot2_disabled");
  return true;
});

// Re-equip amulet + slot2 for death tests.
await store.equipAmulet("GemOwner", amulet.id, now);
await store.equipPet("GemOwner", pet2.id, 2, now);

// --- Craft 10 shards → amulet ---
await store.getOrCreateProfile("Crafter");
for (let i = 0; i < 10; i++) await store.addShard("Crafter", 1, now);
assert.equal((await store.getFullProfile("Crafter")).shardCount, 10);
const crafted = await store.craftAmulet("Crafter", now);
assert.equal(crafted.durability, 10);
assert.equal((await store.getFullProfile("Crafter")).shardCount, 0);
await assert.rejects(async () => store.craftAmulet("Crafter", now), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "insufficient_shards");
  return true;
});

// --- Repair kit ---
await store.grantRepairKit("GemOwner", now);
const beforeDur = (await store.getFullProfile("GemOwner")).amulets.find((a) => a.id === amulet.id)!.durability;
// Damage durability via death once first? Or set by repairing from lower.
// Equip amulet already at 10 — repair should stay at 10 and still consume kit.
await store.repairAmulet("GemOwner", amulet.id, now);
assert.equal(
  (await store.getFullProfile("GemOwner")).amulets.find((a) => a.id === amulet.id)!.durability,
  beforeDur,
);
assert.equal((await store.getFullProfile("GemOwner")).repairKitCount, 0);

// Lower durability by applying death once, then repair.
await store.applyHumanDeathPenalties("GemOwner", now);
full = await store.getFullProfile("GemOwner");
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

await store.grantRepairKit("GemOwner", now);
await store.repairAmulet("GemOwner", amulet.id, now);
assert.equal(
  (await store.getFullProfile("GemOwner")).amulets.find((a) => a.id === amulet.id)!.durability,
  10,
);

// Destroy amulet at durability 0 after 10 deaths from 10.
for (let i = 0; i < 10; i++) {
  await store.applyHumanDeathPenalties("GemOwner", now + i);
}
full = await store.getFullProfile("GemOwner");
assert.equal(full.amulets.length, 0);
assert.equal(full.slot2Enabled, false);
assert.ok(full.pets.every((p) => p.equipSlot !== 2));

// --- Kill loot copies (victim keeps gems/amulets) ---
const victim = await store.getOrCreateProfile("LootVictim");
const vPet = await store.grantPetForTests("LootVictim", "cat", 80, now);
const vGem = await store.grantGem("LootVictim", "health", 60, now);
await store.socketGem("LootVictim", vGem.id, vPet.id, now);
await store.equipPet("LootVictim", vPet.id, 1, now);
const vAmulet = await store.grantAmulet("LootVictim", 7, now);
await store.equipAmulet("LootVictim", vAmulet.id, now);

await store.getOrCreateProfile("LootKiller");
const drops = await store.tryKillItemDrops(
  "LootKiller",
  true,
  { egg: 1, stimulator: 1, gem: 0, amulet: 0, repairKit: 0 },
  now,
  { nickname: "LootVictim", alreadyGrantedShard: false, victimHasAmulet: true },
);
assert.ok(drops.gem, "gem loot copy at roll 0");
assert.equal(drops.gem!.gemType, "health");
assert.equal(drops.gem!.value, 60);
assert.equal(drops.shard, true, "shard when victim has amulet");
assert.ok(drops.amulet, "amulet loot copy at roll 0");
assert.equal(drops.amulet!.durability, 7);
assert.equal(drops.repairKit, true);

// Victim still has original gem + amulet (copy, not steal).
const victimFull = await store.getFullProfile("LootVictim");
assert.equal(victimFull.gems.length, 1);
assert.equal(victimFull.amulets.length, 1);
assert.equal(victimFull.amulets[0]!.durability, 7);

// Shard once-per-victim: alreadyGrantedShard blocks second grant.
const drops2 = await store.tryKillItemDrops(
  "LootKiller",
  true,
  { egg: 1, stimulator: 1, gem: 1, amulet: 1, repairKit: 1 },
  now,
  { nickname: "LootVictim", alreadyGrantedShard: true, victimHasAmulet: true },
);
assert.equal(drops2.shard, false);

// EPIC 57: bot-style victim context (no nickname) grants shard without inventing amulet/gem copies.
await store.getOrCreateProfile("BotShardKiller");
const botStyleDrops = await store.tryKillItemDrops(
  "BotShardKiller",
  true,
  { egg: 1, stimulator: 1, gem: 0, amulet: 0, repairKit: 1 },
  now,
  { alreadyGrantedShard: false, victimHasAmulet: true },
  "sandbox",
);
assert.equal(botStyleDrops.shard, true, "sandbox bot-style victimHasAmulet grants shard");
assert.equal(botStyleDrops.gem, null, "bots must not invent gem copies");
assert.equal(botStyleDrops.amulet, null, "bots must not invent amulet copies");

const botNoAmulet = await store.tryKillItemDrops(
  "BotShardKiller",
  true,
  { egg: 1, stimulator: 1, gem: 0, amulet: 0, repairKit: 1 },
  now,
  { alreadyGrantedShard: false, victimHasAmulet: false },
  "sandbox",
);
assert.equal(botNoAmulet.shard, false, "non-amulet bot path must not grant shard");

// EPIC 57: killer at amulet cap can still receive shards.
await store.getOrCreateProfile("AmuletCapKiller");
for (let i = 0; i < ECONOMY_CAPS.amulets; i++) {
  await store.grantAmulet("AmuletCapKiller", 10, now);
}
assert.equal((await store.getFullProfile("AmuletCapKiller")).amulets.length, ECONOMY_CAPS.amulets);
const capShard = await store.tryKillItemDrops(
  "AmuletCapKiller",
  true,
  { egg: 1, stimulator: 1, gem: 1, amulet: 1, repairKit: 1 },
  now,
  { nickname: "LootVictim", alreadyGrantedShard: false, victimHasAmulet: true },
);
assert.equal(capShard.shard, true, "amulet-cap killer still receives shards");

// Loot gem is a bag copy (not socketed); socket then unsocket.
assert.equal(drops.gem!.petId, null);
const killerPet = await store.grantPetForTests("LootKiller", "bird", 10, now);
await store.socketGem("LootKiller", drops.gem!.id, killerPet.id, now);
await store.unsocketGem("LootKiller", drops.gem!.id, now);
assert.equal((await store.getFullProfile("LootKiller")).gems.find((g) => g.id === drops.gem!.id)!.petId, null);

// --- Critic F-001: loot copy of death-decayed gem value (< 5) must not throw ---
await store.getOrCreateProfile("DecayedVictim");
await store.getOrCreateProfile("DecayedKiller");
const dPet = await store.grantPetForTests("DecayedVictim", "dog", 50, now);
const dGem = await store.grantGem("DecayedVictim", "armor", 5, now);
await store.socketGem("DecayedVictim", dGem.id, dPet.id, now);
await store.equipPet("DecayedVictim", dPet.id, 1, now);
await store.applyHumanDeathPenalties("DecayedVictim", now);
const decayedGem = (await store.getFullProfile("DecayedVictim")).gems.find((g) => g.id === dGem.id)!;
assert.equal(decayedGem.value, 4, "floor(5*0.9)=4 below mint min");
const decayedDrops = await store.tryKillItemDrops(
  "DecayedKiller",
  true,
  { egg: 1, stimulator: 1, gem: 0, amulet: 1, repairKit: 1 },
  now,
  { nickname: "DecayedVictim", alreadyGrantedShard: false, victimHasAmulet: false },
);
assert.ok(decayedDrops.gem, "F-001: loot copy of value 4 must succeed");
assert.equal(decayedDrops.gem!.value, 4);
await assert.doesNotReject(async () => {
  await store.grantGem("DecayedKiller", "speed", 3, now, { allowExistingValue: true });
});
await assert.rejects(async () => store.grantGem("DecayedKiller", "speed", 3, now), (err: unknown) => {
  assert.ok(err instanceof Error);
  assert.match(err.message, /invalid gem type\/value/);
  return true;
});

// --- Critic F-002: slot2 pet decays even when amulet destroyed on same death ---
await store.getOrCreateProfile("Slot2Decay");
const s1 = await store.grantPetForTests("Slot2Decay", "cat", 100, now);
const s2 = await store.grantPetForTests("Slot2Decay", "lion", 100, now);
const sAmulet = await store.grantAmulet("Slot2Decay", 1, now);
await store.equipAmulet("Slot2Decay", sAmulet.id, now);
await store.equipPet("Slot2Decay", s1.id, 1, now);
await store.equipPet("Slot2Decay", s2.id, 2, now);
const deathResult = await store.applyHumanDeathPenalties("Slot2Decay", now);
assert.equal(deathResult.amuletDestroyed, true);
assert.equal(deathResult.petsDecayed, 2, "F-002: both slot1 and former slot2 must decay");
const afterSlot2 = await store.getFullProfile("Slot2Decay");
assert.equal(afterSlot2.amulets.length, 0);
assert.equal(afterSlot2.slot2Enabled, false);
assert.equal(afterSlot2.pets.find((p) => p.id === s1.id)!.baseValue, 90);
assert.equal(afterSlot2.pets.find((p) => p.id === s2.id)!.baseValue, 90);
assert.equal(afterSlot2.pets.find((p) => p.id === s2.id)!.equipSlot, null);

const redisUrl = store.redisUrl;
  const keyPrefix = store.keyPrefix;
  await store.close();
  const reopened = await EconomyStore.open({ redisUrl, keyPrefix, skipSqliteImport: true });
  const restored = await reopened.getFullProfile("LootKiller");
  assert.ok(restored.gems.length >= 1);
  assert.ok(restored.shardCount >= 1);
  await reopened.flushNamespace();
  await reopened.close();
  console.log("[economy-gems-amulets] PASS");

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
