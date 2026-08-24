// EPIC 24 regression: eggs, stimulators, hatch, equip ratings, pet cap,
// human-only drop helper. Gold path covered by regression:economy-gold.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMBAT,
  ECONOMY_CAPS,
  INCUBATION,
  PET_COMBAT,
  STIMULATOR_SOFT_CAP,
  aggregateEquippedRatings,
  applyArmorDr,
  applyStimulatorDeadline,
  armorDrFromRatings,
  damageMultiplierFromRatings,
  maxHealthBonusFromRatings,
  shouldGrantEggDrop,
  shouldGrantStimulatorDrop,
  speedMultiplierFromRatings,
} from "@cubewars/shared";
import {
  EconomyActionError,
  EconomyStore,
  resolveIncubationDurationMs,
} from "../server/src/economy/index.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cubewars-economy-pets-"));
const dbPath = path.join(tmpDir, "economy.sqlite");

// --- Shared math knobs ---
assert.equal(maxHealthBonusFromRatings(200), 50);
assert.equal(armorDrFromRatings(200), 0.1);
assert.ok(armorDrFromRatings(9999) <= PET_COMBAT.ARMOR_DR_CAP);
assert.equal(speedMultiplierFromRatings(200), 1.1);
assert.equal(damageMultiplierFromRatings(200), 1.2);
assert.equal(applyArmorDr(100, 200), 90);
assert.equal(
  aggregateEquippedRatings([{ type: "lion", baseValue: 100, equipSlot: 1 }]).damageRating,
  100,
);
assert.equal(
  aggregateEquippedRatings([{ type: "lion", baseValue: 100, equipSlot: 2 }], false).damageRating,
  0,
  "slot 2 ignored when disabled",
);
assert.equal(COMBAT.maxHealth + maxHealthBonusFromRatings(200), 150);

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

// Env override for incubation (positive int only).
assert.equal(resolveIncubationDurationMs(undefined), INCUBATION.durationMs);
assert.equal(resolveIncubationDurationMs("5000"), 5000);
assert.equal(resolveIncubationDurationMs("0"), INCUBATION.durationMs);
assert.equal(resolveIncubationDurationMs("-1"), INCUBATION.durationMs);
assert.equal(resolveIncubationDurationMs("abc"), INCUBATION.durationMs);

const store = EconomyStore.open(dbPath);
store.getOrCreateProfile("PetOwner");

// Grant egg with long incubation, then stimulator clamps remaining to 1h.
const egg = store.grantEgg("PetOwner", now, 10 * 3600_000);
assert.equal(egg.hatchDeadlineMs, now + 10 * 3600_000);
assert.equal(store.countEggs(store.getOrCreateProfile("PetOwner").id), 1);

// Stimulator clamp.
store.grantStimulator("PetOwner", now);
const afterStim = store.applyStimulator("PetOwner", egg.id, now);
assert.equal(afterStim.hatchDeadlineMs, now + INCUBATION.stimulatorMaxRemainingMs);
assert.equal(store.countStimulators(store.getOrCreateProfile("PetOwner").id), 0);

// Hatch → pet.
const pet = store.hatchEgg("PetOwner", egg.id, now + INCUBATION.stimulatorMaxRemainingMs, {
  type: "cat",
  baseValue: 200,
});
assert.equal(pet.type, "cat");
assert.equal(pet.baseValue, 200);
assert.equal(store.countEggs(store.getOrCreateProfile("PetOwner").id), 0);
assert.equal(store.countPets(store.getOrCreateProfile("PetOwner").id), 1);

// Equip ratings math.
store.equipPet("PetOwner", pet.id, 1);
const full = store.getFullProfile("PetOwner");
assert.equal(full.ratings.healthRating, 200);
assert.equal(full.slot2Enabled, false);
assert.throws(() => store.equipPet("PetOwner", pet.id, 2), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "slot2_disabled");
  return true;
});

// Cross-profile reject.
store.getOrCreateProfile("OtherPlayer");
assert.throws(() => store.equipPet("OtherPlayer", pet.id, 1), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "cross_profile");
  return true;
});
assert.throws(
  () => store.hatchEgg("OtherPlayer", egg.id, now + INCUBATION.stimulatorMaxRemainingMs),
  (err: unknown) => {
    assert.ok(err instanceof EconomyActionError);
    // egg was deleted on hatch — not_found is also acceptable; if somehow still there, cross_profile
    assert.ok(err.code === "not_found" || err.code === "cross_profile");
    return true;
  },
);

// Pet cap block (8 pets): leave a spare egg, fill to 8 pets, then hatch fails.
const owner = store.getOrCreateProfile("PetOwner");
const hatchNow = now + INCUBATION.stimulatorMaxRemainingMs + 1;
while (store.countPets(owner.id) < ECONOMY_CAPS.pets - 1) {
  const e = store.grantEgg("PetOwner", hatchNow, 1);
  store.hatchEgg("PetOwner", e.id, hatchNow + 1, { type: "dog", baseValue: 10 });
}
assert.equal(store.countPets(owner.id), ECONOMY_CAPS.pets - 1);
const spareEgg = store.grantEgg("PetOwner", hatchNow, 1);
const lastFill = store.grantEgg("PetOwner", hatchNow, 1);
store.hatchEgg("PetOwner", lastFill.id, hatchNow + 1, { type: "bird", baseValue: 11 });
assert.equal(store.countPets(owner.id), ECONOMY_CAPS.pets);
assert.throws(() => store.hatchEgg("PetOwner", spareEgg.id, hatchNow + 1), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "pet_cap");
  return true;
});

// Cannot grant more eggs once pets are at cap.
assert.throws(() => store.grantEgg("PetOwner", hatchNow, 1), (err: unknown) => {
  assert.ok(err instanceof EconomyActionError);
  assert.equal(err.code, "pet_cap");
  return true;
});

// Human-only drop helper.
const dropsBotVictim = store.tryKillItemDrops("PetOwner", false, { egg: 0, stimulator: 0 }, hatchNow);
assert.equal(dropsBotVictim.egg, null);
assert.equal(dropsBotVictim.stimulator, false);

// Fresh profile for drop success under caps.
store.getOrCreateProfile("DropHunter");
const dropsHuman = store.tryKillItemDrops(
  "DropHunter",
  true,
  { egg: 0, stimulator: 0 },
  hatchNow,
);
assert.ok(dropsHuman.egg, "human victim + roll 0 must grant egg when under caps");
assert.equal(dropsHuman.stimulator, true);

// Stimulator soft-cap: fill to 20 then drop skipped.
const hunter = store.getOrCreateProfile("StimCapped");
while (store.countStimulators(hunter.id) < STIMULATOR_SOFT_CAP) {
  store.grantStimulator("StimCapped", hatchNow);
}
const noStim = store.tryKillItemDrops("StimCapped", true, { egg: 1, stimulator: 0 }, hatchNow);
assert.equal(noStim.stimulator, false);

store.close();

const reopened = EconomyStore.open(dbPath);
const restored = reopened.getFullProfile("PetOwner");
assert.equal(restored.pets.length, ECONOMY_CAPS.pets);
assert.ok(restored.pets.some((p) => p.equipSlot === 1));
reopened.close();

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("[economy-pets] PASS");
