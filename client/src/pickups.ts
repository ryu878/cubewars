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
// a distinct-silhouette composite mesh in the weapon's color; ammo pickups
// are a small crate in the SAME color family, so a player can tell "weapon
// vs. ammo for that weapon" apart at a glance without walking up to it.
// EPIC 7 adds two more, deliberately distinct from every weapon/ammo color
// AND from each other in both color and shape (Task 5 ask): health is a
// near-white box with a small red cross mark on top (medkit read), armor is
// a faceted plate/shield shape.
//
// EPIC 10 Story 10.3: the weapon and armor meshes below were redesigned from
// single primitives (a plain pillar box / octahedron) into small composite
// groups (2-3 primitives each) so each reads as a distinct silhouette, not
// just a differently-colored blob — pistol compact, rifle elongated, GL
// bulky, armor plate-like. This is a mesh-only change: PICKUP_RADIUS and all
// proximity/collision logic are untouched (server doesn't know or render
// pickup shape at all).
import * as THREE from "three";
import {
  ARMOR_PICKUP_COLOR,
  HEALTH_PICKUP_ACCENT_COLOR,
  HEALTH_PICKUP_COLOR,
  PICKUP_SPAWN_POINTS,
  WEAPON_STATS,
  type PickupSpawnPoint,
  type PickupStatus,
  type WeaponType,
} from "@cubewars/shared";

/** Ammo pickup: a small crate, visually distinct in both size and proportion from the weapon composites below. */
const AMMO_MESH_SIZE = { x: 0.55, y: 0.55, z: 0.55 };
const AMMO_MESH_CENTER_Y = AMMO_MESH_SIZE.y / 2;

/** Health pickup (EPIC 7): a small white medkit box, center-height similar to the ammo crate. */
const HEALTH_MESH_SIZE = { x: 0.6, y: 0.4, z: 0.6 };
const HEALTH_MESH_CENTER_Y = HEALTH_MESH_SIZE.y / 2;
/** The red cross mark sitting on top of the health box — two thin overlapping bars. */
const HEALTH_CROSS_BAR_SIZE = { x: 0.44, y: 0.08, z: 0.12 };

/** Armor pickup (EPIC 7 / redesigned EPIC 10): a flattened hexagonal "plate" disc plus a raised center boss, reading as a chest-plate/shield rather than a generic gem shape. */
const ARMOR_PLATE_RADIUS = 0.5;
const ARMOR_PLATE_DEPTH = 0.16;
const ARMOR_PLATE_CENTER_Y = 0.55;

/**
 * Composite weapon-pickup silhouettes (EPIC 10 Story 10.3): pistol is
 * compact/small, rifle is longer/elongated, grenade launcher is bulky
 * (thick radius) — each built from 2-3 primitives sharing one glowing
 * material per pickup (same "weapon pickups glow, ammo doesn't" discipline
 * as before).
 */
function buildWeaponPickupMesh(weaponType: WeaponType, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();

  if (weaponType === "pistol") {
    // Compact: short grip block + a slim stub barrel — smallest silhouette of the three.
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.4, 0.22), material);
    grip.position.set(0, 0.2, 0.06);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.42), material);
    barrel.position.set(0, 0.42, -0.12);
    group.add(grip, barrel);
    return group;
  }

  if (weaponType === "rifle") {
    // Elongated: stock + body + a protruding barrel — visibly longer than the pistol.
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.42), material);
    stock.position.set(0, 0.5, 0.32);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.55), material);
    body.position.set(0, 0.5, -0.15);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 10), material);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.5, -0.68);
    group.add(stock, body, barrel);
    return group;
  }

  // grenade_launcher — bulky: thick tube + wide muzzle, reads as "heavy weapon" via bulk, not length.
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.4), material);
  stock.position.set(0, 0.45, 0.25);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.75, 12), material);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.45, -0.2);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.15, 12), material);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.45, -0.65);
  group.add(stock, tube, muzzle);
  return group;
}

/**
 * EPIC 14 "Sound System" Story 14.5: optional constructor hook, fired the
 * instant sync() (below) observes one specific pickup's `active` flag
 * transition `true -> false` — never on `false -> false`/`true -> true`,
 * and never on this renderer's very first sync() call (so a client that
 * joins mid-match doesn't fire a burst of "consumed" events for points that
 * were already inactive before it connected). PickupRenderer stays a pure
 * renderer here too — it only detects the transition it already receives
 * from the server, it does NOT decide who gets to hear a sound for it; the
 * caller (main.ts) is responsible for any proximity-based attribution.
 */
export interface PickupRendererOptions {
  onConsumed?: (point: PickupSpawnPoint) => void;
}

export class PickupRenderer {
  private meshes = new Map<string, THREE.Object3D>();
  private pointsById = new Map<string, PickupSpawnPoint>();
  /** Last-seen `active` state per pickup id (EPIC 14 Story 14.5) — undefined until the first sync() call has observed that id at least once. */
  private previousActive = new Map<string, boolean>();
  /** True once sync() has been called at least once — guards the very first call from firing any onConsumed transition (see PickupRendererOptions doc comment above). */
  private hasSyncedOnce = false;

  constructor(
    private scene: THREE.Scene,
    private options: PickupRendererOptions = {},
  ) {
    for (const point of PICKUP_SPAWN_POINTS) {
      const object = this.buildMesh(point.category, point.weapon);
      object.position.set(point.position.x, object.position.y, point.position.z);
      object.name = point.id;
      this.scene.add(object);
      this.meshes.set(point.id, object);
      this.pointsById.set(point.id, point);
    }
  }

  private buildMesh(category: string, weapon: WeaponType | undefined): THREE.Object3D {
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
      // EPIC 10 Story 10.3: a flattened hexagonal "plate" disc (a low-radial-
      // segment cylinder, which renders as a faceted hex plate) plus a
      // raised center boss — reads as a chest-plate/shield rather than the
      // previous generic octahedron gem.
      const group = new THREE.Group();
      group.position.y = ARMOR_PLATE_CENTER_Y;

      const material = new THREE.MeshStandardMaterial({
        color: ARMOR_PICKUP_COLOR,
        emissive: ARMOR_PICKUP_COLOR,
        emissiveIntensity: 0.3,
      });
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(ARMOR_PLATE_RADIUS, ARMOR_PLATE_RADIUS, ARMOR_PLATE_DEPTH, 6), material);
      plate.rotation.x = Math.PI / 2;
      group.add(plate);

      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), material);
      boss.position.z = ARMOR_PLATE_DEPTH / 2 + 0.06;
      group.add(boss);

      return group;
    }

    // "weapon": composite, distinct-silhouette shapes per Story 10.3.
    if (category === "weapon" && weapon) {
      const color = WEAPON_STATS[weapon].color;
      // Weapon pickups glow slightly (emissive) so the silhouette reads
      // clearly against the sandy ground even at range; ammo crates (below)
      // stay a plain lit material to look visually smaller/more mundane.
      const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
      return buildWeaponPickupMesh(weapon, material);
    }

    // "ammo" (EPIC 6, unchanged behavior — a small crate in the weapon's color).
    const color = WEAPON_STATS[weapon as WeaponType].color;
    const geometry = new THREE.BoxGeometry(AMMO_MESH_SIZE.x, AMMO_MESH_SIZE.y, AMMO_MESH_SIZE.z);
    const material = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = AMMO_MESH_CENTER_Y;
    return mesh;
  }

  /**
   * Reconcile visibility against the server's latest pickup on/off state
   * (PickupStateMessage). EPIC 14 Story 14.5: also detects a per-id
   * `active: true -> false` transition and fires `onConsumed` for it — see
   * PickupRendererOptions doc comment above for the exact firing rule.
   */
  sync(pickups: PickupStatus[]): void {
    for (const status of pickups) {
      const mesh = this.meshes.get(status.id);
      if (mesh) mesh.visible = status.active;

      if (this.hasSyncedOnce) {
        const previous = this.previousActive.get(status.id);
        if (previous === true && status.active === false) {
          const point = this.pointsById.get(status.id);
          if (point) this.options.onConsumed?.(point);
        }
      }
      this.previousActive.set(status.id, status.active);
    }
    this.hasSyncedOnce = true;
  }
}
