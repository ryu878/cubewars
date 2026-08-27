// Protocol types shared between client and server.
// Consumed directly as TypeScript source (no build step) by both Vite (client)
// and tsx (server) — keep this package dependency-free and framework-agnostic.

import type { Vector3 } from "./types.js";
export type { Vector3 } from "./types.js";
import type { WeaponType } from "./weapons.js";
import type { PickupStatus } from "./pickups.js";
import type { DamageKind, DamageZone } from "./combat.js";
import type { MapBox, MapId } from "./mapData.js";
import type {
  EquippedPetVisual,
  GemType,
  InventoryItemType,
  PetType,
  ProfileRatings,
} from "./economy.js";
// EPIC 3 "The Arena": the single source of truth for map geometry, spawn
// points, and their collision resolution — see mapData.ts / collision.ts
// doc comments. Re-exported here so both client and server keep importing
// everything from "@cubewars/shared" (this package's "main"/"types" entry).
export * from "./mapData.js";
export * from "./collision.js";
// EPIC 4 "Shooting & Combat": shared hitscan math/constants — see
// combat.ts doc comment.
export * from "./combat.js";
// EPIC 6 "Weapons & Ammo": weapon tier/balance table and generic
// pickup-spawn infrastructure — see weapons.ts / pickups.ts doc comments.
export * from "./weapons.js";
export * from "./pickups.js";
export * from "./nickname.js";
export * from "./economy.js";
export * from "./avatar.js";
import type { AvatarBodyPart, AvatarColors } from "./avatar.js";

export const PROTOCOL_VERSION = 1;

// --- Movement tuning (shared so client prediction and the server's
// authoritative simulation agree on the same constants — one definition,
// not duplicated per EPIC 2 Story 2.2). ---
export const MOVEMENT = {
  /**
   * Ground horizontal move speed, m/s. EPIC 8 Story 8.1: 1.33x the original
   * EPIC 2 baseline (5 -> 5 * 1.33 = 6.65), expressed as the multiplication
   * rather than the literal result so the balance intent stays visible at
   * the one shared definition site (client + server both import this same
   * constant, never a duplicated literal — see EPIC 8 Task 1). EPIC 11
   * Story 11.2: user feedback that the EPIC 8 speed still felt too slow —
   * a further 2x on top of that value (5 * 1.33 * 2 = 13.3 m/s, user's
   * explicit "2x to start" ask after initially asking for 3x then 5x — see
   * EPIC 11 spec Section 2), again expressed as the full lineage rather
   * than the bare literal so the history stays visible. This relies on
   * the sub-stepped collision resolution added in EPIC 11 Story 11.1
   * (shared/src/collision.ts resolveSteppedMovement()) to stay wall-safe
   * at this speed — do not raise this further without re-checking that
   * safety margin (scripts/regression-collision-overshoot.ts).
   */
  maxSpeed: 5 * 1.33 * 2,
  /**
   * Initial vertical velocity applied on jump, m/s. EPIC 12 "Jumpable
   * Crates" Section 2: raised 25% (6 -> 6 * 1.25 = 7.5), expressed as the
   * lineage rather than the bare literal (same style as maxSpeed above), so
   * a player can actually reach a crate's top surface — with the previous
   * value, ballistic apex (jumpSpeed^2 / (2*gravity) = 36/36 = 1.0m) was
   * strictly below CRATE_HEIGHT (1.2m, shared/src/mapData.ts), making
   * crates physically unreachable. New apex = 7.5^2 / (2*18) = 56.25/36 =
   * 1.5625m, clearing CRATE_HEIGHT by ~0.36m (~30%) — a comfortable, not
   * frame-perfect, margin. Still well under WALL_HEIGHT (6), so walls
   * remain unreachable to stand on; only crates (kind: "crate") become
   * climbable (see shared/src/collision.ts boxesBlockingAt/crateTopHeightAt).
   */
  jumpSpeed: 6 * 1.25,
  /** Downward acceleration, m/s^2. */
  gravity: 18,
  /** Ground plane height; player position.y never goes below this. */
  groundY: 0,
} as const;

/**
 * Bunny hop tuning (EPIC 8 Story 8.2): a genuine second Space key-down while
 * still airborne (not a held key, not a third+ press this same air-time)
 * applies a one-time boost to the player's current velocity, gated and
 * computed entirely server-side (server/src/playerRegistry.ts stepPlayer())
 * — the client only predicts the same formula locally for feel
 * (client/src/fpsController.ts), reconciled by the existing position
 * reconciliation from EPIC 2. One definition, shared by both, per the same
 * discipline as MOVEMENT above.
 */
export const BUNNY_HOP = {
  /**
   * Horizontal move-speed multiplier applied for the remainder of the
   * current air-time once the boost triggers (reset to 1 on landing). The
   * existing movement model computes horizontal displacement fresh from
   * input intent every tick rather than integrating a persisted horizontal
   * velocity (see MOVEMENT doc comment / stepPlayer()), so "boost the
   * horizontal speed" is implemented as a temporary multiplier on
   * MOVEMENT.maxSpeed for the rest of this hop rather than a one-off
   * velocity impulse — same end result (faster, farther hop) without
   * introducing a second horizontal-motion model.
   */
  speedMultiplier: 1.3,
  /**
   * Fraction of MOVEMENT.jumpSpeed added to (not replacing) the player's
   * current vertical velocity when the boost triggers — a "kick" mid-air,
   * not a fresh jump from ground height.
   */
  verticalBoostFraction: 0.4,
} as const;

/** Server broadcast tick rate for world-state updates (Hz). See EPIC 2 handoff for rationale. */
export const BROADCAST_TICK_HZ = 20;

export interface WelcomeMessage {
  type: "welcome";
  protocolVersion: number;
  playerId: string;
  serverTimeMs: number;
}

/**
 * Client -> server input intent, sent on a fixed interval (see EPIC 2 handoff
 * for the chosen rate). This is an *intent*, not a position: the server is the
 * sole authority on the resulting player position (security-baseline.mdc).
 */
export interface PlayerInputMessage {
  type: "input";
  /** Forward(+1)/backward(-1) intent relative to look yaw. Server clamps to [-1, 1]. */
  moveForward: number;
  /** Right(+1)/left(-1) strafe intent relative to look yaw. Server clamps to [-1, 1]. */
  moveRight: number;
  /** Current look yaw in radians, used both to project movement into world space and to orient the player's avatar for other clients. */
  yaw: number;
  /**
   * Current look pitch in radians (server clamps to [-MAX_PITCH, MAX_PITCH],
   * see combat.ts). Tracked continuously (not just at fire time) so the
   * server's authoritative hitscan ray (EPIC 4) always starts from the same
   * aim direction the player is actually looking at, without trusting a
   * client-supplied aim direction at the moment of firing.
   */
  pitch: number;
  /**
   * Whether the jump key (Space) is currently held down, sampled at the
   * client's own input-send rate — a level, not an edge. The server derives
   * BOTH the normal "jump when grounded" trigger (level-based, unchanged
   * since EPIC 2) AND the EPIC 8 bunny-hop trigger (a false->true edge
   * detected server-side by comparing consecutive samples of this field,
   * never trusted as a client-asserted "this was a fresh press" — see
   * server/src/playerRegistry.ts applyInput()/stepPlayer()) from this same
   * field, so the protocol itself does not need a second "jump edge" message
   * type.
   */
  jump: boolean;
}

/**
 * Client -> server: fire the equipped weapon (EPIC 4 Story 4.1). Carries no
 * aim/position payload on purpose — the server computes the shot's origin
 * and direction from ITS OWN authoritative record of this player's
 * position/yaw/pitch (kept current via PlayerInputMessage above), never
 * from client-supplied coordinates. This is the strongest anti-cheat
 * posture available here: a compromised client cannot claim "I hit you"
 * from an impossible origin because it never gets to state an origin at all
 * (security-baseline.mdc: client input is never trusted for gameplay-
 * relevant outcomes).
 */
export interface FireEvent {
  type: "fire";
}

/**
 * Client -> server: cycle the equipped weapon forward through owned weapons
 * in tier order (EPIC 6 Story 6.2, "E" key). Carries no target-weapon
 * payload on purpose, same anti-spoofing posture as FireEvent above: the
 * client requests "cycle to the next one", never "set my weapon to X" — the
 * server alone (server/src/playerRegistry.ts `cycleWeapon()`) decides what
 * "next" means from its own authoritative record of what this player owns
 * and currently has equipped.
 */
export interface SwitchWeaponEvent {
  type: "switch_weapon";
}

/**
 * Match kind a connection can join (EPIC 9 "Bots & Match Modes" Architecture
 * Section 2): `"public"` is the single persistent shared world (today's
 * game, unchanged) — `"bots"` creates/joins a fresh private match with
 * exactly this one connection + 2 AI-controlled bots.
 */
export type MatchMode = "public" | "bots" | "endless";

export const MAX_PUBLIC_PLAYERS_PER_MATCH = 8;
export const LEADERBOARD_LIMIT = 20;

export interface LobbyMatchSummary {
  id: string;
  displayName: string;
  players: number;
  maxPlayers: number;
  /** Server-owned static map for this public match (EPIC 46). */
  mapId: MapId;
  /** English display name from the shared catalog. */
  mapDisplayName: string;
}

/**
 * Client -> server: join a match (EPIC 9 Story 9.2). Sent exactly once per
 * connection, after `welcome` and before any gameplay message
 * (input/fire/switch_weapon) — the server does not spawn this connection
 * into any match, and rejects/ignores gameplay messages from it, until this
 * arrives (server/src/index.ts join-gating; security-baseline.mdc "reject
 * what shouldn't be trusted"). No session persistence: a reconnect/refresh
 * is a brand-new connection that must join again.
 */
export interface JoinMessage {
  type: "join";
  mode: MatchMode;
  nickname: string;
  /** Public match id selected from LobbyStateMessage. Omitted for quick-join/auto-create and ignored for bots. */
  matchId?: string;
  /**
   * EPIC 46: preferred static map when creating a new public/bots match.
   * Ignored when joining an existing public matchId (server map wins).
   * Ignored for endless. Invalid values are rejected with map_invalid.
   * EPIC 47: bots create path must honor this (defaults to Base only when omitted).
   */
  mapId?: MapId;
}

/**
 * Client -> server: leave the current match and return to lobby without
 * closing the WebSocket (EPIC 47 ESC pause menu). Server removes the human,
 * re-attaches the socket to lobby broadcasts, and keeps auth/nickname ready
 * so the player can join again on the same connection.
 */
export interface LeaveMatchMessage {
  type: "leave_match";
}

/**
 * Client -> server: bind nickname in the lobby without joining a match (EPIC 42/45).
 * Server normalizes the nickname, sets nicknameReady, stays in lobbySockets,
 * remembers the requested economy pool for lobby inventory mutations, and
 * pushes that pool's `economy_profile`. Does not create/join a match.
 * `economyPool` defaults to `"deathmatch"` when omitted (backward compatible).
 */
export interface LobbyBindNicknameMessage {
  type: "lobby_bind_nickname";
  nickname: string;
  /** Which inventory pool to bind for lobby mutations (EPIC 45). */
  economyPool?: EconomyPool;
}

/**
 * Client -> server: equip a pet into slot 1 or 2 (EPIC 24/25). Server validates
 * ownership; slot 2 only when an amulet is equipped (`slot2Enabled`).
 */
export interface EconomyEquipPetMessage {
  type: "economy_equip_pet";
  petId: number;
  slot: 1 | 2;
}

/** Client -> server: unequip a pet the connection owns (EPIC 24). */
export interface EconomyUnequipPetMessage {
  type: "economy_unequip_pet";
  petId: number;
}

/**
 * Client -> server: set a owned pet's cosmetic color palette index (EPIC 39).
 * Server validates ownership + index range; scope is derived server-side from
 * match context (or Deathmatch in lobby) — never trust a client-claimed pool.
 */
export interface EconomySetPetColorMessage {
  type: "economy_set_pet_color";
  petId: number;
  paletteIndex: number;
}

/** Client -> server: hatch a ready egg owned by this profile (EPIC 24). */
export interface EconomyHatchEggMessage {
  type: "economy_hatch_egg";
  eggId: number;
}

/** Client -> server: consume one growth stimulator on an owned egg (EPIC 24). */
export interface EconomyApplyStimulatorMessage {
  type: "economy_apply_stimulator";
  eggId: number;
}

/** Client -> server: socket an owned unequipped gem into an owned pet (EPIC 25). */
export interface EconomySocketGemMessage {
  type: "economy_socket_gem";
  gemId: number;
  petId: number;
}

/** Client -> server: unsocket an owned gem from its pet (EPIC 25). */
export interface EconomyUnsocketGemMessage {
  type: "economy_unsocket_gem";
  gemId: number;
}

/** Client -> server: equip an owned amulet (enables pet slot 2) (EPIC 25). */
export interface EconomyEquipAmuletMessage {
  type: "economy_equip_amulet";
  amuletId: number;
}

/** Client -> server: unequip an owned amulet (forces slot-2 pet unequip) (EPIC 25). */
export interface EconomyUnequipAmuletMessage {
  type: "economy_unequip_amulet";
  amuletId: number;
}

/** Client -> server: craft an amulet from 10 shards (EPIC 25). */
export interface EconomyCraftAmuletMessage {
  type: "economy_craft_amulet";
}

/** Client -> server: consume one repair kit to +1 durability on an owned amulet (EPIC 25). */
export interface EconomyRepairAmuletMessage {
  type: "economy_repair_amulet";
  amuletId: number;
}

/**
 * Client -> server: move a bag item to a new grid anchor (EPIC 29).
 * Server validates ownership, footprint geometry, and non-overlap.
 * For `shard_stack`, `itemId` is ignored (always 0).
 */
export interface EconomyMoveItemMessage {
  type: "economy_move_item";
  itemType: InventoryItemType;
  itemId: number;
  toAnchor: number;
}

/**
 * Client -> server: destroy a bag item forever (EPIC 29).
 * Equipped / socketed items are rejected.
 * For `shard_stack`, `itemId` is ignored (always 0); clears the whole stack.
 */
export interface EconomyDiscardItemMessage {
  type: "economy_discard_item";
  itemType: InventoryItemType;
  itemId: number;
}

/**
 * Client -> server: drop a bag item onto the match ground (EPIC 38).
 * Deathmatch (public) matches only. Item is removed from bag and lives as a
 * match entity for GROUND_DROP_TTL_MS; expire destroys it.
 */
export interface EconomyDropItemMessage {
  type: "economy_drop_item";
  itemType: InventoryItemType;
  itemId: number;
}

/** Client -> server: pick up a ground item by server id (EPIC 38). */
export interface EconomyPickupGroundMessage {
  type: "economy_pickup_ground";
  groundId: number;
}

/**
 * Client -> server: list a Deathmatch-pool bag item on the auction (EPIC 38).
 * Always Deathmatch pool — never Sandbox. Optional buyout; startPrice > 0.
 * For `shard_stack`, `itemId` is ignored; `shardQuantity` required (1..stack).
 */
export interface EconomyAuctionListMessage {
  type: "economy_auction_list";
  itemType: InventoryItemType;
  itemId: number;
  startPrice: number;
  buyoutPrice?: number;
  /** Required when itemType is shard_stack. */
  shardQuantity?: number;
}

/** Client -> server: place a bid on an active lot (EPIC 38). Gold escrowed. */
export interface EconomyAuctionBidMessage {
  type: "economy_auction_bid";
  lotId: number;
  amount: number;
}

/** Client -> server: buy out a lot at its buyout price when set (EPIC 38). */
export interface EconomyAuctionBuyoutMessage {
  type: "economy_auction_buyout";
  lotId: number;
}

/** Client -> server: refresh auction lot list (EPIC 38). */
export interface EconomyAuctionBrowseMessage {
  type: "economy_auction_browse";
}

/** Client -> server: open / update a same-match P2P trade offer (EPIC 38). */
export interface EconomyTradeOpenMessage {
  type: "economy_trade_open";
  /** Target human playerId in the same match. */
  partnerId: string;
}

export interface EconomyTradeOfferMessage {
  type: "economy_trade_offer";
  tradeId: string;
  /** Gold from Deathmatch pool (0 allowed). */
  gold: number;
  items: Array<{ itemType: InventoryItemType; itemId: number; shardQuantity?: number }>;
}

export interface EconomyTradeConfirmMessage {
  type: "economy_trade_confirm";
  tradeId: string;
}

export interface EconomyTradeCancelMessage {
  type: "economy_trade_cancel";
  tradeId: string;
}

/**
 * Client -> server: request a cosmetic avatar color change (EPIC 33).
 * Server validates `part` + `paletteIndex` against the shared palette before
 * persisting or broadcasting — never trust raw client colors into PlayerState.
 */
export interface AvatarSetColorMessage {
  type: "avatar_set_color";
  part: AvatarBodyPart;
  paletteIndex: number;
}

/**
 * Client -> server: register a new account by email (EPIC 34).
 * Server generates a one-time display code (stub — not emailed), hashes it,
 * issues a session token, and returns both via `account_created`. If the
 * email is already registered, the server responds with
 * `account_login_result` (`reason: "code_required"`) instead of duplicating.
 */
export interface AccountRegisterMessage {
  type: "account_register";
  email: string;
}

/**
 * Client -> server: log in with email + display code (EPIC 34).
 * Code is treated like a password: verified against the stored hash only.
 */
export interface AccountLoginMessage {
  type: "account_login";
  email: string;
  code: string;
}

/**
 * Client -> server: resume a prior session from a stored bearer token (EPIC 34).
 * Used on page load so reconnects skip the email/code UI.
 */
export interface AccountSessionResumeMessage {
  type: "account_session_resume";
  token: string;
}

/**
 * Client -> server: issue a new login code for an existing email (EPIC 47).
 * Stub auth — no email delivery. Server replaces the stored bcrypt hash and
 * returns the new display code once via `account_reset_code_result`.
 * Rate-limited like `account_login`. Existing sessions are kept.
 */
export interface AccountResetCodeMessage {
  type: "account_reset_code";
  email: string;
}

/** EPIC 51: developer console command (client transport only — server validates IDDQD gate). */
export interface DevConsoleMessage {
  type: "dev_console";
  command: string;
}

export type ClientMessage =
  | PlayerInputMessage
  | FireEvent
  | SwitchWeaponEvent
  | JoinMessage
  | LeaveMatchMessage
  | LobbyBindNicknameMessage
  | EconomyEquipPetMessage
  | EconomyUnequipPetMessage
  | EconomySetPetColorMessage
  | EconomyHatchEggMessage
  | EconomyApplyStimulatorMessage
  | EconomySocketGemMessage
  | EconomyUnsocketGemMessage
  | EconomyEquipAmuletMessage
  | EconomyUnequipAmuletMessage
  | EconomyCraftAmuletMessage
  | EconomyRepairAmuletMessage
  | EconomyMoveItemMessage
  | EconomyDiscardItemMessage
  | EconomyDropItemMessage
  | EconomyPickupGroundMessage
  | EconomyAuctionListMessage
  | EconomyAuctionBidMessage
  | EconomyAuctionBuyoutMessage
  | EconomyAuctionBrowseMessage
  | EconomyTradeOpenMessage
  | EconomyTradeOfferMessage
  | EconomyTradeConfirmMessage
  | EconomyTradeCancelMessage
  | AvatarSetColorMessage
  | AccountRegisterMessage
  | AccountLoginMessage
  | AccountSessionResumeMessage
  | AccountResetCodeMessage
  | DevConsoleMessage;

/** A single player's authoritative, server-computed state as broadcast to all clients. */
export interface PlayerState {
  id: string;
  nickname: string;
  position: Vector3;
  yaw: number;
  /**
   * Current health, [0, maxHealth]. Baseline max is COMBAT.maxHealth; EPIC 24
   * pet health rating may raise the ceiling for this life.
   */
  health: number;
  /**
   * Effective max HP for this life (EPIC 24 / EPIC 55). Server-authoritative;
   * clients must render HUD current/max from this field — never invent max
   * from local pet ratings.
   */
  maxHealth: number;
  /**
   * Current armor, [0, maxArmor] (EPIC 7 "Health & Armor Pickups").
   * Absorbs damage before health on a confirmed hit (see server/src/
   * playerRegistry.ts fire()'s spillover math) and resets to 0 on respawn.
   * Broadcast the same way as health (continuous source of truth every
   * tick, not just on pickup) so a client's own HUD self-corrects even if it
   * missed an intermediate update.
   */
  armor: number;
  /**
   * Armor ceiling for HUD current/max (EPIC 55 / EPIC 56). Equals
   * max(COMBAT.maxArmor, petArmor): dog grants above 100 raise the ceiling
   * (e.g. 156/156); weaker dogs keep the 100 pickup cap (e.g. 22/100).
   * Server-authoritative — clients must not invent max from local pets.
   */
  maxArmor: number;
  /**
   * Currently equipped weapon, selected and enforced server-side. Broadcast
   * to everyone from EPIC 17 onward so remote avatars can visibly hold the
   * right weapon; this is an intentional cosmetic information reveal, not a
   * client-controlled gameplay input.
   */
  equippedWeapon: WeaponType;
  /**
   * EPIC 31: species of each currently-equipped pet, slot order [slot1,
   * slot2] (0-2 entries). Same precedent as equippedWeapon — a read-only,
   * server-computed cosmetic reveal for remote-avatar rendering, never a
   * client-controlled gameplay input. Populated for humans (from their
   * economy profile) and bots (from their in-memory loadout) alike.
   */
  equippedPetTypes: PetType[];
  /** EPIC 31: whether this player currently has an amulet equipped (enables pet slot 2). Same cosmetic-reveal precedent as equippedPetTypes. */
  hasAmulet: boolean;
  /**
   * EPIC 39: full companion visual state (type + palette index + left/right
   * side), slot order matching equippedPetTypes. Server-computed; clients
   * never invent sides/colors for other players. Cosmetic only.
   */
  equippedPetsVisual: EquippedPetVisual[];
  /**
   * EPIC 33: palette indices for head/torso/hands/legs. Same cosmetic-reveal
   * precedent as equippedWeapon / equippedPetTypes — server-computed,
   * read-only on the wire; clients never inject claimed colors for others.
   */
  avatarColors: AvatarColors;
  /** False while dead and waiting to respawn — server stops applying movement/combat for this player while false. */
  alive: boolean;
  /**
   * EPIC 36: server clock deadline (Date.now()-based) until which this player
   * is spawn-protected (invincible + rendered transparent). Clients compare
   * against WorldStateMessage.serverTimeMs every tick — never a local free-
   * running countdown. 0 or a past timestamp = not protected.
   */
  spawnProtectedUntilMs: number;
}

/** Full world snapshot, broadcast to every connected client on a fixed server tick. */
export interface WorldStateMessage {
  type: "world_state";
  serverTimeMs: number;
  players: PlayerState[];
}

/**
 * Server -> all clients: broadcast whenever a fire event resolves to a
 * confirmed hit (server/src/combat.ts). This is a one-shot notification for
 * driving edge-triggered cosmetic feedback (hit marker on the shooter's
 * screen, damage flash on the target's) — the ongoing source of truth for
 * "what is this player's health/alive state right now" is PlayerState in
 * WorldStateMessage, not this event (so a client that misses this message,
 * e.g. briefly disconnected, still ends up correct on the next world_state).
 */
export interface HitEvent {
  type: "hit";
  shooterId: string;
  targetId: string;
  damage: number;
  /** EPIC 18: where/why this damage was applied; cosmetic/debug context only. */
  hitZone?: DamageZone;
  damageKind?: DamageKind;
  /** Target's remaining health after this hit (0 if this hit was lethal). */
  targetHealth: number;
  /** World-space point the shot connected, for client-side hit-effect placement. */
  point: Vector3;
}

/** Server-computed visual trajectory for a fired shot/projectile. */
export interface ShotTrace {
  origin: Vector3;
  end: Vector3;
  speed: number;
}

/** Server -> all clients: a player's health reached 0. See HitEvent doc comment re: PlayerState being the continuous source of truth. */
export interface DeathEvent {
  type: "death";
  playerId: string;
  /** Id of the player whose shot was lethal, or null (should not normally happen for a combat death, but kept nullable for robustness). */
  killerId: string | null;
  /** Server timestamp (Date.now()-based) at which this player is expected to respawn. */
  respawnAtMs: number;
}

/** Server -> all clients: a previously-dead player has respawned. See HitEvent doc comment re: PlayerState being the continuous source of truth. */
export interface RespawnEvent {
  type: "respawn";
  playerId: string;
  position: Vector3;
  health: number;
}

/**
 * Server -> all clients: a kill happened (EPIC 5 Story 5.1). This is
 * strictly additive to DeathEvent above — reuses the exact same death
 * resolution in server/src/playerRegistry.ts's fire(), it does not introduce
 * a second health/death system. DeathEvent remains the source of truth for
 * "this player is dead and will respawn at X"; KillEvent exists purely to
 * drive a transient kill-feed line and is broadcast to EVERY connected
 * client, not just the attacker/victim, per the Story 5.1 acceptance
 * criterion ("visible feed entry on every connected client").
 */
export interface KillEvent {
  type: "kill";
  attackerId: string;
  victimId: string;
  attackerNickname: string;
  victimNickname: string;
}

/** One player's server-authoritative kill count, as shown on the scoreboard (EPIC 5 Story 5.2). */
export interface PlayerScore {
  id: string;
  nickname: string;
  kills: number;
}

export interface LeaderboardEntry {
  nickname: string;
  kills: number;
  deaths: number;
}

export interface EndlessLeaderboardEntry {
  nickname: string;
  botKills: number;
  distanceKm: number;
}

export interface LobbyStateMessage {
  type: "lobby_state";
  matches: LobbyMatchSummary[];
}

export interface JoinAcceptedMessage {
  type: "join_accepted";
  matchId: string;
  nickname: string;
  /** EPIC 47: server-owned map for this match (endless may omit / use procedural). */
  mapId?: MapId;
  mode?: MatchMode;
}

/**
 * Server -> client: leave_match succeeded; socket is back in lobby (EPIC 47).
 * Client should show mode-select and clear match-scoped UI state.
 */
export interface LeaveMatchAckMessage {
  type: "leave_match_ack";
}

export interface JoinRejectedMessage {
  type: "join_rejected";
  reason:
    | "nickname_invalid"
    | "nickname_taken"
    | "match_full"
    | "match_not_found"
    | "map_invalid";
}

export interface LeaderboardMessage {
  type: "leaderboard";
  entries: LeaderboardEntry[];
}

export interface EndlessLeaderboardMessage {
  type: "endless_leaderboard";
  entries: EndlessLeaderboardEntry[];
}

export interface MapStateMessage {
  type: "map_state";
  geometry: MapBox[];
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  /** EPIC 47: catalog map id when static; omitted for endless procedural chunks. */
  mapId?: MapId;
}

export interface EndlessStateMessage {
  type: "endless_state";
  fogZ: number;
  distanceMeters: number;
  botKills: number;
}

/**
 * Server -> all clients: the full current scoreboard (EPIC 5 Story 5.2),
 * broadcast whenever it changes (a kill, a player joining, a player
 * leaving) — event-driven like DeathEvent/RespawnEvent rather than sent
 * every tick, since kill counts change far less often than position. Always
 * carries the FULL list (not a delta), so a client that just joined — or
 * missed an earlier update — is correct immediately from the next message,
 * without needing to have observed every prior change.
 */
export interface ScoreboardMessage {
  type: "scoreboard";
  players: PlayerScore[];
}

/**
 * Server -> the OWNING player's socket only (never broadcast to everyone —
 * see EPIC 6 spec risk note / security-baseline.mdc "filter server -> client
 * payloads per player, not just per match"): this player's current equipped
 * weapon, its remaining ammo, and the full set of weapons owned. Sent
 * whenever any of those change (initial spawn, weapon/ammo pickup, `E`
 * switch, ammo decrementing on fire) so the HUD (client/src/combatHud.ts)
 * always reflects the server's own authoritative loadout state — the client
 * never guesses or locally decrements its own ammo.
 */
export interface LoadoutMessage {
  type: "loadout";
  equippedWeapon: WeaponType;
  /** Remaining ammo for the currently equipped weapon, or null for an infinite-ammo weapon (the pistol). */
  ammo: number | null;
  /** Every weapon this player currently owns, in tier order (WEAPON_ORDER). Always includes "pistol". */
  ownedWeapons: WeaponType[];
}

/**
 * Server -> all clients: the full current on/off state of every pickup
 * spawn point (EPIC 6 Story 6.1/6.2), broadcast whenever any changes (a
 * pickup consumed, a pickup respawned) or a client freshly connects — same
 * "always the full list, never a delta" convention as ScoreboardMessage, for
 * the same reason (a client that just joined or missed an update is still
 * correct from the very next message). Static per-point identity
 * (category/weapon/position) lives in shared/src/pickups.ts's
 * PICKUP_SPAWN_POINTS and does not need to be re-sent — only the dynamic
 * `active` flag does.
 */
export interface PickupStateMessage {
  type: "pickup_state";
  pickups: PickupStatus[];
}

/**
 * Server -> all clients: someone in this match attempted to fire (EPIC 14
 * "Sound System" Story 14.4) — broadcast on EVERY fire attempt (hit, miss,
 * or dry), not just a landed hit, so every connected client can play that
 * shooter's weapon-specific gunshot sound. Purely presentational: carries
 * no aim/position/damage/outcome data and never affects hit resolution —
 * HitEvent remains the sole source of truth for "did this shot land and
 * what did it do". This is a minor, deliberate, accepted information
 * reveal (which weapon a given player currently holds), in the same spirit
 * as the already-accepted unfiltered position/health broadcast in
 * WorldStateMessage (docs/backlog.md "Accepted design decisions") — no
 * aim direction, exact hit outcome, or other gameplay-relevant secret is
 * exposed.
 */
export interface FireBroadcastEvent {
  type: "fire_broadcast";
  shooterId: string;
  weapon: WeaponType;
  /** EPIC 19: server-computed path used only for visible tracers/projectiles. */
  trace?: ShotTrace;
  /** Present only for server-simulated projectiles, currently grenade launcher shots. */
  projectileId?: string;
}

/** Server -> all clients: a server-simulated projectile hit geometry or a player. */
export interface ProjectileImpactEvent {
  type: "projectile_impact";
  projectileId: string;
  shooterId: string;
  weapon: WeaponType;
  point: Vector3;
}

/** Wire DTO for a durable pet row (EPIC 24/25/29/39). */
export interface EconomyPetDto {
  id: number;
  type: PetType;
  baseValue: number;
  /** Slot 1 default; slot 2 only when amulet equipped; null when unequipped. */
  equipSlot: 1 | 2 | null;
  /**
   * Bag grid left-cell anchor when unequipped; null when equipped (equip rail).
   * Footprint = 2 horizontal cells.
   */
  slotAnchor: number | null;
  /** EPIC 39: index into AVATAR_COLOR_PALETTE for companion mesh color. */
  colorIndex: number;
}

/** Wire DTO for an incubating egg (EPIC 24/29). Footprint = 1. */
export interface EconomyEggDto {
  id: number;
  hatchDeadlineMs: number;
  /** Bag anchor; null when unplaced/overflow (EPIC 53). */
  slotAnchor: number | null;
}

/** Wire DTO for a gem (EPIC 25/29). `petId` null when unequipped / in bag. */
export interface EconomyGemDto {
  id: number;
  gemType: GemType;
  value: number;
  petId: number | null;
  /** Bag anchor when unequipped; null when socketed on a pet. */
  slotAnchor: number | null;
}

/** Wire DTO for an amulet (EPIC 25/29). Footprint = 2 when in bag. */
export interface EconomyAmuletDto {
  id: number;
  durability: number;
  equipped: boolean;
  /** Bag anchor when unequipped; null when on the equip rail. */
  slotAnchor: number | null;
}

/** Wire DTO for a growth stimulator bag row (EPIC 29). Footprint = 1. */
export interface EconomyStimulatorDto {
  id: number;
  /** Bag anchor; null when unplaced/overflow (EPIC 53). */
  slotAnchor: number | null;
}

/** Wire DTO for a repair kit bag row (EPIC 29). Footprint = 1. */
export interface EconomyRepairKitDto {
  id: number;
  /** Bag anchor; null when unplaced/overflow (EPIC 53). */
  slotAnchor: number | null;
}

/**
 * Server -> owning connection only (EPIC 23/24/25/29): full economy profile
 * snapshot for the player's nickname key. Sent on join and after equip /
 * hatch / stim / gem / amulet / item drops / move / discard.
 * All fields are server-authoritative.
 */
/** Which isolated economy pool a profile snapshot belongs to (EPIC 35). */
export type EconomyPool = "deathmatch" | "sandbox";

export interface EconomyProfileMessage {
  type: "economy_profile";
  nickname: string;
  /**
   * Server-authored pool label (EPIC 35). Derived from match mode on the
   * server — never client-supplied. Deathmatch = public PvP pool; Sandbox =
   * bots/endless pool. Pools never cross-contaminate.
   */
  economyPool: EconomyPool;
  gold: number;
  pets: EconomyPetDto[];
  eggs: EconomyEggDto[];
  stimulatorCount: number;
  /** Individual stimulator rows with grid anchors (EPIC 29). */
  stimulators: EconomyStimulatorDto[];
  gems: EconomyGemDto[];
  amulets: EconomyAmuletDto[];
  shardCount: number;
  /** Anchor of the single shard stack when shardCount > 0; else null. */
  shardSlotAnchor: number | null;
  repairKitCount: number;
  /** Individual repair kit rows with grid anchors (EPIC 29). */
  repairKits: EconomyRepairKitDto[];
  ratings: ProfileRatings;
  /** True when an amulet is equipped (enables pet slot 2 at 40%). */
  slot2Enabled: boolean;
}

/**
 * Server -> owning connection only (EPIC 23): gold balance after a grant
 * (e.g. kill reward). `gained` is the amount just minted; `gold` is the new
 * durable total. Private to the killer's socket — not broadcast.
 */
export interface EconomyGoldUpdateMessage {
  type: "economy_gold_update";
  gold: number;
  gained: number;
}

/**
 * Server-authored kill-loot kinds for world VFX (EPIC 44).
 * Only kinds the server actually granted for that kill — never client-invented.
 */
export type KillLootFxKind =
  | "gold"
  | "gem"
  | "shard"
  | "amulet"
  | "egg"
  | "stimulator"
  | "repair_kit";

/** One granted loot entry shown in kill-loot VFX (EPIC 44). */
export interface KillLootFxGrant {
  kind: KillLootFxKind;
  /** Optional cosmetic hint (e.g. gem type) — display only. */
  detail?: string;
}

/**
 * Server -> match broadcast (EPIC 44): cosmetic kill-loot flyout.
 * Lists only kinds actually minted/granted for this kill. Clients must not
 * invent extra kinds. Does not grant inventory — economy_* profile/gold
 * messages remain authoritative for bag/gold state.
 */
export interface EconomyKillLootFxMessage {
  type: "economy_kill_loot_fx";
  killerId: string;
  victimId: string;
  /** World positions at grant time (server registry). */
  victimPosition: Vector3;
  killerPosition: Vector3;
  grants: KillLootFxGrant[];
}

/**
 * Server -> owning connection only (EPIC 24/25/38): result of an economy action.
 * On success the server also pushes a fresh `economy_profile`.
 * On failure `ok` is false and `code` explains why.
 */
export interface EconomyActionResultMessage {
  type: "economy_action_result";
  action:
    | "equip"
    | "unequip"
    | "hatch"
    | "stimulator"
    | "socket_gem"
    | "unsocket_gem"
    | "equip_amulet"
    | "unequip_amulet"
    | "craft_amulet"
    | "repair_amulet"
    | "move_item"
    | "discard_item"
    | "drop_item"
    | "pickup_ground"
    | "auction_list"
    | "auction_bid"
    | "auction_buyout"
    | "auction_browse"
    | "trade_open"
    | "trade_offer"
    | "trade_confirm"
    | "trade_cancel"
    | "set_pet_color"
    | "lobby_bind";
  ok: boolean;
  code?: string;
}

/** Wire summary of an escrowed auction/trade/ground item (EPIC 38). */
export interface EconomyEscrowItemDto {
  itemType: InventoryItemType;
  /** Display id when applicable; 0 for shard_stack. */
  itemId: number;
  /** Shard stack quantity when itemType is shard_stack. */
  quantity?: number;
  /** Optional short label payload for UI (pet type, gem type, etc.). */
  label?: string;
  detail?: string;
}

/** Active auction lot (EPIC 38). */
export interface EconomyAuctionLotDto {
  lotId: number;
  sellerNickname: string;
  item: EconomyEscrowItemDto;
  startPrice: number;
  buyoutPrice: number | null;
  highestBid: number | null;
  highestBidderNickname: string | null;
  expiresAtMs: number;
  /** True when this connection's deathmatch profile is the seller. */
  isMine: boolean;
}

/** Server -> connection: auction catalog snapshot (EPIC 38). */
export interface EconomyAuctionStateMessage {
  type: "economy_auction_state";
  lots: EconomyAuctionLotDto[];
  developerGoldLedger: number;
}

/** Ground item visible in the current match (EPIC 38). */
export interface EconomyGroundItemDto {
  groundId: number;
  item: EconomyEscrowItemDto;
  position: Vector3;
  expiresAtMs: number;
  ownerPlayerId: string;
}

/** Server -> match: ground item list (EPIC 38). */
export interface EconomyGroundStateMessage {
  type: "economy_ground_state";
  items: EconomyGroundItemDto[];
}

/** Server -> both traders: current trade window state (EPIC 38). */
export interface EconomyTradeStateMessage {
  type: "economy_trade_state";
  tradeId: string;
  status: "open" | "completed" | "cancelled";
  partnerId: string;
  partnerNickname: string;
  you: {
    gold: number;
    items: EconomyEscrowItemDto[];
    confirmed: boolean;
  };
  partner: {
    gold: number;
    items: EconomyEscrowItemDto[];
    confirmed: boolean;
  };
}

/**
 * Server -> registering connection only (EPIC 34).
 * TEMPORARY stub: `code` is returned in plaintext because real email delivery
 * is not built yet. Future email delivery should stop including `code` here
 * and send it out-of-band instead — account/session model stays unchanged.
 */
export interface AccountCreatedMessage {
  type: "account_created";
  accountId: string;
  email: string;
  /** One-time display code (NNN-NNN). Never re-sent by the server. */
  code: string;
  token: string;
}

/** Failure / success reasons for account_login_result (EPIC 34). */
export type AccountLoginReason =
  | "invalid_credentials"
  | "rate_limited"
  | "code_required"
  | "invalid_email"
  | "already_authenticated";

/**
 * Server -> connection: login attempt result (EPIC 34).
 * Also used when `account_register` hits an already-registered email
 * (`reason: "code_required"`) so the client can prompt for the code.
 * Failures use generic reasons — do not reveal whether the email exists.
 */
export interface AccountLoginResultMessage {
  type: "account_login_result";
  ok: boolean;
  accountId?: string;
  email?: string;
  token?: string;
  reason?: AccountLoginReason;
}

/** Failure reasons for account_session_result (EPIC 34). */
export type AccountSessionReason = "invalid_token" | "already_authenticated";

/**
 * Server -> connection: session resume result (EPIC 34).
 * On success returns account identity so the client can skip the email/code UI.
 */
export interface AccountSessionResultMessage {
  type: "account_session_result";
  ok: boolean;
  accountId?: string;
  email?: string;
  reason?: AccountSessionReason;
}

/** Failure reasons for account_reset_code_result (EPIC 47). */
export type AccountResetCodeReason =
  | "invalid_credentials"
  | "rate_limited"
  | "invalid_email"
  | "already_authenticated";

/**
 * Server -> connection: result of `account_reset_code` (EPIC 47).
 * TEMPORARY stub: on success `code` is returned in plaintext (not emailed).
 * Existing sessions stay valid. Failures use generic reasons when possible.
 */
export interface AccountResetCodeResultMessage {
  type: "account_reset_code_result";
  ok: boolean;
  email?: string;
  /** New one-time display code (NNN-NNN). Shown on screen only — not emailed. */
  code?: string;
  reason?: AccountResetCodeReason;
}

/** EPIC 51: feedback for a dev console command. */
export interface DevConsoleResultMessage {
  type: "dev_console_result";
  ok: boolean;
  message: string;
}

export type ServerMessage =
  | WelcomeMessage
  | WorldStateMessage
  | HitEvent
  | DeathEvent
  | RespawnEvent
  | KillEvent
  | ScoreboardMessage
  | LeaderboardMessage
  | EndlessLeaderboardMessage
  | EndlessStateMessage
  | MapStateMessage
  | LobbyStateMessage
  | JoinAcceptedMessage
  | LeaveMatchAckMessage
  | JoinRejectedMessage
  | LoadoutMessage
  | PickupStateMessage
  | FireBroadcastEvent
  | ProjectileImpactEvent
  | EconomyProfileMessage
  | EconomyGoldUpdateMessage
  | EconomyKillLootFxMessage
  | EconomyActionResultMessage
  | EconomyAuctionStateMessage
  | EconomyGroundStateMessage
  | EconomyTradeStateMessage
  | AccountCreatedMessage
  | AccountLoginResultMessage
  | AccountSessionResultMessage
  | AccountResetCodeResultMessage
  | DevConsoleResultMessage;
