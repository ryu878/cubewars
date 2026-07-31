// Static arena geometry (EPIC 3 "The Arena") — the single source of truth
// for both rendering (client/src/main.ts) and collision (client-side
// prediction in client/src/fpsController.ts + server authority in
// server/src/playerRegistry.ts). AABB-only by design (no rotated geometry)
// to keep collision math simple, per "prefer simple and reliable
// architecture" (ai-office/global/global-standards.mdc).
//
// Do NOT hand-roll a second copy of this list anywhere else — client
// renders exactly ARENA_GEOMETRY, server collides exactly against
// ARENA_GEOMETRY. See EPIC 3 spec risk: "Reusing the exact same shared AABB
// list for both rendering and collision is the main risk to get wrong."
//
// Layout (top-down, x = east/west, z = north/south, both centered on 0):
//
//   z=26  +------------------------------------------------------+
//         |            (unreachable filler void)                 |  <- outer_north
//   z=20  |----+                                            +----|
//         |    |                 TUNNEL                     |    |
//   z=12  | A  |-----+                                +-----| B  |
//         |site|  (unreachable filler void)            |site|
//    z=4  |    |-----+                                +-----|    |
//         |    |               MID LANE                     |    |
//   z=-4  |    |-----+                                +-----|    |
//         |    |  (unreachable filler void)            |    |
//  z=-26  +----+------------------------------------------------+
//        x=-46      x=-20                        x=20          x=46
//
// Site A: x in [-46,-20], full z span [-26,26], open, with crate cover.
// Site B: x in [20,46], mirrored.
// Mid lane: x in [-20,20], z in [-4,4] — the direct, shorter route.
// Tunnel (alternate route): x in [-20,20], z in [12,20] — parallel path.
// The two "divider" walls (x=-20 and x=20) are each split into 3 segments,
// leaving exactly the 2 gaps above (mid entrance, tunnel entrance) — every
// other pocket between mid/tunnel/outer walls is a fully enclosed,
// unreachable void (no gameplay effect, just unused interior geometry).

import type { Vector3 } from "./types.js";

export type MapBoxKind = "wall" | "crate";

/** One axis-aligned box of arena geometry: a center position + full size (width/height/depth, not half-extents). */
export interface MapBox {
  id: string;
  kind: MapBoxKind;
  center: Vector3;
  size: Vector3;
}

export interface AabbBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Compute the min/max bounds of a box from its center + size. */
export function boxBounds(box: MapBox): AabbBounds {
  return {
    minX: box.center.x - box.size.x / 2,
    maxX: box.center.x + box.size.x / 2,
    minY: box.center.y - box.size.y / 2,
    maxY: box.center.y + box.size.y / 2,
    minZ: box.center.z - box.size.z / 2,
    maxZ: box.center.z + box.size.z / 2,
  };
}

const WALL_HEIGHT = 4;
const WALL_Y = WALL_HEIGHT / 2;
const CRATE_HEIGHT = 1.2;
const CRATE_Y = CRATE_HEIGHT / 2;

/**
 * Overall arena footprint (outer envelope). Used by the client to size the
 * ground plane consistently with the collidable geometry below — this is
 * NOT itself a collidable box (the outer_* walls in ARENA_GEOMETRY are).
 */
export const ARENA_BOUNDS = {
  minX: -46,
  maxX: 46,
  minZ: -26,
  maxZ: 26,
} as const;

export const ARENA_GEOMETRY: MapBox[] = [
  // --- Outer boundary walls ---
  { id: "outer_west", kind: "wall", center: { x: -46, y: WALL_Y, z: 0 }, size: { x: 1, y: WALL_HEIGHT, z: 52 } },
  { id: "outer_east", kind: "wall", center: { x: 46, y: WALL_Y, z: 0 }, size: { x: 1, y: WALL_HEIGHT, z: 52 } },
  { id: "outer_north", kind: "wall", center: { x: 0, y: WALL_Y, z: 26 }, size: { x: 93, y: WALL_HEIGHT, z: 1 } },
  { id: "outer_south", kind: "wall", center: { x: 0, y: WALL_Y, z: -26 }, size: { x: 93, y: WALL_HEIGHT, z: 1 } },

  // --- West divider (Site A <-> mid/tunnel), 3 segments leaving 2 gaps:
  // z in (-4,4) = mid entrance, z in (12,20) = tunnel entrance ---
  { id: "divider_west_south", kind: "wall", center: { x: -20, y: WALL_Y, z: -15 }, size: { x: 1, y: WALL_HEIGHT, z: 22 } },
  { id: "divider_west_mid", kind: "wall", center: { x: -20, y: WALL_Y, z: 8 }, size: { x: 1, y: WALL_HEIGHT, z: 8 } },
  { id: "divider_west_north", kind: "wall", center: { x: -20, y: WALL_Y, z: 23 }, size: { x: 1, y: WALL_HEIGHT, z: 6 } },

  // --- East divider (mid/tunnel <-> Site B), mirrored ---
  { id: "divider_east_south", kind: "wall", center: { x: 20, y: WALL_Y, z: -15 }, size: { x: 1, y: WALL_HEIGHT, z: 22 } },
  { id: "divider_east_mid", kind: "wall", center: { x: 20, y: WALL_Y, z: 8 }, size: { x: 1, y: WALL_HEIGHT, z: 8 } },
  { id: "divider_east_north", kind: "wall", center: { x: 20, y: WALL_Y, z: 23 }, size: { x: 1, y: WALL_HEIGHT, z: 6 } },

  // --- Mid lane corridor walls (z = -4 / 4, spanning x in [-20,20]) ---
  { id: "mid_wall_south", kind: "wall", center: { x: 0, y: WALL_Y, z: -4 }, size: { x: 40, y: WALL_HEIGHT, z: 1 } },
  { id: "mid_wall_north", kind: "wall", center: { x: 0, y: WALL_Y, z: 4 }, size: { x: 40, y: WALL_HEIGHT, z: 1 } },

  // --- Tunnel (alternate route) corridor walls (z = 12 / 20, x in [-20,20]) ---
  { id: "tunnel_wall_south", kind: "wall", center: { x: 0, y: WALL_Y, z: 12 }, size: { x: 40, y: WALL_HEIGHT, z: 1 } },
  { id: "tunnel_wall_north", kind: "wall", center: { x: 0, y: WALL_Y, z: 20 }, size: { x: 40, y: WALL_HEIGHT, z: 1 } },

  // --- Site A crate cover ---
  { id: "crate_a1", kind: "crate", center: { x: -38, y: CRATE_Y, z: -6 }, size: { x: 2, y: CRATE_HEIGHT, z: 2 } },
  { id: "crate_a2", kind: "crate", center: { x: -30, y: CRATE_Y, z: 6 }, size: { x: 2, y: CRATE_HEIGHT, z: 2 } },
  { id: "crate_a3", kind: "crate", center: { x: -24, y: CRATE_Y, z: -14 }, size: { x: 1.5, y: CRATE_HEIGHT, z: 1.5 } },

  // --- Site B crate cover (mirrored) ---
  { id: "crate_b1", kind: "crate", center: { x: 38, y: CRATE_Y, z: 6 }, size: { x: 2, y: CRATE_HEIGHT, z: 2 } },
  { id: "crate_b2", kind: "crate", center: { x: 30, y: CRATE_Y, z: -6 }, size: { x: 2, y: CRATE_HEIGHT, z: 2 } },
  { id: "crate_b3", kind: "crate", center: { x: 24, y: CRATE_Y, z: 14 }, size: { x: 1.5, y: CRATE_HEIGHT, z: 1.5 } },

  // --- Mid lane crate cover ("mid doors"-style boxes), offset so the
  // corridor remains passable on either side ---
  { id: "crate_mid1", kind: "crate", center: { x: -8, y: CRATE_Y, z: -1.5 }, size: { x: 1.5, y: CRATE_HEIGHT, z: 1.5 } },
  { id: "crate_mid2", kind: "crate", center: { x: 8, y: CRATE_Y, z: 1.5 }, size: { x: 1.5, y: CRATE_HEIGHT, z: 1.5 } },
];

/**
 * Spawn candidates, spread across both sites and pre-checked to be clear of
 * every wall/crate in ARENA_GEOMETRY above. server/src/playerRegistry.ts
 * jitters around one of these and re-resolves against collision as a
 * defensive double-check (see Story 3.3 / Task 5).
 */
export const SPAWN_POINTS: Vector3[] = [
  { x: -34, y: 0, z: -16 },
  { x: -34, y: 0, z: 0 },
  { x: -34, y: 0, z: 16 },
  { x: 34, y: 0, z: -16 },
  { x: 34, y: 0, z: 0 },
  { x: 34, y: 0, z: 16 },
];
