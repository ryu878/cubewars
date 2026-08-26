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
  MAP_IDS,
  STANDARD_MAP_BOUNDS,
  DEFAULT_MAP_ID,
  WALL_HEIGHT,
  WALL_Y,
  CRATE_HEIGHT,
  CRATE_Y,
  isMapId,
} from "./maps/types.js";

export {
  listMaps,
  getMap,
  getMapOrDefault,
  resolveMapId,
  BASE_MAP,
} from "./maps/catalog.js";

import { BASE_MAP } from "./maps/catalog.js";

/**
 * Legacy alias: Base map outer envelope (EPIC 46 — 2× linear vs original arena).
 * Prefer getMap(mapId).bounds for match-scoped geometry.
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
