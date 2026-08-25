// Renders/updates one low-poly humanoid avatar per *other* connected player
// from the server's world-state broadcasts. First-person: the local player
// never renders their own avatar.

import * as THREE from "three";
import { PET_TYPES, WEAPON_STATS, type PetType, type PlayerState, type Vector3, type WeaponType } from "@cubewars/shared";

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

// EPIC 31 "Randomized Bot Equipment Loadouts" Section 3.4: small, cheap
// visual tell for equipped pets/amulet, applied uniformly to any PlayerState
// carrying this data (bots and humans alike — one broadcast path, see
// server/src/match.ts applyEconomyCombatToPlayer() / server/src/botAI.ts
// applyBotLoadout()). Not required to be pixel-perfect, just readable at
// typical engagement range (spec Section 3.4).
const PET_ORB_RADIUS = 0.1;
/** Slot-order shoulder/backpack anchor positions for up to 2 pet orbs (slot1, slot2) — mounted just outside the backpack's left/right edge, at the same depth as the backpack so they read as small satellite orbs riding beside it (not buried inside the torso silhouette). */
const PET_ORB_LOCAL_POSITIONS: readonly [number, number, number][] = [
  [-0.34, 0, 0.27],
  [0.34, 0, 0.27],
];
const AMULET_RING_OUTER_RADIUS = 0.13;
const AMULET_RING_TUBE_RADIUS = 0.028;

/** Color per PetType (EPIC 31 spec Section 3.4: "color-coded by pet type") — matches each type's primary rating axis (shared/src/economy.ts PET_TYPE_RATING): dog/armor -> steel grey, cat/health -> red, bird/speed -> cyan, lion/damage -> orange. */
const PET_ORB_COLORS: Record<PetType, number> = {
  dog: 0x9aa0ab,
  cat: 0xe0435c,
  bird: 0x36c7e0,
  lion: 0xf2a93b,
};

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
  /** EPIC 31: up to 2 pet-tell orbs, slot order [slot1, slot2], hidden by default. */
  petOrbs: THREE.Mesh[];
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
  /** EPIC 31: last-applied pet-tell types, compared by joined-string equality to skip redundant material swaps (mirrors the currentWeapon discipline above). */
  currentPetTypesKey: string;
  currentHasAmulet: boolean;
  /** EPIC 36: last applied protection opacity state (avoids redundant material writes). */
  spawnProtected: boolean;
}

const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.7 });
const limbMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.65 });
const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c197, roughness: 0.8 });
const faceMaterial = new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.5 });
const backpackMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d2a, roughness: 0.75 });

/** One glowing-orb material per PetType (EPIC 31) — swapped onto a shared orb mesh per slot rather than rebuilt per player, matching this file's existing per-type-material style (see weaponMaterial()). */
const petOrbMaterials: Record<PetType, THREE.MeshStandardMaterial> = Object.fromEntries(
  PET_TYPES.map((type) => [
    type,
    new THREE.MeshStandardMaterial({
      color: PET_ORB_COLORS[type],
      emissive: PET_ORB_COLORS[type],
      emissiveIntensity: 0.5,
      roughness: 0.4,
    }),
  ]),
) as Record<PetType, THREE.MeshStandardMaterial>;

/** Amulet pendant material (EPIC 31) — a distinct gold glow so it reads as "amulet", not "another pet orb", at a glance (spec Section 3.4). */
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

  // EPIC 36: clone shared template materials so per-avatar opacity (and any
  // future per-avatar color work, EPIC 33) cannot leak across every player.
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

  // EPIC 31 pet-tell orbs: small spheres near the shoulder/backpack, one per
  // slot, hidden until a loadout arrives (applyPetVisual() below).
  // Clone materials so EPIC 36 opacity is per-avatar.
  const petOrbs: THREE.Mesh[] = PET_ORB_LOCAL_POSITIONS.map(([x, , z]) => {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(PET_ORB_RADIUS, 10, 10), petOrbMaterials.dog.clone());
    orb.name = "avatar:pet-orb";
    orb.position.set(x, backpack.position.y + TORSO_HEIGHT * 0.22, z);
    orb.visible = false;
    return orb;
  });

  // EPIC 31 amulet-tell pendant: a small ring at the neck/chest, visually
  // distinct (gold glow) from the pet orbs so "has amulet" reads separately
  // from "has pet" at a glance (spec Section 3.4).
  const amuletPendant = new THREE.Mesh(
    new THREE.TorusGeometry(AMULET_RING_OUTER_RADIUS, AMULET_RING_TUBE_RADIUS, 8, 16),
    amuletMaterial.clone(),
  );
  amuletPendant.name = "avatar:amulet-pendant";
  amuletPendant.position.set(0, torso.position.y + TORSO_HEIGHT * 0.42, -BODY_DEPTH / 2 - 0.02);
  amuletPendant.visible = false;

  root.add(torso, backpack, head, leftLeg, rightLeg, leftArm, rightArm, weaponAnchor, ...petOrbs, amuletPendant);
  return { root, torso, head, face, leftArm, rightArm, leftLeg, rightLeg, weaponAnchor, weapons, petOrbs, amuletPendant };
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

/** EPIC 31 Section 3.4: show/hide + color the pet-tell orbs and amulet pendant from the server-broadcast, cosmetic-only PlayerState fields. */
function applyPetVisual(parts: AvatarPartSet, petTypes: readonly PetType[], hasAmulet: boolean): void {
  for (let slot = 0; slot < parts.petOrbs.length; slot++) {
    const orb = parts.petOrbs[slot]!;
    const type = petTypes[slot];
    if (type) {
      orb.visible = true;
      // Recolor the per-avatar cloned material in place (do not swap back to
      // the shared petOrbMaterials singleton — that would break EPIC 36 opacity).
      const mat = orb.material as THREE.MeshStandardMaterial;
      mat.color.setHex(PET_ORB_COLORS[type]);
      mat.emissive.setHex(PET_ORB_COLORS[type]);
    } else {
      orb.visible = false;
    }
  }
  parts.amuletPendant.visible = hasAmulet;
}

/** EPIC 36: set opacity on every mesh material under this avatar (body + weapons + tells). */
function applySpawnProtectionVisual(parts: AvatarPartSet, protectedNow: boolean): void {
  const opacity = protectedNow ? SPAWN_PROTECTION_OPACITY : 1;
  const transparent = protectedNow;
  parts.root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if (!mat || !("opacity" in mat)) continue;
      const std = mat as THREE.MeshStandardMaterial;
      std.transparent = transparent;
      std.opacity = opacity;
      // Avoid z-fighting / incorrect sorting while translucent.
      std.depthWrite = !transparent;
    }
  });
}

function petTypesKey(petTypes: readonly PetType[]): string {
  return petTypes.join(",");
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
        applyPetVisual(parts, player.equippedPetTypes, player.hasAmulet);
        this.scene.add(parts.root);
        avatar = {
          parts,
          lastPosition: clonePosition(player.position),
          lastServerTimeMs: serverTimeMs,
          running: false,
          runPhase: 0,
          currentWeapon: player.equippedWeapon,
          currentPetTypesKey: petTypesKey(player.equippedPetTypes),
          currentHasAmulet: player.hasAmulet,
          spawnProtected: false,
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

      const nextPetTypesKey = petTypesKey(player.equippedPetTypes);
      if (avatar.currentPetTypesKey !== nextPetTypesKey || avatar.currentHasAmulet !== player.hasAmulet) {
        avatar.currentPetTypesKey = nextPetTypesKey;
        avatar.currentHasAmulet = player.hasAmulet;
        applyPetVisual(avatar.parts, player.equippedPetTypes, player.hasAmulet);
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
