// EPIC 59: cosmetic mid-map rift ribbon + light per-kind VFX.
// Damage is server-authoritative — this module never touches HP/armor.

import * as THREE from "three";
import type { MapRiftHazard, MapRiftHazardKind } from "@cubewars/shared";

const RIFT_Y = 0.035;
const BUBBLE_COUNT = 14;
const FISH_COUNT = 6;

interface KindStyle {
  color: number;
  emissive: number;
  emissiveIntensity: number;
  opacity: number;
  metalness: number;
  roughness: number;
}

const KIND_STYLE: Record<MapRiftHazardKind, KindStyle> = {
  water_piranha: {
    color: 0x1a4a5c,
    emissive: 0x0a2030,
    emissiveIntensity: 0.35,
    opacity: 0.78,
    metalness: 0.15,
    roughness: 0.55,
  },
  lava: {
    color: 0xc43a10,
    emissive: 0xff5510,
    emissiveIntensity: 0.85,
    opacity: 0.88,
    metalness: 0.2,
    roughness: 0.4,
  },
  acid: {
    color: 0x3cb84a,
    emissive: 0x1a8030,
    emissiveIntensity: 0.55,
    opacity: 0.8,
    metalness: 0.1,
    roughness: 0.45,
  },
  toxic_sludge: {
    color: 0x2a1038,
    emissive: 0x6010a0,
    emissiveIntensity: 0.5,
    opacity: 0.86,
    metalness: 0.25,
    roughness: 0.6,
  },
  oil_fire: {
    color: 0x1a1208,
    emissive: 0xff6010,
    emissiveIntensity: 0.7,
    opacity: 0.9,
    metalness: 0.4,
    roughness: 0.35,
  },
  plasma: {
    color: 0x20c8e0,
    emissive: 0x40ffff,
    emissiveIntensity: 0.95,
    opacity: 0.82,
    metalness: 0.35,
    roughness: 0.25,
  },
  void_ink: {
    color: 0x050508,
    emissive: 0x3040a0,
    emissiveIntensity: 0.4,
    opacity: 0.92,
    metalness: 0.5,
    roughness: 0.3,
  },
  molten_gold: {
    color: 0xc8a020,
    emissive: 0xffc040,
    emissiveIntensity: 0.75,
    opacity: 0.88,
    metalness: 0.65,
    roughness: 0.28,
  },
};

function buildRibbonGeometry(rift: MapRiftHazard): THREE.BufferGeometry {
  const pts = rift.polyline;
  const hw = rift.halfWidth;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * hw;
    const nz = (dx / len) * hw;

    const base = positions.length / 3;
    positions.push(
      a.x + nx, RIFT_Y, a.z + nz,
      a.x - nx, RIFT_Y, a.z - nz,
      b.x + nx, RIFT_Y, b.z + nz,
      b.x - nx, RIFT_Y, b.z - nz,
    );
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function samplePolyline(rift: MapRiftHazard, t: number): { x: number; z: number } {
  const pts = rift.polyline;
  if (pts.length === 0) return { x: 0, z: 0 };
  if (pts.length === 1) return { x: pts[0]!.x, z: pts[0]!.z };
  const segs = pts.length - 1;
  const scaled = Math.min(1, Math.max(0, t)) * segs;
  const i = Math.min(segs - 1, Math.floor(scaled));
  const local = scaled - i;
  const a = pts[i]!;
  const b = pts[i + 1]!;
  return {
    x: a.x + (b.x - a.x) * local,
    z: a.z + (b.z - a.z) * local,
  };
}

export class MapRiftRenderer {
  private group = new THREE.Group();
  private ribbonMat: THREE.MeshStandardMaterial | null = null;
  private bubbleMeshes: THREE.Mesh[] = [];
  private fishMeshes: THREE.Mesh[] = [];
  private sparkMeshes: THREE.Mesh[] = [];
  private age = 0;
  private kind: MapRiftHazardKind | null = null;

  constructor(private scene: THREE.Scene) {
    this.group.name = "map_rift";
    this.scene.add(this.group);
  }

  /** Rebuild from catalog rift (or clear when map has none / endless). */
  setRift(rift: MapRiftHazard | null | undefined): void {
    this.disposeChildren();
    this.kind = null;
    if (!rift || rift.polyline.length < 2) return;

    this.kind = rift.kind;
    const style = KIND_STYLE[rift.kind];
    const geo = buildRibbonGeometry(rift);
    this.ribbonMat = new THREE.MeshStandardMaterial({
      color: style.color,
      emissive: style.emissive,
      emissiveIntensity: style.emissiveIntensity,
      transparent: true,
      opacity: style.opacity,
      metalness: style.metalness,
      roughness: style.roughness,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ribbon = new THREE.Mesh(geo, this.ribbonMat);
    ribbon.name = "rift_ribbon";
    ribbon.renderOrder = 2;
    // Cosmetic only — never block client movement prediction.
    ribbon.raycast = () => undefined;
    this.group.add(ribbon);

    this.spawnKindVfx(rift);
  }

  update(dt: number): void {
    if (!this.kind) return;
    this.age += dt;
    const pulse = 0.85 + 0.15 * Math.sin(this.age * 3.2);
    if (this.ribbonMat) {
      const base = KIND_STYLE[this.kind].emissiveIntensity;
      this.ribbonMat.emissiveIntensity = base * pulse;
    }

    for (let i = 0; i < this.bubbleMeshes.length; i++) {
      const m = this.bubbleMeshes[i]!;
      const phase = this.age * (1.2 + (i % 5) * 0.17) + i;
      m.position.y = RIFT_Y + 0.08 + (Math.sin(phase) * 0.5 + 0.5) * 0.55;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(phase * 1.3));
    }

    for (let i = 0; i < this.fishMeshes.length; i++) {
      const m = this.fishMeshes[i]!;
      const phase = this.age * 0.9 + i * 1.1;
      m.position.y = RIFT_Y + 0.06 + Math.sin(phase) * 0.04;
      m.rotation.y = phase;
    }

    for (let i = 0; i < this.sparkMeshes.length; i++) {
      const m = this.sparkMeshes[i]!;
      const phase = this.age * 2.4 + i;
      m.position.y = RIFT_Y + 0.05 + (0.5 + 0.5 * Math.sin(phase)) * 0.35;
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(phase * 1.7));
    }
  }

  dispose(): void {
    this.disposeChildren();
    this.scene.remove(this.group);
  }

  private spawnKindVfx(rift: MapRiftHazard): void {
    const kind = rift.kind;
    if (kind === "water_piranha" || kind === "toxic_sludge" || kind === "acid") {
      for (let i = 0; i < BUBBLE_COUNT; i++) {
        const p = samplePolyline(rift, (i + 0.5) / BUBBLE_COUNT);
        const geo = new THREE.SphereGeometry(0.06 + (i % 3) * 0.02, 6, 6);
        const mat = new THREE.MeshBasicMaterial({
          color: kind === "acid" ? 0x80ff90 : kind === "toxic_sludge" ? 0xa060ff : 0xa0d0e8,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p.x + ((i % 5) - 2) * 0.12, RIFT_Y + 0.1, p.z);
        mesh.raycast = () => undefined;
        this.group.add(mesh);
        this.bubbleMeshes.push(mesh);
      }
    }

    if (kind === "water_piranha") {
      for (let i = 0; i < FISH_COUNT; i++) {
        const p = samplePolyline(rift, (i + 0.3) / FISH_COUNT);
        const geo = new THREE.ConeGeometry(0.07, 0.22, 5);
        const mat = new THREE.MeshBasicMaterial({
          color: 0x0a2030,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(p.x, RIFT_Y + 0.08, p.z);
        mesh.raycast = () => undefined;
        this.group.add(mesh);
        this.fishMeshes.push(mesh);
      }
    }

    if (
      kind === "lava" ||
      kind === "oil_fire" ||
      kind === "plasma" ||
      kind === "void_ink" ||
      kind === "molten_gold"
    ) {
      const color =
        kind === "lava" || kind === "oil_fire"
          ? 0xff8020
          : kind === "plasma"
            ? 0x80ffff
            : kind === "void_ink"
              ? 0xa0b0ff
              : 0xffe080;
      for (let i = 0; i < 12; i++) {
        const p = samplePolyline(rift, (i + 0.2) / 12);
        const geo = new THREE.SphereGeometry(0.04, 5, 5);
        const mat = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(p.x, RIFT_Y + 0.08, p.z);
        mesh.raycast = () => undefined;
        this.group.add(mesh);
        this.sparkMeshes.push(mesh);
      }
    }
  }

  private disposeChildren(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          for (const m of child.material) m.dispose();
        } else {
          child.material.dispose();
        }
      }
    }
    this.ribbonMat = null;
    this.bubbleMeshes = [];
    this.fishMeshes = [];
    this.sparkMeshes = [];
  }
}
