// EPIC 59: point-in-rift hit test, per-map kinds, spawn clearance, scale.

import assert from "node:assert/strict";
import {
  MAP_IDS,
  MAP_LINEAR_SCALE,
  PLAYER_COLLISION_RADIUS,
  getMap,
  isPointInRift,
  listMaps,
  type MapId,
  type MapRiftHazardKind,
} from "@cubewars/shared";

const EXPECTED_KIND: Record<MapId, MapRiftHazardKind> = {
  base: "water_piranha",
  rust_canyon: "lava",
  glass_dome: "acid",
  dead_station: "toxic_sludge",
  fuel_depot: "oil_fire",
  crystal_cave: "plasma",
  abyss_bridge: "void_ink",
  elite_quarter: "molten_gold",
};

function midpointOnFirstSegment(rift: NonNullable<ReturnType<typeof getMap>["rift"]>): {
  x: number;
  z: number;
} {
  const a = rift.polyline[0]!;
  const b = rift.polyline[1]!;
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function assertPointInRiftBasics(): void {
  const synthetic = {
    kind: "lava" as const,
    halfWidth: 1,
    damagePerSecond: 12,
    polyline: [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ],
  };
  assert.equal(isPointInRift(5, 0, synthetic), true, "on-segment center should hit");
  assert.equal(isPointInRift(5, 0.5, synthetic), true, "within halfWidth should hit");
  assert.equal(isPointInRift(5, 1.01, synthetic), false, "outside halfWidth should miss");
  assert.equal(isPointInRift(-2, 0, synthetic), false, "past endpoint should miss");
  assert.equal(isPointInRift(5, 0, { ...synthetic, polyline: [{ x: 0, z: 0 }] }), false);
}

function assertCatalogRifts(): void {
  const kinds = new Set<MapRiftHazardKind>();
  for (const mapId of MAP_IDS) {
    const map = getMap(mapId);
    assert.ok(map.rift, `${mapId} must have a rift`);
    const rift = map.rift!;
    assert.equal(rift.kind, EXPECTED_KIND[mapId], `${mapId} kind mismatch`);
    assert.ok(rift.polyline.length >= 6, `${mapId} polyline needs ≥6 points`);
    assert.ok(rift.halfWidth > 0.4 && rift.halfWidth < 1.2, `${mapId} halfWidth after scale`);
    assert.ok(rift.damagePerSecond >= 10 && rift.damagePerSecond <= 14, `${mapId} DPS`);
    kinds.add(rift.kind);

    const mid = midpointOnFirstSegment(rift);
    assert.equal(isPointInRift(mid.x, mid.z, rift), true, `${mapId} mid-segment inside`);
    assert.equal(
      isPointInRift(mid.x, mid.z + rift.halfWidth + 0.5, rift),
      false,
      `${mapId} far offset outside`,
    );

    for (const spawn of map.spawnPoints) {
      assert.equal(
        isPointInRift(spawn.x, spawn.z, rift),
        false,
        `${mapId}: spawn (${spawn.x},${spawn.z}) must not be inside rift`,
      );
      // Clearance: spawn circle should not intersect thickened rift.
      const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
      for (const angle of angles) {
        const px = spawn.x + Math.cos(angle) * PLAYER_COLLISION_RADIUS;
        const pz = spawn.z + Math.sin(angle) * PLAYER_COLLISION_RADIUS;
        assert.equal(
          isPointInRift(px, pz, rift),
          false,
          `${mapId}: spawn clearance (${px.toFixed(2)},${pz.toFixed(2)})`,
        );
      }
    }
  }

  assert.equal(kinds.size, MAP_IDS.length, "each catalog map needs a distinct rift kind");
  assert.equal(listMaps().length, MAP_IDS.length);

  // Authored halfWidth 1.6 → 0.8 after MAP_LINEAR_SCALE.
  const base = getMap("base");
  assert.ok(base.rift);
  assert.ok(
    Math.abs(base.rift!.halfWidth - 1.6 * MAP_LINEAR_SCALE) < 1e-9,
    "base halfWidth must scale with MAP_LINEAR_SCALE",
  );
}

assertPointInRiftBasics();
assertCatalogRifts();
console.log("regression-epic59-rifts: OK");
