// EPIC 47: denser pickup layouts (~4× EPIC 46 counts) with clearance from solids.

import { boxBounds, type MapBox } from "./types.js";
import {
  ammoPickup,
  armorPickup,
  healthPickup,
  weaponPickup,
} from "./primitives.js";
import type { PickupSpawnPoint } from "../pickups.js";

const PICKUP_CLEARANCE = 0.6;

function circleHitsBox(cx: number, cz: number, radius: number, box: MapBox): boolean {
  const b = boxBounds(box);
  const nearestX = Math.max(b.minX, Math.min(cx, b.maxX));
  const nearestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
  const dx = cx - nearestX;
  const dz = cz - nearestZ;
  return dx * dx + dz * dz < radius * radius;
}

export function isPickupClear(
  x: number,
  z: number,
  geometry: readonly MapBox[],
  radius = PICKUP_CLEARANCE,
): boolean {
  for (const box of geometry) {
    if (box.kind !== "wall" && box.kind !== "prop" && box.kind !== "crate") continue;
    if (circleHitsBox(x, z, radius, box)) return false;
  }
  return true;
}

type Candidate = { x: number; z: number };

/** Spread candidate xz points across the standard ~184×104 arena. */
function gridCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (let x = -84; x <= 84; x += 12) {
    for (let z = -44; z <= 44; z += 11) {
      out.push({ x, z });
    }
  }
  // Offset secondary lattice for corners / lanes
  for (let x = -78; x <= 78; x += 14) {
    for (let z = -38; z <= 38; z += 13) {
      out.push({ x: x + 5, z: z + 4 });
    }
  }
  return out;
}

/**
 * Build ~4× EPIC-46 pickup density (target 16 weapon / 16 ammo / 12 health / 12 armor)
 * from clear points on the map. Prefers `preferred` centers first, then grid fill.
 */
export function densePickups(
  prefix: string,
  geometry: readonly MapBox[],
  preferred: readonly Candidate[] = [],
): PickupSpawnPoint[] {
  const used = new Set<string>();
  const takeClear = (list: readonly Candidate[]): Candidate[] => {
    const ok: Candidate[] = [];
    for (const p of list) {
      const key = `${Math.round(p.x * 10)},${Math.round(p.z * 10)}`;
      if (used.has(key)) continue;
      if (!isPickupClear(p.x, p.z, geometry)) continue;
      used.add(key);
      ok.push(p);
    }
    return ok;
  };

  const pool = [...takeClear(preferred), ...takeClear(gridCandidates())];
  let i = 0;
  const next = (): Candidate => {
    if (i >= pool.length) {
      // Fallback far corners (should be rare — outer ring is usually free)
      const fb = { x: -84 + (i % 5) * 4, z: -44 + Math.floor(i / 5) * 4 };
      i += 1;
      return fb;
    }
    const p = pool[i]!;
    i += 1;
    return p;
  };

  const out: PickupSpawnPoint[] = [];
  // 16 weapons: alternate rifle / grenade_launcher
  for (let n = 0; n < 16; n++) {
    const p = next();
    const weapon = n % 2 === 0 ? "rifle" : "grenade_launcher";
    out.push(weaponPickup(`${prefix}_weapon_${n}`, weapon, p.x, p.z));
  }
  // 16 ammo matching the weapon mix
  for (let n = 0; n < 16; n++) {
    const p = next();
    const weapon = n % 2 === 0 ? "rifle" : "grenade_launcher";
    out.push(ammoPickup(`${prefix}_ammo_${n}`, weapon, p.x, p.z));
  }
  for (let n = 0; n < 12; n++) {
    const p = next();
    out.push(healthPickup(`${prefix}_health_${n}`, p.x, p.z));
  }
  for (let n = 0; n < 12; n++) {
    const p = next();
    out.push(armorPickup(`${prefix}_armor_${n}`, p.x, p.z));
  }
  return out;
}

/** EPIC 46 baseline counts (pre–EPIC 47 densify) for handoff documentation. */
export const EPIC46_PICKUP_COUNTS = {
  weapon: 4,
  ammo: 4,
  health: 3,
  armor: 3,
  total: 14,
} as const;

export const EPIC47_PICKUP_COUNTS = {
  weapon: 16,
  ammo: 16,
  health: 12,
  armor: 12,
  total: 56,
} as const;
