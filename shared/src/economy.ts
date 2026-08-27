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
  inventoryCells: 30,
  petGemSlots: 4,
  amuletDurabilityMax: 10,
  amuletCraftShards: 10,
} as const;

/**
 * Soft cap on growth stimulator rows (EPIC 24 anti-bloat). If at soft-cap,
 * skip stimulator kill drops. Not a hard inventory-grid constraint (EPIC 27).
 */
export const STIMULATOR_SOFT_CAP = 20;

/** Soft cap on repair kit rows (EPIC 25 anti-bloat), same idea as stimulators. */
export const REPAIR_KIT_SOFT_CAP = 20;

/**
 * Independent kill-drop chances (0–1) from TZ §2.10.
 * Egg + growthStimulator (EPIC 24); gem / amulet / repairKit (EPIC 25).
 * Shard is not rolled — granted at 100% when victim has an amulet (see helpers).
 */
export const DROP_CHANCE = {
  egg: 0.15,
  gem: 0.2,
  amulet: 0.02,
  repairKit: 0.1,
  growthStimulator: 0.08,
} as const;

/** Auction fee split (TZ §3.1 / EPIC 38). */
export const AUCTION_FEE = {
  totalFraction: 0.1,
  burnFraction: 0.05,
  developerFraction: 0.05,
} as const;

/** Bidding window for an auction lot (TZ §3.2 / EPIC 38). */
export const AUCTION_DURATION_MS = 24 * 60 * 60 * 1000;

/** Incubation / stimulator timings (TZ §2.3–2.4). */
export const INCUBATION = {
  durationMs: 24 * 60 * 60 * 1000,
  stimulatorMaxRemainingMs: 60 * 60 * 1000,
} as const;

/** Ground drop TTL (TZ §2.9 / §3.3 / EPIC 38). */
export const GROUND_DROP_TTL_MS = 60_000;

// --- Pets / ratings (EPIC 24) ---

export type PetType = "dog" | "cat" | "bird" | "lion";

export const PET_TYPES: readonly PetType[] = ["dog", "cat", "bird", "lion"] as const;

/** EPIC 39: companion sit side relative to the avatar (server-authoritative). */
export type PetSide = "left" | "right";

export const PET_SIDES: readonly PetSide[] = ["left", "right"] as const;

/**
 * EPIC 39: per-equipped-pet cosmetic descriptor broadcast on PlayerState.
 * Client-render only — never hitscan/collision. Palette index, not raw hex.
 */
export interface EquippedPetVisual {
  type: PetType;
  colorIndex: number;
  side: PetSide;
}

export function isPetSide(value: unknown): value is PetSide {
  return value === "left" || value === "right";
}

export function randomPetSide(): PetSide {
  return Math.random() < 0.5 ? "left" : "right";
}

export type RatingKind = "armor" | "health" | "speed" | "damage";

/** Gem type matches a rating axis (EPIC 25). */
export type GemType = RatingKind;

export const GEM_TYPES: readonly GemType[] = ["health", "armor", "speed", "damage"] as const;

/** Inclusive gem value band (TZ §2.5 / EPIC 25). */
export const GEM_VALUE_MIN = 5;
export const GEM_VALUE_MAX = 100;

/**
 * On human death: multiply each active pet base_value and each socketed gem
 * value by this factor, then floor, min 1 (TZ §2.6 / EPIC 25 §2.4).
 */
export const DEATH_EFFECTIVENESS_FACTOR = 0.9;

/** Pet type → primary profile rating (TZ §2.2). */
export const PET_TYPE_RATING: Record<PetType, RatingKind> = {
  dog: "armor",
  cat: "health",
  bird: "speed",
  lion: "damage",
};

/**
 * Match application knobs (EPIC 24 / EPIC 51 pet combat redesign).
 * Tunable here only — combat code must import these, not literals.
 */
export const PET_COMBAT = {
  /** Slot 1 contributes 100% of pet rating. */
  SLOT1_FRACTION: 1,
  /** Slot 2 (amulet-gated) contributes 40% of the pet's full rating vector. */
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

/** Per-axis gem values socketed on a pet (missing key = 0). */
export type PetGemBonuses = Partial<Record<GemType, number>>;

export interface EquippedPetInput {
  type: PetType;
  baseValue: number;
  /** Slot 2 only counts when slot2Enabled (amulet equipped). */
  equipSlot: 1 | 2 | null;
  /** Socketed gem values by type (EPIC 25). */
  gems?: PetGemBonuses;
}

/**
 * Aggregate integer ratings from equipped pets + socketed gems.
 *
 * Per pet, after gems:
 * - Primary axis (species) = base_value + matching gem (if any)
 * - Off-axis = gem value only
 * Then multiply the pet's full vector by slot fraction (1.0 / 0.4) and floor.
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
    const primary = PET_TYPE_RATING[pet.type];
    const gems = pet.gems ?? {};

    for (const kind of GEM_TYPES) {
      const base = kind === primary ? Math.max(0, pet.baseValue) : 0;
      const gemBonus = Math.max(0, gems[kind] ?? 0);
      const contribution = Math.floor((base + gemBonus) * fraction);
      if (contribution <= 0) continue;
      if (kind === "health") ratings.healthRating += contribution;
      else if (kind === "armor") ratings.armorRating += contribution;
      else if (kind === "speed") ratings.speedRating += contribution;
      else ratings.damageRating += contribution;
    }
  }
  return ratings;
}

/** Inventory UI label for a rating axis (EPIC 50/51). */
export function ratingDisplayLabel(kind: RatingKind): string {
  switch (kind) {
    case "health":
      return "HP";
    case "armor":
      return "Armor";
    case "speed":
      return "Speed";
    case "damage":
      return "Damage";
  }
}

/**
 * Compact inventory grant line for one rating axis (EPIC 51).
 * Dog/cat grant flat points; bird/lion grant % bonuses (rating = percent).
 */
export function formatRatingGrant(kind: RatingKind, amount: number): string {
  const n = Math.max(0, Math.floor(amount));
  if (kind === "armor") {
    return `+${n} Armor`;
  }
  if (kind === "health") {
    return `+${n} HP`;
  }
  if (kind === "speed") {
    return `+${n}% Speed`;
  }
  return `+${n}% Damage`;
}

/** e.g. "+156 Armor" — species primary axis, no slot fraction. */
export function formatPetPrimaryGrant(type: PetType, baseValue: number): string {
  const kind = PET_TYPE_RATING[type];
  return formatRatingGrant(kind, baseValue);
}

export interface PetGrantBreakdown {
  /** Slot fraction used for display lines / totals (1 when unequipped). */
  fraction: number;
  /** Species primary grant after fraction, e.g. "+156 Armor". */
  primaryText: string;
  /** Each socketed gem contribution after fraction, e.g. "+20 Armor". */
  gemTexts: string[];
  /** Non-zero axis totals after the same floor rules as aggregateEquippedRatings. */
  totalTexts: string[];
  totals: ProfileRatings;
}

/**
 * Readable pet grant lines for inventory (EPIC 50).
 * Totals use `aggregateEquippedRatings` so display cannot invent combat math.
 * When `applySlotFraction` is true and the pet has equipSlot 1|2, SLOT1/SLOT2
 * fractions apply; otherwise full (unequipped bag) values are shown.
 */
export function describePetGrants(
  pet: {
    type: PetType;
    baseValue: number;
    gems?: PetGemBonuses;
    equipSlot?: 1 | 2 | null;
  },
  options: { applySlotFraction?: boolean } = {},
): PetGrantBreakdown {
  const apply = options.applySlotFraction === true;
  const slot = pet.equipSlot === 1 || pet.equipSlot === 2 ? pet.equipSlot : null;
  const fraction =
    apply && slot === 2
      ? PET_COMBAT.SLOT2_FRACTION
      : apply && slot === 1
        ? PET_COMBAT.SLOT1_FRACTION
        : 1;

  const primaryKind = PET_TYPE_RATING[pet.type];
  const primaryAmount = Math.floor(Math.max(0, pet.baseValue) * fraction);
  const primaryText = formatRatingGrant(primaryKind, primaryAmount);

  const gems = pet.gems ?? {};
  const gemTexts: string[] = [];
  for (const kind of GEM_TYPES) {
    const raw = Math.max(0, gems[kind] ?? 0);
    if (raw <= 0) continue;
    const amount = Math.floor(raw * fraction);
    gemTexts.push(formatRatingGrant(kind, amount));
  }

  // Authoritative totals: treat as slot 1 at full strength when not applying
  // slot fraction; otherwise use the pet's real slot with slot2 enabled.
  const aggregateSlot: 1 | 2 = apply && slot === 2 ? 2 : 1;
  const totals = aggregateEquippedRatings(
    [
      {
        type: pet.type,
        baseValue: pet.baseValue,
        equipSlot: aggregateSlot,
        gems,
      },
    ],
    true,
  );

  const totalTexts: string[] = [];
  if (totals.healthRating > 0) {
    totalTexts.push(formatRatingGrant("health", totals.healthRating));
  }
  if (totals.armorRating > 0) {
    totalTexts.push(formatRatingGrant("armor", totals.armorRating));
  }
  if (totals.speedRating > 0) {
    totalTexts.push(formatRatingGrant("speed", totals.speedRating));
  }
  if (totals.damageRating > 0) {
    totalTexts.push(formatRatingGrant("damage", totals.damageRating));
  }

  return { fraction, primaryText, gemTexts, totalTexts, totals };
}

/** Apply death effectiveness decay: max(1, floor(value * 0.9)). */
export function applyDeathEffectivenessDecay(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.max(1, Math.floor(value * DEATH_EFFECTIVENESS_FACTOR));
}

/** Effective max HP bonus: 1 rating point = 1 HP (EPIC 51 cat). */
export function maxHealthBonusFromRatings(healthRating: number): number {
  return Math.floor(Math.max(0, healthRating));
}

/** Flat absorptive armor points from dog/gem armor rating (EPIC 51). Caller clamps to COMBAT.maxArmor. */
export function armorBonusFromRatings(armorRating: number): number {
  return Math.floor(Math.max(0, armorRating));
}

/** Multiplier on MOVEMENT.maxSpeed (and bunny-hop air speed). +100 rating → 2×. */
export function speedMultiplierFromRatings(speedRating: number): number {
  return 1 + Math.max(0, speedRating) / 100;
}

/** Multiplier on weapon base damage before zone/splash math. +50 rating → ×1.5. */
export function damageMultiplierFromRatings(damageRating: number): number {
  return 1 + Math.max(0, damageRating) / 100;
}

/** Pure drop gate: egg on human kill when under egg/pet caps. */
export function shouldGrantEggDrop(eggs: number, pets: number, roll: number): boolean {
  return eggs < ECONOMY_CAPS.eggs && pets < ECONOMY_CAPS.pets && roll < DROP_CHANCE.egg;
}

/** Pure drop gate: stimulator on human kill when under soft-cap. */
export function shouldGrantStimulatorDrop(stimulators: number, roll: number): boolean {
  return stimulators < STIMULATOR_SOFT_CAP && roll < DROP_CHANCE.growthStimulator;
}

/** Gem loot copy when killer under gem cap and victim has a gem on an equipped pet. */
export function shouldGrantGemDrop(killerGems: number, victimHasEquippedGem: boolean, roll: number): boolean {
  return killerGems < ECONOMY_CAPS.gems && victimHasEquippedGem && roll < DROP_CHANCE.gem;
}

/** Amulet loot copy when victim has an amulet and killer under amulet cap. */
export function shouldGrantAmuletDrop(killerAmulets: number, victimHasAmulet: boolean, roll: number): boolean {
  return victimHasAmulet && killerAmulets < ECONOMY_CAPS.amulets && roll < DROP_CHANCE.amulet;
}

/** Repair kit when under soft-cap. */
export function shouldGrantRepairKitDrop(kits: number, roll: number): boolean {
  return kits < REPAIR_KIT_SOFT_CAP && roll < DROP_CHANCE.repairKit;
}

/**
 * Shard grant (not a random roll): victim has any amulet, killer amulets &lt; 4,
 * shards under cap, and match has not already granted a shard from this victim
 * to this killer.
 */
export function shouldGrantShard(
  killerAmulets: number,
  killerShards: number,
  victimHasAmulet: boolean,
  alreadyGrantedThisMatch: boolean,
): boolean {
  return (
    victimHasAmulet &&
    killerAmulets < ECONOMY_CAPS.amulets &&
    killerShards < ECONOMY_CAPS.shards &&
    !alreadyGrantedThisMatch
  );
}

/** Clamp stimulator: hatch_deadline = min(hatch_deadline, now + stimulatorMaxRemainingMs). Never extends a ready egg. */
export function applyStimulatorDeadline(hatchDeadlineMs: number, nowMs: number): number {
  const capped = nowMs + INCUBATION.stimulatorMaxRemainingMs;
  return Math.min(hatchDeadlineMs, capped);
}

export function isEggReady(hatchDeadlineMs: number, nowMs: number): boolean {
  return nowMs >= hatchDeadlineMs;
}

// --- Inventory grid (EPIC 29 / TZ §2.9; EPIC 53 shrink to 6×5) ---

/**
 * Persisted bag-grid schema version.
 * 1 = legacy 8×8 (implicit for docs without the field).
 * 2 = 6×5 / 30 cells (EPIC 53).
 */
export const INVENTORY_GRID_VERSION = 2 as const;

/** 6×5 bag grid; cells indexed 0..29 row-major. */
export const INVENTORY_GRID = {
  cols: 6,
  rows: 5,
  cells: 30,
} as const;

/** Logical bag item kinds for move/discard and footprint lookup. */
export type InventoryItemType =
  | "pet"
  | "egg"
  | "gem"
  | "amulet"
  | "stimulator"
  | "repair_kit"
  | "shard_stack";

export const INVENTORY_ITEM_TYPES: readonly InventoryItemType[] = [
  "pet",
  "egg",
  "gem",
  "amulet",
  "stimulator",
  "repair_kit",
  "shard_stack",
] as const;

/** Cell footprint: pets/amulets span two horizontal cells; everything else is 1. */
export type InventoryFootprint = 1 | 2;

export function footprintForItemType(type: InventoryItemType): InventoryFootprint {
  return type === "pet" || type === "amulet" ? 2 : 1;
}

export function inventoryRow(anchor: number): number {
  return Math.floor(anchor / INVENTORY_GRID.cols);
}

export function inventoryCol(anchor: number): number {
  return anchor % INVENTORY_GRID.cols;
}

/**
 * Cells occupied by an item whose left/top-left anchor is `anchor`.
 * Returns null when OOB or a 2-cell footprint would wrap to the next row.
 */
export function cellsForAnchor(
  anchor: number,
  footprint: InventoryFootprint,
): number[] | null {
  if (!Number.isInteger(anchor) || anchor < 0 || anchor >= INVENTORY_GRID.cells) {
    return null;
  }
  if (footprint === 1) return [anchor];
  const col = inventoryCol(anchor);
  if (col > INVENTORY_GRID.cols - 2) return null;
  const right = anchor + 1;
  if (right >= INVENTORY_GRID.cells) return null;
  if (inventoryRow(right) !== inventoryRow(anchor)) return null;
  return [anchor, right];
}

/** True when `anchor` is a legal left cell for the given footprint. */
export function isValidAnchor(anchor: number, footprint: InventoryFootprint): boolean {
  return cellsForAnchor(anchor, footprint) !== null;
}

/** First free row-major anchor that fits `footprint` given occupied cells. */
export function findFirstFreeAnchor(
  occupied: ReadonlySet<number>,
  footprint: InventoryFootprint,
): number | null {
  for (let anchor = 0; anchor < INVENTORY_GRID.cells; anchor++) {
    const cells = cellsForAnchor(anchor, footprint);
    if (!cells) continue;
    if (cells.every((c) => !occupied.has(c))) return anchor;
  }
  return null;
}
