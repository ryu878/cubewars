// EPIC 46 Base map: authored at ±92/±52 (2× classic), then EPIC 50 half-scale
// via finalizeCatalogMap → playable ±46/±26 (densify on scaled geometry).
// EPIC 47: denser interior cover. EPIC 48: balanced/spread pickups via densify.
// EPIC 49: fog walls / thematic props (unchanged here).

import type { MapDefinition } from "./types.js";
import { MAP_LINEAR_SCALE } from "./types.js";
import { finalizeCatalogMap } from "./finalize.js";
import {
  carSilhouette,
  crate,
  outerWalls,
  spawn,
  wall,
  wallWithDoorAlongX,
} from "./primitives.js";

/**
 * Known free xz inside the Base building footprint (away from the interior
 * crate and wall segments). Authored then × MAP_LINEAR_SCALE (EPIC 50).
 * Used by EPIC 46 F-002 regression.
 */
export const BASE_BUILDING_INTERIOR_SAMPLE = {
  x: -72 * MAP_LINEAR_SCALE,
  z: -21 * MAP_LINEAR_SCALE,
} as const;

const BASE_GEOMETRY = [
  ...outerWalls("base"),

  // West divider (Site A <-> mid/tunnel), gaps at mid + tunnel
  wall("base_divider_west_south", -40, -30, 1, 44),
  wall("base_divider_west_mid", -40, 16, 1, 16),
  wall("base_divider_west_north", -40, 46, 1, 12),

  // East divider (mirrored)
  wall("base_divider_east_south", 40, -30, 1, 44),
  wall("base_divider_east_mid", 40, 16, 1, 16),
  wall("base_divider_east_north", 40, 46, 1, 12),

  // Mid lane corridor
  wall("base_mid_wall_south", 0, -8, 80, 1),
  wall("base_mid_wall_north", 0, 8, 80, 1),

  // Tunnel corridor
  wall("base_tunnel_wall_south", 0, 24, 80, 1),
  wall("base_tunnel_wall_north", 0, 40, 80, 1),

  // Site cover crates (scaled positions)
  crate("base_crate_a1", -76, -12, 2.5, 2.5),
  crate("base_crate_a2", -60, 12, 2.5, 2.5),
  crate("base_crate_a3", -48, -28, 2, 2),
  crate("base_crate_b1", 76, 12, 2.5, 2.5),
  crate("base_crate_b2", 60, -12, 2.5, 2.5),
  crate("base_crate_b3", 48, 28, 2, 2),
  crate("base_crate_mid1", -16, -3, 2, 2),
  crate("base_crate_mid2", 16, 3, 2, 2),
  crate("base_crate_tunnel1", -28, 32, 2, 2),
  crate("base_crate_tunnel2", 28, 32, 2, 2),

  // EPIC 47: extra Site A / Site B / mid cover to shrink open voids
  wall("base_cover_a_low", -64, -40, 18, 1),
  wall("base_cover_a_side", -88, 20, 1, 14),
  crate("base_crate_a4", -72, 28, 2.2, 2.2),
  crate("base_crate_a5", -52, -8, 2, 2),
  crate("base_crate_a6", -56, 40, 2.5, 2.5),
  wall("base_cover_b_low", 64, 40, 18, 1),
  wall("base_cover_b_side", 88, -20, 1, 14),
  crate("base_crate_b4", 72, -28, 2.2, 2.2),
  crate("base_crate_b5", 52, 8, 2, 2),
  crate("base_crate_b6", 56, -40, 2.5, 2.5),
  wall("base_mid_pillar_w", -24, 0, 4, 4),
  wall("base_mid_pillar_e", 24, 0, 4, 4),
  crate("base_crate_mid3", -8, 16, 2, 2),
  crate("base_crate_mid4", 8, -16, 2, 2),
  crate("base_crate_tunnel3", -12, 32, 2, 2),
  crate("base_crate_tunnel4", 12, 32, 2, 2),
  wall("base_tunnel_stub_w", -48, 32, 8, 1),
  wall("base_tunnel_stub_e", 48, 32, 8, 1),

  // --- Enterable building (Site A south-west) ---
  // Footprint x∈[-80,-56], z∈[-30,-12] (authoring). Doors on north+south; window
  // holes on east+west = gaps between wall segments (endless door pattern).
  ...wallWithDoorAlongX("base_bld_south", -30, -80, -56, -68, 2.5),
  ...wallWithDoorAlongX("base_bld_north", -12, -80, -56, -68, 2.5),
  // West wall: two segments with a centered window gap (~4 units)
  wall("base_bld_west_s", -80, -27.5, 1, 5),
  wall("base_bld_west_n", -80, -14.5, 1, 5),
  // East wall: mirrored window gap
  wall("base_bld_east_s", -56, -27.5, 1, 5),
  wall("base_bld_east_n", -56, -14.5, 1, 5),
  crate("base_bld_crate", -68, -21, 1.8, 1.8),

  // --- Car near Site B mid-lane entrance ---
  ...carSilhouette("base_car", 58, -2),
  // EPIC 47: second wreck + low wall near Site B south
  ...carSilhouette("base_car_b", 70, -36),
  wall("base_site_b_brace", 48, -20, 1, 12),
];

/**
 * Scaled classic layout: Site A / Site B / mid / tunnel, building in Site A
 * south and a car near Site B mid. Authored at EPIC 46 coords; playable
 * after EPIC 50 `MAP_LINEAR_SCALE` (0.5).
 */
export const BASE_MAP: MapDefinition = finalizeCatalogMap({
  id: "base",
  displayName: "Base",
  displayNameRu: "База",
  geometry: BASE_GEOMETRY,
  spawnPoints: [
    spawn(-68, -32),
    spawn(-68, 0),
    spawn(-68, 32),
    spawn(-50, 46),
    spawn(68, -32),
    spawn(68, 0),
    spawn(68, 32),
    spawn(50, 46),
    spawn(0, -20),
    spawn(0, 32),
  ],
  pickupPrefix: "base",
  preferredPickups: [
    { x: -84, z: 40 },
    { x: 84, z: -40 },
    { x: 0, z: 0 },
    { x: 0, z: 32 },
    { x: -84, z: -40 },
    { x: 84, z: 40 },
    { x: -20, z: 32 },
    { x: 20, z: 32 },
    { x: -84, z: 0 },
    { x: 84, z: 0 },
    { x: 0, z: -40 },
    { x: 0, z: 20 },
  ],
});
