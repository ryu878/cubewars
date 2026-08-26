// Match: a self-contained instance of {PlayerRegistry, PickupSpawner, tick
// loop, connected human sockets} (EPIC 9 "Bots & Match Modes" Architecture
// Section 2). Every piece of server state that used to be a single
// module-level variable in server/src/index.ts pre-EPIC-9 (one
// PlayerRegistry, one PickupSpawner, one 20Hz tick interval) is now owned by
// one Match instance; server/src/matchManager.ts holds a
// Map<matchId, Match> instead.
//
// This is a REFACTOR of the pre-EPIC-9 tick-loop/broadcast logic that used
// to live directly in index.ts's module scope, not a rewrite: the
// physics -> respawn -> pickup -> world_state broadcast SEQUENCE in tick()
// below, and the broadcast/broadcastScoreboard/broadcastPickupState/
// sendLoadout helpers, are the exact same logic, only re-homed onto `this.`
// so it can be instantiated once per match instead of assumed singleton.
// See EPIC 9 spec Story 9.1: "the existing `public` match behaves
// identically to today's single-world game" is the top regression risk of
// this whole EPIC — do not change this sequence's behavior while touching
// this file for an unrelated EPIC 9 concern.

import { randomInt } from "node:crypto";
import type { WebSocket } from "ws";
import {
  BROADCAST_TICK_HZ,
  COMBAT,
  DEFAULT_MAP_ID,
  GOLD_DROP_MAX,
  GOLD_DROP_MIN,
  GROUND_DROP_TTL_MS,
  MAX_PUBLIC_PLAYERS_PER_MATCH,
  PICKUP_RADIUS,
  getMap,
  type EndlessStateMessage,
  boxBounds,
  playerHitboxBounds,
  rayIntersectsAabb,
  type DeathEvent,
  type EconomyActionResultMessage,
  type EconomyGoldUpdateMessage,
  type EconomyGroundStateMessage,
  type EconomyKillLootFxMessage,
  type EconomyTradeStateMessage,
  type KillLootFxGrant,
  type FireBroadcastEvent,
  type InventoryItemType,
  type HitEvent,
  type KillEvent,
  type LeaderboardEntry,
  type LeaderboardMessage,
  type LoadoutMessage,
  type MapBox,
  type MapDefinition,
  type MapId,
  type MapStateMessage,
  type PickupStateMessage,
  type ProjectileImpactEvent,
  type Ray,
  type RespawnEvent,
  type ScoreboardMessage,
  type ServerMessage,
  type ShotTrace,
  type Vector3,
  type WorldStateMessage,
  isAvatarBodyPart,
  isValidPaletteIndex,
  type AvatarBodyPart,
} from "@cubewars/shared";
import { PlayerRegistry, type DamageEvent, type FireOutcome } from "./playerRegistry.js";
import { PickupSpawner } from "./pickupSpawner.js";
import { BotAI } from "./botAI.js";
import { EndlessWorld } from "./endlessWorld.js";
import { classifyHitZone, isSpawnProtected, pointOnRay } from "./combat.js";
import {
  economyScopeFromMatchMode,
  EconomyActionError,
  applyInventoryEconomyAction,
  toEconomyProfileMessage,
  type EconomyScope,
  type EconomyStore,
  type InventoryBagAction,
  type InventoryEconomyPayload,
} from "./economy/index.js";
import type { AvatarProfileStore } from "./avatarProfile.js";
import {
  MatchGroundItems,
  MatchTradeSessions,
  executeAtomicTrade,
  type TradeOfferItem,
} from "./matchMarket.js";
import type { EscrowPayload } from "./economy/escrow.js";

// Same tick rate/derivation as the pre-EPIC-9 single global loop
// (server/src/index.ts) — every Match now runs its own independent copy of
// this same fixed-rate loop.
const TICK_HZ = BROADCAST_TICK_HZ;
const TICK_MS = 1000 / TICK_HZ;
const TICK_DT_SECONDS = TICK_MS / 1000;

/** Exactly 2 bots per "bots:*" match (EPIC 9 Story 9.3 AC: "Exactly 2 bots spawn in a fresh bots:* match"). */
const BOT_COUNT = 2;

interface ActiveProjectile {
  id: string;
  shooterId: string;
  trace: ShotTrace;
  position: Vector3;
  direction: Vector3;
  remainingDistance: number;
}

export type MatchMode = "public" | "bots" | "endless";

export interface MatchOptions {
  id: string;
  mode: MatchMode;
  /**
   * EPIC 46: static catalog map for public/bots. Ignored for endless
   * (geometry comes from EndlessWorld). Defaults to Base.
   */
  mapId?: MapId;
  /**
   * Called at most once, when a "bots" match's last human connection leaves
   * (EPIC 9 spec Section 2: "torn down (all state freed) when the human
   * disconnects") — the caller (MatchManager) uses this to drop its own
   * reference and let this Match (and everything it owns: registry,
   * pickupSpawner, botAI) become garbage. Never invoked for the persistent
   * "public" match (it has no onEmpty by construction — see
   * matchManager.ts).
   */
  onEmpty?: (matchId: string) => void;
  onKillRecorded?: (attackerNickname: string, victimNickname: string) => void;
  onEndlessProgress?: (nickname: string, botKills: number, distanceKm: number) => void;
  /** Durable gold store (EPIC 23). Optional so unit tests without a DB still work. */
  economy?: EconomyStore;
  /** EPIC 33: account-level avatar colors (separate Redis keys from economy). */
  avatarProfile?: AvatarProfileStore;
}

export class Match {
  readonly id: string;
  readonly mode: MatchMode;
  /** Server-owned static map id (EPIC 46). Endless keeps a catalog id for lobby display only. */
  readonly mapId: MapId;
  readonly mapDefinition: MapDefinition;
  readonly registry: PlayerRegistry;
  readonly pickupSpawner: PickupSpawner;

  /** Connected HUMAN sockets in THIS match only, keyed by connection id — bots are never in here (they have no socket). This is what makes broadcast() below never leak this match's state to any other match's connections. */
  private sockets = new Map<string, WebSocket>();
  private botAI: BotAI | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private projectiles = new Map<string, ActiveProjectile>();
  private nextProjectileSeq = 1;
  private endlessWorld: EndlessWorld | null = null;
  private endlessHumanId: string | null = null;
  private endlessBotKills = 0;
  private endlessNextBotSeq = 1;
  private lastMapVersion = -1;
  private lastEndlessProgressAtMs = 0;
  private skipRestOfTickAfterEndlessRestart = false;
  /**
   * EPIC 25: in-match shard grants — killer nickname_key → set of victim
   * nickname_keys already granted. Not durable across match teardown.
   */
  private matchShardGrants = new Map<string, Set<string>>();
  /** EPIC 38: ground drops (Deathmatch/public only). */
  private groundItems = new MatchGroundItems();
  /** EPIC 38: same-match P2P trades (Deathmatch/public only). */
  private trades = new MatchTradeSessions();

  constructor(private options: MatchOptions) {
    this.id = options.id;
    this.mode = options.mode;
    this.mapId = options.mapId ?? DEFAULT_MAP_ID;
    this.mapDefinition = getMap(this.mapId);
    if (this.mode === "endless") {
      this.endlessWorld = new EndlessWorld();
    }
    this.registry = new PlayerRegistry({
      getGeometry: () => this.currentGeometry(),
      getSpawnPoints: () => this.endlessWorld?.getSpawnPoints() ?? this.mapDefinition.spawnPoints,
      worldBound: this.mode === "endless" ? 10000 : undefined,
    });
    // EPIC 6 Story 6.1 "Design note for EPIC 9 compatibility": player-count
    // source reads THIS match's own live alive-player list (bots included,
    // same as any other alive player for this formula), never a snapshot or
    // another match's count.
    this.pickupSpawner = new PickupSpawner(
      () => this.registry.alivePlayerPositions().length,
      this.endlessWorld?.getPickups() ?? this.mapDefinition.pickupPoints,
    );

    if (this.mode === "bots") {
      this.botAI = new BotAI(this.registry, {
        getGeometry: () => this.currentGeometry(),
        getWaypoints: () => this.mapDefinition.spawnPoints,
      });
      this.botAI.setTickDtSeconds(TICK_DT_SECONDS);
      this.botAI.spawnBots(BOT_COUNT);
    } else if (this.mode === "endless") {
      this.botAI = new BotAI(this.registry, {
        getGeometry: () => this.currentGeometry(),
        getWaypoints: () => this.endlessWorld?.getWaypoints() ?? [],
        canTarget: (candidateId) => candidateId === this.endlessHumanId,
      });
      this.botAI.setTickDtSeconds(TICK_DT_SECONDS);
    }
  }

  /** Number of currently-connected HUMAN sockets in this match (bots are never counted here). */
  humanCount(): number {
    return this.sockets.size;
  }

  /**
   * Add a freshly-joined human connection to this match: spawns them in the
   * registry (the exact same spawn()/anti-clustering path as always), starts
   * tracking their socket for this match's broadcasts, and sends their
   * initial private loadout + this match's current scoreboard/pickup state —
   * mirrors what the pre-EPIC-9 connection handler did unconditionally on
   * every WS connect, now done exactly once per connection at `join` time
   * instead.
   */
  canAcceptHuman(): boolean {
    if (this.mode === "public") return this.humanCount() < MAX_PUBLIC_PLAYERS_PER_MATCH;
    if (this.mode === "endless") return this.humanCount() < 1;
    return true;
  }

  hasNicknameKey(nicknameKey: string): boolean {
    return this.registry.hasNicknameKey(nicknameKey);
  }

  async addHuman(connectionId: string, socket: WebSocket, nickname: string, nicknameKey: string): Promise<void> {
    this.sockets.set(connectionId, socket);
    if (this.mode === "endless") this.endlessHumanId = connectionId;
    this.registry.spawn(connectionId, nickname, nicknameKey);
    await this.applyAvatarColorsToPlayer(connectionId, nicknameKey);
    await this.applyEconomyCombatToPlayer(connectionId, nickname);
    this.sendMapState();
    this.sendLoadout(connectionId);
    await this.sendEconomyProfile(connectionId, nickname);
    this.broadcastScoreboard();
    this.broadcastPickupState();
    this.broadcastGroundState();
    this.sendEndlessState();
  }

  /**
   * Remove a human connection from this match (disconnect). If this is a
   * "bots" match and its last human just left, notifies `onEmpty` so the
   * caller can tear the whole match down (EPIC 9 spec: private bots matches
   * don't outlive their one human).
   */
  removeHuman(connectionId: string): void {
    const cancelled = this.trades.cancelForPlayer(connectionId);
    if (cancelled) {
      this.sendTradeState(cancelled, "cancelled");
    }
    this.registry.remove(connectionId);
    this.sockets.delete(connectionId);
    this.broadcastScoreboard();
    if ((this.mode === "bots" || this.mode === "endless") && this.sockets.size === 0) {
      this.options.onEmpty?.(this.id);
    }
  }

  /** Send a server message to every currently-open HUMAN socket in THIS match only — never another match's sockets (EPIC 9 Story 9.1 AC: matches must never leak state to each other). */
  broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.sockets.values()) {
      if (socket.readyState === socket.OPEN) {
        socket.send(payload);
      }
    }
  }

  /** Broadcast this match's full current scoreboard (EPIC 5 Story 5.2), scoped to this match's own sockets only. Bots appear here exactly like human players (EPIC 9 spec Section 3), since registry.getScores() has no concept of "bot" — it is just every PlayerRecord in this match's registry. */
  broadcastScoreboard(): void {
    const scoreboard: ScoreboardMessage = { type: "scoreboard", players: this.registry.getScores() };
    this.broadcast(scoreboard);
  }

  /** Broadcast this match's full current pickup on/off state (EPIC 6 Story 6.1), scoped to this match's own sockets only. */
  broadcastPickupState(): void {
    const message: PickupStateMessage = {
      type: "pickup_state",
      pickups: this.pickupSpawner.list().map((item) => ({
        id: item.id,
        active: item.active,
        category: item.category,
        weapon: item.weapon,
        position: item.position,
      })),
    };
    this.broadcast(message);
  }

  sendMapState(): void {
    const bounds = this.endlessWorld?.getBounds() ?? this.mapDefinition.bounds;
    const message: MapStateMessage = {
      type: "map_state",
      geometry: [...this.currentGeometry()],
      bounds,
      // Endless is procedural — omit catalog mapId so clients don't treat it as Base.
      mapId: this.mode === "endless" ? undefined : this.mapId,
    };
    this.broadcast(message);
    this.lastMapVersion = this.endlessWorld?.getVersion() ?? 0;
  }

  sendEndlessState(): void {
    if (!this.endlessWorld) return;
    const state = this.endlessWorld.state();
    const message: EndlessStateMessage = {
      type: "endless_state",
      fogZ: state.fogZ,
      distanceMeters: state.distanceMeters,
      botKills: this.endlessBotKills,
    };
    this.broadcast(message);
  }

  /** Send `playerId`'s current loadout to THEIR socket only (never broadcast — unchanged discipline from pre-EPIC-9 sendLoadout()). No-op for a bot (no socket to send to) or an unknown/disconnected player. */
  sendLoadout(playerId: string): void {
    const loadout = this.registry.getLoadout(playerId);
    if (!loadout) return;
    const socket = this.sockets.get(playerId);
    if (!socket || socket.readyState !== socket.OPEN) return;
    const message: LoadoutMessage = { type: "loadout", ...loadout };
    socket.send(JSON.stringify(message));
  }


  /** EPIC 35: server-derived pool for this match — never from the client. */
  private economyScope(): EconomyScope {
    return economyScopeFromMatchMode(this.mode);
  }

  /** Send durable economy snapshot to the owning human socket only (EPIC 23–25). */
  async sendEconomyProfile(playerId: string, nickname: string): Promise<void> {
    const economy = this.options.economy;
    if (!economy) return;
    const socket = this.sockets.get(playerId);
    if (!socket || socket.readyState !== socket.OPEN) return;
    const scope = this.economyScope();
    const profile = await economy.getFullProfile(nickname, scope);
    socket.send(JSON.stringify(toEconomyProfileMessage(profile, scope)));
  }

  private sendEconomyGoldUpdate(playerId: string, gold: number, gained: number): void {
    const socket = this.sockets.get(playerId);
    if (!socket || socket.readyState !== socket.OPEN) return;
    const message: EconomyGoldUpdateMessage = { type: "economy_gold_update", gold, gained };
    socket.send(JSON.stringify(message));
  }

  private sendEconomyActionResult(
    playerId: string,
    action: EconomyActionResultMessage["action"],
    ok: boolean,
    code?: string,
  ): void {
    const socket = this.sockets.get(playerId);
    if (!socket || socket.readyState !== socket.OPEN) return;
    const message: EconomyActionResultMessage = { type: "economy_action_result", action, ok, code };
    socket.send(JSON.stringify(message));
  }

  /**
   * Push equipped pet ratings into the live PlayerRecord (EPIC 24), and
   * alongside them the cosmetic equipped-pet-types/amulet reveal (EPIC 31
   * Section 3.3) — derived from the same already-fetched profile so there's
   * no extra economy round-trip. Humans only (bots have no economy profile;
   * see BotAI's own loadout generation + registry.setEquipmentVisual() call
   * for the bot equivalent of this).
   */
  async applyEconomyCombatToPlayer(playerId: string, nickname: string): Promise<void> {
    const economy = this.options.economy;
    if (!economy) return;
    const full = await economy.getFullProfile(nickname, this.economyScope());
    this.registry.applyPetRatings(playerId, full.ratings);
    const equipped = full.pets
      .filter((pet) => pet.equipSlot === 1 || pet.equipSlot === 2)
      .sort((a, b) => (a.equipSlot ?? 0) - (b.equipSlot ?? 0));
    const hasAmulet = full.amulets.some((amulet) => amulet.equipped);
    this.registry.setEquipmentVisual(
      playerId,
      equipped.map((pet) => ({
        slotId: `pet:${pet.id}`,
        type: pet.type,
        colorIndex: pet.colorIndex,
      })),
      hasAmulet,
    );
  }

  /** EPIC 33: load persisted avatar colors (or defaults) into the live PlayerRecord. */
  async applyAvatarColorsToPlayer(playerId: string, nicknameKey: string): Promise<void> {
    const store = this.options.avatarProfile;
    if (!store) return;
    const colors = await store.getColors(nicknameKey);
    this.registry.setAvatarColors(playerId, colors);
  }

  /**
   * EPIC 33: validate + persist + apply a single body-part color change.
   * Returns false if the payload is illegal (caller should treat as malformed drop).
   */
  async handleAvatarSetColor(
    playerId: string,
    nickname: string,
    nicknameKey: string,
    part: unknown,
    paletteIndex: unknown,
  ): Promise<boolean> {
    if (!isAvatarBodyPart(part) || !isValidPaletteIndex(paletteIndex)) {
      return false;
    }
    const bodyPart = part as AvatarBodyPart;
    const index = paletteIndex as number;
    const store = this.options.avatarProfile;
    let colors;
    if (store) {
      colors = await store.setPart(nicknameKey, bodyPart, index);
    } else {
      const player = this.registry.getPlayer(playerId);
      if (!player) return false;
      colors = { ...player.avatarColors, [bodyPart]: index };
    }
    this.registry.setAvatarColors(playerId, colors);
    console.log(
      `[avatar] ${nickname} set ${bodyPart}=${index} (match=${this.id})`,
    );
    return true;
  }

  /**
   * Handle an economy action from the owning connection. Validates ownership
   * server-side; rejects cross-profile ids and slot 2 without an amulet.
   */
  async handleEconomyAction(
    playerId: string,
    nickname: string,
    action: InventoryBagAction,
    payload: InventoryEconomyPayload,
  ): Promise<void> {
    const economy = this.options.economy;
    if (!economy) {
      this.sendEconomyActionResult(playerId, action, false, "not_found");
      return;
    }
    const scope = this.economyScope();
    const result = await applyInventoryEconomyAction(
      economy,
      nickname,
      scope,
      action,
      payload,
      Date.now(),
    );
    if (!result.ok) {
      this.sendEconomyActionResult(playerId, action, false, result.code);
      console.warn(`[economy] ${action} rejected for ${nickname}: ${result.code}`);
      return;
    }
    await this.applyEconomyCombatToPlayer(playerId, nickname);
    this.sendEconomyActionResult(playerId, action, true);
    await this.sendEconomyProfile(playerId, nickname);
    console.log(`[economy] ${action} ok for ${nickname} [match=${this.id}]`);
  }

  /** EPIC 38: auction/trade/ground only on Deathmatch (public) matches. */
  private assertDeathmatchMarket(): void {
    if (this.mode !== "public") {
      throw new EconomyActionError("not_deathmatch", "auction/trade/ground require Deathmatch");
    }
  }

  broadcastGroundState(): void {
    if (this.mode !== "public") return;
    const message: EconomyGroundStateMessage = {
      type: "economy_ground_state",
      items: this.groundItems.toDtoList(),
    };
    this.broadcast(message);
  }

  private sendTradeState(
    session: NonNullable<ReturnType<MatchTradeSessions["get"]>>,
    status: EconomyTradeStateMessage["status"],
  ): void {
    for (const playerId of [session.a.playerId, session.b.playerId]) {
      const socket = this.sockets.get(playerId);
      if (!socket || socket.readyState !== socket.OPEN) continue;
      socket.send(JSON.stringify(this.trades.toStateMessage(session, playerId, status)));
    }
  }

  async handleDropItem(
    playerId: string,
    nickname: string,
    itemType: InventoryItemType,
    itemId: number,
  ): Promise<void> {
    const economy = this.options.economy;
    if (!economy) {
      this.sendEconomyActionResult(playerId, "drop_item", false, "not_found");
      return;
    }
    try {
      this.assertDeathmatchMarket();
      const player = this.registry.getPlayer(playerId);
      if (!player) {
        this.sendEconomyActionResult(playerId, "drop_item", false, "not_found");
        return;
      }
      const payload: EscrowPayload = await economy.extractBagItem(
        nickname,
        itemType,
        itemId,
        Date.now(),
        "deathmatch",
      );
      this.groundItems.drop(payload, { ...player.position }, playerId, Date.now(), GROUND_DROP_TTL_MS);
      this.sendEconomyActionResult(playerId, "drop_item", true);
      await this.sendEconomyProfile(playerId, nickname);
      this.broadcastGroundState();
      console.log(`[ground] drop ${itemType}#${itemId} by ${nickname} [match=${this.id}]`);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as EconomyActionError).code)
          : "not_found";
      this.sendEconomyActionResult(playerId, "drop_item", false, code);
    }
  }

  async handlePickupGround(playerId: string, nickname: string, groundId: number): Promise<void> {
    const economy = this.options.economy;
    if (!economy) {
      this.sendEconomyActionResult(playerId, "pickup_ground", false, "not_found");
      return;
    }
    // F-001: claim synchronously before any await so concurrent pickups cannot
    // both pass assertCanAccept and insert reminted duplicates.
    let claimed: ReturnType<MatchGroundItems["claim"]> | undefined;
    try {
      this.assertDeathmatchMarket();
      claimed = this.groundItems.claim(groundId);
      if (!claimed) {
        this.sendEconomyActionResult(playerId, "pickup_ground", false, "not_found");
        return;
      }
      if (Date.now() >= claimed.expiresAtMs) {
        // Expired — already removed by claim; do not restore (TTL destroy).
        this.broadcastGroundState();
        this.sendEconomyActionResult(playerId, "pickup_ground", false, "not_found");
        claimed = undefined;
        return;
      }
      await economy.assertCanAcceptEscrow(nickname, claimed.payload, "deathmatch");
      await economy.insertEscrowItem(nickname, claimed.payload, Date.now(), "deathmatch");
      claimed = undefined; // granted — do not restore
      this.sendEconomyActionResult(playerId, "pickup_ground", true);
      await this.sendEconomyProfile(playerId, nickname);
      this.broadcastGroundState();
      console.log(`[ground] pickup ground#${groundId} by ${nickname} [match=${this.id}]`);
    } catch (err) {
      if (claimed) {
        this.groundItems.restore(claimed);
        this.broadcastGroundState();
      }
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as EconomyActionError).code)
          : "not_found";
      this.sendEconomyActionResult(playerId, "pickup_ground", false, code);
    }
  }

  async handleTradeOpen(playerId: string, nickname: string, partnerId: string): Promise<void> {
    try {
      this.assertDeathmatchMarket();
      if (!this.sockets.has(partnerId) || this.botAI?.isBot(partnerId)) {
        this.sendEconomyActionResult(playerId, "trade_open", false, "trade_invalid");
        return;
      }
      const partner = this.registry.getPlayer(partnerId);
      if (!partner) {
        this.sendEconomyActionResult(playerId, "trade_open", false, "trade_invalid");
        return;
      }
      const session = this.trades.open(playerId, nickname, partnerId, partner.nickname);
      this.sendEconomyActionResult(playerId, "trade_open", true);
      this.sendEconomyActionResult(partnerId, "trade_open", true);
      this.sendTradeState(session, "open");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as EconomyActionError).code)
          : "trade_invalid";
      this.sendEconomyActionResult(playerId, "trade_open", false, code);
    }
  }

  async handleTradeOffer(
    playerId: string,
    nickname: string,
    tradeId: string,
    gold: number,
    items: TradeOfferItem[],
  ): Promise<void> {
    try {
      this.assertDeathmatchMarket();
      const session = this.trades.setOffer(tradeId, playerId, gold, items);
      this.sendEconomyActionResult(playerId, "trade_offer", true);
      this.sendTradeState(session, "open");
      void nickname;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as EconomyActionError).code)
          : "trade_invalid";
      this.sendEconomyActionResult(playerId, "trade_offer", false, code);
    }
  }

  async handleTradeConfirm(playerId: string, nickname: string, tradeId: string): Promise<void> {
    const economy = this.options.economy;
    if (!economy) {
      this.sendEconomyActionResult(playerId, "trade_confirm", false, "not_found");
      return;
    }
    try {
      this.assertDeathmatchMarket();
      const session = this.trades.confirm(tradeId, playerId);
      this.sendTradeState(session, "open");
      if (!this.trades.bothConfirmed(session)) {
        this.sendEconomyActionResult(playerId, "trade_confirm", true);
        return;
      }
      await executeAtomicTrade(economy, session, Date.now());
      this.trades.cancel(tradeId);
      this.sendEconomyActionResult(session.a.playerId, "trade_confirm", true);
      this.sendEconomyActionResult(session.b.playerId, "trade_confirm", true);
      this.sendTradeState(session, "completed");
      await this.sendEconomyProfile(session.a.playerId, session.a.nickname);
      await this.sendEconomyProfile(session.b.playerId, session.b.nickname);
      void nickname;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as EconomyActionError).code)
          : "trade_invalid";
      this.sendEconomyActionResult(playerId, "trade_confirm", false, code);
      const session = this.trades.get(tradeId);
      if (session) {
        session.a.confirmed = false;
        session.b.confirmed = false;
        this.sendTradeState(session, "open");
      }
    }
  }

  async handleTradeCancel(playerId: string, tradeId: string): Promise<void> {
    try {
      this.assertDeathmatchMarket();
      const session = this.trades.get(tradeId);
      if (!session || (session.a.playerId !== playerId && session.b.playerId !== playerId)) {
        this.sendEconomyActionResult(playerId, "trade_cancel", false, "trade_invalid");
        return;
      }
      this.trades.cancel(tradeId);
      this.sendEconomyActionResult(session.a.playerId, "trade_cancel", true);
      this.sendEconomyActionResult(session.b.playerId, "trade_cancel", true);
      this.sendTradeState(session, "cancelled");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as EconomyActionError).code)
          : "trade_invalid";
      this.sendEconomyActionResult(playerId, "trade_cancel", false, code);
    }
  }

  /**
   * EPIC 25 §2.4: on confirmed human death (any killer including bots/fog),
   * apply amulet durability loss + 10% active-pet/gem effectiveness decay.
   * Never applied to bots.
   */
  private async applyHumanDeathEconomyPenalties(victimId: string): Promise<void> {
    const economy = this.options.economy;
    if (!economy) return;
    if (!this.sockets.has(victimId)) return;
    if (this.botAI?.isBot(victimId)) return;
    const victim = this.registry.getPlayer(victimId);
    if (!victim) return;
    const result = await economy.applyHumanDeathPenalties(
      victim.nickname,
      Date.now(),
      this.economyScope(),
    );
    await this.applyEconomyCombatToPlayer(victimId, victim.nickname);
    await this.sendEconomyProfile(victimId, victim.nickname);
    console.log(
      `[economy] death penalties -> ${victim.nickname}` +
        ` amuletDestroyed=${result.amuletDestroyed}` +
        ` durabilityAfter=${result.durabilityAfter}` +
        ` petsDecayed=${result.petsDecayed}` +
        ` gemsDecayed=${result.gemsDecayed}` +
        ` [match=${this.id}]`,
    );
  }

  /**
   * EPIC 23–26, EPIC 32, EPIC 35: mint kill gold + item drops into the
   * match-scoped economy pool (deathmatch | sandbox).
   *
   * - deathmatch (public): EPIC 32 gate — human victims only; bot victims
   *   grant nothing (preserves competitive anti-farm).
   * - sandbox (bots/endless): bot and human victims both grant rewards, but
   *   only into the isolated sandbox pool (cannot feed deathmatch).
   *
   * Overflow (rolled item cannot grant) substitutes additional gold.
   * Skips fog deaths, self-kills, and non-human shooters (bots have no socket).
   */
  private async grantKillGold(shooterId: string, victimId: string): Promise<void> {
    const economy = this.options.economy;
    if (!economy) return;
    if (shooterId === "fog" || shooterId === victimId) return;
    if (!this.sockets.has(shooterId)) return;
    if (this.botAI?.isBot(shooterId)) return;

    const killer = this.registry.getPlayer(shooterId);
    if (!killer) return;

    const scope = this.economyScope();
    const victimIsHuman = this.sockets.has(victimId) && !this.botAI?.isBot(victimId);

    // Deathmatch keeps EPIC 32: bot victims grant nothing. Sandbox rewards
    // bot and human kills into the sandbox pool only.
    if (scope === "deathmatch" && !victimIsHuman) {
      console.log(
        `[economy] kill vs bot victim -> no reward (${shooterId} -> ${victimId})` +
          ` [scope=${scope} match=${this.id}]`,
      );
      return;
    }

    const primaryGained = randomInt(GOLD_DROP_MIN, GOLD_DROP_MAX + 1);
    await economy.addGold(killer.nickname, primaryGained, scope);
    console.log(
      `[economy] gold minted: +${primaryGained} -> ${killer.nickname} ` +
        `[scope=${scope} match=${this.id} kill ${shooterId} -> ${victimId}]`,
    );

    const victimPlayer = this.registry.getPlayer(victimId);
    let alreadyGrantedShard = false;
    const killerProfile = await economy.getOrCreateProfile(killer.nickname, scope);
    // Never create economy profiles for bot nicknames (EPIC 31). Victim drop
    // context (gem/amulet/shard copy) only applies to human victims.
    if (victimIsHuman && victimPlayer) {
      const killerKey = killerProfile.nicknameKey;
      const victimKey = (await economy.getOrCreateProfile(victimPlayer.nickname, scope))
        .nicknameKey;
      alreadyGrantedShard = this.matchShardGrants.get(killerKey)?.has(victimKey) ?? false;
    }
    // Sandbox: full drop rolls even vs bots (EPIC 35). Deathmatch: human only
    // (EPIC 32). resolveKillDrops still needs victimIsHuman-or-sandbox for the
    // early gate; victim inventory copy only runs when victim context is set.
    const dropsEligible = scope === "sandbox" || victimIsHuman;
    const drops = await economy.resolveKillDrops(
      killer.nickname,
      dropsEligible,
      {},
      Date.now(),
      victimIsHuman && victimPlayer
        ? {
            nickname: victimPlayer.nickname,
            alreadyGrantedShard,
          }
        : undefined,
      scope,
    );
    // Consume once-per-victim shard opportunity on successful grant OR overflow→gold
    // substitute (EPIC 26 F-001: do not farm substitute gold from the same victim).
    const shardOpportunityConsumed =
      drops.shard || drops.substitutedKinds.includes("shard");
    if (shardOpportunityConsumed && victimIsHuman && victimPlayer) {
      const killerKey = killerProfile.nicknameKey;
      const victimKey = (await economy.getOrCreateProfile(victimPlayer.nickname, scope))
        .nicknameKey;
      let set = this.matchShardGrants.get(killerKey);
      if (!set) {
        set = new Set();
        this.matchShardGrants.set(killerKey, set);
      }
      set.add(victimKey);
    }

    const profile = await economy.getOrCreateProfile(killer.nickname, scope);
    const totalGained = primaryGained + drops.substitutedGold;
    this.sendEconomyGoldUpdate(shooterId, profile.gold, totalGained);

    if (drops.egg || drops.stimulator || drops.gem || drops.shard || drops.amulet || drops.repairKit) {
      await this.sendEconomyProfile(shooterId, killer.nickname);
      console.log(
        `[economy] kill item drops -> ${killer.nickname}` +
          `${drops.egg ? ` egg#${drops.egg.id}` : ""}` +
          `${drops.stimulator ? " stimulator" : ""}` +
          `${drops.gem ? ` gem#${drops.gem.id}` : ""}` +
          `${drops.shard ? " shard" : ""}` +
          `${drops.amulet ? ` amulet#${drops.amulet.id}` : ""}` +
          `${drops.repairKit ? " repairKit" : ""}` +
          ` [scope=${scope} match=${this.id}]`,
      );
    }
    if (drops.substitutedGold > 0) {
      await this.sendEconomyProfile(shooterId, killer.nickname);
      console.log(
        `[economy] drop_substituted_gold total=+${drops.substitutedGold}` +
          ` kinds=${drops.substitutedKinds.join(",")}` +
          ` -> ${killer.nickname} (total gold ${profile.gold})` +
          ` [scope=${scope} match=${this.id}]`,
      );
    }

    // EPIC 44: cosmetic kill-loot VFX — only kinds actually granted (never
    // failed rolls that became substitute gold as fake item kinds).
    const grants: KillLootFxGrant[] = [];
    if (primaryGained > 0 || drops.substitutedGold > 0) {
      grants.push({ kind: "gold" });
    }
    if (drops.egg) grants.push({ kind: "egg" });
    if (drops.stimulator) grants.push({ kind: "stimulator" });
    if (drops.gem) grants.push({ kind: "gem", detail: drops.gem.gemType });
    if (drops.shard) grants.push({ kind: "shard" });
    if (drops.amulet) grants.push({ kind: "amulet" });
    if (drops.repairKit) grants.push({ kind: "repair_kit" });

    if (grants.length > 0) {
      const victimPosition: Vector3 = victimPlayer
        ? { ...victimPlayer.position }
        : { x: 0, y: 0, z: 0 };
      const killerPosition: Vector3 = { ...killer.position };
      const fxMessage: EconomyKillLootFxMessage = {
        type: "economy_kill_loot_fx",
        killerId: shooterId,
        victimId,
        victimPosition,
        killerPosition,
        grants,
      };
      this.broadcast(fxMessage);
      console.log(
        `[economy] kill_loot_fx kinds=${grants.map((g) => g.kind).join(",")}` +
          ` ${shooterId} <- ${victimId} [scope=${scope} match=${this.id}]`,
      );
    }
  }

  /**
   * Resolve a fire attempt for `shooterId` — human OR bot, same authoritative
   * path either way (registry.fire()) — and broadcast whatever it resolved
   * to (hit/death/kill), scoped to this match only. This is the single call
   * site for "someone in this match fired", shared between the human "fire"
   * message handler (server/src/index.ts, after its own rate-limit gate) and
   * BotAI's own fire decisions (server/src/botAI.ts, after its own cooldown
   * gate) — one hit/death/kill-broadcast implementation, not duplicated per
   * caller.
   */
  resolveFire(shooterId: string): FireOutcome {
    const outcome = this.registry.fire(shooterId);
    // Ammo may have changed regardless of hit/miss/dry (EPIC 6) — resend the
    // shooter's own loadout. No-op for a bot (sendLoadout() has no socket).
    this.sendLoadout(shooterId);

    // EPIC 14 "Sound System" Story 14.4: broadcast a presentational-only
    // FireBroadcastEvent for every REAL fire attempt (hit, miss, OR dry —
    // `outcome.weapon` is only absent on no-shooter/dead-shooter and EPIC 41
    // spawn-protected-shooter early bails in registry.fire(), see its doc
    // comment) so every connected client can play that shooter's
    // weapon-specific gunshot sound, not just the local shooter's own.
    // Deliberately broadcast BEFORE the hit/dry/miss-specific branches below
    // so it fires uniformly regardless of outcome — a real trigger pull
    // makes a gunshot sound whether or not it happened to land.
    let projectileId: string | undefined;
    if (!outcome.hit && outcome.projectileSpawn) {
      projectileId = `${this.id}:projectile:${this.nextProjectileSeq++}`;
      const totalDistance = Math.hypot(
        outcome.projectileSpawn.trace.end.x - outcome.projectileSpawn.trace.origin.x,
        outcome.projectileSpawn.trace.end.y - outcome.projectileSpawn.trace.origin.y,
        outcome.projectileSpawn.trace.end.z - outcome.projectileSpawn.trace.origin.z,
      );
      if (totalDistance > 1e-5) {
        const projectile: ActiveProjectile = {
          id: projectileId,
          shooterId,
          trace: outcome.projectileSpawn.trace,
          position: { ...outcome.projectileSpawn.trace.origin },
          direction: {
            x: (outcome.projectileSpawn.trace.end.x - outcome.projectileSpawn.trace.origin.x) / totalDistance,
            y: (outcome.projectileSpawn.trace.end.y - outcome.projectileSpawn.trace.origin.y) / totalDistance,
            z: (outcome.projectileSpawn.trace.end.z - outcome.projectileSpawn.trace.origin.z) / totalDistance,
          },
          remainingDistance: totalDistance,
        };
        this.projectiles.set(projectile.id, projectile);
      } else {
        projectileId = undefined;
      }
    }

    if (outcome.weapon) {
      const fireBroadcast: FireBroadcastEvent = {
        type: "fire_broadcast",
        shooterId,
        weapon: outcome.weapon,
        trace: outcome.shotTrace,
        projectileId,
      };
      this.broadcast(fireBroadcast);
    }

    // EPIC 13 Story 13.1: log a material game-state transition whenever this
    // fire attempt emptied the equipped weapon and auto-switched the shooter
    // to their next-best usable weapon — independent of whether the shot
    // itself hit, missed, or was dry (see FireOutcome.autoSwitchedTo doc
    // comment, playerRegistry.ts). Matches the existing `switch:`-line style
    // used by the manual "E" cycle (server/src/index.ts).
    if (outcome.autoSwitchedTo) {
      console.log(
        `[server] [${this.id}] auto-switch (empty ammo): ${shooterId} -> ${outcome.autoSwitchedTo}`,
      );
    }

    if (!outcome.hit) {
      if (outcome.dry) {
        console.log(`[server] [${this.id}] ammo depleted: ${shooterId} tried to fire with 0 ammo`);
      }
      return outcome;
    }

    this.broadcastDamageEvents(shooterId, outcome.damageEvents);
    return outcome;
  }

  private broadcastDamageEvents(shooterId: string, damageEvents: DamageEvent[]): void {
    let scoreboardChanged = false;
    for (const event of damageEvents) {
      const hitMessage: HitEvent = {
        type: "hit",
        shooterId,
        targetId: event.targetId,
        damage: event.damage,
        hitZone: event.hitZone,
        damageKind: event.damageKind,
        targetHealth: event.targetHealth,
        point: event.point,
      };
      this.broadcast(hitMessage);
      const context =
        event.damageKind === "splash" ? "splash" : `${event.hitZone} ${event.damageKind}`;
      console.log(
        `[server] [${this.id}] hit: ${shooterId} -> ${event.targetId} ` +
          `(${event.damage} dmg, ${context}, ${event.targetHealth} hp left, ${event.targetArmor} armor left)`,
      );

      if (event.killed) {
        const shouldRestartEndlessRun = this.isEndlessHuman(event.targetId);
        if (shouldRestartEndlessRun) {
          const human = this.registry.getPlayer(event.targetId);
          if (human) human.respawnAtMs = Date.now();
          event.respawnAtMs = Date.now();
        }

        const deathMessage: DeathEvent = {
          type: "death",
          playerId: event.targetId,
          killerId: shooterId,
          respawnAtMs: event.respawnAtMs ?? Date.now() + COMBAT.respawnDelayMs,
        };
        this.broadcast(deathMessage);
        console.log(`[server] [${this.id}] death: ${event.targetId} killed by ${shooterId}`);
        void this.applyHumanDeathEconomyPenalties(event.targetId).catch((err) => {
          console.error(`[economy] death penalties failed:`, err);
        });

        const killMessage: KillEvent = {
          type: "kill",
          attackerId: shooterId,
          victimId: event.targetId,
          attackerNickname: this.registry.getNickname(shooterId),
          victimNickname: this.registry.getNickname(event.targetId),
        };
        this.broadcast(killMessage);
        void this.grantKillGold(shooterId, event.targetId).catch((err) => {
          console.error(`[economy] grantKillGold failed:`, err);
        });
        if (this.mode === "endless") {
          if (this.endlessHumanId && shooterId === this.endlessHumanId && this.botAI?.isBot(event.targetId)) {
            this.endlessBotKills += 1;
            this.publishEndlessProgress();
          }
          if (this.botAI?.isBot(event.targetId)) this.botAI.removeBot(event.targetId);
        } else if (this.mode === "public") {
          // EPIC 37: competitive career leaderboard is public-mode (real PvP)
          // only — bots-mode practice kills must not inflate K/D or create
          // bogus "Bot N" leaderboard rows. Endless already handled above.
          this.options.onKillRecorded?.(killMessage.attackerNickname, killMessage.victimNickname);
        }
        scoreboardChanged = true;
        if (shouldRestartEndlessRun) {
          this.restartEndlessRun(Date.now());
        }
      }
    }

    if (scoreboardChanged) {
      this.broadcastScoreboard();
    }
  }

  broadcastLeaderboard(entries: LeaderboardEntry[]): void {
    const message: LeaderboardMessage = { type: "leaderboard", entries };
    this.broadcast(message);
  }

  /** Start this match's own fixed-tick physics/respawn/pickup/broadcast loop. Call exactly once, right after construction (see MatchManager) — not idempotent. */
  start(): void {
    this.tickInterval = setInterval(() => this.tick(), TICK_MS);
  }

  /**
   * Stop this match's tick loop and drop its socket references. Everything
   * else this match owns (registry, pickupSpawner, botAI) is freed once
   * nothing still references this Match object — the caller (MatchManager)
   * is expected to also delete its own Map entry right after calling this,
   * which is what actually makes "all state freed" (EPIC 9 spec Section 2)
   * true rather than merely "stopped ticking".
   */
  destroy(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.sockets.clear();
    this.projectiles.clear();
  }

  private stepProjectiles(dtSeconds: number): void {
    for (const projectile of [...this.projectiles.values()]) {
      const stepDistance = Math.min(projectile.remainingDistance, projectile.trace.speed * dtSeconds);
      if (stepDistance <= 0) {
        this.projectiles.delete(projectile.id);
        continue;
      }

      const ray: Ray = { origin: projectile.position, direction: projectile.direction };
      let nearestDistance = stepDistance;
      let impactKind: "geometry" | "player" | null = null;
      let targetId: string | null = null;

      for (const box of this.currentGeometry()) {
        const distance = rayIntersectsAabb(ray, boxBounds(box), nearestDistance);
        if (distance !== null && distance < nearestDistance) {
          nearestDistance = distance;
          impactKind = "geometry";
          targetId = null;
        }
      }

      for (const candidate of this.registry.alivePlayerPositions()) {
        if (candidate.id === projectile.shooterId) continue;
        // EPIC 36: spawn-protected players are ghosts to projectiles too —
        // grenades pass through rather than detonating on them.
        const candidateRecord = this.registry.getPlayer(candidate.id);
        if (candidateRecord && isSpawnProtected(candidateRecord)) continue;
        const distance = rayIntersectsAabb(ray, playerHitboxBounds(candidate.position), nearestDistance);
        if (distance !== null && distance < nearestDistance) {
          nearestDistance = distance;
          impactKind = "player";
          targetId = candidate.id;
        }
      }

      const nextPosition = pointOnRay(ray, nearestDistance);
      projectile.position = nextPosition;
      projectile.remainingDistance -= nearestDistance;

      if (impactKind) {
        this.projectiles.delete(projectile.id);
        const impactMessage: ProjectileImpactEvent = {
          type: "projectile_impact",
          projectileId: projectile.id,
          shooterId: projectile.shooterId,
          weapon: "grenade_launcher",
          point: nextPosition,
        };
        this.broadcast(impactMessage);

        const damageEvents =
          impactKind === "player" && targetId
            ? this.resolveProjectileDirectHit(projectile.shooterId, targetId, nextPosition)
            : this.registry.applyGrenadeSplashImpact(projectile.shooterId, nextPosition);
        this.broadcastDamageEvents(projectile.shooterId, damageEvents);
        continue;
      }

      if (projectile.remainingDistance <= 0) {
        this.projectiles.delete(projectile.id);
      }
    }
  }

  private resolveProjectileDirectHit(shooterId: string, targetId: string, point: Vector3): DamageEvent[] {
    const target = this.registry.getPlayer(targetId);
    if (!target || !target.alive) return [];
    const hitZone = classifyHitZone(point, target);
    return this.registry.applyGrenadeProjectileDirect(shooterId, targetId, hitZone, point);
  }

  private tick(): void {
    const nowMs = Date.now();
    this.updateEndlessWorld(nowMs);

    // EPIC 9 Story 9.3: bot AI computes this tick's input/fire intent BEFORE
    // the physics step below, so it goes through the exact same
    // applyInput()/stepPlayer() path a human's already-buffered intent does
    // — a bot is a PlayerRecord whose "input" is computed here instead of
    // read from a socket, not a special-cased exception to physics.
    this.botAI?.update(nowMs, (shooterId) => this.resolveFire(shooterId));
    if (this.skipRestOfTickAfterEndlessRestart) return this.finishEndlessRestartTick(nowMs);
    this.stepProjectiles(TICK_DT_SECONDS);
    if (this.skipRestOfTickAfterEndlessRestart) return this.finishEndlessRestartTick(nowMs);

    this.registry.step(TICK_DT_SECONDS);
    this.applyEndlessFogDamage();
    if (this.skipRestOfTickAfterEndlessRestart) return this.finishEndlessRestartTick(nowMs);

    // Respawn is time-driven, not event-driven — checked every tick so it
    // happens on schedule even though the kill itself was resolved
    // out-of-band (resolveFire() above, called either from the "fire"
    // message handler or from botAI immediately when it decides to shoot).
    this.restartEndlessRunIfDead(nowMs);
    this.processDueRespawns(nowMs);

    // Server-authoritative pickup-on-proximity, checked every tick against
    // every currently ALIVE player's own server-tracked position. EPIC 9:
    // bots are deliberately EXCLUDED here — "bots stay pistol-only and
    // ignore all pickups entirely" (EPIC 9 spec Risks) — a bot patrolling
    // past a pickup must never pick it up, so this loop skips any id
    // botAI.isBot() recognizes before ever calling applyPickup() for it.
    let pickupStateChanged = false;
    for (const { id, position } of this.registry.alivePlayerPositions()) {
      if (this.botAI?.isBot(id)) continue;

      const nearby = this.pickupSpawner.findNearby(position, PICKUP_RADIUS);
      if (!nearby) continue;

      const { applied, autoSwitchedTo } = this.registry.applyPickup(id, nearby.category, nearby.weapon);
      if (!applied) continue;

      this.pickupSpawner.consume(nearby.id, nowMs);
      pickupStateChanged = true;
      this.sendLoadout(id);
      const weaponSuffix = nearby.weapon ? ` (${nearby.weapon})` : "";
      console.log(`[server] [${this.id}] pickup: ${id} picked up ${nearby.category} "${nearby.id}"${weaponSuffix}`);
      // EPIC 13 Story 13.2: log the generalized auto-equip-on-pickup rule
      // separately from the plain pickup line above, matching the
      // `switch:`-line style used by the manual "E" cycle (server/src/index.ts)
      // and the empty-ammo auto-switch log in resolveFire() above.
      if (autoSwitchedTo) {
        console.log(`[server] [${this.id}] auto-switch (pickup): ${id} -> ${autoSwitchedTo}`);
      }
    }

    // Pickup respawns are time-driven, same pattern as player respawns above.
    const pickupRespawns = this.pickupSpawner.processRespawns(nowMs);
    for (const item of pickupRespawns) {
      pickupStateChanged = true;
      const weaponSuffix = item.weapon ? ` ${item.weapon}` : "";
      console.log(`[server] [${this.id}] pickup respawn: "${item.id}" (${item.category}${weaponSuffix}) is available again`);
    }

    if (pickupStateChanged) {
      this.broadcastPickupState();
    }

    // EPIC 38: expire ground drops (destroy — same as discard).
    if (this.mode === "public" && this.groundItems.expire(nowMs) > 0) {
      this.broadcastGroundState();
    }

    const worldState: WorldStateMessage = {
      type: "world_state",
      serverTimeMs: nowMs,
      players: this.registry.toWorldState(),
    };
    this.broadcast(worldState);
  }

  private currentGeometry(): readonly MapBox[] {
    return this.endlessWorld?.getGeometry() ?? this.mapDefinition.geometry;
  }

  private updateEndlessWorld(nowMs: number): void {
    if (!this.endlessWorld || !this.endlessHumanId) return;
    const human = this.registry.getPlayer(this.endlessHumanId);
    const state = this.endlessWorld.update(TICK_DT_SECONDS, human?.position ?? null);

    if (state.wrapped && human) {
      human.position.z += state.wrapShiftZ;
      human.velocityY = 0;
      this.botAI?.clearBots();
      this.projectiles.clear();
      this.endlessNextBotSeq = 1;
      this.broadcastScoreboard();
    }

    this.pickupSpawner.syncPoints(this.endlessWorld.getPickups());

    if (this.endlessWorld.getVersion() !== this.lastMapVersion) {
      this.sendMapState();
      this.broadcastPickupState();
    }

    if (human?.alive) {
      for (const point of this.endlessWorld.takeBotSpawns(3, human.position.z)) {
        const id = `${this.id}:Bot ${this.endlessNextBotSeq++}`;
        this.botAI?.spawnBotAt(id, point, `Bot ${this.endlessNextBotSeq - 1}`);
        this.broadcastScoreboard();
      }
    }

    if (nowMs - this.lastEndlessProgressAtMs >= 1000) {
      this.lastEndlessProgressAtMs = nowMs;
      this.sendEndlessState();
      const nickname = this.registry.getNickname(this.endlessHumanId);
      this.options.onEndlessProgress?.(nickname, this.endlessBotKills, state.distanceMeters / 1000);
    }
  }

  private applyEndlessFogDamage(): void {
    if (!this.endlessWorld || !this.endlessHumanId) return;
    const human = this.registry.getPlayer(this.endlessHumanId);
    if (!human || !human.alive || !this.endlessWorld.isInFog(human.position)) return;
    const damage = this.endlessWorld.fogDamagePerTick(TICK_DT_SECONDS);
    const event = this.registry.applyEnvironmentalDamage(this.endlessHumanId, damage, {
      x: human.position.x,
      y: human.position.y + 1,
      z: this.endlessWorld.state().fogZ,
    });
    if (event) this.broadcastDamageEvents("fog", [event]);
  }

  private publishEndlessProgress(): void {
    if (!this.endlessWorld || !this.endlessHumanId) return;
    const nickname = this.registry.getNickname(this.endlessHumanId);
    this.sendEndlessState();
    this.options.onEndlessProgress?.(nickname, this.endlessBotKills, this.endlessWorld.state().distanceMeters / 1000);
  }

  private restartEndlessRunIfDead(nowMs: number): void {
    if (!this.endlessWorld || !this.endlessHumanId) return;
    const human = this.registry.getPlayer(this.endlessHumanId);
    if (!human || human.alive) return;
    if (human.respawnAtMs === null || nowMs < human.respawnAtMs) {
      human.respawnAtMs = nowMs;
    }
    this.restartEndlessRun(nowMs);
  }

  private restartEndlessRun(nowMs: number): void {
    if (!this.endlessWorld || !this.endlessHumanId) return;
    const human = this.registry.getPlayer(this.endlessHumanId);
    if (!human || human.alive || human.respawnAtMs === null) return;
    this.options.onEndlessProgress?.(
      human.nickname,
      this.endlessBotKills,
      this.endlessWorld.state().distanceMeters / 1000,
    );
    this.endlessWorld.reset();
    this.pickupSpawner.syncPoints(this.endlessWorld.getPickups());
    this.botAI?.clearBots();
    this.projectiles.clear();
    this.endlessBotKills = 0;
    this.endlessNextBotSeq = 1;
    this.lastMapVersion = -1;
    this.skipRestOfTickAfterEndlessRestart = true;
    this.sendMapState();
    this.broadcastPickupState();
    this.sendEndlessState();
    this.processDueRespawns(nowMs);
    this.broadcastScoreboard();
  }

  private processDueRespawns(nowMs: number): void {
    const respawns = this.registry.processRespawns(nowMs);
    for (const respawn of respawns) {
      const respawnMessage: RespawnEvent = {
        type: "respawn",
        playerId: respawn.playerId,
        position: respawn.position,
        health: respawn.health,
      };
      this.broadcast(respawnMessage);
      this.sendLoadout(respawn.playerId);
      console.log(
        `[server] [${this.id}] respawn: ${respawn.playerId} at (${respawn.position.x.toFixed(1)}, ${respawn.position.z.toFixed(1)})`,
      );
    }
  }

  private isEndlessHuman(playerId: string): boolean {
    return this.mode === "endless" && playerId === this.endlessHumanId;
  }

  private finishEndlessRestartTick(nowMs: number): void {
    this.skipRestOfTickAfterEndlessRestart = false;
    const worldState: WorldStateMessage = {
      type: "world_state",
      serverTimeMs: nowMs,
      players: this.registry.toWorldState(),
    };
    this.broadcast(worldState);
  }
}
