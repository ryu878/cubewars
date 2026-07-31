// Renders/updates one capsule avatar per *other* connected player from the
// server's world-state broadcasts. First-person: the local player never
// renders their own avatar.

import * as THREE from "three";
import type { PlayerState } from "@cubewars/shared";

// Matches the EPIC 1 placeholder capsule (radius 0.5, length 1.2) and its
// ground placement (center at y=1.1 when feet are at y=0).
const CAPSULE_RADIUS = 0.5;
const CAPSULE_LENGTH = 1.2;
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
