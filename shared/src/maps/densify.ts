// EPIC 48: balanced pickup counts (~8 players) with spatially spread placement.
// Replaces EPIC 47's sequential lattice fill (weapon "runways") with
// farthest-from-existing + quadrant quotas + anti-collinear checks.

import { boxBounds, type MapBox } from "./types.js";
import {
  ammoPickup,
  armorPickup,
  healthPickup,
  weaponPickup,
} from "./primitives.js";
import type { PickupSpawnPoint } from "../pickups.js";

const PICKUP_CLEARANCE = 0.6;

/**
 * EPIC 48 pickup counts (quarter of original EPIC 48 band): 2 weapon / 2 ammo /
 * 1 health / 1 armor per catalog map.
 */
export const EPIC48_PICKUP_COUNTS = {
  weapon: 2,
  ammo: 2,
  health: 1,
  armor: 1,
  total: 6,
} as const;

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

/**
 * Lattice + offset lattice across the playable ~92×52 arena (after EPIC 50).
 * densify runs on finalized (scaled) geometry.
 */
function gridCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (let x = -42; x <= 42; x += 6) {
    for (let z = -22; z <= 22; z += 5.5) {
      out.push({ x, z });
    }
  }
  for (let x = -39; x <= 39; x += 7) {
    for (let z = -19; z <= 19; z += 6.5) {
      out.push({ x: x + 2.5, z: z + 2 });
    }
  }
  return out;
}

function dist2(a: Candidate, b: Candidate): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Quadrant index: 0 NW, 1 NE, 2 SW, 3 SE (origin-centered arena). */
function quadrant(p: Candidate): number {
  const east = p.x >= 0 ? 1 : 0;
  const south = p.z >= 0 ? 0 : 2;
  return east + south;
}

/**
 * True when `p` is nearly collinear with the two most recent same-category
 * points (forms an obvious consecutive "runway" stack).
 */
function isCollinearWithRecent(
  p: Candidate,
  recent: readonly Candidate[],
  angleEps = 0.12,
): boolean {
  if (recent.length < 2) return false;
  const a = recent[recent.length - 2]!;
  const b = recent[recent.length - 1]!;
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const bpx = p.x - b.x;
  const bpz = p.z - b.z;
  const abLen = Math.hypot(abx, abz);
  const bpLen = Math.hypot(bpx, bpz);
  if (abLen < 1e-6 || bpLen < 1e-6) return true;
  const cross = Math.abs(abx * bpz - abz * bpx) / (abLen * bpLen);
  // cross ≈ |sin(theta)|; small ⇒ nearly collinear continuation
  return cross < angleEps;
}

/**
 * Pick the clear candidate that maximizes distance to already-placed pickups,
 * prefers under-filled quadrants, and rejects consecutive collinear stacks.
 */
function pickSpreadPoint(
  pool: Candidate[],
  placed: readonly Candidate[],
  recentSameCat: readonly Candidate[],
  quadrantCounts: number[],
): Candidate | null {
  if (pool.length === 0) return null;

  const minQuad = Math.min(...quadrantCounts);
  let best: Candidate | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]!;
    if (isCollinearWithRecent(p, recentSameCat)) continue;

    const q = quadrant(p);
    const quadBonus = quadrantCounts[q]! === minQuad ? 40 : 0;

    let minD = Infinity;
    for (const other of placed) {
      const d = dist2(p, other);
      if (d < minD) minD = d;
    }
    if (placed.length === 0) minD = 0;

    // Farthest-from-existing (sqrt for nicer scale) + light quadrant balancing.
    const score = Math.sqrt(minD) + quadBonus;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  // If anti-collinear filtered everything, fall back to farthest without that rule.
  if (!best) {
    for (const p of pool) {
      let minD = Infinity;
      for (const other of placed) {
        const d = dist2(p, other);
        if (d < minD) minD = d;
      }
      if (placed.length === 0) minD = 0;
      const score = Math.sqrt(minD);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  return best;
}

function takeFromPool(pool: Candidate[], point: Candidate): void {
  const key = `${Math.round(point.x * 10)},${Math.round(point.z * 10)}`;
  for (let i = pool.length - 1; i >= 0; i--) {
    const p = pool[i]!;
    const pk = `${Math.round(p.x * 10)},${Math.round(p.z * 10)}`;
    if (pk === key) pool.splice(i, 1);
  }
}

/**
 * Build EPIC-48 pickup density (2 weapon / 2 ammo / 1 health / 1 armor)
 * from clear points, spread across preferred landmarks then the map.
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

  // Preferred landmarks first in the pool order for early farthest picks;
  // grid fills the rest. Placement itself is spread-aware, not sequential.
  const pool = [...takeClear(preferred), ...takeClear(gridCandidates())];
  const placed: Candidate[] = [];
  const quadrantCounts = [0, 0, 0, 0];
  const out: PickupSpawnPoint[] = [];

  const placeOne = (
    recentSameCat: Candidate[],
    build: (p: Candidate, index: number) => PickupSpawnPoint,
    index: number,
  ): void => {
    let p = pickSpreadPoint(pool, placed, recentSameCat, quadrantCounts);
    if (!p) {
      // Honest fallback when clear pool is exhausted (dense cover maps).
      const fb = {
        x: -42 + (placed.length % 5) * 2,
        z: -22 + Math.floor(placed.length / 5) * 2,
      };
      p = fb;
    } else {
      takeFromPool(pool, p);
    }
    placed.push(p);
    recentSameCat.push(p);
    quadrantCounts[quadrant(p)]! += 1;
    out.push(build(p, index));
  };

  const weaponRecent: Candidate[] = [];
  for (let n = 0; n < EPIC48_PICKUP_COUNTS.weapon; n++) {
    placeOne(weaponRecent, (p, i) => {
      const weapon = i % 2 === 0 ? "rifle" : "grenade_launcher";
      return weaponPickup(`${prefix}_weapon_${i}`, weapon, p.x, p.z);
    }, n);
  }

  const ammoRecent: Candidate[] = [];
  for (let n = 0; n < EPIC48_PICKUP_COUNTS.ammo; n++) {
    placeOne(ammoRecent, (p, i) => {
      const weapon = i % 2 === 0 ? "rifle" : "grenade_launcher";
      return ammoPickup(`${prefix}_ammo_${i}`, weapon, p.x, p.z);
    }, n);
  }

  const healthRecent: Candidate[] = [];
  for (let n = 0; n < EPIC48_PICKUP_COUNTS.health; n++) {
    placeOne(healthRecent, (p, i) => healthPickup(`${prefix}_health_${i}`, p.x, p.z), n);
  }

  const armorRecent: Candidate[] = [];
  for (let n = 0; n < EPIC48_PICKUP_COUNTS.armor; n++) {
    placeOne(armorRecent, (p, i) => armorPickup(`${prefix}_armor_${i}`, p.x, p.z), n);
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

/** EPIC 47 carpet counts (replaced by EPIC 48). Kept for docs / migration notes. */
export const EPIC47_PICKUP_COUNTS = {
  weapon: 16,
  ammo: 16,
  health: 12,
  armor: 12,
  total: 56,
} as const;
