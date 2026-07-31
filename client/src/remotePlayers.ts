// Renders/updates one capsule avatar per *other* connected player from the
// server's world-state broadcasts. First-person: the local player never
// renders their own avatar.

import * as THREE from "three";
import { PLAYER_HITBOX_CYLINDER_LENGTH, PLAYER_HITBOX_RADIUS, type PlayerState } from "@cubewars/shared";

// Matches the EPIC 1 placeholder capsule (radius 0.5, length 1.2) and its
// ground placement (center at y=1.1 when feet are at y=0). Radius/length are
// imported from shared/src/combat.ts so the server's hitscan AABB
// approximation (playerHitboxBounds()) matches exactly what's rendered here
// — one set of dimensions, not duplicated (EPIC 4 Story 4.1 risk note).
const CAPSULE_RADIUS = PLAYER_HITBOX_RADIUS;
const CAPSULE_LENGTH = PLAYER_HITBOX_CYLINDER_LENGTH;
const CAPSULE_CENTER_Y = CAPSULE_RADIUS + CAPSULE_LENGTH / 2;

export class RemotePlayers {
  private meshes = new Map<string, THREE.Mesh>();
  private geometry = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 4, 8);
  private material = new THREE.MeshStandardMaterial({ color: 0xe63946 });

  constructor(private scene: THREE.Scene) {}

  /** Reconcile rendered avatars against the latest world-state snapshot. */
  sync(players: PlayerState[], selfId: string | null): void {
    const seen = new Set<string>();

    for (const player of players) {
      if (player.id === selfId) continue;
      seen.add(player.id);

      let mesh = this.meshes.get(player.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometry, this.material);
        this.scene.add(mesh);
        this.meshes.set(player.id, mesh);
      }
      mesh.position.set(player.position.x, player.position.y + CAPSULE_CENTER_Y, player.position.z);
      mesh.rotation.y = player.yaw;
      // EPIC 4 Story 4.2 AC: "Other clients see the death (avatar
      // disappears/changes state) and the respawn (avatar reappears)".
      // Driven directly by the continuous alive flag in world_state (not a
      // one-off event) so a client that joins/reconnects mid-death still
      // renders the correct state immediately, without needing to have
      // observed the original DeathEvent.
      mesh.visible = player.alive;
    }

    // Anyone missing from this snapshot (disconnected) loses their avatar.
    for (const [id, mesh] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.meshes.delete(id);
      }
    }
  }
}
