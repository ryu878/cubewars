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
  /** Whether jump is being requested in this input sample. */
  jump: boolean;
}

export type ClientMessage = PlayerInputMessage;

/** A single player's authoritative, server-computed state as broadcast to all clients. */
export interface PlayerState {
  id: string;
  position: Vector3;
  yaw: number;
}

/** Full world snapshot, broadcast to every connected client on a fixed server tick. */
export interface WorldStateMessage {
  type: "world_state";
  serverTimeMs: number;
  players: PlayerState[];
}

export type ServerMessage = WelcomeMessage | WorldStateMessage;
