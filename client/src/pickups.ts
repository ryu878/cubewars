// Renders weapon/ammo/health/armor pickups in the 3D world (EPIC 6 Story
// 6.1/6.2, extended by EPIC 7 Story 7.1/7.2). Static identity (position/
// category/weapon/color) comes entirely from the shared PICKUP_SPAWN_POINTS
// list (shared/src/pickups.ts), WEAPON_STATS colors (shared/src/weapons.ts),
// and the EPIC 7 HEALTH_PICKUP_COLOR/ARMOR_PICKUP_COLOR constants
// (shared/src/pickups.ts) — this class only toggles visibility from the
// server's PickupStateMessage broadcasts, it never decides pickup state
// itself (security-baseline.mdc: the client renders, the server decides).
//
// Visual/color identity per the EPIC 6 spec (Section 2): weapon pickups are
// a larger silhouette mesh in the weapon's color; ammo pickups are a small
// crate in the SAME color family, so a player can tell "weapon vs. ammo for
// that weapon" apart at a glance without walking up to it. EPIC 7 adds two
// more, deliberately distinct from every weapon/ammo color AND from each
// other in both color and shape (Task 5 ask): health is a near-white box
// with a small red cross mark on top (medkit read), armor is a solid steel-
// blue octahedron (a shape used nowhere else in the world).
import * as THREE from "three";
import {
  ARMOR_PICKUP_COLOR,
  HEALTH_PICKUP_ACCENT_COLOR,
  HEALTH_PICKUP_COLOR,
  PICKUP_SPAWN_POINTS,
  WEAPON_STATS,
  type PickupStatus,
} from "@cubewars/shared";

/** Weapon pickup: an upright pillar-like silhouette, tall enough to read as "a weapon stand" from a distance. */
const WEAPON_MESH_SIZE = { x: 0.5, y: 1.3, z: 0.5 };
const WEAPON_MESH_CENTER_Y = WEAPON_MESH_SIZE.y / 2;

/** Ammo pickup: a small crate, visually distinct in both size and proportion from the weapon pillar above. */
const AMMO_MESH_SIZE = { x: 0.55, y: 0.55, z: 0.55 };
const AMMO_MESH_CENTER_Y = AMMO_MESH_SIZE.y / 2;

/** Health pickup (EPIC 7): a small white medkit box, center-height similar to the ammo crate. */
const HEALTH_MESH_SIZE = { x: 0.6, y: 0.4, z: 0.6 };
const HEALTH_MESH_CENTER_Y = HEALTH_MESH_SIZE.y / 2;
/** The red cross mark sitting on top of the health box — two thin overlapping bars. */
const HEALTH_CROSS_BAR_SIZE = { x: 0.44, y: 0.08, z: 0.12 };

/** Armor pickup (EPIC 7): an octahedron, a shape not used by any other pickup/geometry in the scene, floating a bit taller than the ammo crate to read as "bigger commitment" (4 needed for full armor). */
const ARMOR_MESH_RADIUS = 0.45;
const ARMOR_MESH_CENTER_Y = 0.65;

export class PickupRenderer {
  private meshes = new Map<string, THREE.Object3D>();

  constructor(private scene: THREE.Scene) {
    for (const point of PICKUP_SPAWN_POINTS) {
      const object = this.buildMesh(point.category, point.weapon);
      object.position.set(point.position.x, object.position.y, point.position.z);
      object.name = point.id;
      this.scene.add(object);
      this.meshes.set(point.id, object);
    }
  }

  private buildMesh(category: string, weapon: string | undefined): THREE.Object3D {
    if (category === "health") {
      const group = new THREE.Group();
      group.position.y = HEALTH_MESH_CENTER_Y;

      const baseGeometry = new THREE.BoxGeometry(HEALTH_MESH_SIZE.x, HEALTH_MESH_SIZE.y, HEALTH_MESH_SIZE.z);
      const baseMaterial = new THREE.MeshStandardMaterial({ color: HEALTH_PICKUP_COLOR });
      group.add(new THREE.Mesh(baseGeometry, baseMaterial));

      // Red cross mark: two thin bars crossed on the box's top face.
      const crossMaterial = new THREE.MeshStandardMaterial({
        color: HEALTH_PICKUP_ACCENT_COLOR,
        emissive: HEALTH_PICKUP_ACCENT_COLOR,
        emissiveIntensity: 0.4,
      });
      const crossY = HEALTH_MESH_SIZE.y / 2 + HEALTH_CROSS_BAR_SIZE.y / 2;
      const barGeometry = new THREE.BoxGeometry(
        HEALTH_CROSS_BAR_SIZE.x,
        HEALTH_CROSS_BAR_SIZE.y,
        HEALTH_CROSS_BAR_SIZE.z,
      );
      const barHorizontal = new THREE.Mesh(barGeometry, crossMaterial);
      barHorizontal.position.y = crossY;
      const barVertical = new THREE.Mesh(barGeometry, crossMaterial);
      barVertical.position.y = crossY;
      barVertical.rotation.y = Math.PI / 2;
      group.add(barHorizontal, barVertical);

      return group;
    }

    if (category === "armor") {
      const geometry = new THREE.OctahedronGeometry(ARMOR_MESH_RADIUS);
      const material = new THREE.MeshStandardMaterial({
        color: ARMOR_PICKUP_COLOR,
        emissive: ARMOR_PICKUP_COLOR,
        emissiveIntensity: 0.3,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = ARMOR_MESH_CENTER_Y;
      return mesh;
    }

    // "weapon" / "ammo" (EPIC 6, unchanged behavior).
    const color = WEAPON_STATS[weapon as keyof typeof WEAPON_STATS].color;
    const isWeapon = category === "weapon";
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
    mesh.position.y = centerY;
    return mesh;
  }

  /** Reconcile visibility against the server's latest pickup on/off state (PickupStateMessage). */
  sync(pickups: PickupStatus[]): void {
    for (const status of pickups) {
      const mesh = this.meshes.get(status.id);
      if (mesh) mesh.visible = status.active;
    }
  }
}
