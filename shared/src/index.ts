// Protocol types shared between client and server.
// Consumed directly as TypeScript source (no build step) by both Vite (client)
// and tsx (server) — keep this package dependency-free and framework-agnostic.

import type { Vector3 } from "./types.js";
export type { Vector3 } from "./types.js";
// EPIC 3 "The Arena": the single source of truth for map geometry, spawn
// points, and their collision resolution — see mapData.ts / collision.ts
// doc comments. Re-exported here so both client and server keep importing
// everything from "@cubewars/shared" (this package's "main"/"types" entry).
export * from "./mapData.js";
export * from "./collision.js";
// EPIC 4 "Shooting & Combat": shared hitscan math/constants — see
// combat.ts doc comment.
export * from "./combat.js";

export const PROTOCOL_VERSION = 1;

// --- Movement tuning (shared so client prediction and the server's
// authoritative simulation agree on the same constants — one definition,
// not duplicated per EPIC 2 Story 2.2). ---
export const MOVEMENT = {
  /** Ground horizontal move speed, m/s. */
  maxSpeed: 5,
  /** Initial vertical velocity applied on jump, m/s. */
  jumpSpeed: 6,
  /** Downward acceleration, m/s^2. */
  gravity: 18,
  /** Ground plane height; player position.y never goes below this. */
  groundY: 0,
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
  /** Whether jump is being requested in this input sample. */
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

export type ClientMessage = PlayerInputMessage | FireEvent;

/** A single player's authoritative, server-computed state as broadcast to all clients. */
export interface PlayerState {
  id: string;
  position: Vector3;
  yaw: number;
  /** Current health, [0, COMBAT.maxHealth]. */
  health: number;
  /** False while dead and waiting to respawn — server stops applying movement/combat for this player while false. */
  alive: boolean;
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
  /** Target's remaining health after this hit (0 if this hit was lethal). */
  targetHealth: number;
  /** World-space point the shot connected, for client-side hit-effect placement. */
  point: Vector3;
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

export type ServerMessage = WelcomeMessage | WorldStateMessage | HitEvent | DeathEvent | RespawnEvent;
