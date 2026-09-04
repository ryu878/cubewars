// First-person weapon viewmodel (EPIC 10 / 30 / 60) — cosmetic Three.js object
// attached to the camera. EPIC 60: shared weaponMeshes builders + visible
// holding hands (pistol one-hand; rifle / grenade launcher two-hand).

import * as THREE from "three";
import { WEAPON_ORDER, type WeaponType } from "@cubewars/shared";
import { buildWeaponMesh, type WeaponMeshBuild } from "./weaponMeshes";

/** Lower-right, in front of the camera — typical FPS viewmodel placement. */
const VIEWMODEL_BASE_POSITION = new THREE.Vector3(0.14, -0.14, -0.68);
/** Uniform shrink so the held gun reads near the bottom-right, not oversized. */
const VIEWMODEL_SCALE = 0.72;

const SWAY_SPEED = 1.6;
const SWAY_AMPLITUDE_X = 0.012;
const SWAY_AMPLITUDE_Y = 0.01;

const HAND_SKIN = 0xe8b896;
const HAND_SKIN_DARK = 0xd4a07a;

interface RecoilProfile {
  kickBack: number;
  kickUp: number;
  flashDurationMs: number;
}

const RECOIL_PROFILES: Record<WeaponType, RecoilProfile> = {
  pistol: { kickBack: 0.045, kickUp: 0.012, flashDurationMs: 80 },
  rifle: { kickBack: 0.085, kickUp: 0.02, flashDurationMs: 100 },
  grenade_launcher: { kickBack: 0.22, kickUp: 0.05, flashDurationMs: 160 },
};

/** Per-weapon local offset of the weapon group inside the viewmodel root. */
const WEAPON_HOLD_OFFSET: Record<WeaponType, THREE.Vector3> = {
  pistol: new THREE.Vector3(0.02, 0.02, 0.02),
  rifle: new THREE.Vector3(0.0, 0.04, 0.04),
  grenade_launcher: new THREE.Vector3(0.0, 0.03, 0.02),
};

interface WeaponVisual {
  group: THREE.Group;
  materials: WeaponMeshBuild["materials"];
  flashMesh: THREE.Mesh;
  flashMaterial: THREE.MeshBasicMaterial;
  rightHand: THREE.Group;
  leftHand: THREE.Group | null;
}

function buildHand(skin: number, darker: number, mirror = false): THREE.Group {
  const group = new THREE.Group();
  group.name = mirror ? "viewmodel:left-hand" : "viewmodel:right-hand";
  const palmMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.85, metalness: 0.05 });
  const fingerMat = new THREE.MeshStandardMaterial({ color: darker, roughness: 0.85, metalness: 0.05 });

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.095), palmMat);
  palm.position.set(0, 0, 0);

  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.028, 0.05), fingerMat);
  thumb.position.set(mirror ? 0.045 : -0.045, 0.005, 0.01);
  thumb.rotation.y = mirror ? -0.5 : 0.5;
  thumb.rotation.z = mirror ? 0.35 : -0.35;

  const fingerOffsets = [-0.022, -0.005, 0.012, 0.028];
  const fingers: THREE.Mesh[] = [];
  for (const fx of fingerOffsets) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.022, 0.055), fingerMat);
    finger.position.set(mirror ? -fx : fx, 0.002, -0.07);
    finger.rotation.x = 0.35;
    fingers.push(finger);
  }

  const wrist = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.04, 0.05), palmMat);
  wrist.position.set(0, -0.005, 0.065);

  group.add(palm, thumb, ...fingers, wrist);
  return group;
}

function placeHandOnSocket(
  hand: THREE.Group,
  socket: THREE.Vector3,
  options: { yaw?: number; pitch?: number; roll?: number; mirror?: boolean },
): void {
  hand.position.copy(socket);
  // Offset so the palm center sits on the grip rather than the hand origin.
  hand.position.y += 0.01;
  hand.rotation.set(options.pitch ?? 0.15, options.yaw ?? 0, options.roll ?? (options.mirror ? 0.2 : -0.2));
}

function buildVisual(weapon: WeaponType): WeaponVisual {
  const built = buildWeaponMesh(weapon, "fp");
  const group = built.group;
  group.position.copy(WEAPON_HOLD_OFFSET[weapon]);

  const rightHand = buildHand(HAND_SKIN, HAND_SKIN_DARK, false);
  placeHandOnSocket(rightHand, built.sockets.rightGrip, {
    pitch: 0.35,
    yaw: weapon === "pistol" ? 0.1 : 0.05,
    roll: -0.35,
  });
  group.add(rightHand);

  let leftHand: THREE.Group | null = null;
  if (built.sockets.leftGrip) {
    leftHand = buildHand(HAND_SKIN, HAND_SKIN_DARK, true);
    placeHandOnSocket(leftHand, built.sockets.leftGrip, {
      pitch: 0.45,
      yaw: -0.15,
      roll: 0.4,
      mirror: true,
    });
    group.add(leftHand);
  }

  if (!built.flashMesh || !built.flashMaterial) {
    throw new Error(`FP weapon mesh missing flash for ${weapon}`);
  }

  return {
    group,
    materials: built.materials,
    flashMesh: built.flashMesh,
    flashMaterial: built.flashMaterial,
    rightHand,
    leftHand,
  };
}

export class WeaponViewmodel {
  private root: THREE.Group;
  private visuals: Record<WeaponType, WeaponVisual>;
  private currentWeapon: WeaponType = "pistol";
  private elapsed = 0;
  private recoilOffset = new THREE.Vector3(0, 0, 0);
  private empty = false;
  private activeFlash: { visual: WeaponVisual; timerMs: number; durationMs: number } | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.root = new THREE.Group();
    this.root.position.copy(VIEWMODEL_BASE_POSITION);
    camera.add(this.root);

    this.visuals = {
      pistol: buildVisual("pistol"),
      rifle: buildVisual("rifle"),
      grenade_launcher: buildVisual("grenade_launcher"),
    };
    for (const type of WEAPON_ORDER) {
      const visual = this.visuals[type];
      visual.group.visible = type === this.currentWeapon;
      visual.group.scale.setScalar(VIEWMODEL_SCALE);
      this.root.add(visual.group);
    }
  }

  setWeapon(weapon: WeaponType): void {
    if (weapon === this.currentWeapon) return;
    this.visuals[this.currentWeapon].group.visible = false;
    this.currentWeapon = weapon;
    this.visuals[weapon].group.visible = true;
    this.applyEmptyState();
  }

  setEmpty(isEmpty: boolean): void {
    if (isEmpty === this.empty) return;
    this.empty = isEmpty;
    this.applyEmptyState();
  }

  private applyEmptyState(): void {
    const visual = this.visuals[this.currentWeapon];
    for (const { material, baseColor } of visual.materials) {
      material.transparent = this.empty;
      material.opacity = this.empty ? 0.4 : 1;
      material.color = this.empty ? baseColor.clone().multiplyScalar(0.5) : baseColor.clone();
    }
  }

  triggerFire(weapon: WeaponType): void {
    const profile = RECOIL_PROFILES[weapon];
    this.recoilOffset.set(0, profile.kickUp, profile.kickBack);

    const visual = this.visuals[weapon];
    visual.flashMesh.visible = true;
    visual.flashMaterial.opacity = 1;
    visual.flashMesh.scale.setScalar(0.6);
    this.activeFlash = { visual, timerMs: 0, durationMs: profile.flashDurationMs };
  }

  update(dt: number): void {
    this.elapsed += dt;

    const swayX = Math.sin(this.elapsed * SWAY_SPEED) * SWAY_AMPLITUDE_X;
    const swayY = Math.abs(Math.sin(this.elapsed * SWAY_SPEED * 2)) * SWAY_AMPLITUDE_Y;

    const decay = Math.exp(-dt * 9);
    this.recoilOffset.multiplyScalar(decay);

    this.root.position.set(
      VIEWMODEL_BASE_POSITION.x + swayX,
      VIEWMODEL_BASE_POSITION.y + swayY + this.recoilOffset.y,
      VIEWMODEL_BASE_POSITION.z + this.recoilOffset.z,
    );

    if (this.activeFlash) {
      this.activeFlash.timerMs += dt * 1000;
      const t = Math.min(1, this.activeFlash.timerMs / this.activeFlash.durationMs);
      this.activeFlash.visual.flashMaterial.opacity = 1 - t;
      this.activeFlash.visual.flashMesh.scale.setScalar(0.6 + t * 0.8);
      if (t >= 1) {
        this.activeFlash.visual.flashMesh.visible = false;
        this.activeFlash = null;
      }
    }
  }
}
