// EPIC 50: scale authored catalog maps then densify on playable geometry
// so pickup clearance stays in world units (not double-shrunk).

import type { Vector3 } from "../types.js";
import { densePickups } from "./densify.js";
import {
  MAP_LINEAR_SCALE,
  STANDARD_MAP_BOUNDS,
  scaleCatalogBox,
  type MapBox,
  type MapDefinition,
  type MapId,
} from "./types.js";

export interface AuthoredCatalogMap {
  id: MapId;
  displayName: string;
  displayNameRu?: string;
  /** Geometry in pre-EPIC-50 authoring coordinates (±92 / ±52). */
  geometry: readonly MapBox[];
  /** Spawns in authoring coordinates. */
  spawnPoints: readonly Vector3[];
  /** densify id prefix, e.g. "base" / "rc". */
  pickupPrefix: string;
  /** Preferred landmarks in authoring coordinates (scaled before densify). */
  preferredPickups?: readonly { x: number; z: number }[];
}

/**
 * Scale authored X/Z geometry + spawns by `MAP_LINEAR_SCALE`, then place
 * EPIC 48 pickups on the **playable** boxes with world-unit clearance.
 */
export function finalizeCatalogMap(
  authored: AuthoredCatalogMap,
  scale: number = MAP_LINEAR_SCALE,
): MapDefinition {
  const geometry = authored.geometry.map((box) => scaleCatalogBox(box, scale));
  const spawnPoints = authored.spawnPoints.map((p) => ({
    x: p.x * scale,
    y: p.y,
    z: p.z * scale,
  }));
  const preferred = (authored.preferredPickups ?? []).map((p) => ({
    x: p.x * scale,
    z: p.z * scale,
  }));
  return {
    id: authored.id,
    displayName: authored.displayName,
    displayNameRu: authored.displayNameRu,
    bounds: STANDARD_MAP_BOUNDS,
    geometry,
    spawnPoints,
    pickupPoints: densePickups(authored.pickupPrefix, geometry, preferred),
  };
}
