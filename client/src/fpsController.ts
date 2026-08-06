// First-person controls: pointer-lock mouse-look + WASD + jump, with local
// prediction for responsiveness. The server is the sole authority on the
// resulting position (security-baseline.mdc) — see reconcile().

import * as THREE from "three";
import {
  BUNNY_HOP,
  ARENA_GEOMETRY,
  EYE_HEIGHT,
  MAX_PITCH,
  MOVEMENT,
  boxesBlockingAt,
  crateTopHeightAt,
  resolveSteppedMovement,
  type MapBox,
} from "@cubewars/shared";

const MOUSE_SENSITIVITY = 0.0025;

/**
 * EPIC 14 "Sound System" Story 14.3: minimum measured horizontal speed
 * (m/s) for isRunning() below to consider the player "actually moving" —
 * a small epsilon rather than a bare `> 0` check, so floating-point noise
 * from a fully-released movement key (or a single sub-pixel collision
 * nudge) can't keep the footstep cadence system alive indefinitely.
 * Comfortably below any real intentional-movement speed (MOVEMENT.maxSpeed
 * is 13.3 m/s) while still well above what idle jitter could produce.
 */
const RUNNING_SPEED_EPSILON_MPS = 0.05;

export interface InputIntent {
  moveForward: number;
  moveRight: number;
  yaw: number;
  pitch: number;
  jump: boolean;
}

export interface FpsControllerOptions {
  /** Called when the player clicks while pointer-locked and alive — i.e. a fire request (EPIC 4 Story 4.1). Not called for the click that merely engages pointer lock. */
  onFire?: () => void;
  /** EPIC 18: if true while the left mouse button is held, repeat onFire at getAutoFireIntervalMs(). */
  shouldAutoFire?: () => boolean;
  getAutoFireIntervalMs?: () => number;
  /**
   * EPIC 14 "Sound System" Story 14.2: called exactly once per genuine
   * ground-jump trigger — the branch in update() below where `Space` is
   * held while `grounded` was true this frame. NOT called for the EPIC 8
   * bunny-hop mid-air boost (the `spacePressed && !this.grounded &&
   * this.bunnyHopAvailable` branch above it) — that is a separate
   * mechanic with its own feel; the user's "jump grunt" ask maps to the
   * ground-jump trigger specifically.
   */
  onJump?: () => void;
}

export class FpsController {
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private locked = false;
  /** Server-confirmed alive state (see setAlive()) — client-side movement/fire prediction stops while dead, though the server enforces this independently regardless of what this flag says (security-baseline.mdc). */
  private alive = true;

  private position: { x: number; y: number; z: number } = { x: 0, y: MOVEMENT.groundY, z: 0 };
  private velocityY = 0;
  private grounded = true;
  /** EPIC 8 Story 8.2 local-prediction mirror of the server's bunny-hop gate — see server/src/playerRegistry.ts PlayerRecord.bunnyHopAvailable doc comment. Purely a feel/prediction aid; the server's own independent gate is authoritative (reconciled via reconcile() like the rest of movement). */
  private bunnyHopAvailable = true;
  /** One-shot latch set by the Space keydown listener below on a genuine (non-repeat) key-down, consumed by the next update() call — mirrors the server's applyInput()/stepPlayer() edge-detection so local prediction matches. */
  private spacePressPending = false;
  /** Local-prediction mirror of the server's airSpeedMultiplier (EPIC 8 Story 8.2) — 1 outside a boosted air-time. */
  private airSpeedMultiplier = 1;
  /**
   * EPIC 14 "Sound System" Story 14.3: this frame's ACTUAL horizontal
   * displacement magnitude / dt (m/s), measured AFTER collision resolution
   * — not the raw input-intent speed — so isRunning() below correctly
   * reads "not moving" when the player is holding a movement key but is
   * fully blocked by a wall (collision resolves to ~0 net displacement),
   * the same way it should read "not moving" when no key is held at all.
   * Reset to 0 in both early-return branches of update() (not locked,
   * dead) so a stale non-zero value from before pointer-lock was released
   * or the player died can never leak into isRunning().
   */
  private horizontalSpeedMps = 0;
  private fireHeld = false;
  private autoFireTimer: number | undefined;
  private collisionGeometry: readonly MapBox[] | undefined;

  private stopAutoFire(): void {
    this.fireHeld = false;
    if (this.autoFireTimer !== undefined) {
      window.clearInterval(this.autoFireTimer);
      this.autoFireTimer = undefined;
    }
  }

  private startAutoFire(): void {
    this.stopAutoFire();
    if (!(this.options.shouldAutoFire?.() ?? false)) return;
    this.fireHeld = true;
    const intervalMs = Math.max(1, this.options.getAutoFireIntervalMs?.() ?? 500);
    this.autoFireTimer = window.setInterval(() => {
      if (!this.locked || !this.alive || !this.fireHeld || !(this.options.shouldAutoFire?.() ?? false)) {
        this.stopAutoFire();
        return;
      }
      this.options.onFire?.();
    }, intervalMs);
  }

  constructor(
    private camera: THREE.PerspectiveCamera,
    private domElement: HTMLElement,
    private options: FpsControllerOptions = {},
  ) {
    this.camera.rotation.order = "YXZ";

    // Task 7 (EPIC 4, carried from EPIC 3 Critic note): apply the initial
    // position immediately instead of leaving the camera at THREE's raw
    // (0,0,0) world-origin default until the first locked update() call —
    // see the pre-lock branch of update() below for the rest of this fix.
    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);

    domElement.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      if (!this.locked) {
        domElement.requestPointerLock();
        return;
      }
      if (this.alive) {
        this.options.onFire?.();
        this.startAutoFire();
      }
    });
    window.addEventListener("mouseup", (event) => {
      if (event.button !== 0) return;
      this.stopAutoFire();
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === domElement;
      if (!this.locked) {
        this.stopAutoFire();
      }
    });

    document.addEventListener("mousemove", (event) => {
      if (!this.locked) return;
      this.yaw -= event.movementX * MOUSE_SENSITIVITY;
      this.pitch -= event.movementY * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    });

    window.addEventListener("keydown", (event) => {
      this.keys.add(event.code);
      // EPIC 8 Story 8.2: latch a genuine Space key-down (event.repeat
      // guards against the OS's own key-repeat firing this while held,
      // same guard style as the "E" weapon-switch handler in main.ts) for
      // update() to evaluate against the CURRENT grounded/bunnyHopAvailable
      // state next frame — this is prediction only, gated the same way the
      // server independently gates its own authoritative version
      // (locked + alive), never trusted as-is for anything another player
      // sees.
      if (event.code === "Space" && !event.repeat && this.locked && this.alive) {
        this.spacePressPending = true;
      }
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    // Avoid a "stuck key" if the window loses focus while a key is held.
    window.addEventListener("blur", () => this.keys.clear());
  }

  isLocked(): boolean {
    return this.locked;
  }

  setCollisionGeometry(geometry: readonly MapBox[]): void {
    this.collisionGeometry = geometry;
  }

  /** Update the locally-known alive state from the server's world_state broadcast (EPIC 4 Story 4.2) — gates local movement/fire prediction only; the server independently enforces this regardless of client state. */
  setAlive(alive: boolean): void {
    if (alive === false) {
      // EPIC 8: don't let a Space press queued right before death carry
      // over into a phantom boost prediction on the next life.
      this.spacePressPending = false;
      this.stopAutoFire();
    }
    this.alive = alive;
  }

  /**
   * Smoothly reconcile local prediction toward the server's authoritative
   * position for this player. Small drift is nudged (avoids visible
   * rubber-banding); large drift (e.g. right after spawn) snaps instantly.
   * This never lets the client's own prediction become what other players
   * see — that always comes from the server's broadcast.
   */
  reconcile(serverPosition: { x: number; y: number; z: number }): void {
    const dx = serverPosition.x - this.position.x;
    const dz = serverPosition.z - this.position.z;
    const drift = Math.hypot(dx, dz);
    if (drift > 3) {
      this.position.x = serverPosition.x;
      this.position.z = serverPosition.z;
    } else {
      this.position.x += dx * 0.1;
      this.position.z += dz * 0.1;
    }
    if (Math.abs(serverPosition.y - this.position.y) > 1) {
      this.position.y = serverPosition.y;
    }
  }

  private readMoveIntent(): { moveForward: number; moveRight: number } {
    let moveForward = 0;
    let moveRight = 0;
    if (this.keys.has("KeyW")) moveForward += 1;
    if (this.keys.has("KeyS")) moveForward -= 1;
    if (this.keys.has("KeyD")) moveRight += 1;
    if (this.keys.has("KeyA")) moveRight -= 1;
    const magnitude = Math.hypot(moveForward, moveRight);
    if (magnitude > 1) {
      moveForward /= magnitude;
      moveRight /= magnitude;
    }
    return { moveForward, moveRight };
  }

  /** Advance local prediction by dt seconds and apply it to the camera transform. */
  update(dt: number): void {
    // EPIC 8 Story 8.2: consume this frame's one-shot Space-keydown latch
    // unconditionally, up front, so it never lingers into a later frame
    // (e.g. across a not-locked/not-alive early return below) — mirrors the
    // server's own always-clear-every-tick discipline (playerRegistry.ts
    // stepPlayer()).
    const spacePressed = this.spacePressPending;
    this.spacePressPending = false;

    if (!this.locked) {
      // Task 7 fix (see constructor comment): keep the camera's position in
      // sync with `this.position` even while unlocked — previously this
      // branch only ever touched rotation, so if reconcile() updated
      // `this.position` from the server's world_state (e.g. moments after
      // connecting, well before the player has clicked to engage pointer
      // lock) the camera would visually stay frozen at wherever it was last
      // set (or THREE's world-origin default on the very first frame)
      // instead of showing the player's actual spawn point.
      this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      // EPIC 14 Story 14.3: not locked -> definitely not "running" (see
      // horizontalSpeedMps doc comment above).
      this.horizontalSpeedMps = 0;
      this.stopAutoFire();
      return;
    }

    if (!this.alive) {
      // Dead: no movement/physics prediction (server freezes this player
      // too, see server/src/playerRegistry.ts stepPlayer) — keep the
      // camera exactly where it died and still let it look around while
      // waiting to respawn.
      this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      // EPIC 14 Story 14.3: dead -> definitely not "running".
      this.horizontalSpeedMps = 0;
      this.stopAutoFire();
      return;
    }

    // EPIC 8 Story 8.2: predict the same one-boost-per-air-time bunny hop
    // the server computes authoritatively (server/src/playerRegistry.ts
    // stepPlayer()) — only fires on a genuine Space key-down (spacePressed,
    // never a held key) while airborne and not yet used this air-time.
    if (spacePressed && !this.grounded && this.bunnyHopAvailable) {
      this.bunnyHopAvailable = false;
      this.airSpeedMultiplier = BUNNY_HOP.speedMultiplier;
      this.velocityY += MOVEMENT.jumpSpeed * BUNNY_HOP.verticalBoostFraction;
    }

    const { moveForward, moveRight } = this.readMoveIntent();
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const dx = (forwardX * moveForward + rightX * moveRight) * MOVEMENT.maxSpeed * this.airSpeedMultiplier * dt;
    const dz = (forwardZ * moveForward + rightZ * moveRight) * MOVEMENT.maxSpeed * this.airSpeedMultiplier * dt;

    // Local collision prediction (EPIC 3 Story 3.3, sub-stepped since EPIC 11
    // Story 11.1, height-aware since EPIC 12 Story 12.1): resolve against
    // the same shared ARENA_GEOMETRY and the SAME resolveSteppedMovement()
    // helper the server's authoritative stepPlayer() uses, so walking into a
    // wall stops the player immediately and responsively — and, at the new
    // higher speeds, a wall hit mid-tick is caught the same way locally as
    // it is authoritatively (no new client/server mismatch). This is a
    // feel/prediction layer only — reconcile() below still pulls the visual
    // position toward whatever the server's authoritative broadcast says,
    // exactly as EPIC 2 already does for the rest of movement. Uses
    // boxesBlockingAt(feetY) at this frame's feet height (this.position.y,
    // before this frame's own vertical integration below) — same as the
    // server — so a crate the player is standing on/above does not block
    // them horizontally here either (EPIC 12 Story 12.1).
    const feetYThisFrame = this.position.y;
    const geometry = this.collisionGeometry ?? ARENA_GEOMETRY;
    const blockingBoxes = boxesBlockingAt(feetYThisFrame, geometry);
    const previousX = this.position.x;
    const previousZ = this.position.z;
    const resolved = resolveSteppedMovement(this.position.x, this.position.z, dx, dz, undefined, blockingBoxes);
    this.position.x = resolved.x;
    this.position.z = resolved.z;
    // EPIC 14 Story 14.3: measured from the POST-collision-resolution
    // displacement (see horizontalSpeedMps doc comment above), not the raw
    // dx/dz intent.
    this.horizontalSpeedMps =
      dt > 0 ? Math.hypot(this.position.x - previousX, this.position.z - previousZ) / dt : 0;

    if (this.keys.has("Space") && this.grounded) {
      this.velocityY = MOVEMENT.jumpSpeed;
      this.grounded = false;
      // EPIC 14 Story 14.2: fires exactly once per genuine ground-jump
      // trigger (this branch, mirrored 1:1 from the server's own
      // stepPlayer() jump trigger) — never for the separate bunny-hop
      // mid-air boost branch above.
      this.options.onJump?.();
    }
    this.velocityY -= MOVEMENT.gravity * dt;
    this.position.y += this.velocityY * dt;

    // Height-aware ground/crate-top support (EPIC 12 Story 12.2), mirroring
    // the server's stepPlayer() clamp exactly (same helper, same math) so
    // client-predicted and server-authoritative crate mount/dismount stay in
    // agreement — evaluated at this frame's POST-horizontal-resolution
    // (x, z).
    const groundHeight = Math.max(
      MOVEMENT.groundY,
      crateTopHeightAt(this.position.x, this.position.z, geometry),
    );

    if (this.position.y <= groundHeight) {
      this.position.y = groundHeight;
      this.velocityY = 0;
      this.grounded = true;
      // EPIC 8 Story 8.2: landing makes the bunny hop available again and
      // ends the boosted air-time's speed multiplier — mirrors the
      // server's stepPlayer() ground-clamp branch.
      this.bunnyHopAvailable = true;
      this.airSpeedMultiplier = 1;
    } else {
      // EPIC 12 Story 12.2: mirrors the server's required `else { grounded =
      // false }` branch exactly — a player who walks off a mounted crate's
      // edge locally (no jump input) must become airborne in the local
      // prediction too, or a locally-predicted (but not yet server-
      // confirmed) extra jump could fire before reconcile() catches up. See
      // server/src/playerRegistry.ts stepPlayer() for the full rationale.
      this.grounded = false;
    }

    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /**
   * EPIC 14 "Sound System" Story 14.3/14.5: true only while this player is
   * actively simulating ground movement — locked, alive, AND grounded.
   * Folds in `locked`/`alive` rather than exposing the raw private
   * `grounded` field alone, so a caller can never read a stale `true` left
   * over from just before pointer-lock was released or the player died
   * (both of update()'s early-return branches above leave `grounded`
   * untouched, but this accessor's own locked/alive check still correctly
   * reports `false` in either case).
   */
  isGrounded(): boolean {
    return this.locked && this.alive && this.grounded;
  }

  /**
   * EPIC 14 Story 14.3: true while isGrounded() AND actually displacing
   * horizontally this frame (see horizontalSpeedMps doc comment) — the
   * exact gate main.ts's footstep cadence system checks every render
   * frame ("footsteps play only while grounded AND moving").
   */
  isRunning(): boolean {
    return this.isGrounded() && this.horizontalSpeedMps > RUNNING_SPEED_EPSILON_MPS;
  }

  /**
   * EPIC 14 Story 14.5 (and 14.3): this client's own current predicted
   * position — needed for the pickup-proximity sound-attribution heuristic
   * in main.ts (see PICKUP_SOUND_RADIUS there). Returns a fresh copy, not a
   * live reference, so a caller can't accidentally mutate this
   * controller's internal prediction state.
   */
  getPosition(): { x: number; y: number; z: number } {
    return { x: this.position.x, y: this.position.y, z: this.position.z };
  }

  /** Current input intent to send to the server. This is intent only — the server computes the resulting position itself. */
  getInputIntent(): InputIntent {
    const { moveForward, moveRight } = this.readMoveIntent();
    return {
      moveForward,
      moveRight,
      yaw: this.yaw,
      pitch: this.pitch,
      jump: this.keys.has("Space"),
    };
  }
}
