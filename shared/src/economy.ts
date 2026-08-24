// Emerald Wasteland economy numeric knobs (TZ v2.1).
// Server imports these for grants/caps; later EPICs use the same constants
// for drop rolls and inventory limits. Keep every balance number here —
// never duplicate literals in handlers.

/** Inclusive gold band granted on an eligible confirmed kill (TZ §2.10 / §3.1). */
export const GOLD_DROP_MIN = 1;
export const GOLD_DROP_MAX = 500;

/** Inventory / item caps (equipped + bag). Defined now for later EPICs. */
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
 * Independent kill-drop chances (0–1) from TZ §2.10.
 * Unused in EPIC 23; reserved for EPIC 26 drop table work.
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

/** Incubation / stimulator timings (TZ §2.3–2.4) — reserved for EPIC 24. */
export const INCUBATION = {
  durationMs: 24 * 60 * 60 * 1000,
  stimulatorMaxRemainingMs: 60 * 60 * 1000,
} as const;

/** Ground drop TTL (TZ §2.9 / §3.3) — reserved for EPIC 28. */
export const GROUND_DROP_TTL_MS = 60_000;
