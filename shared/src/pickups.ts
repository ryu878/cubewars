// Generic pickup-spawn infrastructure (EPIC 6 Story 6.1) — fixed spawn
// points, their static category/weapon identity, and the respawn-delay
// formula. Built generically (category + target weapon per point) so EPIC
// 7's health/armor pickups can reuse the same spawner shape (server/src/
// pickupSpawner.ts) rather than a second implementation, per the EPIC 6 spec
// "Design note for EPIC 9 compatibility" / EPIC 7 interaction note.
//
// Placement discipline matches SPAWN_POINTS (shared/src/mapData.ts): every
// point below is pre-checked to sit clear of every ARENA_GEOMETRY wall/crate
// footprint, spread across both sites + mid + tunnel (EPIC 6 Story 6.1
// output). See individual comments for the ARENA_GEOMETRY boxes each point
// was checked against.

import type { Vector3 } from "./types.js";
import type { WeaponType } from "./weapons.js";

export type PickupCategory = "weapon" | "ammo";

export interface PickupSpawnPoint {
  id: string;
  category: PickupCategory;
  /** Which weapon this point's item is for — same field for both categories, since a weapon pickup and an ammo pickup for that weapon apply the identical effect server-side (EPIC 6 spec Section 2). Never "pistol": the pistol is owned from spawn and never spawns as a pickup. */
  weapon: WeaponType;
  position: Vector3;
}

/**
 * Fixed pickup spawn points. Spread across both sites, mid lane, and the
 * tunnel (EPIC 6 Story 6.1 AC). Coordinates deliberately avoid SPAWN_POINTS
 * (shared/src/mapData.ts) as well as every wall/crate in ARENA_GEOMETRY:
 *
 * - Site A / Site B points sit in open corners of each site (x ~ ±42),
 *   clear of crate_a1/a2/a3 and crate_b1/b2/b3 (all within |x| <= 39).
 * - The mid-lane point sits at the corridor's open center (x=0, z=0),
 *   clear of crate_mid1/crate_mid2 (both offset >= 7 units from center) and
 *   the mid_wall_south/mid_wall_north corridor walls (z = ±4).
 * - The tunnel point sits at the tunnel corridor's open center (x=0, z=16),
 *   clear of tunnel_wall_south/tunnel_wall_north (z = 12 / 20).
 */
export const PICKUP_SPAWN_POINTS: PickupSpawnPoint[] = [
  { id: "weapon_rifle_site_a", category: "weapon", weapon: "rifle", position: { x: -42, y: 0, z: 20 } },
  { id: "weapon_rifle_site_b", category: "weapon", weapon: "rifle", position: { x: 42, y: 0, z: -20 } },
  { id: "weapon_gl_mid", category: "weapon", weapon: "grenade_launcher", position: { x: 0, y: 0, z: 0 } },

  { id: "ammo_rifle_site_a", category: "ammo", weapon: "rifle", position: { x: -42, y: 0, z: -20 } },
  { id: "ammo_rifle_site_b", category: "ammo", weapon: "rifle", position: { x: 42, y: 0, z: 20 } },
  { id: "ammo_gl_tunnel", category: "ammo", weapon: "grenade_launcher", position: { x: 0, y: 0, z: 16 } },
];

/**
 * Respawn-delay formula bases (EPIC 6 Story 6.1): `delayMs = clamp(baseDelayMs
 * / playerCount, minDelayMs, baseDelayMs)`, scaled by currently connected+
 * alive player count. Keyed by category since the formula's base/min differ
 * per category, not per specific weapon.
 */
export const PICKUP_RESPAWN: Record<PickupCategory, { baseDelayMs: number; minDelayMs: number }> = {
  weapon: { baseDelayMs: 25000, minDelayMs: 10000 },
  ammo: { baseDelayMs: 18000, minDelayMs: 7000 },
};

/** Horizontal radius (world units) within which a player standing near a spawn point picks it up. Server-checked against the player's own authoritative position — see server/src/pickupSpawner.ts. */
export const PICKUP_RADIUS = 1.5;

/** One pickup's current on/off state, as broadcast to clients (see PickupStateMessage in index.ts). */
export interface PickupStatus {
  id: string;
  active: boolean;
}
