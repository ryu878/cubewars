// Map geometry types + EPIC 46 static catalog (Base + 7 themed maps).
// Single source of truth for non-endless match collision/rendering via
// catalog getters; legacy ARENA_* exports alias Base for mid-refactor callers.
//
// Doors/windows = gaps between wall segments (endless door pattern).
// Optional MapBoxKind "prop" blocks like walls (car / tank hulls).

export {
  boxBounds,
  type AabbBounds,
  type MapBox,
  type MapBoxKind,
  type MapBounds2D,
  type MapDefinition,
  type MapId,
  type MapRiftHazard,
  type MapRiftHazardKind,
  type MapRiftPoint,
  MAP_IDS,
  MAP_LINEAR_SCALE,
  MAP_AUTHORING_BOUNDS,
  STANDARD_MAP_BOUNDS,
  DEFAULT_MAP_ID,
  WALL_HEIGHT,
  WALL_Y,
  CRATE_HEIGHT,
  CRATE_Y,
  scaleCatalogBox,
  isMapId,
} from "./maps/types.js";

export { finalizeCatalogMap } from "./maps/finalize.js";
export type { AuthoredCatalogMap } from "./maps/finalize.js";
export { isPointInRift, scaleMapRift } from "./maps/rift.js";
export { isSpawnReachable } from "./maps/spawnReachability.js";

export {
  listMaps,
  getMap,
  getMapOrDefault,
  resolveMapId,
  BASE_MAP,
  BASE_BUILDING_INTERIOR_SAMPLE,
} from "./maps/catalog.js";

export {
  EPIC46_PICKUP_COUNTS,
  EPIC47_PICKUP_COUNTS,
  EPIC48_PICKUP_COUNTS,
} from "./maps/densify.js";

import { BASE_MAP } from "./maps/catalog.js";

/**
 * Legacy alias: Base map outer envelope (EPIC 50 — half of EPIC 46–49 ±92/±52).
 * Prefer getMap(mapId).bounds for match-scoped geometry.
 * Endless mode uses its own procedural chunks and does not share this scale.
 */
export const ARENA_BOUNDS = BASE_MAP.bounds;

/**
 * Legacy alias: Base map geometry. Prefer getMap(mapId).geometry.
 */
export const ARENA_GEOMETRY = BASE_MAP.geometry;

/**
 * Legacy alias: Base spawn candidates. Prefer getMap(mapId).spawnPoints.
 */
export const SPAWN_POINTS = BASE_MAP.spawnPoints;
