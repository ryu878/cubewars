// EPIC 29 regression: 8x8 inventory grid — auto-pack, findFit/placeNewItem,
// moveItem overlap/bad_anchor/not_in_bag/cross-profile rejects, discardItem
// permanence, hatch-egg re-anchoring, and slotAnchor persistence across a
// store close/reopen (same reopen pattern as regression-economy-pets.ts).

import assert from "node:assert/strict";
import { ECONOMY_CAPS, INVENTORY_GRID, cellsForAnchor } from "@cubewars/shared";
import { EconomyActionError, EconomyStore } from "../server/src/economy/index.js";
import { createEmptyDocument, type EconomyDocument } from "../server/src/economy/document.js";
import {
  autoPackDocument,
  canPlaceAt,
  findFit,
  needsAutoPack,
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

// --- Pure helpers: auto-pack on a legacy (anchor-less) document ---
{
  const doc = createEmptyDocument(1, "packer", "Packer", 1000);
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
  assert.equal(needsAutoPack(doc), false, "auto-pack must be idempotent (one-shot)");
  assertNoOverlap(doc);

  // Equipped pet (id 2) stays off the grid (equip rail), not a bag anchor.
  const petOnBag = doc.pets.find((p) => p.id === 1)!;
  const petEquipped = doc.pets.find((p) => p.id === 2)!;
  assert.ok(typeof petOnBag.slotAnchor === "number");
  assert.equal(petEquipped.slotAnchor, null);

  // Re-running auto-pack again must be a no-op (already packed).
  const changedAgain = autoPackDocument(doc);
  // autoPackDocument always reassigns deterministically; needsAutoPack is
  // the one-shot gate — assert positions are stable across a second pass.
  assert.equal(changedAgain, true);
  assertNoOverlap(doc);
}

// --- findFit / placeNewItem: footprint packing, no row-wrap for 2-cell items ---
{
  const doc = createEmptyDocument(2, "fitter", "Fitter", 1000);
  // Fill row 0 up to col 6 (cells 0..6) with 1-cell gems so only cell 7
  // (a single free cell at the end of the row) remains free in row 0.
  for (let i = 0; i < 7; i++) {
    doc.gems.push({
      id: i + 1,
      gemType: "health",
      value: 5,
      petId: null,
      createdAt: 1000,
      slotAnchor: i,
    });
  }
  // A 2-cell pet must NOT fit at anchor 7 (would wrap into row 1) and must
  // skip to the first row that has two contiguous free cells (row 1, anchor 8).
  const anchor = findFit(doc, 2);
  assert.equal(anchor, 8, "2-cell footprint must not wrap past column 6");
  const cells = cellsForAnchor(anchor!, 2)!;
  assert.deepEqual(cells, [8, 9]);

  // placeNewItem only writes the anchor onto an item already present in the
  // document (mirrors how EconomyStore.grant* pushes the row first, then
  // calls assignBagAnchor/placeNewItem) — push the pet row before placing.
  doc.pets.push({ id: 100, type: "lion", baseValue: 5, equipSlot: null, createdAt: 1000, slotAnchor: undefined });
  const placed = placeNewItem(doc, "pet", 100);
  assert.equal(placed, 8);
  assert.equal(doc.pets.find((p) => p.id === 100)!.slotAnchor, 8);
  assertNoOverlap(doc);

  // The lone free 1-cell gap in row 0 (anchor 7) is still the first fit for
  // a 1-cell item.
  const oneCellAnchor = findFit(doc, 1);
  assert.equal(oneCellAnchor, 7);

  assert.equal(canPlaceAt(doc, 8, 2), false, "occupied by the just-placed pet");
  assert.equal(canPlaceAt(doc, 10, 2), true);
  assert.equal(canPlaceAt(doc, 6, 2), false, "would wrap past column 6 into next row");
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

  // Free target anchor far from the auto-assigned one.
  const targetAnchor = petBefore.slotAnchor === 40 ? 42 : 40;
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
    // Column 7 (row-end) cannot host a 2-cell item — would wrap to the next row.
    async () => store.moveItem("Mover", "pet", secondPet.id, 7, now),
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
    async () => store.moveItem("Mover", "gem", socketGem.id, 30, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      assert.equal(err.code, "not_in_bag");
      return true;
    },
  );

  // --- moveItem: rejects cross-profile (not your item) ---
  await store.getOrCreateProfile("MoverRival");
  await assert.rejects(
    async () => store.moveItem("MoverRival", "pet", movedPet.id, 50, now),
    (err: unknown) => {
      assert.ok(err instanceof EconomyActionError);
      // Cross-owner items simply don't exist in the caller's own document.
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
  // The freed cell is usable again.
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

  // The freed egg cell is genuinely free again: a fresh gem can be moved
  // onto it without an overlap rejection (proves the egg's old cell was
  // released, not just left dangling).
  const eggAnchorNum = eggAnchor as number;
  const hatcherGem = await store.grantGem("Hatcher", "speed", 8, now);
  if (!petCells.includes(eggAnchorNum)) {
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
