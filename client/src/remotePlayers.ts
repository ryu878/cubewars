// Renders/updates one low-poly humanoid avatar per *other* connected player
// from the server's world-state broadcasts. First-person: the local player
// never renders their own avatar.

import * as THREE from "three";
import { WEAPON_STATS, type PlayerState, type Vector3, type WeaponType } from "@cubewars/shared";

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
}

interface AvatarState {
  parts: AvatarPartSet;
  lastPosition: Vector3;
  lastServerTimeMs: number | null;
  running: boolean;
  runPhase: number;
  currentWeapon: WeaponType;
}

const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.7 });
const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.65 });
const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c197, roughness: 0.8 });
const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.5 });
const backpackMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.75 });

function box(sizeX: number, sizeY: number, sizeZ: number, material: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(sizeX, sizeY, sizeZ), material);
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
  const eyeLeft = box(0.07, 0.07, 0.025, faceMaterial);
  const eyeRight = box(0.07, 0.07, 0.025, faceMaterial);
  const mouth = box(0.18, 0.035, 0.025, faceMaterial);
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

  const torso = box(BODY_WIDTH, TORSO_HEIGHT, BODY_DEPTH, bodyMaterial);
  torso.name = "avatar:torso";
  torso.position.y = FEET_Y + LEG_HEIGHT + TORSO_HEIGHT / 2;

  const backpack = box(BODY_WIDTH * 0.7, TORSO_HEIGHT * 0.68, 0.08, backpackMaterial);
  backpack.name = "avatar:backpack";
  backpack.position.set(0, torso.position.y + 0.02, BODY_DEPTH / 2 + 0.045);

  const head = box(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE, headMaterial);
  head.name = "avatar:head";
  head.position.y = torso.position.y + TORSO_HEIGHT / 2 + HEAD_SIZE / 2;
  const face = buildFace();
  head.add(face);

  const leftLeg = box(LEG_WIDTH, LEG_HEIGHT, LEG_WIDTH, limbMaterial);
  const rightLeg = box(LEG_WIDTH, LEG_HEIGHT, LEG_WIDTH, limbMaterial);
  leftLeg.name = "avatar:left-leg";
  rightLeg.name = "avatar:right-leg";
  leftLeg.position.set(-0.18, FEET_Y + LEG_HEIGHT / 2, 0);
  rightLeg.position.set(0.18, FEET_Y + LEG_HEIGHT / 2, 0);

  const leftArm = box(ARM_WIDTH, ARM_HEIGHT, ARM_WIDTH, limbMaterial);
  const rightArm = box(ARM_WIDTH, ARM_HEIGHT, ARM_WIDTH, limbMaterial);
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

  root.add(torso, backpack, head, leftLeg, rightLeg, leftArm, rightArm, weaponAnchor);
  return { root, torso, head, face, leftArm, rightArm, leftLeg, rightLeg, weaponAnchor, weapons };
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
        applyWeapon(parts, player.equippedWeapon);
        this.scene.add(parts.root);
        avatar = {
          parts,
          lastPosition: clonePosition(player.position),
          lastServerTimeMs: serverTimeMs,
          running: false,
          runPhase: 0,
          currentWeapon: player.equippedWeapon,
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

  /** Advance cosmetic run/stand poses. No gameplay state is changed here. */
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
    }
  }
}
