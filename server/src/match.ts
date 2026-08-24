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
  ARENA_GEOMETRY,
  ARENA_BOUNDS,
  BROADCAST_TICK_HZ,
  COMBAT,
  GOLD_DROP_MAX,
  GOLD_DROP_MIN,
  MAX_PUBLIC_PLAYERS_PER_MATCH,
  PICKUP_RADIUS,
  SPAWN_POINTS,
  type EndlessStateMessage,
  boxBounds,
  playerHitboxBounds,
  rayIntersectsAabb,
  type DeathEvent,
  type EconomyActionResultMessage,
  type EconomyGoldUpdateMessage,
  type EconomyProfileMessage,
  type FireBroadcastEvent,
  type HitEvent,
  type KillEvent,
  type LeaderboardEntry,
  type LeaderboardMessage,
  type LoadoutMessage,
  type MapBox,
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
} from "@cubewars/shared";
import { PlayerRegistry, type DamageEvent, type FireOutcome } from "./playerRegistry.js";
import { PickupSpawner } from "./pickupSpawner.js";
import { BotAI } from "./botAI.js";
import { EndlessWorld } from "./endlessWorld.js";
import { classifyHitZone, pointOnRay } from "./combat.js";
import type { EconomyActionError, EconomyStore } from "./economy/index.js";

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
}

export class Match {
  readonly id: string;
  readonly mode: MatchMode;
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

  constructor(private options: MatchOptions) {
    this.id = options.id;
    this.mode = options.mode;
    if (this.mode === "endless") {
      this.endlessWorld = new EndlessWorld();
    }
    this.registry = new PlayerRegistry({
      getGeometry: () => this.currentGeometry(),
      getSpawnPoints: () => this.endlessWorld?.getSpawnPoints() ?? SPAWN_POINTS,
      worldBound: this.mode === "endless" ? 10000 : undefined,
    });
    // EPIC 6 Story 6.1 "Design note for EPIC 9 compatibility": player-count
    // source reads THIS match's own live alive-player list (bots included,
    // same as any other alive player for this formula), never a snapshot or
    // another match's count.
    this.pickupSpawner = new PickupSpawner(
      () => this.registry.alivePlayerPositions().length,
      this.endlessWorld?.getPickups() ?? undefined,
    );

    if (this.mode === "bots") {
      this.botAI = new BotAI(this.registry);
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

  addHuman(connectionId: string, socket: WebSocket, nickname: string, nicknameKey: string): void {
    this.sockets.set(connectionId, socket);
    if (this.mode === "endless") this.endlessHumanId = connectionId;
    this.registry.spawn(connectionId, nickname, nicknameKey);
    this.applyEconomyCombatToPlayer(connectionId, nickname);
    this.sendMapState();
    this.sendLoadout(connectionId);
    this.sendEconomyProfile(connectionId, nickname);
    this.broadcastScoreboard();
    this.broadcastPickupState();
    this.sendEndlessState();
  }

  /**
   * Remove a human connection from this match (disconnect). If this is a
   * "bots" match and its last human just left, notifies `onEmpty` so the
   * caller can tear the whole match down (EPIC 9 spec: private bots matches
   * don't outlive their one human).
   */
  removeHuman(connectionId: string): void {
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
    const bounds = this.endlessWorld?.getBounds() ?? ARENA_BOUNDS;
    const message: MapStateMessage = { type: "map_state", geometry: [...this.currentGeometry()], bounds };
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

  /** Send durable economy snapshot to the owning human socket only (EPIC 23–25). */
  sendEconomyProfile(playerId: string, nickname: string): void {
    const economy = this.options.economy;
    if (!economy) return;
    const socket = this.sockets.get(playerId);
    if (!socket || socket.readyState !== socket.OPEN) return;
    const profile = economy.getFullProfile(nickname);
    const message: EconomyProfileMessage = {
      type: "economy_profile",
      nickname: profile.nickname,
      gold: profile.gold,
      pets: profile.pets.map((p) => ({
        id: p.id,
        type: p.type,
        baseValue: p.baseValue,
        equipSlot: p.equipSlot,
      })),
      eggs: profile.eggs.map((e) => ({
        id: e.id,
        hatchDeadlineMs: e.hatchDeadlineMs,
      })),
      stimulatorCount: profile.stimulatorCount,
      gems: profile.gems.map((g) => ({
        id: g.id,
        gemType: g.gemType,
        value: g.value,
        petId: g.petId,
      })),
      amulets: profile.amulets.map((a) => ({
        id: a.id,
        durability: a.durability,
        equipped: a.equipped,
      })),
      shardCount: profile.shardCount,
      repairKitCount: profile.repairKitCount,
      ratings: profile.ratings,
      slot2Enabled: profile.slot2Enabled,
    };
    socket.send(JSON.stringify(message));
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

  /** Push equipped pet ratings into the live PlayerRecord (EPIC 24). */
  applyEconomyCombatToPlayer(playerId: string, nickname: string): void {
    const economy = this.options.economy;
    if (!economy) return;
    const full = economy.getFullProfile(nickname);
    this.registry.applyPetRatings(playerId, full.ratings);
  }

  /**
   * Handle an economy action from the owning connection. Validates ownership
   * server-side; rejects cross-profile ids and slot 2 without an amulet.
   */
  handleEconomyAction(
    playerId: string,
    nickname: string,
    action: EconomyActionResultMessage["action"],
    payload: {
      petId?: number;
      eggId?: number;
      slot?: number;
      gemId?: number;
      amuletId?: number;
    },
  ): void {
    const economy = this.options.economy;
    if (!economy) {
      this.sendEconomyActionResult(playerId, action, false, "not_found");
      return;
    }
    try {
      if (action === "equip") {
        if (typeof payload.petId !== "number" || !Number.isInteger(payload.petId)) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        const slot = payload.slot ?? 1;
        economy.equipPet(nickname, payload.petId, slot);
      } else if (action === "unequip") {
        if (typeof payload.petId !== "number" || !Number.isInteger(payload.petId)) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        economy.unequipPet(nickname, payload.petId);
      } else if (action === "hatch") {
        if (typeof payload.eggId !== "number" || !Number.isInteger(payload.eggId)) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        economy.hatchEgg(nickname, payload.eggId);
      } else if (action === "stimulator") {
        if (typeof payload.eggId !== "number" || !Number.isInteger(payload.eggId)) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        economy.applyStimulator(nickname, payload.eggId);
      } else if (action === "socket_gem") {
        if (
          typeof payload.gemId !== "number" ||
          !Number.isInteger(payload.gemId) ||
          typeof payload.petId !== "number" ||
          !Number.isInteger(payload.petId)
        ) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        economy.socketGem(nickname, payload.gemId, payload.petId);
      } else if (action === "unsocket_gem") {
        if (typeof payload.gemId !== "number" || !Number.isInteger(payload.gemId)) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        economy.unsocketGem(nickname, payload.gemId);
      } else if (action === "equip_amulet") {
        if (typeof payload.amuletId !== "number" || !Number.isInteger(payload.amuletId)) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        economy.equipAmulet(nickname, payload.amuletId);
      } else if (action === "unequip_amulet") {
        if (typeof payload.amuletId !== "number" || !Number.isInteger(payload.amuletId)) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        economy.unequipAmulet(nickname, payload.amuletId);
      } else if (action === "craft_amulet") {
        economy.craftAmulet(nickname);
      } else if (action === "repair_amulet") {
        if (typeof payload.amuletId !== "number" || !Number.isInteger(payload.amuletId)) {
          this.sendEconomyActionResult(playerId, action, false, "not_found");
          return;
        }
        economy.repairAmulet(nickname, payload.amuletId);
      }
      this.applyEconomyCombatToPlayer(playerId, nickname);
      this.sendEconomyActionResult(playerId, action, true);
      this.sendEconomyProfile(playerId, nickname);
      console.log(`[economy] ${action} ok for ${nickname} [match=${this.id}]`);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as EconomyActionError).code)
          : "not_found";
      this.sendEconomyActionResult(playerId, action, false, code);
      console.warn(`[economy] ${action} rejected for ${nickname}: ${code}`);
    }
  }

  /**
   * EPIC 25 §2.4: on confirmed human death (any killer including bots/fog),
   * apply amulet durability loss + 10% active-pet/gem effectiveness decay.
   * Never applied to bots.
   */
  private applyHumanDeathEconomyPenalties(victimId: string): void {
    const economy = this.options.economy;
    if (!economy) return;
    if (!this.sockets.has(victimId)) return;
    if (this.botAI?.isBot(victimId)) return;
    const victim = this.registry.getPlayer(victimId);
    if (!victim) return;
    const result = economy.applyHumanDeathPenalties(victim.nickname);
    this.applyEconomyCombatToPlayer(victimId, victim.nickname);
    this.sendEconomyProfile(victimId, victim.nickname);
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
   * EPIC 23–25: mint kill gold into the human killer's nickname profile, and
   * on human victims only roll egg/stim/gem/shard/amulet/repair drops.
   * Skips fog deaths, self-kills, and non-human shooters (bots have no socket).
   */
  private grantKillGold(shooterId: string, victimId: string): void {
    const economy = this.options.economy;
    if (!economy) return;
    if (shooterId === "fog" || shooterId === victimId) return;
    if (!this.sockets.has(shooterId)) return;
    if (this.botAI?.isBot(shooterId)) return;

    const killer = this.registry.getPlayer(shooterId);
    if (!killer) return;

    const gained = randomInt(GOLD_DROP_MIN, GOLD_DROP_MAX + 1);
    const profile = economy.addGold(killer.nickname, gained);
    this.sendEconomyGoldUpdate(shooterId, profile.gold, gained);
    console.log(
      `[economy] gold minted: +${gained} -> ${profile.nickname} (total ${profile.gold}) ` +
        `[match=${this.id} kill ${shooterId} -> ${victimId}]`,
    );

    // Item drops: human victims only (bots remain gold-only for items).
    const victimIsHuman = this.sockets.has(victimId) && !this.botAI?.isBot(victimId);
    const victimPlayer = victimIsHuman ? this.registry.getPlayer(victimId) : null;
    let alreadyGrantedShard = false;
    if (victimPlayer) {
      const killerKey = profile.nicknameKey;
      const victimKey = economy.getOrCreateProfile(victimPlayer.nickname).nicknameKey;
      alreadyGrantedShard = this.matchShardGrants.get(killerKey)?.has(victimKey) ?? false;
    }
    const drops = economy.tryKillItemDrops(
      killer.nickname,
      victimIsHuman,
      {},
      Date.now(),
      victimPlayer
        ? {
            nickname: victimPlayer.nickname,
            alreadyGrantedShard,
          }
        : undefined,
    );
    if (drops.shard && victimPlayer) {
      const killerKey = profile.nicknameKey;
      const victimKey = economy.getOrCreateProfile(victimPlayer.nickname).nicknameKey;
      let set = this.matchShardGrants.get(killerKey);
      if (!set) {
        set = new Set();
        this.matchShardGrants.set(killerKey, set);
      }
      set.add(victimKey);
    }
    if (drops.egg || drops.stimulator || drops.gem || drops.shard || drops.amulet || drops.repairKit) {
      this.sendEconomyProfile(shooterId, killer.nickname);
      console.log(
        `[economy] kill item drops -> ${killer.nickname}` +
          `${drops.egg ? ` egg#${drops.egg.id}` : ""}` +
          `${drops.stimulator ? " stimulator" : ""}` +
          `${drops.gem ? ` gem#${drops.gem.id}` : ""}` +
          `${drops.shard ? " shard" : ""}` +
          `${drops.amulet ? ` amulet#${drops.amulet.id}` : ""}` +
          `${drops.repairKit ? " repairKit" : ""}` +
          ` [match=${this.id}]`,
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
    // `outcome.weapon` is only absent on the effectively-unreachable
    // no-shooter/dead-shooter early bail in registry.fire(), see its doc
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
        this.applyHumanDeathEconomyPenalties(event.targetId);

        const killMessage: KillEvent = {
          type: "kill",
          attackerId: shooterId,
          victimId: event.targetId,
          attackerNickname: this.registry.getNickname(shooterId),
          victimNickname: this.registry.getNickname(event.targetId),
        };
        this.broadcast(killMessage);
        this.grantKillGold(shooterId, event.targetId);
        if (this.mode === "endless") {
          if (this.endlessHumanId && shooterId === this.endlessHumanId && this.botAI?.isBot(event.targetId)) {
            this.endlessBotKills += 1;
            this.publishEndlessProgress();
          }
          if (this.botAI?.isBot(event.targetId)) this.botAI.removeBot(event.targetId);
        } else {
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

    const worldState: WorldStateMessage = {
      type: "world_state",
      serverTimeMs: nowMs,
      players: this.registry.toWorldState(),
    };
    this.broadcast(worldState);
  }

  private currentGeometry(): readonly MapBox[] {
    return this.endlessWorld?.getGeometry() ?? ARENA_GEOMETRY;
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
