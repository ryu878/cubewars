// First-person weapon viewmodel (EPIC 10 Story 10.1/10.3) — a purely
// cosmetic, client-only Three.js object attached to the camera so it
// inherits look direction automatically. Driven entirely by data the client
// already receives for the HUD (LoadoutMessage.equippedWeapon/ammo, the
// existing onFire trigger) — introduces no new client-trusted gameplay
// state (EPIC 10 spec Risks: "confirm it introduces no new client-trusted
// gameplay state").
//
// Shape/color per weapon reuses WEAPON_STATS[...].color (shared/src/
// weapons.ts) — the same identity already used by the HUD text and the
// world pickup meshes (client/src/pickups.ts), so all three agree at a
// glance per the spec's explicit ask.

import * as THREE from "three";
import { WEAPON_ORDER, WEAPON_STATS, type WeaponType } from "@cubewars/shared";

/** Lower-right, in front of the camera — typical FPS viewmodel placement. Camera-local space (camera looks down -z). */
const VIEWMODEL_BASE_POSITION = new THREE.Vector3(0.32, -0.32, -0.55);

const SWAY_SPEED = 1.6;
const SWAY_AMPLITUDE_X = 0.012;
const SWAY_AMPLITUDE_Y = 0.01;

/** Per-weapon fire recoil + muzzle-flash identity (EPIC 10 Story 10.1 "weapon-distinct fire feedback" ask) — deliberately escalating in kick/flash size from pistol -> rifle -> grenade launcher so each reads as visually distinct without checking the HUD. */
interface RecoilProfile {
  /** Local +z offset applied on fire (camera looks down -z, so positive z pulls the model back toward the camera — a "kick"). */
  kickBack: number;
  /** Local +y offset applied on fire (a slight upward jump). */
  kickUp: number;
  /** How large the muzzle-flash mesh scales up to, and roughly how long it stays visible (ms) — bigger weapons get a longer, bigger flash. */
  flashScale: number;
  flashDurationMs: number;
}

const RECOIL_PROFILES: Record<WeaponType, RecoilProfile> = {
  pistol: { kickBack: 0.045, kickUp: 0.012, flashScale: 1, flashDurationMs: 80 },
  rifle: { kickBack: 0.085, kickUp: 0.02, flashScale: 1.6, flashDurationMs: 100 },
  grenade_launcher: { kickBack: 0.22, kickUp: 0.05, flashScale: 2.8, flashDurationMs: 160 },
};

interface WeaponVisual {
  group: THREE.Group;
  /** Solid materials + their original color, so setEmpty() can dim and later restore without losing the weapon's identity color. */
  materials: { material: THREE.MeshStandardMaterial; baseColor: THREE.Color }[];
  flashMesh: THREE.Mesh;
  flashMaterial: THREE.MeshBasicMaterial;
}

function makeFlash(color: number, radius: number): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 8), material);
  mesh.visible = false;
  mesh.renderOrder = 999;
  return { mesh, material };
}

function trackMaterial(
  list: { material: THREE.MeshStandardMaterial; baseColor: THREE.Color }[],
  material: THREE.MeshStandardMaterial,
): THREE.MeshStandardMaterial {
  list.push({ material, baseColor: material.color.clone() });
  return material;
}

/** Pistol: compact grip + short slide/barrel — small "reads as a small weapon" silhouette (Story 10.1). */
function buildPistolVisual(color: number): WeaponVisual {
  const group = new THREE.Group();
  const materials: WeaponVisual["materials"] = [];
  const material = trackMaterial(materials, new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.6 }));

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.17, 0.09), material);
  grip.position.set(0, -0.1, 0.04);
  grip.rotation.x = 0.2;
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.28), material);
  slide.position.set(0, 0.02, -0.1);
  group.add(grip, slide);

  const { mesh: flashMesh, material: flashMaterial } = makeFlash(0xfff2b0, 0.055);
  flashMesh.position.set(0, 0.03, -0.28);
  group.add(flashMesh);

  return { group, materials, flashMesh, flashMaterial };
}

/** Rifle: longer barrel + stock — visibly bigger/longer than the pistol (Story 10.1). */
function buildRifleVisual(color: number): WeaponVisual {
  const group = new THREE.Group();
  const materials: WeaponVisual["materials"] = [];
  const material = trackMaterial(
    materials,
    new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.5 }),
  );

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.22), material);
  stock.position.set(0, -0.03, 0.12);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.4), material);
  body.position.set(0, 0, -0.12);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 10), material);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.01, -0.5);
  group.add(stock, body, barrel);

  const { mesh: flashMesh, material: flashMaterial } = makeFlash(0xffcf70, 0.08);
  flashMesh.position.set(0, 0.01, -0.72);
  group.add(flashMesh);

  return { group, materials, flashMesh, flashMaterial };
}

/** Grenade launcher: thick tube + bulky muzzle — a distinctly "heavy weapon" silhouette (Story 10.1). */
function buildGrenadeLauncherVisual(color: number): WeaponVisual {
  const group = new THREE.Group();
  const materials: WeaponVisual["materials"] = [];
  const material = trackMaterial(
    materials,
    new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.7 }),
  );

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.15, 0.18), material);
  stock.position.set(0, -0.05, 0.08);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.45, 12), material);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0, -0.18);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.07, 12), material);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0, -0.43);
  group.add(stock, tube, muzzle);

  const { mesh: flashMesh, material: flashMaterial } = makeFlash(0xcc55ff, 0.15);
  flashMesh.position.set(0, 0, -0.56);
  group.add(flashMesh);

  return { group, materials, flashMesh, flashMaterial };
}

const VISUAL_BUILDERS: Record<WeaponType, (color: number) => WeaponVisual> = {
  pistol: buildPistolVisual,
  rifle: buildRifleVisual,
  grenade_launcher: buildGrenadeLauncherVisual,
};

export class WeaponViewmodel {
  private root: THREE.Group;
  private visuals: Record<WeaponType, WeaponVisual>;
  private currentWeapon: WeaponType = "pistol";
  private elapsed = 0;
  /** Current recoil offset (camera-local), decayed toward zero every frame — see update(). */
  private recoilOffset = new THREE.Vector3(0, 0, 0);
  private empty = false;
  private activeFlash: { visual: WeaponVisual; timerMs: number; durationMs: number } | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.root = new THREE.Group();
    this.root.position.copy(VIEWMODEL_BASE_POSITION);
    camera.add(this.root);

    this.visuals = {
      pistol: buildPistolVisual(WEAPON_STATS.pistol.color),
      rifle: buildRifleVisual(WEAPON_STATS.rifle.color),
      grenade_launcher: buildGrenadeLauncherVisual(WEAPON_STATS.grenade_launcher.color),
    };
    for (const type of WEAPON_ORDER) {
      const visual = this.visuals[type];
      visual.group.visible = type === this.currentWeapon;
      this.root.add(visual.group);
    }
  }

  /** Swap which weapon's model is shown (reacts to LoadoutMessage.equippedWeapon — no new server message). */
  setWeapon(weapon: WeaponType): void {
    if (weapon === this.currentWeapon) return;
    this.visuals[this.currentWeapon].group.visible = false;
    this.currentWeapon = weapon;
    this.visuals[weapon].group.visible = true;
    this.applyEmptyState();
  }

  /** Dim the currently-equipped model when its ammo is 0 (matches the HUD's existing "EMPTY" state) — restores full color once ammo is available again. */
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

  /** Fire recoil kick + muzzle flash, synced with the existing onFire trigger (client/src/main.ts, also driving CombatHud.showMuzzleFlash()) — reuses that same trigger, no second event source. */
  triggerFire(weapon: WeaponType): void {
    const profile = RECOIL_PROFILES[weapon];
    this.recoilOffset.set(0, profile.kickUp, profile.kickBack);

    const visual = this.visuals[weapon];
    visual.flashMesh.visible = true;
    visual.flashMaterial.opacity = 1;
    visual.flashMesh.scale.setScalar(0.6);
    this.activeFlash = { visual, timerMs: 0, durationMs: profile.flashDurationMs };
  }

  /** Advance idle sway + recoil/flash easing by dt seconds — call once per render frame. */
  update(dt: number): void {
    this.elapsed += dt;

    const swayX = Math.sin(this.elapsed * SWAY_SPEED) * SWAY_AMPLITUDE_X;
    const swayY = Math.abs(Math.sin(this.elapsed * SWAY_SPEED * 2)) * SWAY_AMPLITUDE_Y;

    // Exponential ease-back toward rest — a simple, no-dependency way to get
    // a snappy kick followed by a smooth return (EPIC 10 spec: "a simple
    // lerp-based animation is fine, no animation library needed").
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
