// EPIC 29/53 regression: 6×5 inventory grid — auto-pack, findFit/placeNewItem,
// shrink migration / overflow, moveItem overlap/bad_anchor/not_in_bag rejects,
// discardItem permanence, hatch-egg re-anchoring, and slotAnchor persistence.

import assert from "node:assert/strict";
import {
  ECONOMY_CAPS,
  INVENTORY_GRID,
  INVENTORY_GRID_VERSION,
  cellsForAnchor,
} from "@cubewars/shared";
import { EconomyActionError, EconomyStore } from "../server/src/economy/index.js";
import { createEmptyDocument, type EconomyDocument } from "../server/src/economy/document.js";
import {
  autoPackDocument,
  canPlaceAt,
  findFit,
  migrateInventoryGridShrink,
  needsAutoPack,
  needsInventoryGridMigration,
  occupiedCells,
  placeNewItem,
} from "../server/src/economy/inventoryGrid.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

function assertNoOverlap(doc: EconomyDocument): void {
  const seen = new Set<number>();
  for (const cell of occupiedCells(doc)) {
    assert.ok(!seen.has(cell), `cell ${cell} double-claimed`);
    seen.add(cell);
  }
}

// --- Shared constants ---
{
  assert.deepEqual(INVENTORY_GRID, { cols: 6, rows: 5, cells: 30 });
  assert.equal(ECONOMY_CAPS.inventoryCells, 30);
  assert.equal(INVENTORY_GRID_VERSION, 2);
}

// --- Pure helpers: auto-pack on a legacy (anchor-less) document ---
{
  const doc = createEmptyDocument(1, "packer", "Packer", 1000);
  // createEmptyDocument starts at grid v2; clear so needsAutoPack sees legacy missing anchors.
  doc.inventoryGridVersion = undefined;
  doc.pets.push({ id: 1, type: "dog", baseValue: 10, equipSlot: null, createdAt: 1000, slotAnchor: undefined });
  doc.pets.push({ id: 2, type: "cat", baseValue: 20, equipSlot: 1, createdAt: 1000, slotAnchor: undefined });
  doc.eggs.push({ id: 1, hatchDeadlineMs: 5000, createdAt: 1000, slotAnchor: undefined });
  doc.gems.push({ id: 1, gemType: "armor", value: 10, petId: null, createdAt: 1000, slotAnchor: undefined });
  doc.amulets.push({ id: 1, durability: 5, equipped: false, createdAt: 1000, slotAnchor: undefined });
  doc.stimulators.push({ id: 1, createdAt: 1000, slotAnchor: undefined });
  doc.repairKits.push({ id: 1, createdAt: 1000, slotAnchor: undefined });
  doc.shardCount = 3;
  doc.shardSlotAnchor = undefined;

  assert.equal(needsAutoPack(doc), true, "doc missing anchors must need auto-pack");
  const changed = autoPackDocument(doc);
  assert.equal(changed, true);
  assert.equal(doc.inventoryGridVersion, INVENTORY_GRID_VERSION);
  assert.equal(needsAutoPack(doc), false, "auto-pack must be idempotent (one-shot)");
  assertNoOverlap(doc);

  // Equipped pet (id 2) stays off the grid (equip rail), not a bag anchor.
  const petOnBag = doc.pets.find((p) => p.id === 1)!;
  const petEquipped = doc.pets.find((p) => p.id === 2)!;
  assert.ok(typeof petOnBag.slotAnchor === "number");
  assert.equal(petEquipped.slotAnchor, null);

  // Re-running auto-pack again must keep positions legal.
  autoPackDocument(doc);
  assertNoOverlap(doc);
}

// --- findFit / placeNewItem: footprint packing, no row-wrap for 2-cell items ---
{
  const doc = createEmptyDocument(2, "fitter", "Fitter", 1000);
  // Fill row 0 up to col 4 (cells 0..4) so only cell 5 remains free in row 0.
  for (let i = 0; i < 5; i++) {
    doc.gems.push({
      id: i + 1,
      gemType: "health",
      value: 5,
      petId: null,
      createdAt: 1000,
      slotAnchor: i,
    });
  }
  // A 2-cell pet must NOT fit at anchor 5 (would wrap) and must skip to row 1 (anchor 6).
  const anchor = findFit(doc, 2);
  assert.equal(anchor, 6, "2-cell footprint must not wrap past column 5");
  const cells = cellsForAnchor(anchor!, 2)!;
  assert.deepEqual(cells, [6, 7]);

  doc.pets.push({ id: 100, type: "lion", baseValue: 5, equipSlot: null, createdAt: 1000, slotAnchor: undefined });
  const placed = placeNewItem(doc, "pet", 100);
  assert.equal(placed, 6);
  assert.equal(doc.pets.find((p) => p.id === 100)!.slotAnchor, 6);
  assertNoOverlap(doc);

  const oneCellAnchor = findFit(doc, 1);
  assert.equal(oneCellAnchor, 5);

  assert.equal(canPlaceAt(doc, 6, 2), false, "occupied by the just-placed pet");
  assert.equal(canPlaceAt(doc, 8, 2), true);
  assert.equal(canPlaceAt(doc, 5, 2), false, "would wrap past column 5 into next row");
}

// --- EPIC 53 shrink migration: preserve valid, re-pack OOB, overflow never deleted ---
{
  const doc = createEmptyDocument(3, "shrinker", "Shrinker", 1000);
  doc.inventoryGridVersion = 1;
  // Valid under 6×5:
  doc.gems.push({ id: 1, gemType: "health", value: 1, petId: null, createdAt: 1000, slotAnchor: 0 });
  doc.pets.push({ id: 1, type: "dog", baseValue: 10, equipSlot: null, createdAt: 1000, slotAnchor: 2 });
  // OOB under 6×5 (legacy 8×8 anchors):
  doc.eggs.push({ id: 1, hatchDeadlineMs: 9000, createdAt: 1000, slotAnchor: 40 });
  doc.stimulators.push({ id: 1, createdAt: 1000, slotAnchor: 63 });
  // Overlap with preserved pet cells 2–3 (1-cell loses to 2-cell in preserve order):
  doc.gems.push({ id: 2, gemType: "speed", value: 2, petId: null, createdAt: 1000, slotAnchor: 2 });
  doc.amulets.push({ id: 1, durability: 5, equipped: false, createdAt: 1000, slotAnchor: 10 });

  assert.equal(needsInventoryGridMigration(doc), true);
  const result = migrateInventoryGridShrink(doc);
  assert.equal(doc.inventoryGridVersion, 2);
  assert.equal(doc.gems.find((g) => g.id === 1)!.slotAnchor, 0, "valid non-overlapping gem preserved");
  assert.equal(doc.pets[0]!.slotAnchor, 2, "valid non-overlapping pet preserved");
  assert.ok(
    doc.gems.find((g) => g.id === 2)!.slotAnchor !== 2,
    "overlapping gem must be relocated",
  );
  assert.ok(result.relocated >= 1);
  assert.ok(typeof doc.eggs[0]!.slotAnchor === "number", "OOB egg re-packed");
  assert.ok(doc.eggs[0]!.slotAnchor! < INVENTORY_GRID.cells);
  assert.ok(typeof doc.stimulators[0]!.slotAnchor === "number" || doc.stimulators[0]!.slotAnchor === null);
  assert.equal(doc.amulets[0]!.slotAnchor, 10, "valid amulet preserved");
  assertNoOverlap(doc);
  assert.equal(needsInventoryGridMigration(doc), false);
  assert.equal(needsAutoPack(doc), false, "version guard stops pack loops");

  // Overflow: fill all 30 cells with 1-cell gems, then migrate an extra stim with OOB anchor.
  const full = createEmptyDocument(4, "overflow", "Overflow", 1000);
  full.inventoryGridVersion = 1;
  for (let i = 0; i < 30; i++) {
    full.gems.push({
      id: i + 1,
      gemType: "armor",
      value: 1,
      petId: null,
      createdAt: 1000,
      slotAnchor: i,
    });
  }
  full.stimulators.push({ id: 99, createdAt: 1000, slotAnchor: 50 });
  const overflowResult = migrateInventoryGridShrink(full);
  assert.equal(overflowResult.overflow, 1);
  assert.equal(full.stimulators[0]!.slotAnchor, null, "overflow item kept with null anchor");
  assert.equal(full.stimulators.length, 1, "overflow must never delete items");
  assert.equal(needsAutoPack(full), false, "null overflow must not infinite-loop needsAutoPack");
  assert.equal(needsInventoryGridMigration(full), false);
}

async function main(): Promise<void> {
  const store = await openTestEconomyStore();
  const redisUrl = store.redisUrl;
  const prefix = store.keyPrefix;
  const now = 3_000_000;

  // --- moveItem: success to a free anchor, persists ---
  await store.getOrCreateProfile("Mover");
  const movedPet = await store.grantPetForTests("Mover", "dog", 50, now);
  const beforeMove = await store.getFullProfile("Mover");
  const petBefore = beforeMove.pets.find((p) => p.id === movedPet.id)!;
  assert.ok(typeof petBefore.slotAnchor === "number");

  // Free target anchor far from the auto-assigned one (within 0..29).
  const targetAnchor = petBefore.slotAnchor === 12 ? 18 : 12;
  await store.moveItem("Mover", "pet", movedPet.id, targetAnchor, now);
  const afterMove = await store.getFullProfile("Mover");
  assert.equal(afterMove.pets.find((p) => p.id === movedPet.id)!.slotAnchor, targetAnchor);

  // --- moveItem: overlap reject ---
  const secondPet = await store.grantPetForTests("Mover", "cat", 60, now);
  const occupiedAnchor = (await store.getFullProfile("Mover")).pets.find(
    (p) => p.id === movedPet.id,
  )!.slotAnchor as number;
  await assert.rejects(
    async () => store.moveItem("Mover", "pet", secondPet.id, occupiedAnchor, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.equal(err.code, "overlap");
      return true;
    },
  );

  // --- moveItem: bad_anchor for OOB and row-wrap-violating anchors ---
  await assert.rejects(
    async () => store.moveItem("Mover", "pet", secondPet.id, INVENTORY_GRID.cells, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.equal(err.code, "bad_anchor");
      return true;
    },
  );
  await assert.rejects(
    // Last column cannot host a 2-cell item.
    async () => store.moveItem("Mover", "pet", secondPet.id, 5, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.equal(err.code, "bad_anchor");
      return true;
    },
  );

  // --- moveItem: rejects equipped/socketed items (not_in_bag) ---
  await store.equipPet("Mover", secondPet.id, 1, now);
  await assert.rejects(
    async () => store.moveItem("Mover", "pet", secondPet.id, 20, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.equal(err.code, "not_in_bag");
      return true;
    },
  );
  const socketGem = await store.grantGem("Mover", "armor", 10, now);
  await store.socketGem("Mover", socketGem.id, secondPet.id, now);
  await assert.rejects(
    async () => store.moveItem("Mover", "gem", socketGem.id, 24, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.equal(err.code, "not_in_bag");
      return true;
    },
  );

  // --- moveItem: rejects cross-profile (not your item) ---
  await store.getOrCreateProfile("MoverRival");
  await assert.rejects(
    async () => store.moveItem("MoverRival", "pet", movedPet.id, 10, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.equal(err.code, "not_found");
      return true;
    },
  );

  // --- discardItem: permanently removes, frees the cell, rejects equipped/socketed ---
  const discardGem = await store.grantGem("Mover", "speed", 15, now);
  await store.discardItem("Mover", "gem", discardGem.id, now);
  const afterDiscard = await store.getFullProfile("Mover");
  assert.ok(
    !afterDiscard.gems.some((g) => g.id === discardGem.id),
    "discarded gem must be gone from getFullProfile",
  );
  const refillGem = await store.grantGem("Mover", "damage", 20, now);
  assert.ok(
    (await store.getFullProfile("Mover")).gems.find((g) => g.id === refillGem.id)!.slotAnchor !==
      null,
  );

  await assert.rejects(
    async () => store.discardItem("Mover", "pet", secondPet.id, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.equal(err.code, "not_in_bag", "equipped pets cannot be discarded");
      return true;
    },
  );

  // --- Hatch placement: freed egg cell + new pet placed at a free 2-cell anchor ---
  await store.getOrCreateProfile("Hatcher");
  const hatchEgg = await store.grantEgg("Hatcher", now, 1);
  const eggAnchor = (await store.getFullProfile("Hatcher")).eggs.find(
    (e) => e.id === hatchEgg.id,
  )!.slotAnchor;
  const hatchedPet = await store.hatchEgg("Hatcher", hatchEgg.id, now + 2, {
    type: "bird",
    baseValue: 30,
  });
  const afterHatch = await store.getFullProfile("Hatcher");
  assert.ok(!afterHatch.eggs.some((e) => e.id === hatchEgg.id), "egg consumed by hatch");
  const newPet = afterHatch.pets.find((p) => p.id === hatchedPet.id)!;
  assert.ok(typeof newPet.slotAnchor === "number", "hatched pet must have a 2-cell bag anchor");
  const petCells = cellsForAnchor(newPet.slotAnchor!, 2);
  assert.ok(petCells, "hatched pet anchor must be a legal 2-cell footprint");

  const eggAnchorNum = eggAnchor as number;
  const hatcherGem = await store.grantGem("Hatcher", "speed", 8, now);
  if (!petCells!.includes(eggAnchorNum)) {
    await store.moveItem("Hatcher", "gem", hatcherGem.id, eggAnchorNum, now);
    assert.equal(
      (await store.getFullProfile("Hatcher")).gems.find((g) => g.id === hatcherGem.id)!.slotAnchor,
      eggAnchorNum,
    );
  }

  // --- Persistence: anchors survive a store close/reopen ---
  await store.close();
  const reopened = await EconomyStore.open({ redisUrl, keyPrefix: prefix, skipSqliteImport: true });
  const restoredMover = await reopened.getFullProfile("Mover");
  const restoredMovedPet = restoredMover.pets.find((p) => p.id === movedPet.id)!;
  assert.equal(restoredMovedPet.slotAnchor, targetAnchor, "moved anchor must survive reopen");
  const restoredHatcher = await reopened.getFullProfile("Hatcher");
  const restoredHatchedPet = restoredHatcher.pets.find((p) => p.id === hatchedPet.id)!;
  assert.equal(restoredHatchedPet.slotAnchor, newPet.slotAnchor, "hatched pet anchor must survive reopen");
  assert.equal(ECONOMY_CAPS.inventoryCells, INVENTORY_GRID.cells);

  await reopened.flushNamespace();
  await reopened.close();

  console.log("[economy-inventory] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
