// EPIC 46 static map catalog registry.

import { BASE_MAP } from "./base.js";
import { THEMED_MAPS } from "./themedMaps.js";
import {
  DEFAULT_MAP_ID,
  type MapDefinition,
  type MapId,
  isMapId,
} from "./types.js";

const ALL_MAPS: MapDefinition[] = [BASE_MAP, ...THEMED_MAPS];

const BY_ID = new Map<MapId, MapDefinition>(ALL_MAPS.map((map) => [map.id, map]));

export function listMaps(): readonly MapDefinition[] {
  return ALL_MAPS;
}

export function getMap(mapId: MapId): MapDefinition {
  const map = BY_ID.get(mapId);
  if (!map) {
    throw new Error(`Unknown map id: ${mapId}`);
  }
  return map;
}

export function getMapOrDefault(mapId: unknown): MapDefinition {
  if (isMapId(mapId)) return getMap(mapId);
  return getMap(DEFAULT_MAP_ID);
}

export function resolveMapId(mapId: unknown): MapId | null {
  return isMapId(mapId) ? mapId : null;
}

export { BASE_MAP, DEFAULT_MAP_ID, isMapId };
export { BASE_BUILDING_INTERIOR_SAMPLE } from "./base.js";
export type { MapDefinition, MapId };
