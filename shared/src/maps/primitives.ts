// Small AABB builders for catalog maps (EPIC 46).

import {
  CRATE_HEIGHT,
  CRATE_Y,
  MAP_AUTHORING_BOUNDS,
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

/**
 * Outer envelope walls for a rectangular map (1-unit thick).
 * Default uses authoring bounds; `finalizeCatalogMap` scales to playable size.
 */
export function outerWalls(prefix: string, bounds: MapBounds2D = MAP_AUTHORING_BOUNDS): MapBox[] {
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

/**
 * Military tank wreck: hull + turret + short track stubs (EPIC 49 silhouette).
 * Keep clear of spawn/pickup footprints when placing.
 */
export function tankWreck(idPrefix: string, cx: number, cz: number): MapBox[] {
  return [
    prop(`${idPrefix}_hull`, cx, 1.1, cz, 5.5, 2.2, 3.0),
    prop(`${idPrefix}_turret`, cx + 0.6, 2.5, cz, 2.4, 1.2, 2.4),
    prop(`${idPrefix}_track_l`, cx, 0.45, cz + 1.7, 5.2, 0.9, 0.55),
    prop(`${idPrefix}_track_r`, cx, 0.45, cz - 1.7, 5.2, 0.9, 0.55),
  ];
}

/** Fuel cistern: fat tank + rim + short pipe stub. */
export function cisternProp(idPrefix: string, cx: number, cz: number, scale = 1): MapBox[] {
  const s = scale;
  return [
    prop(`${idPrefix}_cistern`, cx, 2.5 * s, cz, 10 * s, 5 * s, 10 * s),
    prop(`${idPrefix}_rim`, cx, 5.1 * s, cz, 10.4 * s, 0.35 * s, 10.4 * s),
    prop(`${idPrefix}_pipe`, cx + 5.5 * s, 1.2 * s, cz, 2.2 * s, 0.5 * s, 0.5 * s),
  ];
}

/** Crystal pillar + side shards (emissive materials match `cc_crystal_` / `_crystal_`). */
export function crystalCluster(idPrefix: string, cx: number, cz: number, h = 5): MapBox[] {
  return [
    prop(`${idPrefix}_crystal_main`, cx, h / 2, cz, 2.4, h, 2.4),
    prop(`${idPrefix}_crystal_a`, cx + 1.6, h * 0.35, cz + 0.8, 1.2, h * 0.7, 1.2),
    prop(`${idPrefix}_crystal_b`, cx - 1.4, h * 0.28, cz - 1.0, 1.0, h * 0.55, 1.0),
  ];
}

/** Low rock / ridge pile for canyon beds. */
export function rockPile(idPrefix: string, cx: number, cz: number): MapBox[] {
  return [
    prop(`${idPrefix}_rock_a`, cx, 0.7, cz, 3.5, 1.4, 2.8),
    prop(`${idPrefix}_rock_b`, cx + 2.2, 0.45, cz + 1.2, 2.2, 0.9, 2.0),
    prop(`${idPrefix}_rock_c`, cx - 1.8, 0.55, cz - 0.8, 2.0, 1.1, 1.8),
  ];
}

/** Collapsed rubble heap (multi-box, reads as ruined roof/cover). */
export function rubbleHeap(idPrefix: string, cx: number, cz: number): MapBox[] {
  return [
    prop(`${idPrefix}_rubble_base`, cx, 0.7, cz, 7, 1.4, 5),
    prop(`${idPrefix}_rubble_top`, cx + 1.2, 1.6, cz - 0.5, 3.5, 1.0, 3.2),
    prop(`${idPrefix}_rubble_chunk`, cx - 2.0, 1.3, cz + 1.2, 2.4, 0.9, 2.0),
  ];
}

/** Barrel cluster for fuel alleys. */
export function barrelCluster(idPrefix: string, cx: number, cz: number): MapBox[] {
  return [
    prop(`${idPrefix}_barrel_a`, cx, 0.7, cz, 1.1, 1.4, 1.1),
    prop(`${idPrefix}_barrel_b`, cx + 1.3, 0.7, cz + 0.4, 1.1, 1.4, 1.1),
    prop(`${idPrefix}_barrel_c`, cx - 0.4, 0.7, cz + 1.3, 1.1, 1.4, 1.1),
  ];
}

/**
 * Cable-stay segments as thin tall-ish boxes between two X positions at fixed Z.
 * Visual landmark for abyss bridge; still shared AABB collision.
 */
export function cableStay(
  idPrefix: string,
  x0: number,
  x1: number,
  z: number,
  y: number,
  segments = 4,
): MapBox[] {
  const out: MapBox[] = [];
  const dx = x1 - x0;
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const mid = (t0 + t1) / 2;
    const cx = x0 + dx * mid;
    const len = Math.abs(dx) / segments;
    // Sag: lower in the middle of the span.
    const sag = Math.sin(Math.PI * mid) * 1.2;
    out.push(prop(`${idPrefix}_cable_${i}`, cx, y - sag, z, Math.max(0.8, len), 0.25, 0.25));
  }
  return out;
}

/** Low vegetation blocks (kind crate so climbable; client greens by id). */
export function vegPatch(idPrefix: string, cx: number, cz: number): MapBox[] {
  return [
    crate(`${idPrefix}_veg_a`, cx, cz, 2.8, 2.8, 1.6),
    crate(`${idPrefix}_veg_b`, cx + 2.5, cz + 1.2, 2.2, 2.2, 1.9),
    crate(`${idPrefix}_bush_c`, cx - 2.0, cz - 1.0, 2.0, 2.0, 1.4),
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

/**
 * Default denser pickup set for 8-player maps (~scaled from original Base).
 * Prefer per-map layouts when catalog geometry collides with these centers —
 * themed maps in `themedMaps.ts` do not reuse this blindly (EPIC 46 F-001).
 */
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
