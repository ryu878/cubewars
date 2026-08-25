// In-match P2P trade sessions + ground item entities (EPIC 38).
// Deathmatch (public) matches only — Sandbox must never enter the market.

import { randomUUID } from "node:crypto";
import {
  GROUND_DROP_TTL_MS,
  type EconomyEscrowItemDto,
  type EconomyGroundItemDto,
  type EconomyTradeStateMessage,
  type InventoryItemType,
  type Vector3,
} from "@cubewars/shared";
import { escrowToDto, type EscrowInsertRef, type EscrowPayload } from "./economy/escrow.js";
import {
  EconomyActionError,
  type EconomyStore,
} from "./economy/index.js";

export interface GroundItemEntity {
  groundId: number;
  payload: EscrowPayload;
  position: Vector3;
  expiresAtMs: number;
  ownerPlayerId: string;
}

export interface TradeOfferItem {
  itemType: InventoryItemType;
  itemId: number;
  shardQuantity?: number;
}

interface TradeSide {
  playerId: string;
  nickname: string;
  gold: number;
  items: TradeOfferItem[];
  confirmed: boolean;
}

export interface TradeSession {
  tradeId: string;
  a: TradeSide;
  b: TradeSide;
}

export class MatchGroundItems {
  private items = new Map<number, GroundItemEntity>();
  private nextId = 1;

  drop(
    payload: EscrowPayload,
    position: Vector3,
    ownerPlayerId: string,
    nowMs: number,
    ttlMs: number = GROUND_DROP_TTL_MS,
  ): GroundItemEntity {
    const groundId = this.nextId++;
    const entity: GroundItemEntity = {
      groundId,
      payload,
      position: { ...position },
      expiresAtMs: nowMs + ttlMs,
      ownerPlayerId,
    };
    this.items.set(groundId, entity);
    return entity;
  }

  get(groundId: number): GroundItemEntity | undefined {
    return this.items.get(groundId);
  }

  remove(groundId: number): GroundItemEntity | undefined {
    const item = this.items.get(groundId);
    if (item) this.items.delete(groundId);
    return item;
  }

  /**
   * F-001: synchronous exclusive claim — removes from the map before any await
   * so concurrent pickups cannot both observe the same entity.
   */
  claim(groundId: number): GroundItemEntity | undefined {
    return this.remove(groundId);
  }

  /** Put a previously claimed entity back (insert failure / cap reject). */
  restore(entity: GroundItemEntity): void {
    this.items.set(entity.groundId, entity);
  }

  /** Destroy expired items; returns whether anything changed. */
  expire(nowMs: number): number {
    let n = 0;
    for (const [id, item] of this.items) {
      if (nowMs >= item.expiresAtMs) {
        this.items.delete(id);
        n += 1;
        console.log(`[ground] expired destroy ground#${id}`);
      }
    }
    return n;
  }

  toDtoList(): EconomyGroundItemDto[] {
    return [...this.items.values()].map((item) => ({
      groundId: item.groundId,
      item: escrowToDto(item.payload),
      position: item.position,
      expiresAtMs: item.expiresAtMs,
      ownerPlayerId: item.ownerPlayerId,
    }));
  }
}

export class MatchTradeSessions {
  private byId = new Map<string, TradeSession>();
  private byPlayer = new Map<string, string>();

  getForPlayer(playerId: string): TradeSession | undefined {
    const id = this.byPlayer.get(playerId);
    return id ? this.byId.get(id) : undefined;
  }

  get(tradeId: string): TradeSession | undefined {
    return this.byId.get(tradeId);
  }

  open(
    playerId: string,
    nickname: string,
    partnerId: string,
    partnerNickname: string,
  ): TradeSession {
    if (playerId === partnerId) {
      throw new EconomyActionError("trade_invalid", "cannot trade with self");
    }
    if (this.byPlayer.has(playerId) || this.byPlayer.has(partnerId)) {
      throw new EconomyActionError("trade_invalid", "player already in a trade");
    }
    const tradeId = randomUUID();
    const session: TradeSession = {
      tradeId,
      a: { playerId, nickname, gold: 0, items: [], confirmed: false },
      b: {
        playerId: partnerId,
        nickname: partnerNickname,
        gold: 0,
        items: [],
        confirmed: false,
      },
    };
    this.byId.set(tradeId, session);
    this.byPlayer.set(playerId, tradeId);
    this.byPlayer.set(partnerId, tradeId);
    return session;
  }

  setOffer(
    tradeId: string,
    playerId: string,
    gold: number,
    items: TradeOfferItem[],
  ): TradeSession {
    const session = this.byId.get(tradeId);
    if (!session) throw new EconomyActionError("trade_invalid", "unknown trade");
    const side = this.sideOf(session, playerId);
    if (!Number.isInteger(gold) || gold < 0) {
      throw new EconomyActionError("invalid_price", "gold must be a non-negative integer");
    }
    side.gold = gold;
    side.items = items.map((i) => ({ ...i }));
    // Changing offer clears both confirms.
    session.a.confirmed = false;
    session.b.confirmed = false;
    return session;
  }

  confirm(tradeId: string, playerId: string): TradeSession {
    const session = this.byId.get(tradeId);
    if (!session) throw new EconomyActionError("trade_invalid", "unknown trade");
    this.sideOf(session, playerId).confirmed = true;
    return session;
  }

  bothConfirmed(session: TradeSession): boolean {
    return session.a.confirmed && session.b.confirmed;
  }

  cancel(tradeId: string): TradeSession | undefined {
    const session = this.byId.get(tradeId);
    if (!session) return undefined;
    this.byId.delete(tradeId);
    this.byPlayer.delete(session.a.playerId);
    this.byPlayer.delete(session.b.playerId);
    return session;
  }

  /** Cancel any trade involving this player (disconnect / leave). */
  cancelForPlayer(playerId: string): TradeSession | undefined {
    const id = this.byPlayer.get(playerId);
    if (!id) return undefined;
    return this.cancel(id);
  }

  private sideOf(session: TradeSession, playerId: string): TradeSide {
    if (session.a.playerId === playerId) return session.a;
    if (session.b.playerId === playerId) return session.b;
    throw new EconomyActionError("trade_invalid", "not a party to this trade");
  }

  toStateMessage(
    session: TradeSession,
    viewerId: string,
    status: EconomyTradeStateMessage["status"] = "open",
  ): EconomyTradeStateMessage {
    const you = session.a.playerId === viewerId ? session.a : session.b;
    const partner = session.a.playerId === viewerId ? session.b : session.a;
    return {
      type: "economy_trade_state",
      tradeId: session.tradeId,
      status,
      partnerId: partner.playerId,
      partnerNickname: partner.nickname,
      you: {
        gold: you.gold,
        items: you.items.map((i) => offerToDto(i)),
        confirmed: you.confirmed,
      },
      partner: {
        gold: partner.gold,
        items: partner.items.map((i) => offerToDto(i)),
        confirmed: partner.confirmed,
      },
    };
  }
}

function offerToDto(item: TradeOfferItem): EconomyEscrowItemDto {
  return {
    itemType: item.itemType,
    itemId: item.itemId,
    quantity: item.shardQuantity,
    label: item.itemType,
  };
}

/**
 * Atomically swap offers between two deathmatch profiles (no fee).
 * Validates ownership + caps, then extract/insert/gold transfer.
 * On failure: reverse only completed inserts (by remint ref), restore all
 * extracted payloads to original owners, refund gold (F-002).
 */
export async function executeAtomicTrade(
  economy: EconomyStore,
  session: TradeSession,
  nowMs: number,
): Promise<void> {
  const scope = "deathmatch" as const;

  const profileA = await economy.getOrCreateProfile(session.a.nickname, scope);
  const profileB = await economy.getOrCreateProfile(session.b.nickname, scope);
  if (profileA.gold < session.a.gold) {
    throw new EconomyActionError("insufficient_gold", "side A lacks gold");
  }
  if (profileB.gold < session.b.gold) {
    throw new EconomyActionError("insufficient_gold", "side B lacks gold");
  }

  const extractedA: EscrowPayload[] = [];
  const extractedB: EscrowPayload[] = [];
  /** Reminted inserts already applied to A (from B's offer). */
  const insertedOnA: EscrowInsertRef[] = [];
  /** Reminted inserts already applied to B (from A's offer). */
  const insertedOnB: EscrowInsertRef[] = [];
  let goldDebitedA = 0;
  let goldDebitedB = 0;
  let goldCreditedA = 0;
  let goldCreditedB = 0;

  try {
    for (const item of session.a.items) {
      extractedA.push(
        await economy.extractBagItem(
          session.a.nickname,
          item.itemType,
          item.itemId,
          nowMs,
          scope,
          item.shardQuantity,
        ),
      );
    }
    for (const item of session.b.items) {
      extractedB.push(
        await economy.extractBagItem(
          session.b.nickname,
          item.itemType,
          item.itemId,
          nowMs,
          scope,
          item.shardQuantity,
        ),
      );
    }

    for (const payload of extractedB) {
      await economy.assertCanAcceptEscrow(session.a.nickname, payload, scope);
    }
    for (const payload of extractedA) {
      await economy.assertCanAcceptEscrow(session.b.nickname, payload, scope);
    }

    if (session.a.gold > 0) {
      await economy.debitGold(session.a.nickname, session.a.gold, nowMs, scope);
      goldDebitedA = session.a.gold;
    }
    if (session.b.gold > 0) {
      await economy.debitGold(session.b.nickname, session.b.gold, nowMs, scope);
      goldDebitedB = session.b.gold;
    }

    for (const payload of extractedB) {
      insertedOnA.push(
        await economy.insertEscrowItem(session.a.nickname, payload, nowMs, scope),
      );
    }
    for (const payload of extractedA) {
      insertedOnB.push(
        await economy.insertEscrowItem(session.b.nickname, payload, nowMs, scope),
      );
    }

    if (session.a.gold > 0) {
      await economy.addGold(session.b.nickname, session.a.gold, scope);
      goldCreditedB = session.a.gold;
    }
    if (session.b.gold > 0) {
      await economy.addGold(session.a.nickname, session.b.gold, scope);
      goldCreditedA = session.b.gold;
    }
  } catch (err) {
    // Reverse reminted inserts on receivers (discard reminted extract), then
    // restore original escrow payloads to original owners — never both.
    for (const ref of insertedOnA) {
      try {
        await reverseInsert(economy, session.a.nickname, ref, nowMs, scope);
      } catch (restoreErr) {
        console.error(`[trade] reverse insert on A failed:`, restoreErr);
      }
    }
    for (const ref of insertedOnB) {
      try {
        await reverseInsert(economy, session.b.nickname, ref, nowMs, scope);
      } catch (restoreErr) {
        console.error(`[trade] reverse insert on B failed:`, restoreErr);
      }
    }
    for (const payload of extractedA) {
      try {
        await economy.insertEscrowItem(session.a.nickname, payload, nowMs, scope);
      } catch (restoreErr) {
        console.error(`[trade] restore A failed:`, restoreErr);
      }
    }
    for (const payload of extractedB) {
      try {
        await economy.insertEscrowItem(session.b.nickname, payload, nowMs, scope);
      } catch (restoreErr) {
        console.error(`[trade] restore B failed:`, restoreErr);
      }
    }
    if (goldCreditedA > 0) {
      try {
        await economy.debitGold(session.a.nickname, goldCreditedA, nowMs, scope);
      } catch (restoreErr) {
        console.error(`[trade] clawback A gold credit failed:`, restoreErr);
      }
    }
    if (goldCreditedB > 0) {
      try {
        await economy.debitGold(session.b.nickname, goldCreditedB, nowMs, scope);
      } catch (restoreErr) {
        console.error(`[trade] clawback B gold credit failed:`, restoreErr);
      }
    }
    if (goldDebitedA > 0) {
      try {
        await economy.addGold(session.a.nickname, goldDebitedA, scope);
      } catch (restoreErr) {
        console.error(`[trade] refund A gold failed:`, restoreErr);
      }
    }
    if (goldDebitedB > 0) {
      try {
        await economy.addGold(session.b.nickname, goldDebitedB, scope);
      } catch (restoreErr) {
        console.error(`[trade] refund B gold failed:`, restoreErr);
      }
    }
    throw err;
  }

  console.log(
    `[trade] atomic swap ok ${session.a.nickname} <-> ${session.b.nickname} ` +
      `gold ${session.a.gold}/${session.b.gold} items ${extractedA.length}/${extractedB.length}`,
  );
}

async function reverseInsert(
  economy: EconomyStore,
  nickname: string,
  ref: EscrowInsertRef,
  nowMs: number,
  scope: "deathmatch",
): Promise<void> {
  // Extract reminted copy and drop it — originals are restored from escrow payloads.
  if (ref.itemType === "shard_stack") {
    await economy.extractBagItem(nickname, "shard_stack", 0, nowMs, scope, ref.quantity);
    return;
  }
  await economy.extractBagItem(nickname, ref.itemType, ref.itemId, nowMs, scope);
}
