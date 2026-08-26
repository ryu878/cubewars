// EPIC 46 Base map: 2× linear scale of the classic arena (~184×104),
// plus an enterable building (door gaps both sides + window holes) and a
// collidable car AABB silhouette.

import type { MapDefinition } from "./types.js";
import { STANDARD_MAP_BOUNDS } from "./types.js";
import {
  armorPickup,
  ammoPickup,
  carSilhouette,
  crate,
  healthPickup,
  outerWalls,
  spawn,
  wall,
  wallWithDoorAlongX,
  weaponPickup,
} from "./primitives.js";

/**
 * Scaled classic layout (2× from EPIC 3): Site A / Site B / mid / tunnel,
 * then building in Site A south and a car near Site B mid.
 */
export const BASE_MAP: MapDefinition = {
  id: "base",
  displayName: "Base",
  displayNameRu: "База",
  bounds: STANDARD_MAP_BOUNDS,
  geometry: [
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

    // --- Enterable building (Site A south-west) ---
    // Footprint x∈[-80,-56], z∈[-30,-12]. Doors on north+south; window
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
  ],
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
  pickupPoints: [
    weaponPickup("base_weapon_rifle_a", "rifle", -84, 40),
    weaponPickup("base_weapon_rifle_b", "rifle", 84, -40),
    weaponPickup("base_weapon_gl_mid", "grenade_launcher", 0, 0),
    weaponPickup("base_weapon_gl_tunnel", "grenade_launcher", 0, 32),
    ammoPickup("base_ammo_rifle_a", "rifle", -84, -40),
    ammoPickup("base_ammo_rifle_b", "rifle", 84, 40),
    ammoPickup("base_ammo_gl_a", "grenade_launcher", -20, 32),
    ammoPickup("base_ammo_gl_b", "grenade_launcher", 20, 32),
    healthPickup("base_health_a", -84, 0),
    healthPickup("base_health_b", 84, 0),
    healthPickup("base_health_c", 0, -40),
    armorPickup("base_armor_a", -20, 32),
    armorPickup("base_armor_b", 20, 32),
    armorPickup("base_armor_c", 0, 20),
  ],
};
