// Redis JSON document shape for one player's durable economy profile (EPIC 27).

import type { GemType, PetType } from "@cubewars/shared";

export interface StoredPet {
  id: number;
  type: PetType;
  baseValue: number;
  equipSlot: 1 | 2 | null;
  createdAt: number;
}

export interface StoredEgg {
  id: number;
  hatchDeadlineMs: number;
  createdAt: number;
}

export interface StoredGem {
  id: number;
  gemType: GemType;
  value: number;
  petId: number | null;
  createdAt: number;
}

export interface StoredAmulet {
  id: number;
  durability: number;
  equipped: boolean;
  createdAt: number;
}

export interface StoredStimulator {
  id: number;
  createdAt: number;
}

export interface StoredRepairKit {
  id: number;
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
  repairKits: StoredRepairKit[];
  career: StoredCareer;
  endless: StoredEndless;
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
    repairKits: [],
    career: emptyCareer(nowMs),
    endless: emptyEndless(nowMs),
  };
}

export function cloneDocument(doc: EconomyDocument): EconomyDocument {
  return structuredClone(doc);
}
