// Escrow payloads for auction / P2P trade / ground drops (EPIC 38).
// Items leave a player's bag into escrow, then are reminted into a receiver
// (or destroyed on ground TTL expire). IDs are never preserved across profiles.

import type { EconomyEscrowItemDto, InventoryItemType } from "@cubewars/shared";
import type {
  StoredAmulet,
  StoredEgg,
  StoredGem,
  StoredPet,
  StoredRepairKit,
  StoredStimulator,
} from "./document.js";

export type EscrowPayload =
  | { itemType: "pet"; pet: StoredPet; gems: StoredGem[] }
  | { itemType: "egg"; egg: StoredEgg }
  | { itemType: "gem"; gem: StoredGem }
  | { itemType: "amulet"; amulet: StoredAmulet }
  | { itemType: "stimulator"; stimulator: StoredStimulator }
  | { itemType: "repair_kit"; repairKit: StoredRepairKit }
  | { itemType: "shard_stack"; quantity: number };

export function escrowToDto(payload: EscrowPayload, displayId = 0): EconomyEscrowItemDto {
  switch (payload.itemType) {
    case "pet":
      return {
        itemType: "pet",
        itemId: displayId || payload.pet.id,
        label: payload.pet.type,
        detail: `bv ${payload.pet.baseValue}${payload.gems.length ? ` +${payload.gems.length}gem` : ""}`,
      };
    case "egg":
      return {
        itemType: "egg",
        itemId: displayId || payload.egg.id,
        label: "egg",
        detail: `ready@${payload.egg.hatchDeadlineMs}`,
      };
    case "gem":
      return {
        itemType: "gem",
        itemId: displayId || payload.gem.id,
        label: payload.gem.gemType,
        detail: `v${payload.gem.value}`,
      };
    case "amulet":
      return {
        itemType: "amulet",
        itemId: displayId || payload.amulet.id,
        label: "amulet",
        detail: `dur ${payload.amulet.durability}`,
      };
    case "stimulator":
      return {
        itemType: "stimulator",
        itemId: displayId || payload.stimulator.id,
        label: "stim",
      };
    case "repair_kit":
      return {
        itemType: "repair_kit",
        itemId: displayId || payload.repairKit.id,
        label: "kit",
      };
    case "shard_stack":
      return {
        itemType: "shard_stack",
        itemId: 0,
        quantity: payload.quantity,
        label: "shards",
        detail: `x${payload.quantity}`,
      };
  }
}

export function footprintForEscrow(payload: EscrowPayload): 1 | 2 {
  return payload.itemType === "pet" || payload.itemType === "amulet" ? 2 : 1;
}

export function itemTypeOfEscrow(payload: EscrowPayload): InventoryItemType {
  return payload.itemType;
}

/** Reminted identity returned by insertEscrowItem for compensating rollbacks (F-002). */
export type EscrowInsertRef =
  | { itemType: Exclude<InventoryItemType, "shard_stack">; itemId: number }
  | { itemType: "shard_stack"; quantity: number };
