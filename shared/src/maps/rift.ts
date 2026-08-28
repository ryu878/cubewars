// EPIC 59: thick-polyline rift hit test + XZ scale for catalog finalize.

import { MAP_LINEAR_SCALE, type MapRiftHazard, type MapRiftPoint } from "./types.js";

/** Squared distance from point (px,pz) to segment (ax,az)-(bx,bz). */
function distSqPointToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const apx = px - ax;
  const apz = pz - az;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq <= 1e-12) {
    return apx * apx + apz * apz;
  }
  let t = (apx * abx + apz * abz) / abLenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + abx * t;
  const cz = az + abz * t;
  const dx = px - cx;
  const dz = pz - cz;
  return dx * dx + dz * dz;
}

/**
 * True when (x,z) lies within `halfWidth` of any polyline segment.
 * Used by the authoritative server DoT (and optional client FX).
 */
export function isPointInRift(x: number, z: number, rift: MapRiftHazard): boolean {
  const pts = rift.polyline;
  if (pts.length < 2 || !(rift.halfWidth > 0)) return false;
  const limitSq = rift.halfWidth * rift.halfWidth;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (distSqPointToSegment(x, z, a.x, a.z, b.x, b.z) <= limitSq) return true;
  }
  return false;
}

/** Scale authored rift X/Z + halfWidth by MAP_LINEAR_SCALE (Y unused). */
export function scaleMapRift(
  rift: MapRiftHazard,
  scale: number = MAP_LINEAR_SCALE,
): MapRiftHazard {
  return {
    kind: rift.kind,
    halfWidth: rift.halfWidth * scale,
    damagePerSecond: rift.damagePerSecond,
    polyline: rift.polyline.map((p): MapRiftPoint => ({
      x: p.x * scale,
      z: p.z * scale,
    })),
  };
}
