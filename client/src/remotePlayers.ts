// Renders/updates one low-poly humanoid avatar per *other* connected player
// from the server's world-state broadcasts. First-person: the local player
// never renders their own avatar.
//
// EPIC 60: shared weaponMeshes props parented to the right arm, one/two-hand
// hold poses, and a slightly more modern remote humanoid silhouette.

import * as THREE from "three";
import {
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
import { buildWeaponMesh } from "./weaponMeshes";

// Keep the avatar within the existing server hitbox's rough silhouette.
// The server-side hitscan still uses the unchanged AABB approximation from
// shared/src/combat.ts; this file is cosmetic rendering only.
const BODY_WIDTH = 0.7;
const BODY_DEPTH = 0.4;
const TORSO_HEIGHT = 0.78;
const HEAD_SIZE = 0.4;
const LEG_HEIGHT = 0.74;
const LEG_WIDTH = 0.2;
const ARM_HEIGHT = 0.64;
const ARM_WIDTH = 0.17;
const FEET_Y = 0;
const RUN_SPEED_THRESHOLD = 0.45;
const RUN_PHASE_SPEED = 9;
/** EPIC 36: low opacity while spawn-protected — reads as a ghost, not a solid target. */
const SPAWN_PROTECTION_OPACITY = 0.35;

const PET_SIDE_X = { left: -0.9, right: 0.9 } as const;
const PET_ANCHOR_Y_OFFSET = 0.9;
const PET_ANCHOR_Z = 0.3;
const PET_ROOT_SCALE = 1.35;
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
  /** Shoulder-pivoted arm groups (rotation applies at shoulder). */
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftArmMesh: THREE.Mesh;
  rightArmMesh: THREE.Mesh;
  leftShoulder: THREE.Mesh;
  rightShoulder: THREE.Mesh;
  chestPlate: THREE.Mesh;
  neck: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  weaponAnchor: THREE.Group;
  weapons: Record<WeaponType, THREE.Group>;
  petCompanions: THREE.Group[];
  petCompanionBaseY: number;
  amuletPendant: THREE.Mesh;
}

interface AvatarState {
  parts: AvatarPartSet;
  lastPosition: Vector3;
  lastServerTimeMs: number | null;
  running: boolean;
  runPhase: number;
  currentWeapon: WeaponType;
  currentPetsVisualKey: string;
  currentHasAmulet: boolean;
  currentAvatarColorsKey: string;
  spawnProtected: boolean;
  petBobPhase: number;
}

const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.7 });
const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.65 });
const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c197, roughness: 0.8 });
const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.5 });
const backpackMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.75 });
const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.55, metalness: 0.2 });

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

function buildCompanionSlot(baseY: number): THREE.Group {
  const root = new THREE.Group();
  root.name = "avatar:pet-companion";
  root.position.set(PET_SIDE_X.left, baseY, PET_ANCHOR_Z);
  root.scale.setScalar(PET_ROOT_SCALE);
  root.visible = false;
  root.add(petGlowShell());
  const mat = petBodyMaterial(0x888888);
  const body = buildDogMesh(mat);
  body.name = "avatar:pet-body";
  root.add(body);
  return root;
}

function buildWeaponProp(weapon: WeaponType): THREE.Group {
  const built = buildWeaponMesh(weapon, "tp");
  // Orient so the barrel points roughly forward while held at the right hand.
  built.group.rotation.set(-0.05, 0, 0);
  if (weapon === "pistol") {
    built.group.position.set(0.02, 0.02, -0.08);
  } else if (weapon === "rifle") {
    built.group.position.set(0.0, 0.04, -0.06);
  } else {
    built.group.position.set(0.0, 0.03, -0.04);
  }
  return built.group;
}

function buildFace(): THREE.Group {
  const face = new THREE.Group();
  face.name = "avatar:face";
  const faceMat = faceMaterial.clone();
  const eyeLeft = box(0.06, 0.055, 0.022, faceMat);
  const eyeRight = box(0.06, 0.055, 0.022, faceMat);
  const brow = box(0.22, 0.02, 0.02, faceMat);
  const mouth = box(0.14, 0.028, 0.022, faceMat);
  eyeLeft.name = "avatar:left-eye";
  eyeRight.name = "avatar:right-eye";
  mouth.name = "avatar:mouth";

  eyeLeft.position.set(-0.085, 0.055, -HEAD_SIZE / 2 - 0.012);
  eyeRight.position.set(0.085, 0.055, -HEAD_SIZE / 2 - 0.012);
  brow.position.set(0, 0.1, -HEAD_SIZE / 2 - 0.01);
  mouth.position.set(0, -0.085, -HEAD_SIZE / 2 - 0.012);
  face.add(eyeLeft, eyeRight, brow, mouth);
  return face;
}

/** Shoulder-pivoted arm: mesh hangs downward from the group origin. */
function buildArm(side: "left" | "right"): { group: THREE.Group; mesh: THREE.Mesh } {
  const group = new THREE.Group();
  group.name = side === "left" ? "avatar:left-arm" : "avatar:right-arm";
  const mesh = box(ARM_WIDTH, ARM_HEIGHT, ARM_WIDTH, limbMaterial.clone());
  mesh.name = side === "left" ? "avatar:left-arm-mesh" : "avatar:right-arm-mesh";
  mesh.position.y = -ARM_HEIGHT / 2;
  // Subtle forearm cuff detail.
  const cuff = box(ARM_WIDTH * 1.08, 0.06, ARM_WIDTH * 1.08, trimMaterial.clone());
  cuff.position.y = -ARM_HEIGHT + 0.05;
  group.add(mesh, cuff);
  return { group, mesh };
}

function buildAvatar(): AvatarPartSet {
  const root = new THREE.Group();
  root.name = "remote-avatar";

  const torsoY = FEET_Y + LEG_HEIGHT + TORSO_HEIGHT / 2;

  const torso = box(BODY_WIDTH, TORSO_HEIGHT, BODY_DEPTH, bodyMaterial.clone());
  torso.name = "avatar:torso";
  torso.position.y = torsoY;

  // Slimmer chest plate overlay — uses torso palette via applyAvatarColors.
  const chestPlate = box(BODY_WIDTH * 0.72, TORSO_HEIGHT * 0.55, 0.06, bodyMaterial.clone());
  chestPlate.name = "avatar:chest-plate";
  chestPlate.position.set(0, torsoY + 0.04, -BODY_DEPTH / 2 - 0.02);

  const backpack = box(BODY_WIDTH * 0.62, TORSO_HEIGHT * 0.58, 0.1, backpackMaterial.clone());
  backpack.name = "avatar:backpack";
  backpack.position.set(0, torsoY + 0.02, BODY_DEPTH / 2 + 0.055);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.1, 0.12, 8),
    headMaterial.clone(),
  );
  neck.name = "avatar:neck";
  neck.position.y = torsoY + TORSO_HEIGHT / 2 + 0.04;

  const head = box(HEAD_SIZE, HEAD_SIZE * 0.95, HEAD_SIZE * 0.9, headMaterial.clone());
  head.name = "avatar:head";
  head.position.y = neck.position.y + 0.06 + HEAD_SIZE / 2;
  const face = buildFace();
  head.add(face);

  const leftLeg = box(LEG_WIDTH, LEG_HEIGHT, LEG_WIDTH * 1.05, limbMaterial.clone());
  const rightLeg = box(LEG_WIDTH, LEG_HEIGHT, LEG_WIDTH * 1.05, limbMaterial.clone());
  leftLeg.name = "avatar:left-leg";
  rightLeg.name = "avatar:right-leg";
  leftLeg.position.set(-0.17, FEET_Y + LEG_HEIGHT / 2, 0);
  rightLeg.position.set(0.17, FEET_Y + LEG_HEIGHT / 2, 0);

  // Knee pads (cosmetic trim — not avatar color parts).
  const kneeL = box(LEG_WIDTH * 1.1, 0.08, LEG_WIDTH * 1.15, trimMaterial.clone());
  kneeL.position.set(-0.17, FEET_Y + LEG_HEIGHT * 0.45, 0);
  const kneeR = box(LEG_WIDTH * 1.1, 0.08, LEG_WIDTH * 1.15, trimMaterial.clone());
  kneeR.position.set(0.17, FEET_Y + LEG_HEIGHT * 0.45, 0);

  const left = buildArm("left");
  const right = buildArm("right");
  const shoulderY = FEET_Y + LEG_HEIGHT + TORSO_HEIGHT * 0.78;
  left.group.position.set(-BODY_WIDTH / 2 - ARM_WIDTH * 0.15, shoulderY, -0.02);
  right.group.position.set(BODY_WIDTH / 2 + ARM_WIDTH * 0.15, shoulderY, -0.08);

  const leftShoulder = box(0.22, 0.12, 0.22, bodyMaterial.clone());
  leftShoulder.name = "avatar:left-shoulder";
  leftShoulder.position.set(-BODY_WIDTH / 2 + 0.02, shoulderY + 0.02, -0.02);
  const rightShoulder = box(0.22, 0.12, 0.22, bodyMaterial.clone());
  rightShoulder.name = "avatar:right-shoulder";
  rightShoulder.position.set(BODY_WIDTH / 2 - 0.02, shoulderY + 0.02, -0.05);

  const weaponAnchor = new THREE.Group();
  weaponAnchor.name = "avatar:weapon-anchor";
  // Near the hand end of the right arm (arm mesh hangs down from shoulder pivot).
  weaponAnchor.position.set(0.02, -ARM_HEIGHT + 0.04, -0.05);
  weaponAnchor.rotation.x = -0.1;
  right.group.add(weaponAnchor);

  const weapons = {
    pistol: buildWeaponProp("pistol"),
    rifle: buildWeaponProp("rifle"),
    grenade_launcher: buildWeaponProp("grenade_launcher"),
  };
  for (const weapon of Object.values(weapons)) {
    weapon.visible = false;
    weaponAnchor.add(weapon);
  }

  const petCompanionBaseY = torsoY + PET_ANCHOR_Y_OFFSET;
  const petCompanions: THREE.Group[] = [
    buildCompanionSlot(petCompanionBaseY),
    buildCompanionSlot(petCompanionBaseY),
  ];

  const amuletPendant = new THREE.Mesh(
    new THREE.TorusGeometry(AMULET_RING_OUTER_RADIUS, AMULET_RING_TUBE_RADIUS, 8, 16),
    amuletMaterial.clone(),
  );
  amuletPendant.name = "avatar:amulet-pendant";
  amuletPendant.position.set(0, torsoY + TORSO_HEIGHT * 0.38, -BODY_DEPTH / 2 - 0.04);
  amuletPendant.visible = false;

  root.add(
    torso,
    chestPlate,
    backpack,
    neck,
    head,
    leftLeg,
    rightLeg,
    kneeL,
    kneeR,
    left.group,
    right.group,
    leftShoulder,
    rightShoulder,
    ...petCompanions,
    amuletPendant,
  );
  return {
    root,
    torso,
    head,
    face,
    leftArm: left.group,
    rightArm: right.group,
    leftArmMesh: left.mesh,
    rightArmMesh: right.mesh,
    leftShoulder,
    rightShoulder,
    chestPlate,
    neck,
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
}

/**
 * EPIC 33 / 60: apply palette indices to per-avatar body materials.
 * Shoulders + chest plate follow torso; neck follows head; arms = hands.
 */
function applyAvatarColors(parts: AvatarPartSet, colors: AvatarColors): void {
  const headHex = resolveAvatarColor(colors.head);
  const torsoHex = resolveAvatarColor(colors.torso);
  setMeshColor(parts.head, headHex);
  setMeshColor(parts.neck, headHex);
  setMeshColor(parts.torso, torsoHex);
  setMeshColor(parts.chestPlate, darkenHex(torsoHex, 0.85));
  setMeshColor(parts.leftShoulder, darkenHex(torsoHex, 0.9));
  setMeshColor(parts.rightShoulder, darkenHex(torsoHex, 0.9));
  const handsHex = resolveAvatarColor(colors.hands);
  setMeshColor(parts.leftArmMesh, handsHex);
  setMeshColor(parts.rightArmMesh, handsHex);
  const legsHex = resolveAvatarColor(colors.legs);
  setMeshColor(parts.leftLeg, legsHex);
  setMeshColor(parts.rightLeg, legsHex);
}

function darkenHex(hex: number, factor: number): number {
  return new THREE.Color(hex).multiplyScalar(factor).getHex();
}

function applySpawnProtectionVisual(parts: AvatarPartSet, protectedNow: boolean): void {
  const opacity = protectedNow ? SPAWN_PROTECTION_OPACITY : 1;
  const transparent = protectedNow;
  parts.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if (!mat || !("opacity" in mat)) continue;
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

/** Fixed hold poses — pistol one-hand; rifle / GL two-hand (no IK). */
function applyHoldPose(parts: AvatarPartSet, weapon: WeaponType, stride: number): void {
  if (weapon === "pistol") {
    parts.rightArm.rotation.set(-0.62 + stride * 0.12, 0.05, -0.12);
    parts.leftArm.rotation.set(0.1 - stride * 0.4, 0, 0.08);
    parts.leftArm.position.z = -0.02 - stride * 0.05;
    parts.rightArm.position.z = -0.08 + stride * 0.03;
    parts.weaponAnchor.position.set(0.02, -ARM_HEIGHT + 0.04, -0.05);
    parts.weaponAnchor.rotation.set(-0.05, 0.1, 0);
  } else if (weapon === "rifle") {
    parts.rightArm.rotation.set(-1.05 + stride * 0.06, 0.12, -0.18);
    parts.leftArm.rotation.set(-0.95 + stride * 0.04, 0.45, 0.35);
    parts.leftArm.position.z = -0.12;
    parts.rightArm.position.z = -0.1;
    parts.weaponAnchor.position.set(0.0, -ARM_HEIGHT + 0.06, -0.02);
    parts.weaponAnchor.rotation.set(0.05, 0.05, 0.05);
  } else {
    // grenade_launcher — slightly bulkier two-hand stance
    parts.rightArm.rotation.set(-1.0 + stride * 0.05, 0.1, -0.2);
    parts.leftArm.rotation.set(-0.9 + stride * 0.03, 0.4, 0.32);
    parts.leftArm.position.z = -0.1;
    parts.rightArm.position.z = -0.08;
    parts.weaponAnchor.position.set(0.0, -ARM_HEIGHT + 0.05, -0.02);
    parts.weaponAnchor.rotation.set(0.02, 0.05, 0.08);
  }
}

function poseStanding(parts: AvatarPartSet, weapon: WeaponType): void {
  parts.leftLeg.scale.y = 1;
  parts.rightLeg.scale.y = 1;
  parts.leftLeg.position.set(-0.17, FEET_Y + LEG_HEIGHT / 2, 0.02);
  parts.rightLeg.position.set(0.17, FEET_Y + LEG_HEIGHT / 2, 0.02);
  applyHoldPose(parts, weapon, 0);
}

function poseRunning(parts: AvatarPartSet, phase: number, weapon: WeaponType): void {
  const stride = Math.sin(phase);
  const leftCompression = stride > 0 ? 0.74 : 1;
  const rightCompression = stride < 0 ? 0.74 : 1;

  parts.leftLeg.scale.y = leftCompression;
  parts.rightLeg.scale.y = rightCompression;
  parts.leftLeg.position.y = FEET_Y + (LEG_HEIGHT * leftCompression) / 2;
  parts.rightLeg.position.y = FEET_Y + (LEG_HEIGHT * rightCompression) / 2;
  parts.leftLeg.position.z = stride * 0.1;
  parts.rightLeg.position.z = -stride * 0.1;

  applyHoldPose(parts, weapon, stride);
}

export class RemotePlayers {
  private avatars = new Map<string, AvatarState>();

  constructor(private scene: THREE.Scene) {}

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

      const protectedNow = serverTimeMs < player.spawnProtectedUntilMs;
      if (avatar.spawnProtected !== protectedNow) {
        avatar.spawnProtected = protectedNow;
        applySpawnProtectionVisual(avatar.parts, protectedNow);
      }

      avatar.parts.root.position.set(player.position.x, player.position.y, player.position.z);
      avatar.parts.root.rotation.y = player.yaw;
      avatar.parts.root.visible = player.alive;
    }

    for (const [id, avatar] of this.avatars) {
      if (!seen.has(id)) {
        this.scene.remove(avatar.parts.root);
        this.avatars.delete(id);
      }
    }
  }

  update(dt: number): void {
    for (const avatar of this.avatars.values()) {
      if (!avatar.parts.root.visible) continue;
      if (avatar.running) {
        avatar.runPhase += dt * RUN_PHASE_SPEED;
        poseRunning(avatar.parts, avatar.runPhase, avatar.currentWeapon);
      } else {
        avatar.runPhase = 0;
        poseStanding(avatar.parts, avatar.currentWeapon);
      }
      avatar.petBobPhase += dt * PET_BOB_SPEED;
      const bob = Math.sin(avatar.petBobPhase) * PET_BOB_AMPLITUDE;
      for (const companion of avatar.parts.petCompanions) {
        if (!companion.visible) continue;
        companion.position.y = avatar.parts.petCompanionBaseY + bob;
      }
    }
  }
}
