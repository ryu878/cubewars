// Authoritative player registry + movement simulation.
// Deliberately transport-agnostic: no `ws` types here, only game/simulation
// state (per global-standards.mdc: keep game logic separate from transport).

import {
  MOVEMENT,
  SPAWN_POINTS,
  resolveHorizontalCollisions,
  type PlayerState,
  type Vector3,
} from "@cubewars/shared";

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

export interface PlayerRecord {
  id: string;
  position: Vector3;
  velocityY: number;
  grounded: boolean;
  yaw: number;
  /** Latest validated input intent — physics integrates from this every tick, not from raw message timing. */
  intent: {
    moveForward: number;
    moveRight: number;
    jump: boolean;
  };
}

export class PlayerRegistry {
  private players = new Map<string, PlayerRecord>();

  spawn(id: string): PlayerRecord {
    // Pick one of the arena's pre-checked spawn points (EPIC 3 Story 3.3 /
    // Task 5) and jitter a little so multiple players don't stack exactly
    // on top of each other, then re-resolve against the same collision
    // geometry used every simulation tick — a defensive guarantee that a
    // spawn can never land inside a wall/crate even if a future edit moves
    // SPAWN_POINTS closer to geometry than intended.
    const base = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    const jitterRadius = 2;
    const angle = Math.random() * Math.PI * 2;
    const jitterX = Math.cos(angle) * jitterRadius * Math.random();
    const jitterZ = Math.sin(angle) * jitterRadius * Math.random();
    const resolved = resolveHorizontalCollisions(base.x + jitterX, base.z + jitterZ);

    const record: PlayerRecord = {
      id,
      position: {
        x: resolved.x,
        y: MOVEMENT.groundY,
        z: resolved.z,
      },
      velocityY: 0,
      grounded: true,
      yaw: 0,
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
    raw: { moveForward: unknown; moveRight: unknown; yaw: unknown; jump: unknown },
  ): boolean {
    const player = this.players.get(id);
    if (!player) return false;

    if (
      typeof raw.moveForward !== "number" ||
      typeof raw.moveRight !== "number" ||
      typeof raw.yaw !== "number" ||
      typeof raw.jump !== "boolean" ||
      !Number.isFinite(raw.moveForward) ||
      !Number.isFinite(raw.moveRight) ||
      !Number.isFinite(raw.yaw)
    ) {
      return false;
    }

    player.intent.moveForward = clampUnit(raw.moveForward);
    player.intent.moveRight = clampUnit(raw.moveRight);
    player.intent.jump = raw.jump;
    player.yaw = normalizeYaw(raw.yaw, player.yaw);
    return true;
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
      });
    }
    return states;
  }
}

function clampBound(value: number): number {
  return Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, value));
}
