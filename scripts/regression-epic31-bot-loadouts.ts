// EPIC 31 "Randomized Bot Equipment Loadouts" regression.
//
// Verifies, against the REAL server code path (PlayerRegistry + BotAI --
// never a parallel calculation):
//  1. generateBotLoadout() produces all 4 documented archetypes (A/B/C/D,
//     spec Section 3.1) with roughly the expected ~25% frequency each, and
//     that each archetype's shape (pet count / slot / amulet flag / baseValue
//     band) matches the spec table exactly.
//  2. BotAI.spawnBots() (the "bots" match-mode path) actually applies a
//     loadout to each spawned bot via registry.applyPetRatings() -- the same
//     entry point applyEconomyCombatToPlayer() uses for humans -- and that a
//     geared bot (archetype D) ends up with a measurably different
//     maxHealth / armor DR / speed multiplier / damage multiplier than a
//     bare archetype-A bot.
//  3. BotAI.spawnBotAt() (the "endless" match-mode path) also assigns a
//     loadout -- not a bots-mode-only feature.

import assert from "node:assert/strict";
import {
  COMBAT,
  armorDrFromRatings,
  damageMultiplierFromRatings,
  maxHealthBonusFromRatings,
  speedMultiplierFromRatings,
} from "../shared/src/index.js";
import { PlayerRegistry } from "../server/src/playerRegistry.js";
import { BotAI, generateBotLoadout, type BotLoadoutArchetype } from "../server/src/botAI.js";

// --- Part 1: pure generator shape + distribution ---

const SAMPLE_SIZE = 4000;
const counts: Record<BotLoadoutArchetype, number> = { A: 0, B: 0, C: 0, D: 0 };

for (let i = 0; i < SAMPLE_SIZE; i++) {
  const loadout = generateBotLoadout();
  counts[loadout.archetype] += 1;

  if (loadout.archetype === "A") {
    assert.equal(loadout.pets.length, 0, "archetype A must have zero pets");
    assert.equal(loadout.hasAmulet, false, "archetype A must have no amulet");
  } else if (loadout.archetype === "B") {
    assert.equal(loadout.pets.length, 1, "archetype B must have exactly 1 pet");
    assert.equal(loadout.pets[0]!.equipSlot, 1, "archetype B's pet must be in slot 1");
    assert.equal(loadout.hasAmulet, false, "archetype B must have no amulet");
  } else if (loadout.archetype === "C") {
    assert.equal(loadout.pets.length, 1, "archetype C must have exactly 1 pet");
    assert.equal(loadout.pets[0]!.equipSlot, 2, "archetype C's pet must be in slot 2");
    assert.equal(loadout.hasAmulet, true, "archetype C must have an amulet");
  } else {
    assert.equal(loadout.pets.length, 2, "archetype D must have exactly 2 pets");
    assert.deepEqual(
      loadout.pets.map((p) => p.equipSlot).sort(),
      [1, 2],
      "archetype D must have one pet in each slot",
    );
    assert.equal(loadout.hasAmulet, true, "archetype D must have an amulet");
  }

  for (const pet of loadout.pets) {
    assert.ok(
      Number.isInteger(pet.baseValue) && pet.baseValue >= 1 && pet.baseValue <= 200,
      `pet baseValue out of documented [1,200] band: ${pet.baseValue}`,
    );
  }
}

console.log(`[epic31] archetype distribution over ${SAMPLE_SIZE} generations:`, counts);
for (const archetype of ["A", "B", "C", "D"] as const) {
  const frequency = counts[archetype] / SAMPLE_SIZE;
  assert.ok(
    frequency > 0.15 && frequency < 0.35,
    `archetype ${archetype} frequency ${frequency.toFixed(3)} outside expected ~25% (uniform-of-4) band`,
  );
}

// --- Part 2: real BotAI.spawnBots() code path -- stat differences ---

const registry = new PlayerRegistry();
const botAI = new BotAI(registry);
botAI.setTickDtSeconds(0.05);

interface Observed {
  id: string;
  archetype: BotLoadoutArchetype;
  maxHealth: number;
  armorDr: number;
  speedMult: number;
  damageMult: number;
}

function classify(equippedPetTypesLength: number, hasAmulet: boolean): BotLoadoutArchetype {
  if (equippedPetTypesLength === 0) return "A";
  if (equippedPetTypesLength === 2) return "D";
  return hasAmulet ? "C" : "B";
}

const observed: Observed[] = [];
const seenArchetypes = new Set<BotLoadoutArchetype>();
let spawnCount = 0;
while (seenArchetypes.size < 4 && spawnCount < 500) {
  const [id] = botAI.spawnBots(1);
  spawnCount += 1;
  const player = registry.getPlayer(id!)!;
  const archetype = classify(player.equippedPetTypes.length, player.hasAmulet);
  seenArchetypes.add(archetype);
  observed.push({
    id: id!,
    archetype,
    maxHealth: player.maxHealth,
    armorDr: armorDrFromRatings(player.petRatings.armorRating),
    speedMult: speedMultiplierFromRatings(player.petRatings.speedRating),
    damageMult: damageMultiplierFromRatings(player.petRatings.damageRating),
  });
  botAI.removeBot(id!);
}

assert.equal(
  seenArchetypes.size,
  4,
  `expected to observe all 4 archetypes within ${spawnCount} "bots"-mode spawns, saw: ${[...seenArchetypes].join(",")}`,
);
console.log(`[epic31] observed all 4 archetypes (bots-mode spawnBots()) within ${spawnCount} spawns`);

const bareA = observed.find((o) => o.archetype === "A")!;
assert.equal(bareA.maxHealth, COMBAT.maxHealth, "archetype A must be exactly baseline maxHealth (unchanged today's behavior)");
assert.equal(bareA.armorDr, 0, "archetype A must have zero armor DR");
assert.equal(bareA.speedMult, 1, "archetype A must have a 1x speed multiplier");
assert.equal(bareA.damageMult, 1, "archetype A must have a 1x damage multiplier");

const gearedD = observed.filter((o) => o.archetype === "D");
assert.ok(gearedD.length > 0, "expected at least one archetype-D observation");
const buffedD = gearedD.find(
  (o) => o.maxHealth > bareA.maxHealth || o.armorDr > 0 || o.speedMult > 1 || o.damageMult > 1,
);
assert.ok(
  buffedD,
  "expected at least one archetype-D bot to show a measurable stat increase (maxHealth/DR/speed/damage) over the bare baseline",
);
console.log("[epic31] archetype A (bare) baseline stats:", bareA);
console.log("[epic31] archetype D (geared) sample stats, real registry.applyPetRatings() output:", buffedD);

// --- Part 3: "endless" match-mode spawn path (spawnBotAt) also gets a loadout ---

const endlessRegistry = new PlayerRegistry();
const endlessBotAI = new BotAI(endlessRegistry);
endlessBotAI.setTickDtSeconds(0.05);

const endlessObserved: { id: string; archetype: BotLoadoutArchetype }[] = [];
for (let i = 0; i < 60; i++) {
  const id = `endless-bot-${i}`;
  endlessBotAI.spawnBotAt(id, { x: 0, y: 0, z: 0 }, id);
  const player = endlessRegistry.getPlayer(id)!;
  const archetype = classify(player.equippedPetTypes.length, player.hasAmulet);
  endlessObserved.push({ id, archetype });
  // Confirm applyPetRatings() actually ran for this bot: maxHealth must be
  // internally consistent with the ratings the registry stored (this would
  // fail if spawnBotAt() ever stopped calling applyBotLoadout()).
  assert.equal(
    player.maxHealth,
    COMBAT.maxHealth + maxHealthBonusFromRatings(player.petRatings.healthRating),
    `endless bot ${id} maxHealth inconsistent with its own stored petRatings`,
  );
  endlessBotAI.removeBot(id);
}

const endlessArchetypesSeen = new Set(endlessObserved.map((o) => o.archetype));
assert.ok(
  endlessArchetypesSeen.size > 1,
  `expected endless-mode spawnBotAt() to also produce varied archetypes across 60 spawns, saw only: ${[...endlessArchetypesSeen].join(",")}`,
);
console.log(
  `[epic31] endless-mode spawnBotAt() archetypes observed across ${endlessObserved.length} spawns:`,
  [...endlessArchetypesSeen].sort(),
);

console.log("[epic31-bot-loadouts] PASS");
