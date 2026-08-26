// EPIC 24/27 regression: eggs, stimulators, hatch, equip ratings, pet cap,
// human-only drop helper. Gold path covered by regression:economy-gold.

import assert from "node:assert/strict";
import {
  COMBAT,
  ECONOMY_CAPS,
  INCUBATION,
  PET_COMBAT,
  STIMULATOR_SOFT_CAP,
  aggregateEquippedRatings,
  applyStimulatorDeadline,
  armorBonusFromRatings,
  damageMultiplierFromRatings,
  describePetGrants,
  formatPetPrimaryGrant,
  formatRatingGrant,
  maxHealthBonusFromRatings,
  ratingDisplayLabel,
  shouldGrantEggDrop,
  shouldGrantStimulatorDrop,
  speedMultiplierFromRatings,
} from "@cubewars/shared";
import {
  EconomyActionError,
  EconomyStore,
  resolveIncubationDurationMs,
} from "../server/src/economy/index.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

// --- Shared math knobs (EPIC 51 pet combat redesign) ---
assert.equal(maxHealthBonusFromRatings(9), 9);
assert.equal(maxHealthBonusFromRatings(200), 200);
assert.equal(armorBonusFromRatings(159), 159);
assert.equal(armorBonusFromRatings(200), 200);
assert.equal(speedMultiplierFromRatings(100), 2);
assert.equal(speedMultiplierFromRatings(200), 3);
assert.equal(damageMultiplierFromRatings(50), 1.5);
assert.equal(damageMultiplierFromRatings(200), 3);
assert.equal(
  aggregateEquippedRatings([{ type: "lion", baseValue: 100, equipSlot: 1 }]).damageRating,
  100,
);
assert.equal(
  aggregateEquippedRatings([{ type: "lion", baseValue: 100, equipSlot: 2 }], false).damageRating,
  0,
  "slot 2 ignored when disabled",
);
assert.equal(COMBAT.maxHealth + maxHealthBonusFromRatings(9), 109);
assert.equal(COMBAT.maxHealth + maxHealthBonusFromRatings(200), 300);

// EPIC 50/51: readable pet grant labels match PET_TYPE_RATING + aggregate math
assert.equal(formatPetPrimaryGrant("dog", 156), "+156 Armor");
assert.equal(formatPetPrimaryGrant("cat", 9), "+9 HP");
assert.equal(formatPetPrimaryGrant("bird", 100), "+100% Speed");
assert.equal(formatPetPrimaryGrant("lion", 50), "+50% Damage");
assert.equal(ratingDisplayLabel("health"), "HP");
assert.equal(ratingDisplayLabel("armor"), "Armor");
assert.equal(formatRatingGrant("armor", 159), "+159 Armor");
assert.equal(formatRatingGrant("speed", 100), "+100% Speed");
assert.equal(formatRatingGrant("damage", 50), "+50% Damage");

{
  const full = describePetGrants(
    { type: "dog", baseValue: 156, gems: { armor: 20, speed: 10 } },
    { applySlotFraction: false },
  );
  assert.equal(full.primaryText, "+156 Armor");
  assert.ok(full.gemTexts.includes("+20 Armor"));
  assert.ok(full.gemTexts.includes("+10% Speed"));
  assert.equal(full.totals.armorRating, 176);
  assert.equal(full.totals.speedRating, 10);

  const slot2 = describePetGrants(
    { type: "dog", baseValue: 156, equipSlot: 2, gems: { armor: 20 } },
    { applySlotFraction: true },
  );
  assert.equal(slot2.fraction, PET_COMBAT.SLOT2_FRACTION);
  assert.equal(slot2.totals.armorRating, Math.floor((156 + 20) * 0.4));
}

assert.equal(shouldGrantEggDrop(0, 0, 0.0), true);
assert.equal(shouldGrantEggDrop(ECONOMY_CAPS.eggs, 0, 0.0), false);
assert.equal(shouldGrantEggDrop(0, ECONOMY_CAPS.pets, 0.0), false);
assert.equal(shouldGrantEggDrop(0, 0, 0.99), false);
assert.equal(shouldGrantStimulatorDrop(0, 0.0), true);
assert.equal(shouldGrantStimulatorDrop(STIMULATOR_SOFT_CAP, 0.0), false);

const now = 1_000_000;
assert.equal(applyStimulatorDeadline(now + 10 * 3600_000, now), now + INCUBATION.stimulatorMaxRemainingMs);
assert.equal(
  applyStimulatorDeadline(now + 30_000, now),
  now + 30_000,
  "stimulator never extends a nearer deadline",
);

assert.equal(resolveIncubationDurationMs(undefined), INCUBATION.durationMs);
assert.equal(resolveIncubationDurationMs("5000"), 5000);
assert.equal(resolveIncubationDurationMs("0"), INCUBATION.durationMs);
assert.equal(resolveIncubationDurationMs("-1"), INCUBATION.durationMs);
assert.equal(resolveIncubationDurationMs("abc"), INCUBATION.durationMs);

async function main(): Promise<void> {
  const store = await openTestEconomyStore();
  const redisUrl = store.redisUrl;
  const prefix = store.keyPrefix;

  await store.getOrCreateProfile("PetOwner");

  const egg = await store.grantEgg("PetOwner", now, 10 * 3600_000);
  assert.equal(egg.hatchDeadlineMs, now + 10 * 3600_000);
  assert.equal(await store.countEggs((await store.getOrCreateProfile("PetOwner")).id), 1);

  await store.grantStimulator("PetOwner", now);
  const afterStim = await store.applyStimulator("PetOwner", egg.id, now);
  assert.equal(afterStim.hatchDeadlineMs, now + INCUBATION.stimulatorMaxRemainingMs);
  assert.equal(await store.countStimulators((await store.getOrCreateProfile("PetOwner")).id), 0);

  const pet = await store.hatchEgg("PetOwner", egg.id, now + INCUBATION.stimulatorMaxRemainingMs, {
    type: "cat",
    baseValue: 200,
  });
  assert.equal(pet.type, "cat");
  assert.equal(pet.baseValue, 200);
  assert.equal(await store.countEggs((await store.getOrCreateProfile("PetOwner")).id), 0);
  assert.equal(await store.countPets((await store.getOrCreateProfile("PetOwner")).id), 1);

  await store.equipPet("PetOwner", pet.id, 1);
  const full = await store.getFullProfile("PetOwner");
  assert.equal(full.ratings.healthRating, 200);
  assert.equal(full.slot2Enabled, false);
  await assert.rejects(async () => store.equipPet("PetOwner", pet.id, 2), (err: unknown) => {
    assert.ok(err instanceof EconomyActionError);
    assert.equal(err.code, "slot2_disabled");
    return true;
  });

  await store.getOrCreateProfile("OtherPlayer");
  await assert.rejects(async () => store.equipPet("OtherPlayer", pet.id, 1), (err: unknown) => {
    assert.ok(err instanceof EconomyActionError);
    assert.equal(err.code, "cross_profile");
    return true;
  });
  await assert.rejects(
    async () => store.hatchEgg("OtherPlayer", egg.id, now + INCUBATION.stimulatorMaxRemainingMs),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.ok(err.code === "not_found" || err.code === "cross_profile");
      return true;
    },
  );

  const owner = await store.getOrCreateProfile("PetOwner");
  const hatchNow = now + INCUBATION.stimulatorMaxRemainingMs + 1;
  while ((await store.countPets(owner.id)) < ECONOMY_CAPS.pets - 1) {
    const e = await store.grantEgg("PetOwner", hatchNow, 1);
    await store.hatchEgg("PetOwner", e.id, hatchNow + 1, { type: "dog", baseValue: 10 });
  }
  assert.equal(await store.countPets(owner.id), ECONOMY_CAPS.pets - 1);
  const spareEgg = await store.grantEgg("PetOwner", hatchNow, 1);
  const lastFill = await store.grantEgg("PetOwner", hatchNow, 1);
  await store.hatchEgg("PetOwner", lastFill.id, hatchNow + 1, { type: "bird", baseValue: 11 });
  assert.equal(await store.countPets(owner.id), ECONOMY_CAPS.pets);
  await assert.rejects(async () => store.hatchEgg("PetOwner", spareEgg.id, hatchNow + 1), (err: unknown) => {
    assert.ok(err instanceof EconomyActionError);
    assert.equal(err.code, "pet_cap");
    return true;
  });

  await assert.rejects(async () => store.grantEgg("PetOwner", hatchNow, 1), (err: unknown) => {
    assert.ok(err instanceof EconomyActionError);
    assert.equal(err.code, "pet_cap");
    return true;
  });

  const dropsBotVictim = await store.tryKillItemDrops("PetOwner", false, { egg: 0, stimulator: 0 }, hatchNow);
  assert.equal(dropsBotVictim.egg, null);
  assert.equal(dropsBotVictim.stimulator, false);

  await store.getOrCreateProfile("DropHunter");
  const dropsHuman = await store.tryKillItemDrops(
    "DropHunter",
    true,
    { egg: 0, stimulator: 0 },
    hatchNow,
  );
  assert.ok(dropsHuman.egg, "human victim + roll 0 must grant egg when under caps");
  assert.equal(dropsHuman.stimulator, true);

  const hunter = await store.getOrCreateProfile("StimCapped");
  while ((await store.countStimulators(hunter.id)) < STIMULATOR_SOFT_CAP) {
    await store.grantStimulator("StimCapped", hatchNow);
  }
  const noStim = await store.tryKillItemDrops("StimCapped", true, { egg: 1, stimulator: 0 }, hatchNow);
  assert.equal(noStim.stimulator, false);

  await store.close();

  const reopened = await EconomyStore.open({
    redisUrl,
    keyPrefix: prefix,
    skipSqliteImport: true,
  });
  const restored = await reopened.getFullProfile("PetOwner");
  assert.equal(restored.pets.length, ECONOMY_CAPS.pets);
  assert.ok(restored.pets.some((p) => p.equipSlot === 1));
  await reopened.flushNamespace();
  await reopened.close();

  console.log("[economy-pets] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
