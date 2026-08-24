// Emerald Wasteland economy numeric knobs (TZ v2.1).
// Server imports these for grants/caps; client may display the same constants
// for HUD copy. Keep every balance number here — never duplicate literals in
// handlers.

/** Inclusive gold band granted on an eligible confirmed kill (TZ §2.10 / §3.1). */
export const GOLD_DROP_MIN = 1;
export const GOLD_DROP_MAX = 500;

/** Inventory / item caps (equipped + bag). */
export const ECONOMY_CAPS = {
  pets: 8,
  eggs: 3,
  gems: 20,
  amulets: 4,
  shards: 10,
  inventoryCells: 64,
  petGemSlots: 4,
  amuletDurabilityMax: 10,
  amuletCraftShards: 10,
} as const;

/**
 * Soft cap on growth stimulator rows (EPIC 24 anti-bloat). If at soft-cap,
 * skip stimulator kill drops. Not a hard inventory-grid constraint (EPIC 27).
 */
export const STIMULATOR_SOFT_CAP = 20;

/**
 * Independent kill-drop chances (0–1) from TZ §2.10.
 * Egg + growthStimulator used in EPIC 24; gem/amulet/repairKit reserved.
 */
export const DROP_CHANCE = {
  egg: 0.15,
  gem: 0.2,
  amulet: 0.02,
  repairKit: 0.1,
  growthStimulator: 0.08,
} as const;

/** Auction fee split (TZ §3.1) — reserved for EPIC 28. */
export const AUCTION_FEE = {
  totalFraction: 0.1,
  burnFraction: 0.05,
  developerFraction: 0.05,
} as const;

/** Incubation / stimulator timings (TZ §2.3–2.4). */
export const INCUBATION = {
  durationMs: 24 * 60 * 60 * 1000,
  stimulatorMaxRemainingMs: 60 * 60 * 1000,
} as const;

/** Ground drop TTL (TZ §2.9 / §3.3) — reserved for EPIC 28. */
export const GROUND_DROP_TTL_MS = 60_000;

// --- Pets / ratings (EPIC 24) ---

export type PetType = "dog" | "cat" | "bird" | "lion";

export const PET_TYPES: readonly PetType[] = ["dog", "cat", "bird", "lion"] as const;

export type RatingKind = "armor" | "health" | "speed" | "damage";

/** Pet type → primary profile rating (TZ §2.2). */
export const PET_TYPE_RATING: Record<PetType, RatingKind> = {
  dog: "armor",
  cat: "health",
  bird: "speed",
  lion: "damage",
};

/**
 * Match application knobs (EPIC 24 Team Lead starters).
 * Tunable here only — combat code must import these, not literals.
 */
export const PET_COMBAT = {
  /** healthRating 200 → +50 max HP. */
  HEALTH_HP_PER_POINT: 0.25,
  /** armorRating 200 → 10% DR before EPIC 7 absorptive armor. */
  ARMOR_DR_PER_POINT: 0.0005,
  /** Hard cap on pet %DR. */
  ARMOR_DR_CAP: 0.35,
  /** speedRating 200 → +10% move speed. */
  SPEED_PER_POINT: 0.0005,
  /** damageRating 200 → +20% weapon damage. */
  DAMAGE_PER_POINT: 0.001,
  /** Slot 1 contributes 100% of pet rating. */
  SLOT1_FRACTION: 1,
  /** Slot 2 (amulet-gated, EPIC 25) would contribute 40%; unused while slot2Enabled=false. */
  SLOT2_FRACTION: 0.4,
} as const;

export interface ProfileRatings {
  healthRating: number;
  armorRating: number;
  speedRating: number;
  damageRating: number;
}

export function emptyRatings(): ProfileRatings {
  return { healthRating: 0, armorRating: 0, speedRating: 0, damageRating: 0 };
}

export interface EquippedPetInput {
  type: PetType;
  baseValue: number;
  /** Only slot 1 is functional in EPIC 24; slot 2 ignored unless slot2Enabled. */
  equipSlot: 1 | 2 | null;
}

/**
 * Aggregate integer ratings from equipped pets (no gems in EPIC 24).
 * Slot 2 is ignored when `slot2Enabled` is false.
 */
export function aggregateEquippedRatings(
  pets: readonly EquippedPetInput[],
  slot2Enabled: boolean = false,
): ProfileRatings {
  const ratings = emptyRatings();
  for (const pet of pets) {
    if (pet.equipSlot !== 1 && pet.equipSlot !== 2) continue;
    if (pet.equipSlot === 2 && !slot2Enabled) continue;
    const fraction = pet.equipSlot === 1 ? PET_COMBAT.SLOT1_FRACTION : PET_COMBAT.SLOT2_FRACTION;
    const contribution = Math.floor(Math.max(0, pet.baseValue) * fraction);
    if (contribution <= 0) continue;
    const kind = PET_TYPE_RATING[pet.type];
    if (kind === "health") ratings.healthRating += contribution;
    else if (kind === "armor") ratings.armorRating += contribution;
    else if (kind === "speed") ratings.speedRating += contribution;
    else ratings.damageRating += contribution;
  }
  return ratings;
}

/** Effective max HP = COMBAT.maxHealth + floor(healthRating * HP_PER_POINT). */
export function maxHealthBonusFromRatings(healthRating: number): number {
  return Math.floor(Math.max(0, healthRating) * PET_COMBAT.HEALTH_HP_PER_POINT);
}

/** Pet %DR in [0, ARMOR_DR_CAP]. */
export function armorDrFromRatings(armorRating: number): number {
  return Math.min(PET_COMBAT.ARMOR_DR_CAP, Math.max(0, armorRating) * PET_COMBAT.ARMOR_DR_PER_POINT);
}

/** Multiplier on MOVEMENT.maxSpeed (and bunny-hop air speed). */
export function speedMultiplierFromRatings(speedRating: number): number {
  return 1 + Math.max(0, speedRating) * PET_COMBAT.SPEED_PER_POINT;
}

/** Multiplier on weapon base damage before zone/splash math. */
export function damageMultiplierFromRatings(damageRating: number): number {
  return 1 + Math.max(0, damageRating) * PET_COMBAT.DAMAGE_PER_POINT;
}

/**
 * Apply pet %DR to raw incoming damage before EPIC 7 absorptive armor.
 * Returns a non-negative integer.
 */
export function applyArmorDr(rawDamage: number, armorRating: number): number {
  if (!Number.isFinite(rawDamage) || rawDamage <= 0) return 0;
  const reduced = Math.floor(rawDamage * (1 - armorDrFromRatings(armorRating)));
  return Math.max(0, reduced);
}

/** Pure drop gate: egg on human kill when under egg/pet caps. */
export function shouldGrantEggDrop(eggs: number, pets: number, roll: number): boolean {
  return eggs < ECONOMY_CAPS.eggs && pets < ECONOMY_CAPS.pets && roll < DROP_CHANCE.egg;
}

/** Pure drop gate: stimulator on human kill when under soft-cap. */
export function shouldGrantStimulatorDrop(stimulators: number, roll: number): boolean {
  return stimulators < STIMULATOR_SOFT_CAP && roll < DROP_CHANCE.growthStimulator;
}

/** Clamp stimulator: hatch_deadline = min(hatch_deadline, now + stimulatorMaxRemainingMs). Never extends a ready egg. */
export function applyStimulatorDeadline(hatchDeadlineMs: number, nowMs: number): number {
  const capped = nowMs + INCUBATION.stimulatorMaxRemainingMs;
  return Math.min(hatchDeadlineMs, capped);
}

export function isEggReady(hatchDeadlineMs: number, nowMs: number): boolean {
  return nowMs >= hatchDeadlineMs;
}
