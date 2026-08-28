// Spawn reachability — ensures respawn points are not inside sealed pockets.

import { boxesBlockingAt, PLAYER_COLLISION_RADIUS } from "../collision.js";
import { boxBounds, type MapBox, type MapBounds2D } from "./types.js";

const BFS_STEP = 1;
const BFS_MAX_NODES = 7000;

function circleHitsBox(cx: number, cz: number, radius: number, box: MapBox): boolean {
  const b = boxBounds(box);
  const nearestX = Math.max(b.minX, Math.min(cx, b.maxX));
  const nearestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
  const dx = cx - nearestX;
  const dz = cz - nearestZ;
  return dx * dx + dz * dz < radius * radius;
}

function isBlockedAtGround(x: number, z: number, geometry: readonly MapBox[]): boolean {
  const boxes = boxesBlockingAt(0, geometry);
  for (const box of boxes) {
    if (circleHitsBox(x, z, PLAYER_COLLISION_RADIUS, box)) return true;
  }
  return false;
}

function probeTargets(bounds: MapBounds2D): { x: number; z: number }[] {
  const inset = 8;
  return [
    { x: 0, z: 0 },
    { x: bounds.minX + inset, z: bounds.minZ + inset },
    { x: bounds.maxX - inset, z: bounds.minZ + inset },
    { x: bounds.minX + inset, z: bounds.maxZ - inset },
    { x: bounds.maxX - inset, z: bounds.maxZ - inset },
    { x: 0, z: bounds.maxZ - inset },
    { x: 0, z: bounds.minZ + inset },
  ];
}

/**
 * True when a grounded player at (x,z) can walk to a major open area on the map
 * (center or near-edge probes). Used to reject respawns inside sealed rooms.
 */
export function isSpawnReachable(
  x: number,
  z: number,
  geometry: readonly MapBox[],
  bounds: MapBounds2D,
): boolean {
  if (isBlockedAtGround(x, z, geometry)) return false;

  const targets = probeTargets(bounds);
  const targetKeys = new Set(targets.map((p) => `${Math.round(p.x / BFS_STEP)},${Math.round(p.z / BFS_STEP)}`));

  const key = (px: number, pz: number) => `${Math.round(px / BFS_STEP)},${Math.round(pz / BFS_STEP)}`;
  const startKey = key(x, z);
  const seen = new Set<string>([startKey]);
  const queue: { x: number; z: number }[] = [{ x, z }];
  let nodes = 0;

  while (queue.length > 0 && nodes < BFS_MAX_NODES) {
    const cur = queue.shift()!;
    nodes++;
    const curKey = key(cur.x, cur.z);
    if (targetKeys.has(curKey) && curKey !== startKey) return true;

    for (const [dx, dz] of [
      [BFS_STEP, 0],
      [-BFS_STEP, 0],
      [0, BFS_STEP],
      [0, -BFS_STEP],
    ] as const) {
      const nx = cur.x + dx;
      const nz = cur.z + dz;
      if (nx <= bounds.minX + 1 || nx >= bounds.maxX - 1 || nz <= bounds.minZ + 1 || nz >= bounds.maxZ - 1) {
        continue;
      }
      if (isBlockedAtGround(nx, nz, geometry)) continue;
      const nk = key(nx, nz);
      if (seen.has(nk)) continue;
      seen.add(nk);
      queue.push({ x: nx, z: nz });
    }
  }

  return false;
}
