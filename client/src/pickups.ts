// Renders weapon/ammo/health/armor pickups in the 3D world (EPIC 6 / 7 / 10 /
// 30 / 60). Static identity comes from shared spawn lists and colors; this
// class only toggles visibility from server PickupStateMessage broadcasts.
//
// EPIC 60: weapon pickups use shared weaponMeshes builders (same family as
// FP/TP holds). Armor rebuilt as a clearer vest/breastplate with straps and
// shoulder pads.

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
import { buildWeaponMesh } from "./weaponMeshes";

/** Ammo pickup: a small crate, visually distinct from weapon composites. */
const AMMO_MESH_SIZE = { x: 0.55, y: 0.55, z: 0.55 };
const AMMO_MESH_CENTER_Y = AMMO_MESH_SIZE.y / 2;
const AMMO_CRATE_BODY_COLOR = 0x5a4a36;
const AMMO_LID_SIZE = { x: 0.59, y: 0.1, z: 0.59 };

/** Health pickup: white medkit with red cross. */
const HEALTH_MESH_SIZE = { x: 0.6, y: 0.4, z: 0.6 };
const HEALTH_MESH_CENTER_Y = HEALTH_MESH_SIZE.y / 2;
const HEALTH_CROSS_BAR_SIZE = { x: 0.44, y: 0.08, z: 0.12 };

/** Armor vest trim / strap colors. */
const ARMOR_TRIM_COLOR = 0xb9c2cc;
const ARMOR_STRAP_COLOR = 0x5a3d28;
const ARMOR_VEST_CENTER_Y = 0.55;

/**
 * EPIC 60 Story 60.4: clear vest / breastplate — torso plate, side panels,
 * shoulder pads, collar, and crossed straps. Distinct from health (red cross)
 * and ammo crates.
 */
function buildArmorVest(): THREE.Group {
  const group = new THREE.Group();
  group.position.y = ARMOR_VEST_CENTER_Y;

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: ARMOR_PICKUP_COLOR,
    emissive: ARMOR_PICKUP_COLOR,
    emissiveIntensity: 0.28,
    metalness: 0.35,
    roughness: 0.45,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: ARMOR_TRIM_COLOR,
    emissive: ARMOR_TRIM_COLOR,
    emissiveIntensity: 0.12,
    metalness: 0.65,
    roughness: 0.35,
  });
  const strapMaterial = new THREE.MeshStandardMaterial({ color: ARMOR_STRAP_COLOR, roughness: 0.9 });

  // Main breastplate
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.72, 0.16), baseMaterial);
  group.add(plate);

  // Side panels (vest wrap)
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.28), baseMaterial);
  sideL.position.set(-0.32, -0.02, 0);
  const sideR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.28), baseMaterial);
  sideR.position.set(0.32, -0.02, 0);
  group.add(sideL, sideR);

  // Collar / neck guard
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.18), baseMaterial);
  collar.position.set(0, 0.4, 0.02);
  group.add(collar);

  // Shoulder pads
  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.26), trimMaterial);
  shoulderL.position.set(-0.28, 0.38, 0);
  const shoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.26), trimMaterial);
  shoulderR.position.set(0.28, 0.38, 0);
  group.add(shoulderL, shoulderR);

  // Center ridge / sternum plate
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.58, 0.05), trimMaterial);
  ridge.position.set(0, 0.02, 0.1);
  group.add(ridge);

  // Crossed straps (X)
  const strapA = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.04), strapMaterial);
  strapA.position.set(0, 0.08, 0.11);
  strapA.rotation.z = 0.55;
  const strapB = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.04), strapMaterial);
  strapB.position.set(0, 0.08, 0.11);
  strapB.rotation.z = -0.55;
  group.add(strapA, strapB);

  // Waist belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.2), strapMaterial);
  belt.position.set(0, -0.32, 0);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.06), trimMaterial);
  buckle.position.set(0, -0.32, 0.12);
  group.add(belt, buckle);

  // Corner rivets
  const rivetOffsets: Array<[number, number]> = [
    [-0.22, 0.28],
    [0.22, 0.28],
    [-0.22, -0.22],
    [0.22, -0.22],
  ];
  for (const [rx, ry] of rivetOffsets) {
    const rivet = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), trimMaterial);
    rivet.position.set(rx, ry, 0.1);
    group.add(rivet);
  }

  return group;
}

export interface PickupRendererOptions {
  onConsumed?: (point: PickupSpawnPoint) => void;
}

export class PickupRenderer {
  private meshes = new Map<string, THREE.Object3D>();
  private pointsById = new Map<string, PickupSpawnPoint>();
  private previousActive = new Map<string, boolean>();
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
      return buildArmorVest();
    }

    if (category === "weapon" && weapon) {
      // Same silhouette family as FP viewmodel / remote props (EPIC 60 T60.1/T60.4).
      return buildWeaponMesh(weapon, "world").group;
    }

    // ammo crate
    const color = WEAPON_STATS[weapon as WeaponType].color;
    const group = new THREE.Group();
    group.position.y = AMMO_MESH_CENTER_Y;

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: AMMO_CRATE_BODY_COLOR, roughness: 0.9 });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(AMMO_MESH_SIZE.x, AMMO_MESH_SIZE.y, AMMO_MESH_SIZE.z),
      bodyMaterial,
    );
    group.add(body);

    const lidMaterial = new THREE.MeshStandardMaterial({ color });
    const lid = new THREE.Mesh(new THREE.BoxGeometry(AMMO_LID_SIZE.x, AMMO_LID_SIZE.y, AMMO_LID_SIZE.z), lidMaterial);
    lid.position.y = AMMO_MESH_SIZE.y / 2 + AMMO_LID_SIZE.y / 2 - 0.02;
    group.add(lid);

    return group;
  }

  sync(pickups: PickupStatus[]): void {
    const liveIds = new Set(pickups.map((status) => status.id));
    for (const [id, mesh] of this.meshes) {
      if (liveIds.has(id)) continue;
      this.scene.remove(mesh);
      this.meshes.delete(id);
      this.pointsById.delete(id);
      this.previousActive.delete(id);
    }

    for (const status of pickups) {
      if (!this.meshes.has(status.id) && status.category && status.position) {
        const point: PickupSpawnPoint = {
          id: status.id,
          category: status.category,
          weapon: status.weapon,
          position: status.position,
        };
        const object = this.buildMesh(point.category, point.weapon);
        object.position.set(point.position.x, object.position.y, point.position.z);
        object.name = point.id;
        this.scene.add(object);
        this.meshes.set(point.id, object);
        this.pointsById.set(point.id, point);
      }

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
