// Shared weapon mesh builders (EPIC 60 Story 60.1) — one silhouette family for
// first-person viewmodel, remote third-person props, and world ground pickups.
// Client cosmetics only; materials are owned by the caller (dispose on teardown).

import * as THREE from "three";
import { WEAPON_STATS, type WeaponType } from "@cubewars/shared";

/** Placement context — scales / lift / emissive differ; geometry family stays the same. */
export type WeaponMeshContext = "fp" | "tp" | "world";

/** Shared neutral gunmetal trim — never a weapon's primary identity color. */
export const WEAPON_METAL_ACCENT = 0x3a3f45;

export interface GripSockets {
  /** Local position where the right palm sits on the grip. */
  rightGrip: THREE.Vector3;
  /** Local foregrip / barrel support for two-hand weapons; null for pistol. */
  leftGrip: THREE.Vector3 | null;
}

export interface TrackedMaterial {
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
}

export interface WeaponMeshBuild {
  group: THREE.Group;
  materials: TrackedMaterial[];
  /** Muzzle flash (FP only); null for tp/world. */
  flashMesh: THREE.Mesh | null;
  flashMaterial: THREE.MeshBasicMaterial | null;
  sockets: GripSockets;
}

const CONTEXT_SCALE: Record<WeaponMeshContext, number> = {
  fp: 1,
  tp: 0.82,
  world: 1.65,
};

/** World pickups sit above the ground plane so the silhouette clears the floor. */
const WORLD_Y_LIFT = 0.42;

function darken(color: number, factor: number): number {
  return new THREE.Color(color).multiplyScalar(factor).getHex();
}

function track(
  list: TrackedMaterial[],
  material: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  list.push({ material, baseColor: material.color.clone() });
  return material;
}

function makeMats(
  color: number,
  context: WeaponMeshContext,
  list: TrackedMaterial[],
): {
  body: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
} {
  const glow = context === "world";
  const body = track(
    list,
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.35,
      roughness: 0.5,
      ...(glow ? { emissive: color, emissiveIntensity: 0.32 } : {}),
    }),
  );
  const accentHex = darken(color, 0.4);
  const accent = track(
    list,
    new THREE.MeshStandardMaterial({
      color: accentHex,
      metalness: 0.25,
      roughness: 0.7,
      ...(glow ? { emissive: accentHex, emissiveIntensity: 0.18 } : {}),
    }),
  );
  const metal = track(
    list,
    new THREE.MeshStandardMaterial({
      color: WEAPON_METAL_ACCENT,
      metalness: 0.85,
      roughness: 0.3,
    }),
  );
  return { body, accent, metal };
}

function makeFlash(
  color: number,
  radius: number,
): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 8), material);
  mesh.visible = false;
  mesh.renderOrder = 999;
  return { mesh, material };
}

function buildPistol(color: number, context: WeaponMeshContext): WeaponMeshBuild {
  const group = new THREE.Group();
  group.name = "weapon:pistol";
  const materials: TrackedMaterial[] = [];
  const { body, accent, metal } = makeMats(color, context, materials);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.16, 0.085), accent);
  grip.position.set(0, -0.095, 0.035);
  grip.rotation.x = 0.22;

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.075, 0.3), body);
  slide.position.set(0, 0.025, -0.1);

  const slideRails = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.02, 0.22), metal);
  slideRails.position.set(0, 0.055, -0.08);

  const barrelTip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.045, 0.055), metal);
  barrelTip.position.set(0, 0.025, -0.27);

  const sightRear = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.02), metal);
  sightRear.position.set(0, 0.075, 0.04);
  const sightFront = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.03, 0.015), metal);
  sightFront.position.set(0, 0.07, -0.22);

  const triggerGuard = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.09), accent);
  triggerGuard.position.set(0, -0.025, 0.015);

  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.05), accent);
  magazine.position.set(0, -0.14, 0.02);

  group.add(grip, slide, slideRails, barrelTip, sightRear, sightFront, triggerGuard, magazine);

  let flashMesh: THREE.Mesh | null = null;
  let flashMaterial: THREE.MeshBasicMaterial | null = null;
  if (context === "fp") {
    const flash = makeFlash(0xfff2b0, 0.055);
    flash.mesh.position.set(0, 0.03, -0.3);
    group.add(flash.mesh);
    flashMesh = flash.mesh;
    flashMaterial = flash.material;
  }

  return {
    group,
    materials,
    flashMesh,
    flashMaterial,
    sockets: {
      rightGrip: new THREE.Vector3(0.02, -0.1, 0.04),
      leftGrip: null,
    },
  };
}

function buildRifle(color: number, context: WeaponMeshContext): WeaponMeshBuild {
  const group = new THREE.Group();
  group.name = "weapon:rifle";
  const materials: TrackedMaterial[] = [];
  const { body, accent, metal } = makeMats(color, context, materials);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.2), accent);
  stock.position.set(0, -0.02, 0.14);
  const stockPad = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.12, 0.04), accent);
  stockPad.position.set(0, -0.01, 0.24);

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.38), body);
  receiver.position.set(0, 0.01, -0.1);

  const handguard = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.22), metal);
  handguard.position.set(0, 0.0, -0.38);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.36, 10), body);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.015, -0.58);

  const muzzleBrake = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.028, 0.05, 10), metal);
  muzzleBrake.rotation.x = Math.PI / 2;
  muzzleBrake.position.set(0, 0.015, -0.76);

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.055), accent);
  foregrip.position.set(0, -0.07, -0.36);

  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.07), accent);
  magazine.position.set(0, -0.1, -0.05);
  magazine.rotation.x = -0.15;

  const optic = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.045, 0.14), metal);
  optic.position.set(0, 0.07, -0.12);
  const opticGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8), metal);
  opticGlass.rotation.x = Math.PI / 2;
  opticGlass.position.set(0, 0.07, -0.2);

  const pistolGrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), accent);
  pistolGrip.position.set(0, -0.08, 0.06);
  pistolGrip.rotation.x = 0.25;

  group.add(
    stock,
    stockPad,
    receiver,
    handguard,
    barrel,
    muzzleBrake,
    foregrip,
    magazine,
    optic,
    opticGlass,
    pistolGrip,
  );

  let flashMesh: THREE.Mesh | null = null;
  let flashMaterial: THREE.MeshBasicMaterial | null = null;
  if (context === "fp") {
    const flash = makeFlash(0xff9d2e, 0.08);
    flash.mesh.position.set(0, 0.015, -0.8);
    group.add(flash.mesh);
    flashMesh = flash.mesh;
    flashMaterial = flash.material;
  }

  return {
    group,
    materials,
    flashMesh,
    flashMaterial,
    sockets: {
      rightGrip: new THREE.Vector3(0.02, -0.09, 0.06),
      leftGrip: new THREE.Vector3(-0.02, -0.08, -0.36),
    },
  };
}

function buildGrenadeLauncher(color: number, context: WeaponMeshContext): WeaponMeshBuild {
  const group = new THREE.Group();
  group.name = "weapon:grenade_launcher";
  const materials: TrackedMaterial[] = [];
  const { body, accent, metal } = makeMats(color, context, materials);

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.16), accent);
  stock.position.set(0, -0.04, 0.1);
  const stockPad = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.04), accent);
  stockPad.position.set(0, -0.03, 0.18);

  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.48, 12), body);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.01, -0.16);

  const breech = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.12), metal);
  breech.position.set(0, 0.01, 0.02);

  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.105, 0.08, 12), body);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.01, -0.44);

  const muzzleRim = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.03, 12), metal);
  muzzleRim.rotation.x = Math.PI / 2;
  muzzleRim.position.set(0, 0.01, -0.49);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.06), accent);
  grip.position.set(0, -0.09, 0.02);
  grip.rotation.x = 0.2;

  const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.07), accent);
  foregrip.position.set(0, -0.1, -0.22);

  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.07, 0.04), metal);
  frontSight.position.set(0, 0.12, -0.38);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), metal);
  rearSight.position.set(0, 0.1, 0.0);

  group.add(stock, stockPad, tube, breech, muzzle, muzzleRim, grip, foregrip, frontSight, rearSight);

  let flashMesh: THREE.Mesh | null = null;
  let flashMaterial: THREE.MeshBasicMaterial | null = null;
  if (context === "fp") {
    const flash = makeFlash(0xcc55ff, 0.15);
    flash.mesh.position.set(0, 0.01, -0.58);
    group.add(flash.mesh);
    flashMesh = flash.mesh;
    flashMaterial = flash.material;
  }

  return {
    group,
    materials,
    flashMesh,
    flashMaterial,
    sockets: {
      rightGrip: new THREE.Vector3(0.02, -0.1, 0.02),
      leftGrip: new THREE.Vector3(-0.02, -0.11, -0.22),
    },
  };
}

const BUILDERS: Record<WeaponType, (color: number, context: WeaponMeshContext) => WeaponMeshBuild> = {
  pistol: buildPistol,
  rifle: buildRifle,
  grenade_launcher: buildGrenadeLauncher,
};

/**
 * Build a weapon mesh for the given context. Caller owns materials / geometries
 * for disposal. FP includes muzzle-flash mesh; tp/world omit it.
 */
export function buildWeaponMesh(weapon: WeaponType, context: WeaponMeshContext): WeaponMeshBuild {
  const color = WEAPON_STATS[weapon].color;
  const built = BUILDERS[weapon](color, context);
  const scale = CONTEXT_SCALE[context];
  built.group.scale.setScalar(scale);
  // Scale grip sockets with the group so consumers can place hands in local space.
  built.sockets.rightGrip.multiplyScalar(scale);
  if (built.sockets.leftGrip) built.sockets.leftGrip.multiplyScalar(scale);

  if (context === "world") {
    built.group.position.y = WORLD_Y_LIFT;
    // Slight yaw so pickups read clearly from typical approach angles.
    built.group.rotation.y = 0.35;
  }

  return built;
}

/** Dispose geometries and materials under a weapon group (safe on weapon swap teardown). */
export function disposeWeaponMesh(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) mat?.dispose?.();
  });
}
