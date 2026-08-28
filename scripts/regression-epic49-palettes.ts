// EPIC 49: every catalog MapId has a distinct palette entry (client mapThemes).
// Also re-exports assert for quick local smoke without Playwright.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_IDS, listMaps, EPIC48_PICKUP_COUNTS, WALL_HEIGHT } from "@cubewars/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// Load client mapThemes via tsx (same as other client-adjacent checks).
const require = createRequire(import.meta.url);

async function loadPalettes() {
  // Dynamic import of TS source under tsx runner.
  const mod = await import(join(REPO_ROOT, "client/src/mapThemes.ts"));
  return mod;
}

async function main(): Promise<void> {
  const { MAP_PALETTES, assertPalettesDistinct, getPalette } = await loadPalettes();

  assert.equal(Object.keys(MAP_PALETTES).length, MAP_IDS.length, "palette count matches MAP_IDS");
  for (const id of MAP_IDS) {
    assert.ok(MAP_PALETTES[id], `missing palette for ${id}`);
    const p = getPalette(id);
    assert.ok(typeof p.ground === "number");
    assert.ok(typeof p.fogColor === "number");
    assert.ok(typeof p.skyHorizon === "number");
    assert.ok(typeof p.wallTint === "number");
    assert.ok(typeof p.crateTint === "number");
    assert.ok(typeof p.propMetal === "number");
  }

  assertPalettesDistinct();

  const { groundThemeIdsForRegression } = await import(join(REPO_ROOT, "client/src/textures.ts"));
  for (const id of groundThemeIdsForRegression()) {
    assert.ok(typeof id === "string", `ground theme id ${id}`);
  }

  // Story 49.3 / EPIC 58: shared wall AABB height (6 → 18 in EPIC 58).
  assert.equal(WALL_HEIGHT, 18, "WALL_HEIGHT should be 18 (taller fog walls)");
  for (const map of listMaps()) {
    const fullWalls = map.geometry.filter((b) => b.kind === "wall" && b.size.y >= WALL_HEIGHT - 0.01);
    assert.ok(
      fullWalls.length > 0,
      `${map.id} should have full-height walls at WALL_HEIGHT=${WALL_HEIGHT}`,
    );
  }

  // EPIC 48 pickup counts must still hold after geometry enrichment.
  for (const map of listMaps()) {
    const counts = { weapon: 0, ammo: 0, health: 0, armor: 0 };
    for (const p of map.pickupPoints) {
      counts[p.category] += 1;
    }
    assert.equal(counts.weapon, EPIC48_PICKUP_COUNTS.weapon, `${map.id} weapon count`);
    assert.equal(counts.ammo, EPIC48_PICKUP_COUNTS.ammo, `${map.id} ammo count`);
    assert.equal(counts.health, EPIC48_PICKUP_COUNTS.health, `${map.id} health count`);
    assert.equal(counts.armor, EPIC48_PICKUP_COUNTS.armor, `${map.id} armor count`);
    assert.equal(
      map.pickupPoints.length,
      EPIC48_PICKUP_COUNTS.total,
      `${map.id} total pickups`,
    );
  }

  // Sanity: themed props exist with expected id prefixes on key maps.
  const byId = Object.fromEntries(listMaps().map((m) => [m.id, m]));
  assert.ok(byId.rust_canyon!.geometry.some((b) => b.id.startsWith("rc_tank_")));
  assert.ok(byId.fuel_depot!.geometry.some((b) => b.id.includes("fd_tank_") && b.id.includes("cistern")));
  assert.ok(byId.crystal_cave!.geometry.some((b) => b.id.includes("crystal")));
  assert.ok(byId.abyss_bridge!.geometry.some((b) => b.id.includes("cable")));
  assert.ok(byId.glass_dome!.geometry.some((b) => b.id.includes("veg")));
  assert.ok(byId.elite_quarter!.geometry.some((b) => b.id.includes("rubble")));

  // F-001: dry-bed rock piles contain `_bed` + `_rock_`; classifier must return rock (not body).
  const { propMaterialKind } = await import(join(REPO_ROOT, "client/src/propMaterialKind.ts"));
  assert.equal(propMaterialKind("rc_bed_w_rock_a"), "rock");
  assert.equal(propMaterialKind("rc_bed_e_rock_b"), "rock");
  assert.equal(propMaterialKind("rc_wreck_a_body"), "body");
  const bedRocks = byId.rust_canyon!.geometry.filter(
    (b) => b.id.includes("rc_bed_") && b.id.includes("_rock_"),
  );
  assert.ok(bedRocks.length >= 6, "rust_canyon dry-bed rock piles present");
  for (const b of bedRocks) {
    assert.equal(propMaterialKind(b.id), "rock", `${b.id} must use rock material`);
  }

  console.log("EPIC 49 palette + pickup regression OK");
  void require;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
