// Shared mapper: FullEconomyProfile → wire EconomyProfileMessage (EPIC 42).
// Used by match, lobby bind, and auction Deathmatch profile pushes so DTO
// fields stay in one place.

import type { EconomyProfileMessage, EconomyPool } from "@cubewars/shared";
import type { EconomyScope, FullEconomyProfile } from "./store.js";

export function toEconomyProfileMessage(
  profile: FullEconomyProfile,
  scope: EconomyScope,
): EconomyProfileMessage {
  const economyPool: EconomyPool = scope;
  return {
    type: "economy_profile",
    nickname: profile.nickname,
    economyPool,
    gold: profile.gold,
    pets: profile.pets.map((p) => ({
      id: p.id,
      type: p.type,
      baseValue: p.baseValue,
      equipSlot: p.equipSlot,
      slotAnchor: p.slotAnchor,
      colorIndex: p.colorIndex,
    })),
    eggs: profile.eggs.map((e) => ({
      id: e.id,
      hatchDeadlineMs: e.hatchDeadlineMs,
      slotAnchor: e.slotAnchor,
    })),
    stimulatorCount: profile.stimulatorCount,
    stimulators: profile.stimulators.map((s) => ({
      id: s.id,
      slotAnchor: s.slotAnchor,
    })),
    gems: profile.gems.map((g) => ({
      id: g.id,
      gemType: g.gemType,
      value: g.value,
      petId: g.petId,
      slotAnchor: g.slotAnchor,
    })),
    amulets: profile.amulets.map((a) => ({
      id: a.id,
      durability: a.durability,
      equipped: a.equipped,
      slotAnchor: a.slotAnchor,
    })),
    shardCount: profile.shardCount,
    shardSlotAnchor: profile.shardSlotAnchor,
    repairKitCount: profile.repairKitCount,
    repairKits: profile.repairKits.map((k) => ({
      id: k.id,
      slotAnchor: k.slotAnchor,
    })),
    ratings: profile.ratings,
    slot2Enabled: profile.slot2Enabled,
  };
}
