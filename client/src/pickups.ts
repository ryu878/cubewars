// Renders weapon/ammo pickups in the 3D world (EPIC 6 Story 6.1/6.2). Static
// identity (position/category/weapon/color) comes entirely from the shared
// PICKUP_SPAWN_POINTS list (shared/src/pickups.ts) and WEAPON_STATS colors
// (shared/src/weapons.ts) — this class only toggles visibility from the
// server's PickupStateMessage broadcasts, it never decides pickup state
// itself (security-baseline.mdc: the client renders, the server decides).
//
// Visual/color identity per the EPIC 6 spec (Section 2): weapon pickups are
// a larger silhouette mesh in the weapon's color; ammo pickups are a small
// crate in the SAME color family, so a player can tell "weapon vs. ammo for
// that weapon" apart at a glance without walking up to it.

import * as THREE from "three";
import { PICKUP_SPAWN_POINTS, WEAPON_STATS, type PickupStatus } from "@cubewars/shared";

/** Weapon pickup: an upright pillar-like silhouette, tall enough to read as "a weapon stand" from a distance. */
const WEAPON_MESH_SIZE = { x: 0.5, y: 1.3, z: 0.5 };
const WEAPON_MESH_CENTER_Y = WEAPON_MESH_SIZE.y / 2;

/** Ammo pickup: a small crate, visually distinct in both size and proportion from the weapon pillar above. */
const AMMO_MESH_SIZE = { x: 0.55, y: 0.55, z: 0.55 };
const AMMO_MESH_CENTER_Y = AMMO_MESH_SIZE.y / 2;

export class PickupRenderer {
  private meshes = new Map<string, THREE.Mesh>();

  constructor(private scene: THREE.Scene) {
    for (const point of PICKUP_SPAWN_POINTS) {
      const color = WEAPON_STATS[point.weapon].color;
      const isWeapon = point.category === "weapon";
      const size = isWeapon ? WEAPON_MESH_SIZE : AMMO_MESH_SIZE;
      const centerY = isWeapon ? WEAPON_MESH_CENTER_Y : AMMO_MESH_CENTER_Y;

      const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      // Weapon pickups glow slightly (emissive) so the "bigger silhouette"
      // reads clearly against the sandy ground even at range; ammo crates
      // stay a plain lit material to look visually smaller/more mundane.
      const material = isWeapon
        ? new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
        : new THREE.MeshStandardMaterial({ color });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(point.position.x, centerY, point.position.z);
      mesh.name = point.id;
      this.scene.add(mesh);
      this.meshes.set(point.id, mesh);
    }
  }

  /** Reconcile visibility against the server's latest pickup on/off state (PickupStateMessage). */
  sync(pickups: PickupStatus[]): void {
    for (const status of pickups) {
      const mesh = this.meshes.get(status.id);
      if (mesh) mesh.visible = status.active;
    }
  }
}
