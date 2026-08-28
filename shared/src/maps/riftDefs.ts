// EPIC 59: authored mid-map rift polylines (MAP_AUTHORING_BOUNDS coords).
// Zig-zag fault lines through open mid lanes; halfWidth ~1.2–2.0 before scale.
// Kept clear of spawn footprints (halfWidth + player radius after scale).

import type { MapRiftHazard, MapRiftHazardKind } from "./types.js";

const DPS = 12;
const HALF = 1.6;

function rift(
  kind: MapRiftHazardKind,
  polyline: { x: number; z: number }[],
  halfWidth = HALF,
  damagePerSecond = DPS,
): MapRiftHazard {
  return { kind, polyline, halfWidth, damagePerSecond };
}

/**
 * Base — murky piranha water through mid-lane only (between west/east
 * dividers at x=±40). Does not reach Site A/B side spawns at x=±68.
 */
export const BASE_RIFT: MapRiftHazard = rift("water_piranha", [
  { x: -38, z: -4 },
  { x: -28, z: 5 },
  { x: -16, z: -5 },
  { x: -4, z: 4 },
  { x: 8, z: -5 },
  { x: 18, z: 5 },
  { x: 28, z: -4 },
  { x: 38, z: 3 },
]);

/** Rust Canyon — lava along dry bed; stay inward of (±70,0) side spawns. */
export const RUST_CANYON_RIFT: MapRiftHazard = rift("lava", [
  { x: -42, z: 3 },
  { x: -28, z: -4 },
  { x: -12, z: 5 },
  { x: 2, z: -3 },
  { x: 16, z: 4 },
  { x: 30, z: -5 },
  { x: 42, z: 2 },
]);

/** Glass Dome — acid crack across plaza (offset from center veg + ring). */
export const GLASS_DOME_RIFT: MapRiftHazard = rift("acid", [
  { x: -55, z: -16 },
  { x: -35, z: -4 },
  { x: -18, z: 10 },
  { x: 0, z: -8 },
  { x: 16, z: 9 },
  { x: 34, z: -6 },
  { x: 55, z: 14 },
]);

/** Dead Station — toxic sludge north of runway (clear of (±20,0) and hangar spawns). */
export const DEAD_STATION_RIFT: MapRiftHazard = rift("toxic_sludge", [
  { x: -70, z: 28 },
  { x: -40, z: 32 },
  { x: -15, z: 26 },
  { x: 10, z: 34 },
  { x: 35, z: 27 },
  { x: 60, z: 33 },
  { x: 80, z: 28 },
]);

/** Fuel Depot — oil/fire north of pump row (clear of (±12,±8) alley spawns). */
export const FUEL_DEPOT_RIFT: MapRiftHazard = rift("oil_fire", [
  { x: -70, z: 24 },
  { x: -45, z: 28 },
  { x: -20, z: 22 },
  { x: 5, z: 30 },
  { x: 28, z: 23 },
  { x: 50, z: 29 },
  { x: 75, z: 24 },
]);

/** Crystal Cave — plasma fissure (diagonal, clear of center crystal). */
export const CRYSTAL_CAVE_RIFT: MapRiftHazard = rift("plasma", [
  { x: -70, z: -18 },
  { x: -45, z: -6 },
  { x: -22, z: 8 },
  { x: -5, z: -12 },
  { x: 15, z: 10 },
  { x: 35, z: -8 },
  { x: 60, z: 12 },
  { x: 78, z: 18 },
]);

/** Abyss Bridge — void ink along south deck edge (clear of (±50,0)). */
export const ABYSS_BRIDGE_RIFT: MapRiftHazard = rift("void_ink", [
  { x: -70, z: -18 },
  { x: -40, z: -14 },
  { x: -15, z: -20 },
  { x: 10, z: -12 },
  { x: 35, z: -18 },
  { x: 60, z: -13 },
  { x: 80, z: -19 },
]);

/** Elite Quarter — molten gold south of plaza (clear of (±65,16) / (±30,0)). */
export const ELITE_QUARTER_RIFT: MapRiftHazard = rift("molten_gold", [
  { x: -70, z: -18 },
  { x: -40, z: -22 },
  { x: -15, z: -14 },
  { x: 10, z: -24 },
  { x: 35, z: -16 },
  { x: 55, z: -23 },
  { x: 75, z: -17 },
]);
