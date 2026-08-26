// Generic pickup-spawn infrastructure (EPIC 6 Story 6.1) — fixed spawn
// points, their static category/weapon identity, and the respawn-delay
// formula. Built generically (category + target weapon per point) so EPIC
// 7's health/armor pickups can reuse the same spawner shape (server/src/
// pickupSpawner.ts) rather than a second implementation, per the EPIC 6 spec
// "Design note for EPIC 9 compatibility" / EPIC 7 interaction note.
//
// EPIC 7 ("Health & Armor Pickups") extends this SAME list/formula with two
// more categories ("health"/"armor") rather than forking a second spawner —
// see docs/tasks/epic-07-health-armor.md Section 1 "Interaction with other
// components". Health/armor points carry no `weapon` (that field only means
// something for "weapon"/"ammo" categories — a fixed pickup category doesn't
// target a specific weapon).
//
// Placement discipline: every point is intended to sit clear of that map's
// wall/crate/prop footprints. Prefer getMap(mapId).pickupPoints for
// match-scoped spawns (EPIC 46). PICKUP_SPAWN_POINTS aliases Base.

import type { Vector3 } from "./types.js";
import type { WeaponType } from "./weapons.js";

export type PickupCategory = "weapon" | "ammo" | "health" | "armor";

export interface PickupSpawnPoint {
  id: string;
  category: PickupCategory;
  /**
   * Which weapon this point's item is for — same field for both "weapon"
   * and "ammo" categories, since a weapon pickup and an ammo pickup for
   * that weapon apply the identical effect server-side (EPIC 6 spec Section
   * 2). Never "pistol": the pistol is owned from spawn and never spawns as
   * a pickup. Omitted (undefined) for "health"/"armor" categories (EPIC 7):
   * those apply a fixed, weapon-independent effect (heal / add armor).
   */
  weapon?: WeaponType;
  position: Vector3;
}

/**
 * Legacy alias: Base map pickup points (EPIC 46). Prefer
 * `getMap(mapId).pickupPoints` for match-scoped geometry.
 */
import { BASE_MAP } from "./maps/base.js";

export const PICKUP_SPAWN_POINTS: PickupSpawnPoint[] = BASE_MAP.pickupPoints;

/**
 * Respawn-delay formula bases (EPIC 6 Story 6.1, extended by EPIC 7 Section
 * 2 for the health/armor categories): `delayMs = clamp(baseDelayMs /
 * playerCount, minDelayMs, baseDelayMs)`, scaled by currently connected+
 * alive player count. Keyed by category since the formula's base/min differ
 * per category, not per specific weapon.
 */
export const PICKUP_RESPAWN: Record<PickupCategory, { baseDelayMs: number; minDelayMs: number }> = {
  weapon: { baseDelayMs: 25000, minDelayMs: 10000 },
  ammo: { baseDelayMs: 18000, minDelayMs: 7000 },
  health: { baseDelayMs: 20000, minDelayMs: 8000 },
  armor: { baseDelayMs: 35000, minDelayMs: 15000 },
};

/** Horizontal radius (world units) within which a player standing near a spawn point picks it up. Server-checked against the player's own authoritative position — see server/src/pickupSpawner.ts. */
export const PICKUP_RADIUS = 1.5;

/**
 * Color identity for the EPIC 7 health/armor pickup categories — same
 * "one definition, imported by both client render and HUD" discipline as
 * WEAPON_STATS[...].color (shared/src/weapons.ts), and deliberately distinct
 * from every weapon color (pistol grey 0x9e9e9e, rifle orange 0xff8c00,
 * grenade launcher red/purple 0x9b30ff) and from the ammo-crate shading of
 * those same colors, per the EPIC 7 spec Task 5 ask.
 */
export const HEALTH_PICKUP_COLOR = 0xf2f2f2; // near-white base (medkit body)
/** Accent color for the health pickup's cross mark (client/src/pickups.ts) — the "red cross" half of the white/red-cross tone. */
export const HEALTH_PICKUP_ACCENT_COLOR = 0xd32f2f; // red cross
export const ARMOR_PICKUP_COLOR = 0x2f6fae; // steel blue

/** One pickup's current on/off state, as broadcast to clients (see PickupStateMessage in index.ts). */
export interface PickupStatus {
  id: string;
  active: boolean;
  category?: PickupCategory;
  weapon?: WeaponType;
  position?: Vector3;
}
