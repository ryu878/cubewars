// Redis JSON document shape for one player's durable economy profile (EPIC 27/29).

import type { GemType, PetType } from "@cubewars/shared";

export interface StoredPet {
  id: number;
  type: PetType;
  baseValue: number;
  equipSlot: 1 | 2 | null;
  /** Bag left-cell when unequipped; null/omitted when equipped or legacy. */
  slotAnchor?: number | null;
  /**
   * EPIC 39: index into AVATAR_COLOR_PALETTE. Omitted on legacy docs → treat as 0.
   */
  colorIndex?: number;
  createdAt: number;
}

export interface StoredEgg {
  id: number;
  hatchDeadlineMs: number;
  slotAnchor?: number | null;
  createdAt: number;
}

export interface StoredGem {
  id: number;
  gemType: GemType;
  value: number;
  petId: number | null;
  /** Bag anchor when unequipped; null when socketed or legacy. */
  slotAnchor?: number | null;
  createdAt: number;
}

export interface StoredAmulet {
  id: number;
  durability: number;
  equipped: boolean;
  slotAnchor?: number | null;
  createdAt: number;
}

export interface StoredStimulator {
  id: number;
  slotAnchor?: number | null;
  createdAt: number;
}

export interface StoredRepairKit {
  id: number;
  slotAnchor?: number | null;
  createdAt: number;
}

export interface StoredCareer {
  kills: number;
  deaths: number;
  updatedAt: number;
}

export interface StoredEndless {
  botKills: number;
  distanceKm: number;
  updatedAt: number;
}

export interface EconomyDocument {
  v: 1;
  id: number;
  nicknameKey: string;
  nickname: string;
  gold: number;
  createdAt: number;
  updatedAt: number;
  nextPetId: number;
  nextEggId: number;
  nextGemId: number;
  nextAmuletId: number;
  nextStimId: number;
  nextRepairKitId: number;
  pets: StoredPet[];
  eggs: StoredEgg[];
  stimulators: StoredStimulator[];
  gems: StoredGem[];
  amulets: StoredAmulet[];
  shardCount: number;
  /** Anchor of the single shard stack when shardCount > 0. */
  shardSlotAnchor?: number | null;
  repairKits: StoredRepairKit[];
  career: StoredCareer;
  endless: StoredEndless;
  /**
   * EPIC 53: bag grid schema version. Missing/1 = legacy 8×8 anchors;
   * 2 = migrated (or created) for 6×5. Overflow items may keep null anchors
   * without re-triggering pack loops once this is 2.
   */
  inventoryGridVersion?: number;
}

export function emptyCareer(nowMs: number): StoredCareer {
  return { kills: 0, deaths: 0, updatedAt: nowMs };
}

export function emptyEndless(nowMs: number): StoredEndless {
  return { botKills: 0, distanceKm: 0, updatedAt: nowMs };
}

export function createEmptyDocument(
  id: number,
  nicknameKey: string,
  nickname: string,
  nowMs: number,
): EconomyDocument {
  return {
    v: 1,
    id,
    nicknameKey,
    nickname,
    gold: 0,
    createdAt: nowMs,
    updatedAt: nowMs,
    nextPetId: 1,
    nextEggId: 1,
    nextGemId: 1,
    nextAmuletId: 1,
    nextStimId: 1,
    nextRepairKitId: 1,
    pets: [],
    eggs: [],
    stimulators: [],
    gems: [],
    amulets: [],
    shardCount: 0,
    shardSlotAnchor: null,
    repairKits: [],
    career: emptyCareer(nowMs),
    endless: emptyEndless(nowMs),
    inventoryGridVersion: 2,
  };
}

export function cloneDocument(doc: EconomyDocument): EconomyDocument {
  return structuredClone(doc);
}
