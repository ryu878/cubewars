// Renders/updates one low-poly humanoid avatar per *other* connected player
// from the server's world-state broadcasts. First-person: the local player
// never renders their own avatar.

import * as THREE from "three";
import {
  WEAPON_STATS,
  avatarColorsKey,
  defaultAvatarColors,
  resolveAvatarColor,
  type AvatarColors,
  type EquippedPetVisual,
  type PetType,
  type PlayerState,
  type Vector3,
  type WeaponType,
} from "@cubewars/shared";

// Keep the avatar within the existing server hitbox's rough silhouette.
// The server-side hitscan still uses the unchanged AABB approximation from
// shared/src/combat.ts; this file is cosmetic rendering only.
const BODY_WIDTH = 0.72;
const BODY_DEPTH = 0.42;
const TORSO_HEIGHT = 0.82;
const HEAD_SIZE = 0.42;
const LEG_HEIGHT = 0.72;
const LEG_WIDTH = 0.22;
const ARM_HEIGHT = 0.66;
const ARM_WIDTH = 0.18;
const FEET_Y = 0;
const RUN_SPEED_THRESHOLD = 0.45;
const RUN_PHASE_SPEED = 9;
/** EPIC 36: low opacity while spawn-protected — reads as a ghost, not a solid target. */
const SPAWN_PROTECTION_OPACITY = 0.35;

// EPIC 39 companions (replaces EPIC 31 color orbs): low-poly silhouettes that
// read as dog/cat/bird/lion at engagement range. Client-render only — never
// hitscan/collision. Soft cyan aura + palette color from server.
const PET_SIDE_X = { left: -0.48, right: 0.48 } as const;
const PET_ANCHOR_Y_OFFSET = 0.12;
const PET_ANCHOR_Z = 0.22;
const PET_BOB_AMPLITUDE = 0.035;
const PET_BOB_SPEED = 2.4;
const PET_GLOW_COLOR = 0x4ec8ff;
const AMULET_RING_OUTER_RADIUS = 0.13;
const AMULET_RING_TUBE_RADIUS = 0.028;

interface AvatarPartSet {
  root: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  face: THREE.Group;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  weaponAnchor: THREE.Group;
  weapons: Record<WeaponType, THREE.Group>;
  /** EPIC 39: up to 2 companion groups, slot order [slot1, slot2], hidden by default. */
  petCompanions: THREE.Group[];
  /** Base Y for companion bob (local space). */
  petCompanionBaseY: number;
  /** EPIC 31: amulet-tell pendant, hidden by default. */
  amuletPendant: THREE.Mesh;
}

interface AvatarState {
  parts: AvatarPartSet;
  lastPosition: Vector3;
  lastServerTimeMs: number | null;
  running: boolean;
  runPhase: number;
  currentWeapon: WeaponType;
  /** EPIC 39: last-applied companion visual key (type/color/side). */
  currentPetsVisualKey: string;
  currentHasAmulet: boolean;
  /** EPIC 33: last-applied avatar palette key (skip redundant color writes). */
  currentAvatarColorsKey: string;
  /** EPIC 36: last applied protection opacity state (avoids redundant material writes). */
  spawnProtected: boolean;
  /** EPIC 39: cosmetic bob phase (shared across companions on this avatar). */
  petBobPhase: number;
}

const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.7 });
const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.65 });
const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c197, roughness: 0.8 });
const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.5 });
const backpackMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.75 });

/** Amulet pendant material (EPIC 31) — gold glow, distinct from pet companions. */
const amuletMaterial = new THREE.MeshStandardMaterial({
  color: 0xffd75e,
  emissive: 0xffb300,
  emissiveIntensity: 0.55,
  metalness: 0.6,
  roughness: 0.25,
});

function box(sizeX: number, sizeY: number, sizeZ: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(sizeX, sizeY, sizeZ), material);
}

function petBodyMaterial(hex: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 0.22,
    roughness: 0.55,
    metalness: 0.05,
  });
}

function petGlowShell(): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color: PET_GLOW_COLOR,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), mat);
  shell.name = "avatar:pet-glow";
  return shell;
}

/** Low-poly dog: quadruped + longer snout. */
function buildDogMesh(mat: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  g.name = "companion:dog";
  const body = box(0.14, 0.1, 0.22, mat);
  body.position.set(0, 0.08, 0);
  const head = box(0.1, 0.09, 0.1, mat);
  head.position.set(0, 0.14, -0.14);
  const snout = box(0.06, 0.05, 0.1, mat);
  snout.position.set(0, 0.12, -0.22);
  const earL = box(0.03, 0.05, 0.02, mat);
  earL.position.set(-0.04, 0.2, -0.12);
  const earR = box(0.03, 0.05, 0.02, mat);
  earR.position.set(0.04, 0.2, -0.12);
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [
    [-0.05, 0.07],
    [0.05, 0.07],
    [-0.05, -0.07],
    [0.05, -0.07],
  ] as const) {
    const leg = box(0.035, 0.08, 0.035, mat);
    leg.position.set(x, 0.04, z);
    legs.push(leg);
  }
  const tail = box(0.025, 0.025, 0.08, mat);
  tail.position.set(0, 0.12, 0.14);
  g.add(body, head, snout, earL, earR, ...legs, tail);
  return g;
}

/** Low-poly cat: quadruped + pointed ears + shorter face. */
function buildCatMesh(mat: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  g.name = "companion:cat";
  const body = box(0.12, 0.09, 0.18, mat);
  body.position.set(0, 0.08, 0);
  const head = box(0.09, 0.08, 0.08, mat);
  head.position.set(0, 0.14, -0.12);
  const face = box(0.05, 0.04, 0.04, mat);
  face.position.set(0, 0.12, -0.17);
  const earL = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), mat);
  earL.position.set(-0.035, 0.2, -0.11);
  const earR = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), mat);
  earR.position.set(0.035, 0.2, -0.11);
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [
    [-0.04, 0.06],
    [0.04, 0.06],
    [-0.04, -0.05],
    [0.04, -0.05],
  ] as const) {
    const leg = box(0.03, 0.07, 0.03, mat);
    leg.position.set(x, 0.035, z);
    legs.push(leg);
  }
  const tail = box(0.02, 0.02, 0.12, mat);
  tail.position.set(0, 0.12, 0.12);
  tail.rotation.x = -0.4;
  g.add(body, head, face, earL, earR, ...legs, tail);
  return g;
}

/** Low-poly bird: small body + wings. */
function buildBirdMesh(mat: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  g.name = "companion:bird";
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), mat);
  body.position.set(0, 0.1, 0);
  body.scale.set(1, 0.85, 1.2);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), mat);
  head.position.set(0, 0.16, -0.07);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.05, 4), mat);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.15, -0.12);
  const wingL = box(0.12, 0.02, 0.06, mat);
  wingL.position.set(-0.1, 0.1, 0);
  wingL.rotation.z = 0.25;
  const wingR = box(0.12, 0.02, 0.06, mat);
  wingR.position.set(0.1, 0.1, 0);
  wingR.rotation.z = -0.25;
  const tail = box(0.04, 0.015, 0.07, mat);
  tail.position.set(0, 0.08, 0.09);
  g.add(body, head, beak, wingL, wingR, tail);
  return g;
}

/** Low-poly lion: quadruped + mane volume. */
function buildLionMesh(mat: THREE.MeshStandardMaterial): THREE.Group {
  const g = new THREE.Group();
  g.name = "companion:lion";
  const body = box(0.15, 0.11, 0.24, mat);
  body.position.set(0, 0.09, 0);
  const mane = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), mat);
  mane.position.set(0, 0.14, -0.12);
  mane.scale.set(1.15, 1.1, 0.95);
  const head = box(0.09, 0.08, 0.09, mat);
  head.position.set(0, 0.14, -0.18);
  const snout = box(0.055, 0.045, 0.06, mat);
  snout.position.set(0, 0.12, -0.24);
  const legs: THREE.Mesh[] = [];
  for (const [x, z] of [
    [-0.055, 0.08],
    [0.055, 0.08],
    [-0.055, -0.08],
    [0.055, -0.08],
  ] as const) {
    const leg = box(0.04, 0.085, 0.04, mat);
    leg.position.set(x, 0.042, z);
    legs.push(leg);
  }
  const tail = box(0.025, 0.025, 0.1, mat);
  tail.position.set(0, 0.13, 0.15);
  g.add(body, mane, head, snout, ...legs, tail);
  return g;
}

function buildCompanionBody(type: PetType, mat: THREE.MeshStandardMaterial): THREE.Group {
  switch (type) {
    case "dog":
      return buildDogMesh(mat);
    case "cat":
      return buildCatMesh(mat);
    case "bird":
      return buildBirdMesh(mat);
    case "lion":
      return buildLionMesh(mat);
  }
}

/** Empty companion slot: glow + body replaced when applyPetVisual runs. */
function buildCompanionSlot(baseY: number): THREE.Group {
  const root = new THREE.Group();
  root.name = "avatar:pet-companion";
  root.position.set(PET_SIDE_X.left, baseY, PET_ANCHOR_Z);
  root.visible = false;
  root.add(petGlowShell());
  // Placeholder body (replaced on apply).
  const mat = petBodyMaterial(0x888888);
  const body = buildDogMesh(mat);
  body.name = "avatar:pet-body";
  root.add(body);
  return root;
}

function weaponMaterial(weapon: WeaponType): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: WEAPON_STATS[weapon].color,
    metalness: 0.25,
    roughness: 0.55,
  });
}

function buildPistolProp(): THREE.Group {
  const group = new THREE.Group();
  group.name = "weapon:pistol";
  const material = weaponMaterial("pistol");

  const grip = box(0.07, 0.16, 0.07, material);
  grip.position.set(0, -0.07, 0.02);
  grip.rotation.x = 0.35;

  const slide = box(0.09, 0.08, 0.24, material);
  slide.position.set(0, 0.04, -0.12);

  group.add(grip, slide);
  return group;
}

function buildRifleProp(): THREE.Group {
  const group = new THREE.Group();
  group.name = "weapon:rifle";
  const material = weaponMaterial("rifle");

  const stock = box(0.09, 0.12, 0.18, material);
  stock.position.set(0, -0.01, 0.1);
  const body = box(0.1, 0.1, 0.42, material);
  body.position.set(0, 0.02, -0.12);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 10), material);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, -0.5);

  group.add(stock, body, barrel);
  return group;
}

function buildGrenadeLauncherProp(): THREE.Group {
  const group = new THREE.Group();
  group.name = "weapon:grenade_launcher";
  const material = weaponMaterial("grenade_launcher");

  const stock = box(0.13, 0.15, 0.18, material);
  stock.position.set(0, -0.02, 0.08);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.46, 12), material);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.02, -0.18);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12), material);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.02, -0.44);

  group.add(stock, tube, muzzle);
  return group;
}

function buildFace(): THREE.Group {
  const face = new THREE.Group();
  face.name = "avatar:face";
  // Clone so per-avatar EPIC 36 opacity does not mutate the shared template.
  const faceMat = faceMaterial.clone();
  const eyeLeft = box(0.07, 0.07, 0.025, faceMat);
  const eyeRight = box(0.07, 0.07, 0.025, faceMat);
  const mouth = box(0.18, 0.035, 0.025, faceMat);
  eyeLeft.name = "avatar:left-eye";
  eyeRight.name = "avatar:right-eye";
  mouth.name = "avatar:mouth";

  eyeLeft.position.set(-0.09, 0.06, -HEAD_SIZE / 2 - 0.012);
  eyeRight.position.set(0.09, 0.06, -HEAD_SIZE / 2 - 0.012);
  mouth.position.set(0, -0.09, -HEAD_SIZE / 2 - 0.012);
  face.add(eyeLeft, eyeRight, mouth);
  return face;
}

function buildAvatar(): AvatarPartSet {
  const root = new THREE.Group();
  root.name = "remote-avatar";

  // EPIC 36: clone shared template materials so per-avatar opacity (and EPIC 33
  // per-avatar colors) cannot leak across every player. Arms and legs get
  // separate material clones so they can diverge by palette index.
  const torso = box(BODY_WIDTH, TORSO_HEIGHT, BODY_DEPTH, bodyMaterial.clone());
  torso.name = "avatar:torso";
  torso.position.y = FEET_Y + LEG_HEIGHT + TORSO_HEIGHT / 2;

  const backpack = box(BODY_WIDTH * 0.7, TORSO_HEIGHT * 0.68, 0.08, backpackMaterial.clone());
  backpack.name = "avatar:backpack";
  backpack.position.set(0, torso.position.y + 0.02, BODY_DEPTH / 2 + 0.045);

  const head = box(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE, headMaterial.clone());
  head.name = "avatar:head";
  head.position.y = torso.position.y + TORSO_HEIGHT / 2 + HEAD_SIZE / 2;
  const face = buildFace();
  head.add(face);

  const leftLeg = box(LEG_WIDTH, LEG_HEIGHT, LEG_WIDTH, limbMaterial.clone());
  const rightLeg = box(LEG_WIDTH, LEG_HEIGHT, LEG_WIDTH, limbMaterial.clone());
  leftLeg.name = "avatar:left-leg";
  rightLeg.name = "avatar:right-leg";
  leftLeg.position.set(-0.18, FEET_Y + LEG_HEIGHT / 2, 0);
  rightLeg.position.set(0.18, FEET_Y + LEG_HEIGHT / 2, 0);

  const leftArm = box(ARM_WIDTH, ARM_HEIGHT, ARM_WIDTH, limbMaterial.clone());
  const rightArm = box(ARM_WIDTH, ARM_HEIGHT, ARM_WIDTH, limbMaterial.clone());
  leftArm.name = "avatar:left-arm";
  rightArm.name = "avatar:right-arm";
  leftArm.position.set(-BODY_WIDTH / 2 - ARM_WIDTH / 2, FEET_Y + LEG_HEIGHT + TORSO_HEIGHT * 0.55, -0.03);
  rightArm.position.set(BODY_WIDTH / 2 + ARM_WIDTH / 2, FEET_Y + LEG_HEIGHT + TORSO_HEIGHT * 0.55, -0.12);
  rightArm.rotation.x = -0.42;

  const weaponAnchor = new THREE.Group();
  weaponAnchor.name = "avatar:weapon-anchor";
  weaponAnchor.position.set(BODY_WIDTH / 2 + 0.13, FEET_Y + LEG_HEIGHT + TORSO_HEIGHT * 0.47, -0.34);
  weaponAnchor.rotation.x = -0.08;

  const weapons = {
    pistol: buildPistolProp(),
    rifle: buildRifleProp(),
    grenade_launcher: buildGrenadeLauncherProp(),
  };
  for (const weapon of Object.values(weapons)) {
    weapon.visible = false;
    weaponAnchor.add(weapon);
  }

  // EPIC 39 companion slots: low-poly silhouettes beside the avatar
  // (left/right from server). Clone materials so EPIC 36 opacity is per-avatar.
  const petCompanionBaseY = torso.position.y + PET_ANCHOR_Y_OFFSET;
  const petCompanions: THREE.Group[] = [
    buildCompanionSlot(petCompanionBaseY),
    buildCompanionSlot(petCompanionBaseY),
  ];

  // EPIC 31 amulet-tell pendant: a small ring at the neck/chest, visually
  // distinct (gold glow) from companions so "has amulet" reads separately.
  const amuletPendant = new THREE.Mesh(
    new THREE.TorusGeometry(AMULET_RING_OUTER_RADIUS, AMULET_RING_TUBE_RADIUS, 8, 16),
    amuletMaterial.clone(),
  );
  amuletPendant.name = "avatar:amulet-pendant";
  amuletPendant.position.set(0, torso.position.y + TORSO_HEIGHT * 0.42, -BODY_DEPTH / 2 - 0.02);
  amuletPendant.visible = false;

  root.add(
    torso,
    backpack,
    head,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    weaponAnchor,
    ...petCompanions,
    amuletPendant,
  );
  return {
    root,
    torso,
    head,
    face,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    weaponAnchor,
    weapons,
    petCompanions,
    petCompanionBaseY,
    amuletPendant,
  };
}

function clonePosition(position: Vector3): Vector3 {
  return { x: position.x, y: position.y, z: position.z };
}

function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function applyWeapon(parts: AvatarPartSet, weapon: WeaponType): void {
  for (const [type, group] of Object.entries(parts.weapons) as Array<[WeaponType, THREE.Group]>) {
    group.visible = type === weapon;
  }
}

/**
 * Dispose geometries/materials under a removed companion body (F-002).
 * Each rebuild allocates fresh meshes + materials — must not leak GPU resources.
 */
function disposeCompanionSubtree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.geometry?.dispose();
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      mat?.dispose?.();
    }
  });
}

/**
 * EPIC 39: show/hide companion meshes from server-broadcast equippedPetsVisual
 * (type + palette color + left/right side). Falls back to equippedPetTypes
 * for incomplete fixtures. Cosmetic only — never solid.
 */
function applyPetVisual(
  parts: AvatarPartSet,
  visuals: readonly EquippedPetVisual[],
  hasAmulet: boolean,
): void {
  for (let slot = 0; slot < parts.petCompanions.length; slot++) {
    const companion = parts.petCompanions[slot]!;
    const visual = visuals[slot];
    if (!visual) {
      companion.visible = false;
      continue;
    }
    companion.visible = true;
    companion.position.x = PET_SIDE_X[visual.side];
    companion.position.z = PET_ANCHOR_Z;

    const hex = resolveAvatarColor(visual.colorIndex);
    const oldBody = companion.getObjectByName("avatar:pet-body");
    if (oldBody) {
      companion.remove(oldBody);
      disposeCompanionSubtree(oldBody);
    }

    const mat = petBodyMaterial(hex);
    const body = buildCompanionBody(visual.type, mat);
    body.name = "avatar:pet-body";
    companion.add(body);
  }
  parts.amuletPendant.visible = hasAmulet;
}

function setMeshColor(mesh: THREE.Mesh, hex: number): void {
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.color.setHex(hex);
  // Color only — leave opacity / transparent / depthWrite for EPIC 36.
}

/**
 * EPIC 33: apply palette indices to per-avatar body materials.
 * Arms share one color (hands); legs share another — never mutates shared templates.
 */
function applyAvatarColors(parts: AvatarPartSet, colors: AvatarColors): void {
  setMeshColor(parts.head, resolveAvatarColor(colors.head));
  setMeshColor(parts.torso, resolveAvatarColor(colors.torso));
  const handsHex = resolveAvatarColor(colors.hands);
  setMeshColor(parts.leftArm, handsHex);
  setMeshColor(parts.rightArm, handsHex);
  const legsHex = resolveAvatarColor(colors.legs);
  setMeshColor(parts.leftLeg, legsHex);
  setMeshColor(parts.rightLeg, legsHex);
}

/** EPIC 36: set opacity on every mesh material under this avatar (body + weapons + tells + companions). */
function applySpawnProtectionVisual(parts: AvatarPartSet, protectedNow: boolean): void {
  const opacity = protectedNow ? SPAWN_PROTECTION_OPACITY : 1;
  const transparent = protectedNow;
  parts.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if (!mat || !("opacity" in mat)) continue;
      // Glow shells stay translucent; scale their base opacity when protected.
      if (obj.name === "avatar:pet-glow") {
        const basic = mat as THREE.MeshBasicMaterial;
        basic.transparent = true;
        basic.opacity = protectedNow ? 0.28 * SPAWN_PROTECTION_OPACITY : 0.28;
        basic.depthWrite = false;
        continue;
      }
      const std = mat as THREE.MeshStandardMaterial;
      std.transparent = transparent;
      std.opacity = opacity;
      std.depthWrite = !transparent;
    }
  });
}

function petsVisualKey(visuals: readonly EquippedPetVisual[]): string {
  return visuals.map((v) => `${v.type}:${v.colorIndex}:${v.side}`).join("|");
}

/** Prefer equippedPetsVisual; fall back to equippedPetTypes for older fixtures. */
function resolvePetsVisual(player: PlayerState): EquippedPetVisual[] {
  if (Array.isArray(player.equippedPetsVisual) && player.equippedPetsVisual.length > 0) {
    return player.equippedPetsVisual;
  }
  const types = player.equippedPetTypes ?? [];
  return types.map((type, i) => ({
    type,
    colorIndex: 0,
    side: i % 2 === 0 ? ("left" as const) : ("right" as const),
  }));
}

function poseStanding(parts: AvatarPartSet): void {
  parts.leftLeg.scale.y = 1;
  parts.rightLeg.scale.y = 1;
  parts.leftLeg.position.set(-0.18, FEET_Y + LEG_HEIGHT / 2, 0.02);
  parts.rightLeg.position.set(0.18, FEET_Y + LEG_HEIGHT / 2, 0.02);
  parts.leftArm.rotation.x = 0.08;
  parts.rightArm.rotation.x = -0.42;
  parts.leftArm.position.z = -0.03;
  parts.rightArm.position.z = -0.12;
  parts.weaponAnchor.position.z = -0.34;
}

function poseRunning(parts: AvatarPartSet, phase: number): void {
  const stride = Math.sin(phase);
  const leftCompression = stride > 0 ? 0.74 : 1;
  const rightCompression = stride < 0 ? 0.74 : 1;

  parts.leftLeg.scale.y = leftCompression;
  parts.rightLeg.scale.y = rightCompression;
  parts.leftLeg.position.y = FEET_Y + (LEG_HEIGHT * leftCompression) / 2;
  parts.rightLeg.position.y = FEET_Y + (LEG_HEIGHT * rightCompression) / 2;
  parts.leftLeg.position.z = stride * 0.1;
  parts.rightLeg.position.z = -stride * 0.1;

  parts.leftArm.rotation.x = -stride * 0.42;
  parts.rightArm.rotation.x = -0.45 + stride * 0.18;
  parts.leftArm.position.z = -0.03 - stride * 0.06;
  parts.rightArm.position.z = -0.12 + stride * 0.04;
  parts.weaponAnchor.position.z = -0.34 + stride * 0.035;
}

export class RemotePlayers {
  private avatars = new Map<string, AvatarState>();

  constructor(private scene: THREE.Scene) {}

  /** Reconcile rendered avatars against the latest world-state snapshot. */
  sync(players: PlayerState[], selfId: string | null, serverTimeMs: number): void {
    const seen = new Set<string>();

    for (const player of players) {
      if (player.id === selfId) continue;
      seen.add(player.id);

      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        const parts = buildAvatar();
        parts.root.name = `remote-avatar:${player.id}`;
        const colors = player.avatarColors ?? defaultAvatarColors();
        const petsVisual = resolvePetsVisual(player);
        applyAvatarColors(parts, colors);
        applyWeapon(parts, player.equippedWeapon);
        applyPetVisual(parts, petsVisual, player.hasAmulet);
        this.scene.add(parts.root);
        avatar = {
          parts,
          lastPosition: clonePosition(player.position),
          lastServerTimeMs: serverTimeMs,
          running: false,
          runPhase: 0,
          currentWeapon: player.equippedWeapon,
          currentPetsVisualKey: petsVisualKey(petsVisual),
          currentHasAmulet: player.hasAmulet,
          currentAvatarColorsKey: avatarColorsKey(colors),
          spawnProtected: false,
          petBobPhase: 0,
        };
        this.avatars.set(player.id, avatar);
      } else {
        const elapsedSeconds =
          avatar.lastServerTimeMs === null ? 0 : Math.max(0.001, (serverTimeMs - avatar.lastServerTimeMs) / 1000);
        const speed = horizontalDistance(player.position, avatar.lastPosition) / elapsedSeconds;
        avatar.running = player.alive && speed > RUN_SPEED_THRESHOLD;
        avatar.lastPosition = clonePosition(player.position);
        avatar.lastServerTimeMs = serverTimeMs;
      }

      if (avatar.currentWeapon !== player.equippedWeapon) {
        avatar.currentWeapon = player.equippedWeapon;
        applyWeapon(avatar.parts, player.equippedWeapon);
      }

      const petsVisual = resolvePetsVisual(player);
      const nextPetsKey = petsVisualKey(petsVisual);
      if (avatar.currentPetsVisualKey !== nextPetsKey || avatar.currentHasAmulet !== player.hasAmulet) {
        avatar.currentPetsVisualKey = nextPetsKey;
        avatar.currentHasAmulet = player.hasAmulet;
        applyPetVisual(avatar.parts, petsVisual, player.hasAmulet);
        // Fresh companion materials start opaque — re-apply EPIC 36 if needed.
        if (avatar.spawnProtected) {
          applySpawnProtectionVisual(avatar.parts, true);
        }
      }

      const colors = player.avatarColors ?? defaultAvatarColors();
      const nextColorsKey = avatarColorsKey(colors);
      if (avatar.currentAvatarColorsKey !== nextColorsKey) {
        avatar.currentAvatarColorsKey = nextColorsKey;
        applyAvatarColors(avatar.parts, colors);
      }

      // EPIC 36: opacity from server-broadcast deadline vs this tick's
      // serverTimeMs only — no local free-running countdown.
      const protectedNow = serverTimeMs < player.spawnProtectedUntilMs;
      if (avatar.spawnProtected !== protectedNow) {
        avatar.spawnProtected = protectedNow;
        applySpawnProtectionVisual(avatar.parts, protectedNow);
      }

      avatar.parts.root.position.set(player.position.x, player.position.y, player.position.z);
      avatar.parts.root.rotation.y = player.yaw;
      avatar.parts.root.visible = player.alive;
    }

    // Anyone missing from this snapshot (disconnected) loses their avatar.
    for (const [id, avatar] of this.avatars) {
      if (!seen.has(id)) {
        this.scene.remove(avatar.parts.root);
        this.avatars.delete(id);
      }
    }
  }

  /** Advance cosmetic run/stand poses and companion bob. No gameplay state is changed here. */
  update(dt: number): void {
    for (const avatar of this.avatars.values()) {
      if (!avatar.parts.root.visible) continue;
      if (avatar.running) {
        avatar.runPhase += dt * RUN_PHASE_SPEED;
        poseRunning(avatar.parts, avatar.runPhase);
      } else {
        avatar.runPhase = 0;
        poseStanding(avatar.parts);
      }
      // EPIC 39: gentle vertical bob on visible companions (cosmetic only).
      avatar.petBobPhase += dt * PET_BOB_SPEED;
      const bob = Math.sin(avatar.petBobPhase) * PET_BOB_AMPLITUDE;
      for (const companion of avatar.parts.petCompanions) {
        if (!companion.visible) continue;
        companion.position.y = avatar.parts.petCompanionBaseY + bob;
      }
    }
  }
}
