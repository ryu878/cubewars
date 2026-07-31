// Authoritative player registry + movement simulation.
// Deliberately transport-agnostic: no `ws` types here, only game/simulation
// state (per global-standards.mdc: keep game logic separate from transport).

import {
  COMBAT,
  MAX_PITCH,
  MOVEMENT,
  SPAWN_POINTS,
  resolveHorizontalCollisions,
  type PlayerState,
  type Vector3,
} from "@cubewars/shared";
import { performHitscan } from "./combat.js";

/** Sanity bound so a malformed/runaway input can never send a player to infinity — a coarse outer clamp, independent of (and checked before) the precise wall/crate collision resolution below. */
const WORLD_BOUND = 200;

/** Clamp a value into [-1, 1] — defends against an out-of-range or malicious moveForward/moveRight. */
function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/** Wrap an arbitrary finite angle into (-PI, PI]. Non-finite input is treated as "no turn". */
function normalizeYaw(yaw: number, fallback: number): number {
  if (!Number.isFinite(yaw)) return fallback;
  const twoPi = Math.PI * 2;
  let wrapped = yaw % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

/** Clamp pitch to the same [-MAX_PITCH, MAX_PITCH] range the client's own mouse-look enforces (shared/src/combat.ts) — defends against a client claiming an aim angle its own controls could never produce. */
function clampPitch(pitch: number, fallback: number): number {
  if (!Number.isFinite(pitch)) return fallback;
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}

export interface PlayerRecord {
  id: string;
  position: Vector3;
  velocityY: number;
  grounded: boolean;
  yaw: number;
  /** Look pitch, radians, clamped to [-MAX_PITCH, MAX_PITCH]. Tracked continuously from input messages (see clampPitch) so the hitscan raycast always fires along the player's actual current aim. */
  pitch: number;
  /** Current health, [0, COMBAT.maxHealth]. */
  health: number;
  /** False while dead and waiting to respawn. */
  alive: boolean;
  /** Server timestamp (Date.now()-based) at which a dead player should respawn; null while alive. */
  respawnAtMs: number | null;
  /** Latest validated input intent — physics integrates from this every tick, not from raw message timing. */
  intent: {
    moveForward: number;
    moveRight: number;
    jump: boolean;
  };
}

export type FireOutcome =
  | { hit: false }
  | {
      hit: true;
      targetId: string;
      damage: number;
      targetHealth: number;
      point: Vector3;
      killed: boolean;
      respawnAtMs: number | null;
    };

export interface RespawnOutcome {
  playerId: string;
  position: Vector3;
  health: number;
}

export class PlayerRegistry {
  private players = new Map<string, PlayerRecord>();

  /**
   * Pick one of the arena's pre-checked spawn points (EPIC 3 Story 3.3 /
   * Task 5) and jitter a little so multiple players don't stack exactly on
   * top of each other, then re-resolve against the same collision geometry
   * used every simulation tick — a defensive guarantee that a spawn can
   * never land inside a wall/crate even if a future edit moves SPAWN_POINTS
   * closer to geometry than intended. Shared by both initial spawn() and
   * respawn (processRespawns()) so there is exactly one spawn-picking
   * implementation.
   */
  private pickSpawnPosition(): Vector3 {
    const base = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    const jitterRadius = 2;
    const angle = Math.random() * Math.PI * 2;
    const jitterX = Math.cos(angle) * jitterRadius * Math.random();
    const jitterZ = Math.sin(angle) * jitterRadius * Math.random();
    const resolved = resolveHorizontalCollisions(base.x + jitterX, base.z + jitterZ);
    return { x: resolved.x, y: MOVEMENT.groundY, z: resolved.z };
  }

  spawn(id: string): PlayerRecord {
    const record: PlayerRecord = {
      id,
      position: this.pickSpawnPosition(),
      velocityY: 0,
      grounded: true,
      yaw: 0,
      pitch: 0,
      health: COMBAT.maxHealth,
      alive: true,
      respawnAtMs: null,
      intent: { moveForward: 0, moveRight: 0, jump: false },
    };
    this.players.set(id, record);
    return record;
  }

  remove(id: string): void {
    this.players.delete(id);
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  isAlive(id: string): boolean {
    return this.players.get(id)?.alive ?? false;
  }

  size(): number {
    return this.players.size;
  }

  /**
   * Validate and apply a raw input payload's intent for a player. Returns
   * false (and applies nothing) if the payload is malformed — caller should
   * log this as an anomaly per security-baseline.mdc rather than trust it.
   */
  applyInput(
    id: string,
    raw: { moveForward: unknown; moveRight: unknown; yaw: unknown; pitch: unknown; jump: unknown },
  ): boolean {
    const player = this.players.get(id);
    if (!player) return false;

    if (
      typeof raw.moveForward !== "number" ||
      typeof raw.moveRight !== "number" ||
      typeof raw.yaw !== "number" ||
      typeof raw.pitch !== "number" ||
      typeof raw.jump !== "boolean" ||
      !Number.isFinite(raw.moveForward) ||
      !Number.isFinite(raw.moveRight) ||
      !Number.isFinite(raw.yaw) ||
      !Number.isFinite(raw.pitch)
    ) {
      return false;
    }

    player.intent.moveForward = clampUnit(raw.moveForward);
    player.intent.moveRight = clampUnit(raw.moveRight);
    player.intent.jump = raw.jump;
    player.yaw = normalizeYaw(raw.yaw, player.yaw);
    player.pitch = clampPitch(raw.pitch, player.pitch);
    return true;
  }

  /**
   * Resolve a fire event for `shooterId` using the server's own
   * authoritative hitscan (server/src/combat.ts). Returns `{ hit: false }`
   * if the shooter doesn't exist, is dead, or the ray didn't connect with
   * another player (miss or blocked by geometry) — the caller (index.ts)
   * only broadcasts a HitEvent/DeathEvent when `hit` is true, so a client
   * can never make itself or anyone else take damage by merely claiming a
   * hit (security-baseline.mdc).
   */
  fire(shooterId: string): FireOutcome {
    const shooter = this.players.get(shooterId);
    if (!shooter || !shooter.alive) return { hit: false };

    const result = performHitscan(shooter, this.players.values());
    if (!result.hitPlayerId || !result.point) return { hit: false };

    const target = this.players.get(result.hitPlayerId);
    if (!target || !target.alive) return { hit: false }; // defensive: target could not exist / already dead

    target.health = Math.max(0, target.health - COMBAT.damagePerHit);
    let killed = false;
    if (target.health <= 0) {
      target.alive = false;
      target.respawnAtMs = Date.now() + COMBAT.respawnDelayMs;
      killed = true;
    }

    return {
      hit: true,
      targetId: target.id,
      damage: COMBAT.damagePerHit,
      targetHealth: target.health,
      point: result.point,
      killed,
      respawnAtMs: target.respawnAtMs,
    };
  }

  /**
   * Check every dead player's respawn timer against `nowMs` (server clock)
   * and respawn any that are due: full health, a fresh spawn position
   * (same pool/collision-safety as spawn()), cleared intent (so a stale
   * held key from before death can't trigger an instant post-respawn jump).
   * Returns the set of respawns that happened this call, for the caller to
   * broadcast as RespawnEvent messages.
   */
  processRespawns(nowMs: number): RespawnOutcome[] {
    const outcomes: RespawnOutcome[] = [];
    for (const player of this.players.values()) {
      if (player.alive || player.respawnAtMs === null) continue;
      if (nowMs < player.respawnAtMs) continue;

      player.position = this.pickSpawnPosition();
      player.velocityY = 0;
      player.grounded = true;
      player.health = COMBAT.maxHealth;
      player.alive = true;
      player.respawnAtMs = null;
      player.intent = { moveForward: 0, moveRight: 0, jump: false };

      outcomes.push({ playerId: player.id, position: { ...player.position }, health: player.health });
    }
    return outcomes;
  }

  /**
   * Advance the whole simulation by one fixed tick. dtSeconds is the
   * server's own fixed tick duration — never derived from client-reported
   * timing, so a client cannot speed up its own simulation by sending a
   * fabricated delta.
   */
  step(dtSeconds: number): void {
    for (const player of this.players.values()) {
      this.stepPlayer(player, dtSeconds);
    }
  }

  private stepPlayer(player: PlayerRecord, dt: number): void {
    // Story 4.2 AC: "A player reduced to 0 health stops being able to
    // move ... until respawn" — frozen in place entirely (including
    // gravity) while dead. Harmless visually since dead players' avatars
    // are hidden client-side (client/src/remotePlayers.ts).
    if (!player.alive) return;

    const { intent } = player;

    // Clamp combined move-intent to unit length so diagonal movement (W+D)
    // cannot exceed maxSpeed — this is the server-side speed clamp.
    let moveForward = intent.moveForward;
    let moveRight = intent.moveRight;
    const magnitude = Math.hypot(moveForward, moveRight);
    if (magnitude > 1) {
      moveForward /= magnitude;
      moveRight /= magnitude;
    }

    // Project local move-intent into world space using the player's yaw.
    // Matches three.js's rotation.y convention (forward = -sin/-cos, right = cos/-sin)
    // so client-side prediction and this authoritative simulation agree visually.
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);

    const dx = (forwardX * moveForward + rightX * moveRight) * MOVEMENT.maxSpeed * dt;
    const dz = (forwardZ * moveForward + rightZ * moveRight) * MOVEMENT.maxSpeed * dt;

    // Authoritative collision (EPIC 3 Story 3.3): resolve the proposed
    // position against the exact same ARENA_GEOMETRY the client renders
    // and predicts against. This is what actually matters for anti-cheat —
    // no matter what the client's own prediction claims, the position
    // broadcast to every player is clamped clear of every wall/crate here.
    const proposedX = clampBound(player.position.x + dx);
    const proposedZ = clampBound(player.position.z + dz);
    const resolved = resolveHorizontalCollisions(proposedX, proposedZ);
    player.position.x = resolved.x;
    player.position.z = resolved.z;

    // Vertical: gravity + jump, simple ground clamp (map geometry is not
    // height-aware for collision purposes — see collision.ts doc comment).
    if (intent.jump && player.grounded) {
      player.velocityY = MOVEMENT.jumpSpeed;
      player.grounded = false;
    }
    player.velocityY -= MOVEMENT.gravity * dt;
    player.position.y += player.velocityY * dt;

    if (player.position.y <= MOVEMENT.groundY) {
      player.position.y = MOVEMENT.groundY;
      player.velocityY = 0;
      player.grounded = true;
    }
  }

  toWorldState(): PlayerState[] {
    const states: PlayerState[] = [];
    for (const player of this.players.values()) {
      states.push({
        id: player.id,
        position: { ...player.position },
        yaw: player.yaw,
        health: player.health,
        alive: player.alive,
      });
    }
    return states;
  }
}

function clampBound(value: number): number {
  return Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, value));
}
