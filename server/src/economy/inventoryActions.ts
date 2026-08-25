// Shared inventory-family economy mutations (EPIC 42).
// Used by in-match Match.handleEconomyAction and by the pre-match lobby
// Deathmatch path so the switch is not duplicated. Drop / trade / ground
// stay match-only and are intentionally absent here.

import { isValidPaletteIndex, type InventoryItemType } from "@cubewars/shared";
import {
  EconomyActionError,
  type EconomyScope,
  type EconomyStore,
} from "./store.js";

/** Inventory-family actions that may run in lobby (Deathmatch) or in-match. */
export type InventoryBagAction =
  | "equip"
  | "unequip"
  | "set_pet_color"
  | "hatch"
  | "stimulator"
  | "socket_gem"
  | "unsocket_gem"
  | "equip_amulet"
  | "unequip_amulet"
  | "craft_amulet"
  | "repair_amulet"
  | "move_item"
  | "discard_item";

export interface InventoryEconomyPayload {
  petId?: number;
  eggId?: number;
  slot?: number;
  gemId?: number;
  amuletId?: number;
  itemType?: InventoryItemType;
  itemId?: number;
  toAnchor?: number;
  paletteIndex?: number;
}

export type InventoryActionResult = { ok: true } | { ok: false; code: string };

/**
 * Apply one inventory-family mutation against `economy` for `nickname`/`scope`.
 * Caller is responsible for pushing `economy_profile` / combat rating refresh.
 */
export async function applyInventoryEconomyAction(
  economy: EconomyStore,
  nickname: string,
  scope: EconomyScope,
  action: InventoryBagAction,
  payload: InventoryEconomyPayload,
  nowMs: number = Date.now(),
): Promise<InventoryActionResult> {
  try {
    if (action === "equip") {
      if (typeof payload.petId !== "number" || !Number.isInteger(payload.petId)) {
        return { ok: false, code: "not_found" };
      }
      const slot = payload.slot ?? 1;
      await economy.equipPet(nickname, payload.petId, slot, nowMs, scope);
    } else if (action === "unequip") {
      if (typeof payload.petId !== "number" || !Number.isInteger(payload.petId)) {
        return { ok: false, code: "not_found" };
      }
      await economy.unequipPet(nickname, payload.petId, nowMs, scope);
    } else if (action === "set_pet_color") {
      if (
        typeof payload.petId !== "number" ||
        !Number.isInteger(payload.petId) ||
        !isValidPaletteIndex(payload.paletteIndex)
      ) {
        return { ok: false, code: "not_found" };
      }
      await economy.setPetColor(nickname, payload.petId, payload.paletteIndex!, nowMs, scope);
    } else if (action === "hatch") {
      if (typeof payload.eggId !== "number" || !Number.isInteger(payload.eggId)) {
        return { ok: false, code: "not_found" };
      }
      await economy.hatchEgg(nickname, payload.eggId, nowMs, undefined, scope);
    } else if (action === "stimulator") {
      if (typeof payload.eggId !== "number" || !Number.isInteger(payload.eggId)) {
        return { ok: false, code: "not_found" };
      }
      await economy.applyStimulator(nickname, payload.eggId, nowMs, scope);
    } else if (action === "socket_gem") {
      if (
        typeof payload.gemId !== "number" ||
        !Number.isInteger(payload.gemId) ||
        typeof payload.petId !== "number" ||
        !Number.isInteger(payload.petId)
      ) {
        return { ok: false, code: "not_found" };
      }
      await economy.socketGem(nickname, payload.gemId, payload.petId, nowMs, scope);
    } else if (action === "unsocket_gem") {
      if (typeof payload.gemId !== "number" || !Number.isInteger(payload.gemId)) {
        return { ok: false, code: "not_found" };
      }
      await economy.unsocketGem(nickname, payload.gemId, nowMs, scope);
    } else if (action === "equip_amulet") {
      if (typeof payload.amuletId !== "number" || !Number.isInteger(payload.amuletId)) {
        return { ok: false, code: "not_found" };
      }
      await economy.equipAmulet(nickname, payload.amuletId, nowMs, scope);
    } else if (action === "unequip_amulet") {
      if (typeof payload.amuletId !== "number" || !Number.isInteger(payload.amuletId)) {
        return { ok: false, code: "not_found" };
      }
      await economy.unequipAmulet(nickname, payload.amuletId, nowMs, scope);
    } else if (action === "craft_amulet") {
      await economy.craftAmulet(nickname, nowMs, scope);
    } else if (action === "repair_amulet") {
      if (typeof payload.amuletId !== "number" || !Number.isInteger(payload.amuletId)) {
        return { ok: false, code: "not_found" };
      }
      await economy.repairAmulet(nickname, payload.amuletId, nowMs, scope);
    } else if (action === "move_item") {
      if (
        typeof payload.itemType !== "string" ||
        typeof payload.itemId !== "number" ||
        !Number.isInteger(payload.itemId) ||
        typeof payload.toAnchor !== "number" ||
        !Number.isInteger(payload.toAnchor)
      ) {
        return { ok: false, code: "not_found" };
      }
      await economy.moveItem(
        nickname,
        payload.itemType,
        payload.itemId,
        payload.toAnchor,
        nowMs,
        scope,
      );
    } else if (action === "discard_item") {
      if (
        typeof payload.itemType !== "string" ||
        typeof payload.itemId !== "number" ||
        !Number.isInteger(payload.itemId)
      ) {
        return { ok: false, code: "not_found" };
      }
      await economy.discardItem(nickname, payload.itemType, payload.itemId, nowMs, scope);
    } else {
      return { ok: false, code: "not_found" };
    }
    return { ok: true };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as EconomyActionError).code)
        : "not_found";
    return { ok: false, code };
  }
}
