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
// Placement discipline matches SPAWN_POINTS (shared/src/mapData.ts): every
// point below is pre-checked to sit clear of every ARENA_GEOMETRY wall/crate
// footprint, spread across both sites + mid + tunnel (EPIC 6 Story 6.1
// output). See individual comments for the ARENA_GEOMETRY boxes each point
// was checked against.

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
 * Fixed pickup spawn points. Spread across both sites, mid lane, and the
 * tunnel (EPIC 6 Story 6.1 AC; EPIC 7 adds health/armor points in the same
 * spirit). Coordinates deliberately avoid SPAWN_POINTS (shared/src/mapData.ts)
 * as well as every wall/crate in ARENA_GEOMETRY:
 *
 * - Site A / Site B points sit in open corners of each site (x ~ ±42),
 *   clear of crate_a1/a2/a3 and crate_b1/b2/b3 (all within |x| <= 39).
 * - The mid-lane point sits at the corridor's open center (x=0, z=0),
 *   clear of crate_mid1/crate_mid2 (both offset >= 7 units from center) and
 *   the mid_wall_south/mid_wall_north corridor walls (z = ±4).
 * - The tunnel point sits at the tunnel corridor's open center (x=0, z=16),
 *   clear of tunnel_wall_south/tunnel_wall_north (z = 12 / 20).
 * - EPIC 7's health points sit at x = ±42, z = 0 — same open-corner column
 *   as the Site A/B weapon/ammo points above (verified clear of every
 *   crate_a and crate_b footprint and >=20 units from the existing
 *   weapon/ammo points at z = ±20 in the same column, so they don't cluster).
 * - EPIC 7's armor points sit at x = ±10, z = 16 — inside the tunnel's open
 *   corridor (clear of tunnel_wall_south/north at z = 12/20 and of
 *   divider_west/east_mid at x = ±20), 10 units from the existing
 *   ammo_gl_tunnel point at (0, 16) so they don't cluster on top of it.
 */
export const PICKUP_SPAWN_POINTS: PickupSpawnPoint[] = [
  { id: "weapon_rifle_site_a", category: "weapon", weapon: "rifle", position: { x: -42, y: 0, z: 20 } },
  { id: "weapon_rifle_site_b", category: "weapon", weapon: "rifle", position: { x: 42, y: 0, z: -20 } },
  { id: "weapon_gl_mid", category: "weapon", weapon: "grenade_launcher", position: { x: 0, y: 0, z: 0 } },

  { id: "ammo_rifle_site_a", category: "ammo", weapon: "rifle", position: { x: -42, y: 0, z: -20 } },
  { id: "ammo_rifle_site_b", category: "ammo", weapon: "rifle", position: { x: 42, y: 0, z: 20 } },
  { id: "ammo_gl_tunnel", category: "ammo", weapon: "grenade_launcher", position: { x: 0, y: 0, z: 16 } },

  // --- EPIC 7: health & armor pickups (reusing this same spawner) ---
  { id: "health_site_a", category: "health", position: { x: -42, y: 0, z: 0 } },
  { id: "health_site_b", category: "health", position: { x: 42, y: 0, z: 0 } },
  { id: "armor_tunnel_west", category: "armor", position: { x: -10, y: 0, z: 16 } },
  { id: "armor_tunnel_east", category: "armor", position: { x: 10, y: 0, z: 16 } },
];

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
}
