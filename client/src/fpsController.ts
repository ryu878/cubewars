// First-person controls: pointer-lock mouse-look + WASD + jump, with local
// prediction for responsiveness. The server is the sole authority on the
// resulting position (security-baseline.mdc) — see reconcile().

import * as THREE from "three";
import { MOVEMENT, resolveHorizontalCollisions } from "@cubewars/shared";

const EYE_HEIGHT = 1.7;
const MOUSE_SENSITIVITY = 0.0025;
const MAX_PITCH = Math.PI / 2 - 0.05; // clamp so the player can't flip over

export interface InputIntent {
  moveForward: number;
  moveRight: number;
  yaw: number;
  jump: boolean;
}

export class FpsController {
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private locked = false;

  private position: { x: number; y: number; z: number } = { x: 0, y: MOVEMENT.groundY, z: 0 };
  private velocityY = 0;
  private grounded = true;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private domElement: HTMLElement,
  ) {
    this.camera.rotation.order = "YXZ";

    domElement.addEventListener("click", () => {
      domElement.requestPointerLock();
    });

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === domElement;
    });

    document.addEventListener("mousemove", (event) => {
      if (!this.locked) return;
      this.yaw -= event.movementX * MOUSE_SENSITIVITY;
      this.pitch -= event.movementY * MOUSE_SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    });

    window.addEventListener("keydown", (event) => this.keys.add(event.code));
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    // Avoid a "stuck key" if the window loses focus while a key is held.
    window.addEventListener("blur", () => this.keys.clear());
  }

  isLocked(): boolean {
    return this.locked;
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
    if (!this.locked) {
      // Still apply look rotation so a re-lock doesn't jump; no movement while unlocked.
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      return;
    }

    const { moveForward, moveRight } = this.readMoveIntent();
    const forwardX = -Math.sin(this.yaw);
    const forwardZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    const nextX = this.position.x + (forwardX * moveForward + rightX * moveRight) * MOVEMENT.maxSpeed * dt;
    const nextZ = this.position.z + (forwardZ * moveForward + rightZ * moveRight) * MOVEMENT.maxSpeed * dt;

    // Local collision prediction (EPIC 3 Story 3.3): resolve against the
    // same shared ARENA_GEOMETRY the server uses, so walking into a wall
    // stops the player immediately and responsively. This is a feel/
    // prediction layer only — reconcile() below still pulls the visual
    // position toward whatever the server's authoritative broadcast says,
    // exactly as EPIC 2 already does for the rest of movement.
    const resolved = resolveHorizontalCollisions(nextX, nextZ);
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    if (this.keys.has("Space") && this.grounded) {
      this.velocityY = MOVEMENT.jumpSpeed;
      this.grounded = false;
    }
    this.velocityY -= MOVEMENT.gravity * dt;
    this.position.y += this.velocityY * dt;
    if (this.position.y <= MOVEMENT.groundY) {
      this.position.y = MOVEMENT.groundY;
      this.velocityY = 0;
      this.grounded = true;
    }

    this.camera.position.set(this.position.x, this.position.y + EYE_HEIGHT, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** Current input intent to send to the server. This is intent only — the server computes the resulting position itself. */
  getInputIntent(): InputIntent {
    const { moveForward, moveRight } = this.readMoveIntent();
    return {
      moveForward,
      moveRight,
      yaw: this.yaw,
      jump: this.keys.has("Space"),
    };
  }
}
