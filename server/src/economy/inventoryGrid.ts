// Server-authoritative 8×8 inventory packing (EPIC 29).
// Equip rail items (equipped pets/amulets, socketed gems) do not occupy bag cells.

import {
  cellsForAnchor,
  findFirstFreeAnchor,
  footprintForItemType,
  isValidAnchor,
  type InventoryFootprint,
  type InventoryItemType,
} from "@cubewars/shared";
import type { EconomyDocument } from "./document.js";

export interface OccupancyEntry {
  itemType: InventoryItemType;
  itemId: number;
  footprint: InventoryFootprint;
  anchor: number;
  cells: number[];
}

function hasFiniteAnchor(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** True when any bag item is missing a usable slotAnchor (triggers one-shot auto-pack). */
export function needsAutoPack(doc: EconomyDocument): boolean {
  for (const pet of doc.pets) {
    if (pet.equipSlot === 1 || pet.equipSlot === 2) continue;
    if (!hasFiniteAnchor(pet.slotAnchor)) return true;
  }
  for (const egg of doc.eggs) {
    if (!hasFiniteAnchor(egg.slotAnchor)) return true;
  }
  for (const gem of doc.gems) {
    if (gem.petId !== null) continue;
    if (!hasFiniteAnchor(gem.slotAnchor)) return true;
  }
  for (const amulet of doc.amulets) {
    if (amulet.equipped) continue;
    if (!hasFiniteAnchor(amulet.slotAnchor)) return true;
  }
  for (const stim of doc.stimulators) {
    if (!hasFiniteAnchor(stim.slotAnchor)) return true;
  }
  for (const kit of doc.repairKits) {
    if (!hasFiniteAnchor(kit.slotAnchor)) return true;
  }
  if (doc.shardCount > 0 && !hasFiniteAnchor(doc.shardSlotAnchor)) return true;
  if (doc.shardCount <= 0 && doc.shardSlotAnchor != null) return true;
  return false;
}

/** Collect bag occupancy from current anchors (skips invalid / missing). */
export function collectOccupancy(doc: EconomyDocument): OccupancyEntry[] {
  const entries: OccupancyEntry[] = [];

  const push = (
    itemType: InventoryItemType,
    itemId: number,
    anchor: number | null | undefined,
  ): void => {
    if (!hasFiniteAnchor(anchor)) return;
    const footprint = footprintForItemType(itemType);
    const cells = cellsForAnchor(anchor, footprint);
    if (!cells) return;
    entries.push({ itemType, itemId, footprint, anchor, cells });
  };

  for (const pet of doc.pets) {
    if (pet.equipSlot === 1 || pet.equipSlot === 2) continue;
    push("pet", pet.id, pet.slotAnchor);
  }
  for (const egg of doc.eggs) {
    push("egg", egg.id, egg.slotAnchor);
  }
  for (const gem of doc.gems) {
    if (gem.petId !== null) continue;
    push("gem", gem.id, gem.slotAnchor);
  }
  for (const amulet of doc.amulets) {
    if (amulet.equipped) continue;
    push("amulet", amulet.id, amulet.slotAnchor);
  }
  for (const stim of doc.stimulators) {
    push("stimulator", stim.id, stim.slotAnchor);
  }
  for (const kit of doc.repairKits) {
    push("repair_kit", kit.id, kit.slotAnchor);
  }
  if (doc.shardCount > 0) {
    push("shard_stack", 0, doc.shardSlotAnchor);
  }
  return entries;
}

export function occupiedCells(
  doc: EconomyDocument,
  exclude?: { itemType: InventoryItemType; itemId: number },
): Set<number> {
  const set = new Set<number>();
  for (const entry of collectOccupancy(doc)) {
    if (
      exclude &&
      entry.itemType === exclude.itemType &&
      entry.itemId === exclude.itemId
    ) {
      continue;
    }
    for (const cell of entry.cells) set.add(cell);
  }
  return set;
}

export function findFit(
  doc: EconomyDocument,
  footprint: InventoryFootprint,
  exclude?: { itemType: InventoryItemType; itemId: number },
): number | null {
  return findFirstFreeAnchor(occupiedCells(doc, exclude), footprint);
}

export function canPlaceAt(
  doc: EconomyDocument,
  anchor: number,
  footprint: InventoryFootprint,
  exclude?: { itemType: InventoryItemType; itemId: number },
): boolean {
  if (!isValidAnchor(anchor, footprint)) return false;
  const cells = cellsForAnchor(anchor, footprint);
  if (!cells) return false;
  const occupied = occupiedCells(doc, exclude);
  return cells.every((c) => !occupied.has(c));
}

interface Packable {
  itemType: InventoryItemType;
  itemId: number;
  footprint: InventoryFootprint;
  apply: (anchor: number) => void;
}

/**
 * Assign anchors to every bag item in footprint-desc then stable id order.
 * Mutates `doc` in place. Returns true when any anchor changed.
 */
export function autoPackDocument(doc: EconomyDocument): boolean {
  const packables: Packable[] = [];

  for (const pet of doc.pets) {
    if (pet.equipSlot === 1 || pet.equipSlot === 2) {
      pet.slotAnchor = null;
      continue;
    }
    packables.push({
      itemType: "pet",
      itemId: pet.id,
      footprint: 2,
      apply: (anchor) => {
        pet.slotAnchor = anchor;
      },
    });
  }
  for (const amulet of doc.amulets) {
    if (amulet.equipped) {
      amulet.slotAnchor = null;
      continue;
    }
    packables.push({
      itemType: "amulet",
      itemId: amulet.id,
      footprint: 2,
      apply: (anchor) => {
        amulet.slotAnchor = anchor;
      },
    });
  }
  for (const egg of doc.eggs) {
    packables.push({
      itemType: "egg",
      itemId: egg.id,
      footprint: 1,
      apply: (anchor) => {
        egg.slotAnchor = anchor;
      },
    });
  }
  for (const gem of doc.gems) {
    if (gem.petId !== null) {
      gem.slotAnchor = null;
      continue;
    }
    packables.push({
      itemType: "gem",
      itemId: gem.id,
      footprint: 1,
      apply: (anchor) => {
        gem.slotAnchor = anchor;
      },
    });
  }
  for (const stim of doc.stimulators) {
    packables.push({
      itemType: "stimulator",
      itemId: stim.id,
      footprint: 1,
      apply: (anchor) => {
        stim.slotAnchor = anchor;
      },
    });
  }
  for (const kit of doc.repairKits) {
    packables.push({
      itemType: "repair_kit",
      itemId: kit.id,
      footprint: 1,
      apply: (anchor) => {
        kit.slotAnchor = anchor;
      },
    });
  }
  if (doc.shardCount > 0) {
    packables.push({
      itemType: "shard_stack",
      itemId: 0,
      footprint: 1,
      apply: (anchor) => {
        doc.shardSlotAnchor = anchor;
      },
    });
  } else {
    doc.shardSlotAnchor = null;
  }

  packables.sort((a, b) => {
    if (b.footprint !== a.footprint) return b.footprint - a.footprint;
    if (a.itemType !== b.itemType) return a.itemType.localeCompare(b.itemType);
    return a.itemId - b.itemId;
  });

  const occupied = new Set<number>();
  let changed = false;
  for (const item of packables) {
    const anchor = findFirstFreeAnchor(occupied, item.footprint);
    if (anchor === null) {
      // Should not happen under normal caps; leave unset so needsAutoPack retries.
      continue;
    }
    const cells = cellsForAnchor(anchor, item.footprint)!;
    for (const c of cells) occupied.add(c);
    item.apply(anchor);
    changed = true;
  }
  return changed;
}

export function clearItemAnchor(
  doc: EconomyDocument,
  itemType: InventoryItemType,
  itemId: number,
): void {
  switch (itemType) {
    case "pet": {
      const pet = doc.pets.find((p) => p.id === itemId);
      if (pet) pet.slotAnchor = null;
      break;
    }
    case "egg": {
      const egg = doc.eggs.find((e) => e.id === itemId);
      if (egg) egg.slotAnchor = null;
      break;
    }
    case "gem": {
      const gem = doc.gems.find((g) => g.id === itemId);
      if (gem) gem.slotAnchor = null;
      break;
    }
    case "amulet": {
      const amulet = doc.amulets.find((a) => a.id === itemId);
      if (amulet) amulet.slotAnchor = null;
      break;
    }
    case "stimulator": {
      const stim = doc.stimulators.find((s) => s.id === itemId);
      if (stim) stim.slotAnchor = null;
      break;
    }
    case "repair_kit": {
      const kit = doc.repairKits.find((k) => k.id === itemId);
      if (kit) kit.slotAnchor = null;
      break;
    }
    case "shard_stack":
      doc.shardSlotAnchor = null;
      break;
  }
}

export function setItemAnchor(
  doc: EconomyDocument,
  itemType: InventoryItemType,
  itemId: number,
  anchor: number,
): void {
  switch (itemType) {
    case "pet": {
      const pet = doc.pets.find((p) => p.id === itemId);
      if (pet) pet.slotAnchor = anchor;
      break;
    }
    case "egg": {
      const egg = doc.eggs.find((e) => e.id === itemId);
      if (egg) egg.slotAnchor = anchor;
      break;
    }
    case "gem": {
      const gem = doc.gems.find((g) => g.id === itemId);
      if (gem) gem.slotAnchor = anchor;
      break;
    }
    case "amulet": {
      const amulet = doc.amulets.find((a) => a.id === itemId);
      if (amulet) amulet.slotAnchor = anchor;
      break;
    }
    case "stimulator": {
      const stim = doc.stimulators.find((s) => s.id === itemId);
      if (stim) stim.slotAnchor = anchor;
      break;
    }
    case "repair_kit": {
      const kit = doc.repairKits.find((k) => k.id === itemId);
      if (kit) kit.slotAnchor = anchor;
      break;
    }
    case "shard_stack":
      doc.shardSlotAnchor = anchor;
      break;
  }
}

/** Place a newly granted bag item; throws if no free footprint fit. */
export function placeNewItem(
  doc: EconomyDocument,
  itemType: InventoryItemType,
  itemId: number,
): number {
  const footprint = footprintForItemType(itemType);
  const anchor = findFit(doc, footprint);
  if (anchor === null) {
    throw new Error("inventory_full");
  }
  setItemAnchor(doc, itemType, itemId, anchor);
  return anchor;
}
