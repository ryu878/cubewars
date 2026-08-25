// Server-authoritative Deathmatch auction house (EPIC 38 / TZ §3.1–3.2).
// Lots + developer gold ledger live in Redis under the store key prefix.
// Sandbox pool items/gold never enter this module — callers must use deathmatch.
// F-003: per-lot mutex + Redis NX delivery/payment keys make settle/bid idempotent.

import type { Redis } from "ioredis";
import {
  AUCTION_DURATION_MS,
  AUCTION_FEE,
  type EconomyAuctionLotDto,
  type InventoryItemType,
  normalizeNickname,
} from "@cubewars/shared";
import { escrowToDto, type EscrowPayload } from "./escrow.js";
import {
  EconomyActionError,
  type EconomyScope,
  type EconomyStore,
} from "./store.js";

/** Auction is always Deathmatch — never accept sandbox. */
export const AUCTION_SCOPE: EconomyScope = "deathmatch";

export function resolveAuctionDurationMs(
  envValue: string | undefined = process.env.CUBEWARS_AUCTION_MS,
): number {
  if (envValue && envValue.trim().length > 0) {
    const parsed = Number(envValue.trim());
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return AUCTION_DURATION_MS;
}

export interface AuctionSettlementCheckpoint {
  reason: "expire" | "buyout";
  price: number;
  winnerKey: string;
  winnerNickname: string;
  burn: number;
  developer: number;
  sellerNet: number;
}

export interface AuctionLotRecord {
  lotId: number;
  sellerNicknameKey: string;
  sellerNickname: string;
  item: EscrowPayload;
  startPrice: number;
  buyoutPrice: number | null;
  highestBid: number | null;
  highestBidderKey: string | null;
  highestBidderNickname: string | null;
  /** Gold currently held from the highest bidder. */
  escrowedBid: number;
  createdAtMs: number;
  expiresAtMs: number;
  status: "active" | "settling" | "settled" | "cancelled" | "expired_returned";
  /** Frozen payout intent while status === settling (crash-safe resume). */
  settlement?: AuctionSettlementCheckpoint;
}

function splitAuctionFee(price: number): { burn: number; developer: number; sellerNet: number } {
  const burn = Math.floor(price * AUCTION_FEE.burnFraction);
  const developer = Math.floor(price * AUCTION_FEE.developerFraction);
  const sellerNet = price - burn - developer;
  return { burn, developer, sellerNet };
}

export class AuctionHouse {
  private readonly redis: Redis;
  private readonly keyPrefix: string;
  private readonly store: EconomyStore;
  /** In-process per-lot mutex chain (F-003 concurrent bid/settle). */
  private readonly lotLocks = new Map<number, Promise<void>>();

  constructor(store: EconomyStore, redis: Redis, keyPrefix: string) {
    this.store = store;
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  /** Attach to an open EconomyStore (shares its Redis connection + prefix). */
  static fromStore(store: EconomyStore): AuctionHouse {
    return new AuctionHouse(store, store.getRedisClient(), store.keyPrefix);
  }

  private lotKey(lotId: number): string {
    return `${this.keyPrefix}:auction:v1:lot:${lotId}`;
  }

  private itemDeliveredKey(lotId: number): string {
    return `${this.keyPrefix}:auction:v1:lot:${lotId}:item_delivered`;
  }

  private goldPaidKey(lotId: number): string {
    return `${this.keyPrefix}:auction:v1:lot:${lotId}:gold_paid`;
  }

  private get activeSetKey(): string {
    return `${this.keyPrefix}:auction:v1:active`;
  }

  private get nextLotIdKey(): string {
    return `${this.keyPrefix}:auction:v1:nextLotId`;
  }

  private get developerGoldKey(): string {
    return `${this.keyPrefix}:auction:v1:developer_gold`;
  }

  private get burnedGoldKey(): string {
    return `${this.keyPrefix}:auction:v1:burned_gold`;
  }

  private async withLotLock<T>(lotId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.lotLocks.get(lotId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.lotLocks.set(
      lotId,
      prev.then(() => gate).catch(() => gate),
    );
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async getDeveloperGold(): Promise<number> {
    const raw = await this.redis.get(this.developerGoldKey);
    return raw ? Number(raw) || 0 : 0;
  }

  async getBurnedGold(): Promise<number> {
    const raw = await this.redis.get(this.burnedGoldKey);
    return raw ? Number(raw) || 0 : 0;
  }

  private async creditDeveloper(amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.redis.incrby(this.developerGoldKey, amount);
  }

  private async recordBurn(amount: number): Promise<void> {
    if (amount <= 0) return;
    await this.redis.incrby(this.burnedGoldKey, amount);
  }

  private async loadLot(lotId: number): Promise<AuctionLotRecord | null> {
    const raw = await this.redis.get(this.lotKey(lotId));
    if (!raw) return null;
    return JSON.parse(raw) as AuctionLotRecord;
  }

  private async saveLot(lot: AuctionLotRecord): Promise<void> {
    await this.redis.set(this.lotKey(lot.lotId), JSON.stringify(lot));
  }

  private lotToDto(lot: AuctionLotRecord, viewerKey: string | null): EconomyAuctionLotDto {
    return {
      lotId: lot.lotId,
      sellerNickname: lot.sellerNickname,
      item: escrowToDto(lot.item),
      startPrice: lot.startPrice,
      buyoutPrice: lot.buyoutPrice,
      highestBid: lot.highestBid,
      highestBidderNickname: lot.highestBidderNickname,
      expiresAtMs: lot.expiresAtMs,
      isMine: viewerKey !== null && viewerKey === lot.sellerNicknameKey,
    };
  }

  async listActiveLots(viewerNickname?: string): Promise<{
    lots: EconomyAuctionLotDto[];
    developerGoldLedger: number;
  }> {
    const ids = await this.redis.smembers(this.activeSetKey);
    let viewerKey: string | null = null;
    if (viewerNickname) {
      const n = normalizeNickname(viewerNickname);
      viewerKey = n.ok ? n.key : null;
    }
    const lots: EconomyAuctionLotDto[] = [];
    for (const idStr of ids) {
      const lot = await this.loadLot(Number(idStr));
      if (!lot || (lot.status !== "active" && lot.status !== "settling")) {
        await this.redis.srem(this.activeSetKey, idStr);
        continue;
      }
      if (lot.status === "settling") continue; // hide mid-settle from catalog
      lots.push(this.lotToDto(lot, viewerKey));
    }
    lots.sort((a, b) => a.expiresAtMs - b.expiresAtMs);
    return { lots, developerGoldLedger: await this.getDeveloperGold() };
  }

  async listItem(
    sellerNickname: string,
    itemType: InventoryItemType,
    itemId: number,
    startPrice: number,
    buyoutPrice: number | null | undefined,
    nowMs: number = Date.now(),
    shardQuantity?: number,
    durationMs: number = resolveAuctionDurationMs(),
  ): Promise<AuctionLotRecord> {
    if (!Number.isInteger(startPrice) || startPrice <= 0) {
      throw new EconomyActionError("invalid_price", "startPrice must be a positive integer");
    }
    let buyout: number | null = null;
    if (buyoutPrice !== undefined && buyoutPrice !== null) {
      if (!Number.isInteger(buyoutPrice) || buyoutPrice < startPrice) {
        throw new EconomyActionError(
          "invalid_price",
          "buyoutPrice must be an integer >= startPrice",
        );
      }
      buyout = buyoutPrice;
    }

    const profile = await this.store.getOrCreateProfile(sellerNickname, AUCTION_SCOPE);
    const item = await this.store.extractBagItem(
      sellerNickname,
      itemType,
      itemId,
      nowMs,
      AUCTION_SCOPE,
      shardQuantity,
    );

    const lotId = await this.redis.incr(this.nextLotIdKey);
    const lot: AuctionLotRecord = {
      lotId,
      sellerNicknameKey: profile.nicknameKey,
      sellerNickname: profile.nickname,
      item,
      startPrice,
      buyoutPrice: buyout,
      highestBid: null,
      highestBidderKey: null,
      highestBidderNickname: null,
      escrowedBid: 0,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + durationMs,
      status: "active",
    };
    await this.saveLot(lot);
    await this.redis.sadd(this.activeSetKey, String(lotId));
    console.log(
      `[auction] listed lot#${lotId} ${itemType} by ${profile.nicknameKey} start=${startPrice}`,
    );
    return lot;
  }

  async bid(
    bidderNickname: string,
    lotId: number,
    amount: number,
    nowMs: number = Date.now(),
  ): Promise<AuctionLotRecord> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new EconomyActionError("invalid_price", "bid must be a positive integer");
    }
    return this.withLotLock(lotId, async () => {
      const lot = await this.loadLot(lotId);
      if (!lot || lot.status !== "active") {
        throw new EconomyActionError("lot_inactive", "lot is not active");
      }
      if (nowMs >= lot.expiresAtMs) {
        throw new EconomyActionError("lot_inactive", "lot has expired");
      }

      const bidder = await this.store.getOrCreateProfile(bidderNickname, AUCTION_SCOPE);
      if (bidder.nicknameKey === lot.sellerNicknameKey) {
        throw new EconomyActionError("self_bid", "seller cannot bid on own lot");
      }

      const minBid = lot.highestBid !== null ? lot.highestBid + 1 : lot.startPrice;
      if (amount < minBid) {
        throw new EconomyActionError("bid_too_low", `bid must be at least ${minBid}`);
      }

      const prevKey = lot.highestBidderKey;
      const prevEscrow = lot.escrowedBid;
      let debited = 0;
      try {
        await this.store.debitGold(bidderNickname, amount, nowMs, AUCTION_SCOPE);
        debited = amount;

        lot.highestBid = amount;
        lot.highestBidderKey = bidder.nicknameKey;
        lot.highestBidderNickname = bidder.nickname;
        lot.escrowedBid = amount;
        await this.saveLot(lot);

        if (prevKey && prevEscrow > 0) {
          await this.store.addGold(prevKey, prevEscrow, AUCTION_SCOPE);
          console.log(`[auction] outbid refund ${prevEscrow} -> ${prevKey} lot#${lotId}`);
        }
      } catch (err) {
        if (debited > 0) {
          try {
            await this.store.addGold(bidderNickname, debited, AUCTION_SCOPE);
          } catch (refundErr) {
            console.error(`[auction] bid refund failed lot#${lotId}:`, refundErr);
          }
        }
        throw err;
      }

      console.log(`[auction] bid lot#${lotId} ${amount} by ${bidder.nicknameKey}`);
      return lot;
    });
  }

  async buyout(
    buyerNickname: string,
    lotId: number,
    nowMs: number = Date.now(),
  ): Promise<AuctionLotRecord> {
    return this.withLotLock(lotId, async () => {
      const lot = await this.loadLot(lotId);
      if (!lot || lot.status !== "active") {
        throw new EconomyActionError("lot_inactive", "lot is not active");
      }
      if (lot.buyoutPrice === null) {
        throw new EconomyActionError("no_buyout", "lot has no buyout price");
      }
      if (nowMs >= lot.expiresAtMs) {
        throw new EconomyActionError("lot_inactive", "lot has expired");
      }

      const buyer = await this.store.getOrCreateProfile(buyerNickname, AUCTION_SCOPE);
      if (buyer.nicknameKey === lot.sellerNicknameKey) {
        throw new EconomyActionError("self_bid", "seller cannot buy out own lot");
      }

      const price = lot.buyoutPrice;
      const prevKey = lot.highestBidderKey;
      const prevEscrow = lot.escrowedBid;
      let debited = 0;
      try {
        await this.store.debitGold(buyerNickname, price, nowMs, AUCTION_SCOPE);
        debited = price;

        lot.highestBid = price;
        lot.highestBidderKey = buyer.nicknameKey;
        lot.highestBidderNickname = buyer.nickname;
        lot.escrowedBid = price;
        await this.saveLot(lot);

        if (prevKey && prevEscrow > 0) {
          await this.store.addGold(prevKey, prevEscrow, AUCTION_SCOPE);
        }
      } catch (err) {
        if (debited > 0) {
          try {
            await this.store.addGold(buyerNickname, debited, AUCTION_SCOPE);
          } catch (refundErr) {
            console.error(`[auction] buyout refund failed lot#${lotId}:`, refundErr);
          }
        }
        throw err;
      }

      await this.settleLotLocked(lot, nowMs, "buyout");
      return (await this.loadLot(lotId))!;
    });
  }

  /**
   * Settle highest bid (if >= start) or return item to seller.
   * Buyer cap failure → cancel, refund bid, return item to seller.
   * Idempotent under lock + Redis NX delivery/payment keys (F-003).
   */
  async settleLot(
    lot: AuctionLotRecord,
    nowMs: number,
    reason: "expire" | "buyout",
  ): Promise<void> {
    await this.withLotLock(lot.lotId, async () => {
      const fresh = await this.loadLot(lot.lotId);
      if (!fresh) return;
      await this.settleLotLocked(fresh, nowMs, reason);
    });
  }

  /** Must be called while holding `withLotLock(lot.lotId)`. */
  private async settleLotLocked(
    lot: AuctionLotRecord,
    nowMs: number,
    reason: "expire" | "buyout",
  ): Promise<void> {
    if (lot.status === "settled" || lot.status === "cancelled" || lot.status === "expired_returned") {
      return;
    }

    if (lot.status === "settling") {
      await this.completeSettling(lot, nowMs);
      return;
    }

    // status === active
    const hasWinner =
      lot.highestBidderKey !== null &&
      lot.highestBid !== null &&
      lot.highestBid >= lot.startPrice &&
      lot.escrowedBid > 0;

    if (!hasWinner) {
      await this.returnLotToSeller(lot, nowMs, "expired_returned");
      console.log(`[auction] lot#${lot.lotId} ${reason}: no valid bid, item returned`);
      return;
    }

    const price = lot.escrowedBid;
    const winnerKey = lot.highestBidderKey!;
    const winnerNick = lot.highestBidderNickname ?? winnerKey;

    try {
      await this.store.assertCanAcceptEscrow(winnerNick, lot.item, AUCTION_SCOPE);
    } catch (err) {
      await this.store.addGold(winnerKey, price, AUCTION_SCOPE);
      lot.escrowedBid = 0;
      lot.highestBid = null;
      lot.highestBidderKey = null;
      lot.highestBidderNickname = null;
      await this.returnLotToSeller(lot, nowMs, "cancelled");
      const code = err instanceof EconomyActionError ? err.code : "buyer_cap";
      console.log(
        `[auction] lot#${lot.lotId} settle cancelled (${code}): refund ${price} -> ${winnerKey}, item -> seller`,
      );
      return;
    }

    const { burn, developer, sellerNet } = splitAuctionFee(price);
    lot.status = "settling";
    lot.settlement = {
      reason,
      price,
      winnerKey,
      winnerNickname: winnerNick,
      burn,
      developer,
      sellerNet,
    };
    await this.saveLot(lot);

    await this.completeSettling(lot, nowMs);
  }

  /**
   * Resume/finish a settling lot. Item delivery and gold payout each claim a
   * Redis NX key so a crash + retry cannot double-insert or double-pay.
   */
  private async completeSettling(lot: AuctionLotRecord, nowMs: number): Promise<void> {
    const cp = lot.settlement;
    if (!cp) {
      console.error(`[auction] lot#${lot.lotId} settling without checkpoint — forcing cancelled`);
      lot.status = "cancelled";
      await this.saveLot(lot);
      await this.redis.srem(this.activeSetKey, String(lot.lotId));
      return;
    }

    const deliveredKey = this.itemDeliveredKey(lot.lotId);
    const claimedDeliver = await this.redis.set(deliveredKey, "1", "EX", 7 * 24 * 3600, "NX");
    if (claimedDeliver === "OK") {
      try {
        await this.store.insertEscrowItem(cp.winnerNickname, lot.item, nowMs, AUCTION_SCOPE);
      } catch (err) {
        await this.redis.del(deliveredKey);
        throw err;
      }
    }

    const paidKey = this.goldPaidKey(lot.lotId);
    const claimedPay = await this.redis.set(paidKey, "1", "EX", 7 * 24 * 3600, "NX");
    if (claimedPay === "OK") {
      try {
        await this.store.addGold(lot.sellerNicknameKey, cp.sellerNet, AUCTION_SCOPE);
        await this.creditDeveloper(cp.developer);
        await this.recordBurn(cp.burn);
      } catch (err) {
        await this.redis.del(paidKey);
        throw err;
      }
    }

    lot.status = "settled";
    lot.escrowedBid = 0;
    await this.saveLot(lot);
    await this.redis.srem(this.activeSetKey, String(lot.lotId));
    console.log(
      `[auction] lot#${lot.lotId} settled ${cp.reason}: price=${cp.price} burn=${cp.burn} ` +
        `dev=${cp.developer} sellerNet=${cp.sellerNet}`,
    );
  }

  private async returnLotToSeller(
    lot: AuctionLotRecord,
    nowMs: number,
    status: "cancelled" | "expired_returned",
  ): Promise<void> {
    try {
      await this.store.insertEscrowItem(lot.sellerNickname, lot.item, nowMs, AUCTION_SCOPE);
    } catch (err) {
      console.error(
        `[auction] failed returning item to seller ${lot.sellerNicknameKey} lot#${lot.lotId}:`,
        err,
      );
    }
    lot.status = status;
    delete lot.settlement;
    await this.saveLot(lot);
    await this.redis.srem(this.activeSetKey, String(lot.lotId));
  }

  /** Expire due lots (call from server cron / tick). Also resumes settling. */
  async tick(nowMs: number = Date.now()): Promise<number> {
    const ids = await this.redis.smembers(this.activeSetKey);
    let settled = 0;
    for (const idStr of ids) {
      const lotId = Number(idStr);
      const lot = await this.loadLot(lotId);
      if (!lot) {
        await this.redis.srem(this.activeSetKey, idStr);
        continue;
      }
      if (lot.status === "settled" || lot.status === "cancelled" || lot.status === "expired_returned") {
        await this.redis.srem(this.activeSetKey, idStr);
        continue;
      }
      if (lot.status === "settling") {
        await this.settleLot(lot, nowMs, lot.settlement?.reason ?? "expire");
        settled += 1;
        continue;
      }
      if (nowMs < lot.expiresAtMs) continue;
      await this.settleLot(lot, nowMs, "expire");
      settled += 1;
    }
    return settled;
  }
}
