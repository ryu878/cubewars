// EPIC 46: shared static map catalog types + AABB box primitives.
// Geometry/spawns/pickups are the server-authoritative source for
// non-endless matches; clients render from map_state / pickup_state only.

import type { PickupSpawnPoint } from "../pickups.js";
import type { Vector3 } from "../types.js";

/**
 * Box kind for collision/rendering.
 * - wall: always blocks horizontally (and hitscan)
 * - crate: climbable; blocks only while feet are below its top
 * - prop: blocking silhouette (car, tank hull, etc.) — same collision as wall
 *
 * Doors/windows are NOT box kinds — they are gaps between wall segments
 * (same pattern as endless maze doors).
 */
export type MapBoxKind = "wall" | "crate" | "prop";

/** One axis-aligned box: center + full size (width/height/depth, not half-extents). */
export interface MapBox {
  id: string;
  kind: MapBoxKind;
  center: Vector3;
  size: Vector3;
}

export interface AabbBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Compute the min/max bounds of a box from its center + size. */
export function boxBounds(box: MapBox): AabbBounds {
  return {
    minX: box.center.x - box.size.x / 2,
    maxX: box.center.x + box.size.x / 2,
    minY: box.center.y - box.size.y / 2,
    maxY: box.center.y + box.size.y / 2,
    minZ: box.center.z - box.size.z / 2,
    maxZ: box.center.z + box.size.z / 2,
  };
}

export type MapId =
  | "base"
  | "rust_canyon"
  | "glass_dome"
  | "dead_station"
  | "fuel_depot"
  | "crystal_cave"
  | "abyss_bridge"
  | "elite_quarter";

export const MAP_IDS: readonly MapId[] = [
  "base",
  "rust_canyon",
  "glass_dome",
  "dead_station",
  "fuel_depot",
  "crystal_cave",
  "abyss_bridge",
  "elite_quarter",
] as const;

export function isMapId(value: unknown): value is MapId {
  return typeof value === "string" && (MAP_IDS as readonly string[]).includes(value);
}

export interface MapBounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** EPIC 59: per-map hazardous mid-map rift medium (visual + DoT theme). */
export type MapRiftHazardKind =
  | "water_piranha"
  | "lava"
  | "acid"
  | "toxic_sludge"
  | "oil_fire"
  | "plasma"
  | "void_ink"
  | "molten_gold";

/** One control point of an authored / finalized rift polyline (XZ only). */
export interface MapRiftPoint {
  x: number;
  z: number;
}

/**
 * EPIC 59: irregular thick-polyline hazard on a catalog map.
 * Not a blocking MapBox — cosmetic on client; DoT is server-authoritative.
 */
export interface MapRiftHazard {
  kind: MapRiftHazardKind;
  /** Zig-zag control points (≥6). World XZ after finalize. */
  polyline: MapRiftPoint[];
  /** Half-width of the thick polyline (world units after finalize). */
  halfWidth: number;
  /** Continuous armor→health drain while grounded inside the footprint. */
  damagePerSecond: number;
}

export interface MapDefinition {
  id: MapId;
  /** English UI name. */
  displayName: string;
  /** Optional Russian lobby label. */
  displayNameRu?: string;
  bounds: MapBounds2D;
  geometry: MapBox[];
  spawnPoints: Vector3[];
  pickupPoints: PickupSpawnPoint[];
  /** EPIC 59: mid-map rift hazard (absent for endless / maps without one). */
  rift?: MapRiftHazard;
}

/**
 * EPIC 50: catalog maps are authored at the pre-EPIC-50 envelope (±92 / ±52),
 * then scaled by this factor on X/Z (centers + sizes). Y / WALL_HEIGHT unchanged.
 */
export const MAP_LINEAR_SCALE = 0.5 as const;

/**
 * Authoring envelope for catalog geometry / densify / preferred pickups
 * (pre-EPIC-50 / EPIC 46–49 coordinates). Runtime playable bounds are
 * `STANDARD_MAP_BOUNDS` after `finalizeCatalogMap`.
 */
export const MAP_AUTHORING_BOUNDS: MapBounds2D = {
  minX: -92,
  maxX: 92,
  minZ: -52,
  maxZ: 52,
} as const;

/**
 * Playable catalog envelope after EPIC 50 half-size: ±46 / ±26
 * (~92×52 area). Shared by all static catalog maps.
 */
export const STANDARD_MAP_BOUNDS: MapBounds2D = {
  minX: -46,
  maxX: 46,
  minZ: -26,
  maxZ: 26,
} as const;

export const DEFAULT_MAP_ID: MapId = "base";

/**
 * Shared wall AABB height (EPIC 49 Story 49.3, EPIC 58 Story 58.5).
 * Raised 4 → 6 (EPIC 49), then 6 → 18 (EPIC 58) so collision matches
 * taller client walls; tops dissolve visually into fog (client-only fade —
 * no invisible blockers above this AABB). Y is not scaled by MAP_LINEAR_SCALE.
 */
export const WALL_HEIGHT = 18;
export const WALL_Y = WALL_HEIGHT / 2;
export const CRATE_HEIGHT = 1.2;
export const CRATE_Y = CRATE_HEIGHT / 2;

/** Scale one catalog box on X/Z only (Y center/size unchanged). */
export function scaleCatalogBox(box: MapBox, scale: number = MAP_LINEAR_SCALE): MapBox {
  return {
    id: box.id,
    kind: box.kind,
    center: {
      x: box.center.x * scale,
      y: box.center.y,
      z: box.center.z * scale,
    },
    size: {
      x: box.size.x * scale,
      y: box.size.y,
      z: box.size.z * scale,
    },
  };
}
