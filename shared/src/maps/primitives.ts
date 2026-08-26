// Small AABB builders for catalog maps (EPIC 46).

import {
  CRATE_HEIGHT,
  CRATE_Y,
  STANDARD_MAP_BOUNDS,
  WALL_HEIGHT,
  WALL_Y,
  type MapBox,
  type MapBounds2D,
} from "./types.js";
import type { PickupSpawnPoint } from "../pickups.js";
import type { Vector3 } from "../types.js";

export function wall(
  id: string,
  cx: number,
  cz: number,
  sx: number,
  sz: number,
  height = WALL_HEIGHT,
  cy = height / 2,
): MapBox {
  return { id, kind: "wall", center: { x: cx, y: cy, z: cz }, size: { x: sx, y: height, z: sz } };
}

export function crate(id: string, cx: number, cz: number, sx = 2, sz = 2, height = CRATE_HEIGHT): MapBox {
  return {
    id,
    kind: "crate",
    center: { x: cx, y: height / 2, z: cz },
    size: { x: sx, y: height, z: sz },
  };
}

export function prop(
  id: string,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
): MapBox {
  return { id, kind: "prop", center: { x: cx, y: cy, z: cz }, size: { x: sx, y: sy, z: sz } };
}

/** Outer envelope walls for a rectangular map (1-unit thick). */
export function outerWalls(prefix: string, bounds: MapBounds2D = STANDARD_MAP_BOUNDS): MapBox[] {
  const width = bounds.maxX - bounds.minX + 1;
  const depth = bounds.maxZ - bounds.minZ + 1;
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midZ = (bounds.minZ + bounds.maxZ) / 2;
  return [
    wall(`${prefix}_outer_west`, bounds.minX, midZ, 1, depth),
    wall(`${prefix}_outer_east`, bounds.maxX, midZ, 1, depth),
    wall(`${prefix}_outer_north`, midX, bounds.maxZ, width, 1),
    wall(`${prefix}_outer_south`, midX, bounds.minZ, width, 1),
  ];
}

/**
 * Split a long wall along Z into two segments with a centered door gap
 * (endless-style openings — no "door" boxes).
 */
export function wallWithDoorAlongZ(
  idPrefix: string,
  x: number,
  zMin: number,
  zMax: number,
  doorCenterZ: number,
  doorHalfWidth: number,
  thickness = 1,
): MapBox[] {
  const southEnd = doorCenterZ - doorHalfWidth;
  const northStart = doorCenterZ + doorHalfWidth;
  const out: MapBox[] = [];
  if (southEnd > zMin + 0.5) {
    const len = southEnd - zMin;
    out.push(wall(`${idPrefix}_s`, x, zMin + len / 2, thickness, len));
  }
  if (zMax > northStart + 0.5) {
    const len = zMax - northStart;
    out.push(wall(`${idPrefix}_n`, x, northStart + len / 2, thickness, len));
  }
  return out;
}

/**
 * Split a long wall along X into two segments with a centered door gap.
 */
export function wallWithDoorAlongX(
  idPrefix: string,
  z: number,
  xMin: number,
  xMax: number,
  doorCenterX: number,
  doorHalfWidth: number,
  thickness = 1,
): MapBox[] {
  const westEnd = doorCenterX - doorHalfWidth;
  const eastStart = doorCenterX + doorHalfWidth;
  const out: MapBox[] = [];
  if (westEnd > xMin + 0.5) {
    const len = westEnd - xMin;
    out.push(wall(`${idPrefix}_w`, xMin + len / 2, z, len, thickness));
  }
  if (xMax > eastStart + 0.5) {
    const len = xMax - eastStart;
    out.push(wall(`${idPrefix}_e`, eastStart + len / 2, z, len, thickness));
  }
  return out;
}

/**
 * Wall along X with a window hole: lower sill + upper lintel + side piers,
 * leaving a shoot-through opening (gap between segments).
 */
export function wallWithWindowAlongX(
  idPrefix: string,
  z: number,
  xMin: number,
  xMax: number,
  windowCenterX: number,
  windowHalfWidth: number,
  sillHeight = 1.2,
  windowHeight = 1.4,
  thickness = 1,
): MapBox[] {
  const westEnd = windowCenterX - windowHalfWidth;
  const eastStart = windowCenterX + windowHalfWidth;
  const out: MapBox[] = [];
  if (westEnd > xMin + 0.5) {
    const len = westEnd - xMin;
    out.push(wall(`${idPrefix}_pier_w`, xMin + len / 2, z, len, thickness));
  }
  if (xMax > eastStart + 0.5) {
    const len = xMax - eastStart;
    out.push(wall(`${idPrefix}_pier_e`, eastStart + len / 2, z, len, thickness));
  }
  // Sill under the window
  out.push(
    wall(`${idPrefix}_sill`, windowCenterX, z, windowHalfWidth * 2, thickness, sillHeight, sillHeight / 2),
  );
  // Lintel above the window
  const lintelBottom = sillHeight + windowHeight;
  const lintelHeight = Math.max(0.4, WALL_HEIGHT - lintelBottom);
  out.push(
    wall(
      `${idPrefix}_lintel`,
      windowCenterX,
      z,
      windowHalfWidth * 2,
      thickness,
      lintelHeight,
      lintelBottom + lintelHeight / 2,
    ),
  );
  return out;
}

/** Low-poly car silhouette: body + cabin + four wheel stubs (all prop, wall-like). */
export function carSilhouette(idPrefix: string, cx: number, cz: number, yawDeg = 0): MapBox[] {
  // AABB-only: ignore yaw visually; place along +X by default.
  void yawDeg;
  return [
    prop(`${idPrefix}_body`, cx, 0.55, cz, 4.4, 1.1, 2.0),
    prop(`${idPrefix}_cabin`, cx - 0.6, 1.35, cz, 2.0, 0.9, 1.8),
    prop(`${idPrefix}_wheel_fl`, cx + 1.4, 0.35, cz + 1.15, 0.7, 0.7, 0.35),
    prop(`${idPrefix}_wheel_fr`, cx + 1.4, 0.35, cz - 1.15, 0.7, 0.7, 0.35),
    prop(`${idPrefix}_wheel_rl`, cx - 1.4, 0.35, cz + 1.15, 0.7, 0.7, 0.35),
    prop(`${idPrefix}_wheel_rr`, cx - 1.4, 0.35, cz - 1.15, 0.7, 0.7, 0.35),
  ];
}

export function spawn(x: number, z: number, y = 0): Vector3 {
  return { x, y, z };
}

export function weaponPickup(
  id: string,
  weapon: "rifle" | "grenade_launcher",
  x: number,
  z: number,
): PickupSpawnPoint {
  return { id, category: "weapon", weapon, position: { x, y: 0, z } };
}

export function ammoPickup(
  id: string,
  weapon: "rifle" | "grenade_launcher",
  x: number,
  z: number,
): PickupSpawnPoint {
  return { id, category: "ammo", weapon, position: { x, y: 0, z } };
}

export function healthPickup(id: string, x: number, z: number): PickupSpawnPoint {
  return { id, category: "health", position: { x, y: 0, z } };
}

export function armorPickup(id: string, x: number, z: number): PickupSpawnPoint {
  return { id, category: "armor", position: { x, y: 0, z } };
}

/** Default denser pickup set suitable for 8-player maps (~scaled from original Base). */
export function standardPickups(prefix: string): PickupSpawnPoint[] {
  return [
    weaponPickup(`${prefix}_weapon_rifle_a`, "rifle", -70, 36),
    weaponPickup(`${prefix}_weapon_rifle_b`, "rifle", 70, -36),
    weaponPickup(`${prefix}_weapon_gl_mid`, "grenade_launcher", 0, 0),
    weaponPickup(`${prefix}_weapon_gl_north`, "grenade_launcher", 0, 40),
    ammoPickup(`${prefix}_ammo_rifle_a`, "rifle", -70, -36),
    ammoPickup(`${prefix}_ammo_rifle_b`, "rifle", 70, 36),
    ammoPickup(`${prefix}_ammo_gl_a`, "grenade_launcher", -20, 32),
    ammoPickup(`${prefix}_ammo_gl_b`, "grenade_launcher", 20, -32),
    healthPickup(`${prefix}_health_a`, -70, 0),
    healthPickup(`${prefix}_health_b`, 70, 0),
    healthPickup(`${prefix}_health_c`, 0, -40),
    armorPickup(`${prefix}_armor_a`, -24, 32),
    armorPickup(`${prefix}_armor_b`, 24, 32),
    armorPickup(`${prefix}_armor_c`, 0, 20),
  ];
}

export { WALL_HEIGHT, WALL_Y, CRATE_HEIGHT, CRATE_Y, STANDARD_MAP_BOUNDS };
