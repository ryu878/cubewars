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
//
// EPIC 30 Story 30.2/30.3: a second visual pass — weapon pickups gained a
// darker per-weapon accent material + 2-3 extra detail primitives each
// (mirroring the viewmodel identity in client/src/viewmodel.ts, same
// silhouette language, not identical geometry), the ammo crate gained a
// second "lid stripe" accent material in the weapon's color (still a plain
// crate body, so it stays visually smaller/more mundane than the weapon
// pickup per the EPIC 6/10 rule), and the armor pickup was redesigned from a
// hex-plate-disc-plus-boss into a breastplate-with-strap-and-rivets
// silhouette so it unambiguously reads as "armor". Still mesh/material-only:
// PICKUP_RADIUS and proximity/collision logic are untouched.
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
/** Neutral crate-body color (EPIC 30 Story 30.2) — the weapon's own color is now reserved for the lid stripe accent, so "ammo crate" reads as one consistent neutral prop family, only tagged by color for which weapon it refills. */
const AMMO_CRATE_BODY_COLOR = 0x5a4a36;
/** The lid stripe band, in the weapon's own color, sitting on top of the crate body. */
const AMMO_LID_SIZE = { x: 0.59, y: 0.1, z: 0.59 };

/** Health pickup (EPIC 7): a small white medkit box, center-height similar to the ammo crate. */
const HEALTH_MESH_SIZE = { x: 0.6, y: 0.4, z: 0.6 };
const HEALTH_MESH_CENTER_Y = HEALTH_MESH_SIZE.y / 2;
/** The red cross mark sitting on top of the health box — two thin overlapping bars. */
const HEALTH_CROSS_BAR_SIZE = { x: 0.44, y: 0.08, z: 0.12 };

/** Armor pickup (EPIC 7 / redesigned EPIC 10 / redesigned again EPIC 30 Story 30.3): a breastplate silhouette (main plate + collar guard + raised center ridge + a diagonal strap + corner rivets), reading unambiguously as "armor" rather than an abstract plate/gem shape. */
const ARMOR_PLATE_SIZE = { x: 0.62, y: 0.78, z: 0.14 };
const ARMOR_COLLAR_SIZE = { x: 0.34, y: 0.18, z: 0.14 };
const ARMOR_RIDGE_SIZE = { x: 0.08, y: 0.7, z: 0.06 };
const ARMOR_STRAP_SIZE = { x: 0.7, y: 0.13, z: 0.06 };
const ARMOR_RIVET_SIZE = { x: 0.06, y: 0.06, z: 0.06 };
const ARMOR_PLATE_CENTER_Y = 0.55;
/** Rivet/trim accent — a light steel highlight distinct from the ARMOR_PICKUP_COLOR base, reused for the center ridge too. */
const ARMOR_TRIM_COLOR = 0xb9c2cc;
/** Strap accent — a leather-brown band across the plate, the single strongest "this is armor, not a gem" visual cue (Story 30.3). */
const ARMOR_STRAP_COLOR = 0x6b4a2b;

/** Shared neutral gunmetal trim for weapon-pickup metal details (barrel tips/sights/muzzle rims) — same value and rationale as METAL_ACCENT_COLOR in client/src/viewmodel.ts: never a weapon's *primary* identity color, so it never competes with WEAPON_STATS[...].color for weapon-to-weapon distinction. */
const METAL_TRIM_COLOR = 0x3a3f45;

/** Darkens a weapon's primary color for its grip/stock/magazine accent parts — same helper approach as client/src/viewmodel.ts, keeps the accent tied to that weapon's own identity color instead of an unrelated new color. */
function darken(color: number, factor: number): number {
  return new THREE.Color(color).multiplyScalar(factor).getHex();
}

/**
 * Composite weapon-pickup silhouettes (EPIC 10 Story 10.3, extended EPIC 30
 * Story 30.2): pistol is compact/small, rifle is longer/elongated, grenade
 * launcher is bulky (thick radius) — each now built from a base-color body
 * plus a darker accent (grip/stock/magazine) and a shared metal accent
 * (barrel tip/sight/muzzle rim), mirroring the viewmodel identity in
 * client/src/viewmodel.ts (same silhouette language, not identical
 * geometry). Weapon pickups keep glowing (emissive), ammo crates stay plain.
 */
function buildWeaponPickupMesh(
  weaponType: WeaponType,
  bodyMaterial: THREE.Material,
  accentMaterial: THREE.Material,
  metalMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();

  if (weaponType === "pistol") {
    // Compact: short grip block + a slim stub barrel — smallest silhouette of the three.
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.4, 0.22), accentMaterial);
    grip.position.set(0, 0.2, 0.06);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.42), bodyMaterial);
    barrel.position.set(0, 0.42, -0.12);
    const barrelTip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), metalMaterial);
    barrelTip.position.set(0, 0.42, -0.36);
    const sightNub = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.06), metalMaterial);
    sightNub.position.set(0, 0.55, 0.06);
    group.add(grip, barrel, barrelTip, sightNub);
    return group;
  }

  if (weaponType === "rifle") {
    // Elongated: stock + body + a protruding barrel — visibly longer than the pistol.
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.42), accentMaterial);
    stock.position.set(0, 0.5, 0.32);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.55), bodyMaterial);
    body.position.set(0, 0.5, -0.15);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 10), bodyMaterial);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.5, -0.68);
    const muzzleRim = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 10), metalMaterial);
    muzzleRim.rotation.x = Math.PI / 2;
    muzzleRim.position.set(0, 0.5, -0.95);
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.16), accentMaterial);
    magazine.position.set(0, 0.28, -0.05);
    magazine.rotation.x = -0.25;
    group.add(stock, body, barrel, muzzleRim, magazine);
    return group;
  }

  // grenade_launcher — bulky: thick tube + wide muzzle, reads as "heavy weapon" via bulk, not length.
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.4), accentMaterial);
  stock.position.set(0, 0.45, 0.25);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.75, 12), bodyMaterial);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.45, -0.2);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.15, 12), bodyMaterial);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.45, -0.65);
  const muzzleRim = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 12), metalMaterial);
  muzzleRim.rotation.x = Math.PI / 2;
  muzzleRim.position.set(0, 0.45, -0.73);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.14), accentMaterial);
  handle.position.set(0, 0.2, -0.02);
  group.add(stock, tube, muzzle, muzzleRim, handle);
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
      // EPIC 30 Story 30.3: redesigned again from the EPIC 10 hex-plate-plus-
      // boss (still read as an abstract faceted gem) into a breastplate
      // silhouette: a main plate, a raised collar guard on top, a raised
      // center ridge, a diagonal strap, and corner rivets — reads
      // unambiguously as "armor", not a generic colored primitive.
      const group = new THREE.Group();
      group.position.y = ARMOR_PLATE_CENTER_Y;

      const baseMaterial = new THREE.MeshStandardMaterial({
        color: ARMOR_PICKUP_COLOR,
        emissive: ARMOR_PICKUP_COLOR,
        emissiveIntensity: 0.3,
      });
      const trimMaterial = new THREE.MeshStandardMaterial({
        color: ARMOR_TRIM_COLOR,
        emissive: ARMOR_TRIM_COLOR,
        emissiveIntensity: 0.15,
        metalness: 0.6,
        roughness: 0.4,
      });
      const strapMaterial = new THREE.MeshStandardMaterial({ color: ARMOR_STRAP_COLOR, roughness: 0.85 });

      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(ARMOR_PLATE_SIZE.x, ARMOR_PLATE_SIZE.y, ARMOR_PLATE_SIZE.z),
        baseMaterial,
      );
      group.add(plate);

      const collar = new THREE.Mesh(
        new THREE.BoxGeometry(ARMOR_COLLAR_SIZE.x, ARMOR_COLLAR_SIZE.y, ARMOR_COLLAR_SIZE.z),
        baseMaterial,
      );
      collar.position.y = ARMOR_PLATE_SIZE.y / 2 + ARMOR_COLLAR_SIZE.y / 2 - 0.02;
      group.add(collar);

      const ridge = new THREE.Mesh(
        new THREE.BoxGeometry(ARMOR_RIDGE_SIZE.x, ARMOR_RIDGE_SIZE.y, ARMOR_RIDGE_SIZE.z),
        trimMaterial,
      );
      ridge.position.z = ARMOR_PLATE_SIZE.z / 2 + ARMOR_RIDGE_SIZE.z / 2;
      group.add(ridge);

      const strap = new THREE.Mesh(
        new THREE.BoxGeometry(ARMOR_STRAP_SIZE.x, ARMOR_STRAP_SIZE.y, ARMOR_STRAP_SIZE.z),
        strapMaterial,
      );
      strap.position.z = ARMOR_PLATE_SIZE.z / 2 + ARMOR_STRAP_SIZE.z / 2 - 0.01;
      strap.rotation.z = 0.5;
      group.add(strap);

      const rivetOffsets: Array<[number, number]> = [
        [-ARMOR_PLATE_SIZE.x / 2 + 0.09, ARMOR_PLATE_SIZE.y / 2 - 0.09],
        [ARMOR_PLATE_SIZE.x / 2 - 0.09, ARMOR_PLATE_SIZE.y / 2 - 0.09],
        [-ARMOR_PLATE_SIZE.x / 2 + 0.09, -ARMOR_PLATE_SIZE.y / 2 + 0.09],
        [ARMOR_PLATE_SIZE.x / 2 - 0.09, -ARMOR_PLATE_SIZE.y / 2 + 0.09],
      ];
      for (const [rx, ry] of rivetOffsets) {
        const rivet = new THREE.Mesh(
          new THREE.BoxGeometry(ARMOR_RIVET_SIZE.x, ARMOR_RIVET_SIZE.y, ARMOR_RIVET_SIZE.z),
          trimMaterial,
        );
        rivet.position.set(rx, ry, ARMOR_PLATE_SIZE.z / 2 + ARMOR_RIVET_SIZE.z / 2);
        group.add(rivet);
      }

      return group;
    }

    // "weapon": composite, distinct-silhouette shapes per Story 10.3, now
    // multi-material per Story 30.2 (base body + darker per-weapon accent +
    // shared metal trim, mirroring the viewmodel).
    if (category === "weapon" && weapon) {
      const color = WEAPON_STATS[weapon].color;
      // Weapon pickups glow slightly (emissive) so the silhouette reads
      // clearly against the sandy ground even at range; ammo crates (below)
      // stay a plain lit material to look visually smaller/more mundane.
      const bodyMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 });
      const accentMaterial = new THREE.MeshStandardMaterial({
        color: darken(color, 0.4),
        emissive: darken(color, 0.4),
        emissiveIntensity: 0.2,
      });
      const metalMaterial = new THREE.MeshStandardMaterial({
        color: METAL_TRIM_COLOR,
        metalness: 0.85,
        roughness: 0.3,
      });
      return buildWeaponPickupMesh(weapon, bodyMaterial, accentMaterial, metalMaterial);
    }

    // "ammo" (EPIC 6, extended EPIC 30 Story 30.2): a small neutral crate
    // body with a lid stripe accent in the weapon's color — still visually
    // smaller/plainer than the weapon pickup itself (no emissive glow).
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

  /**
   * Reconcile visibility against the server's latest pickup on/off state
   * (PickupStateMessage). EPIC 14 Story 14.5: also detects a per-id
   * `active: true -> false` transition and fires `onConsumed` for it — see
   * PickupRendererOptions doc comment above for the exact firing rule.
   */
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
