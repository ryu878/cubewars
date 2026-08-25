// EPIC 44: world-space kill-loot VFX. Spawns glowing low-poly meshes for
// server-listed grants only — never invents loot kinds. Cosmetic only: no
// pickup radius, no inventory mutation.

import * as THREE from "three";
import type { EconomyKillLootFxMessage, KillLootFxKind, Vector3 } from "@cubewars/shared";

const CHEST_Y_OFFSET = 1.15;
const FLIGHT_DURATION_SEC = 0.9;
const STAGGER_SEC = 0.07;
const ABSORB_POP_SEC = 0.12;
const ARC_HEIGHT = 1.35;

interface ActiveLootPiece {
  mesh: THREE.Object3D;
  kind: KillLootFxKind;
  start: THREE.Vector3;
  end: THREE.Vector3;
  age: number;
  delay: number;
  duration: number;
  baseScale: number;
}

function toVec3(value: Vector3): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function emissiveMat(
  color: number,
  emissive: number,
  intensity: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    roughness: 0.35,
    metalness: 0.25,
  });
}

function buildLootMesh(kind: KillLootFxKind): { root: THREE.Object3D; size: number } {
  const root = new THREE.Group();
  root.name = `killLoot:${kind}`;

  switch (kind) {
    case "gem": {
      const size = 0.48;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(size * 0.55, 0),
        emissiveMat(0x3ad4ff, 0x1aa8ff, 1.35),
      );
      root.add(mesh);
      return { root, size };
    }
    case "shard": {
      const size = 0.52;
      const mesh = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.22, size * 0.95, 5),
        emissiveMat(0xd14dff, 0x9b20ff, 1.25),
      );
      mesh.rotation.z = Math.PI * 0.12;
      root.add(mesh);
      return { root, size };
    }
    case "amulet": {
      const size = 0.5;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(size * 0.28, size * 0.08, 8, 16),
        emissiveMat(0xffc94a, 0xff9a1a, 1.1),
      );
      const disk = new THREE.Mesh(
        new THREE.CircleGeometry(size * 0.16, 10),
        emissiveMat(0xffe08a, 0xffb300, 0.95),
      );
      disk.rotation.x = -Math.PI / 2;
      root.add(ring, disk);
      return { root, size };
    }
    case "gold": {
      const size = 0.42;
      const coin = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.38, size * 0.38, size * 0.12, 12),
        emissiveMat(0xffd24a, 0xff9e1a, 1.2),
      );
      coin.rotation.x = Math.PI / 2;
      const nugget = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.35, size * 0.28, size * 0.3),
        emissiveMat(0xffb020, 0xff7a00, 0.9),
      );
      nugget.position.set(size * 0.22, -size * 0.05, size * 0.1);
      root.add(coin, nugget);
      return { root, size };
    }
    case "egg": {
      const size = 0.5;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.38, 12, 10),
        emissiveMat(0xf5e6c8, 0xffc8a0, 0.75),
      );
      mesh.scale.set(1, 1.28, 1);
      root.add(mesh);
      return { root, size };
    }
    case "stimulator": {
      const size = 0.55;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.08, size * 0.1, size * 0.85, 8),
        emissiveMat(0x7dff4a, 0x3dff1a, 1.15),
      );
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.07, size * 0.2, 6),
        emissiveMat(0xd8ffe0, 0x90ffb0, 0.85),
      );
      tip.position.y = size * 0.5;
      root.add(body, tip);
      return { root, size };
    }
    case "repair_kit": {
      const size = 0.45;
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.7, size * 0.45, size * 0.55),
        emissiveMat(0x8a93a0, 0x4a5560, 0.55),
      );
      const accent = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.55, size * 0.12, size * 0.12),
        emissiveMat(0xff7a2a, 0xff4a00, 1.05),
      );
      accent.position.y = size * 0.22;
      root.add(crate, accent);
      return { root, size };
    }
    default: {
      const size = 0.4;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.5, size * 0.5, size * 0.5),
        emissiveMat(0xffffff, 0xaaaaaa, 0.6),
      );
      root.add(mesh);
      return { root, size };
    }
  }
}

function sampleArc(start: THREE.Vector3, end: THREE.Vector3, t: number): THREE.Vector3 {
  const mid = start.clone().lerp(end, 0.5);
  mid.y += ARC_HEIGHT;
  const omt = 1 - t;
  return start
    .clone()
    .multiplyScalar(omt * omt)
    .add(mid.clone().multiplyScalar(2 * omt * t))
    .add(end.clone().multiplyScalar(t * t));
}

/**
 * Renders server-authored kill loot flying from victim toward killer.
 * Call `spawnFromMessage` on `economy_kill_loot_fx`; `update(dt)` each frame.
 */
export class KillLootVfx {
  private pieces: ActiveLootPiece[] = [];

  constructor(private scene: THREE.Scene) {}

  spawnFromMessage(message: EconomyKillLootFxMessage): void {
    if (!message.grants || message.grants.length === 0) return;

    const victimBase = toVec3(message.victimPosition);
    victimBase.y += CHEST_Y_OFFSET;
    const killerBase = toVec3(message.killerPosition);
    killerBase.y += CHEST_Y_OFFSET;

    message.grants.forEach((grant, index) => {
      const { root, size } = buildLootMesh(grant.kind);
      const lateral = (index - (message.grants.length - 1) / 2) * 0.22;
      const start = victimBase.clone().add(new THREE.Vector3(lateral, 0.05 * index, lateral * 0.35));
      const end = killerBase.clone();
      root.position.copy(start);
      root.scale.setScalar(1);
      this.scene.add(root);
      this.pieces.push({
        mesh: root,
        kind: grant.kind,
        start,
        end,
        age: 0,
        delay: index * STAGGER_SEC,
        duration: FLIGHT_DURATION_SEC,
        baseScale: Math.max(0.85, Math.min(1.25, size / 0.45)),
      });
    });
  }

  update(dt: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i]!;
      piece.age += dt;
      const flightAge = piece.age - piece.delay;
      if (flightAge < 0) {
        piece.mesh.visible = false;
        continue;
      }
      piece.mesh.visible = true;

      const totalLife = piece.duration + ABSORB_POP_SEC;
      if (flightAge >= totalLife) {
        this.disposePiece(piece);
        this.pieces.splice(i, 1);
        continue;
      }

      if (flightAge <= piece.duration) {
        const t = Math.min(1, flightAge / piece.duration);
        const eased = t * t * (3 - 2 * t);
        piece.mesh.position.copy(sampleArc(piece.start, piece.end, eased));
        piece.mesh.rotation.y += dt * (2.4 + (piece.kind === "shard" ? 1.2 : 0));
        piece.mesh.rotation.x += dt * 1.1;
        const pulse = 1 + 0.08 * Math.sin(flightAge * 14);
        piece.mesh.scale.setScalar(piece.baseScale * pulse);
      } else {
        const popT = (flightAge - piece.duration) / ABSORB_POP_SEC;
        piece.mesh.position.copy(piece.end);
        const popScale = piece.baseScale * (1.35 * (1 - popT) + 0.2);
        piece.mesh.scale.setScalar(Math.max(0.01, popScale));
        this.setOpacity(piece.mesh, 1 - popT);
      }
    }
  }

  clear(): void {
    for (const piece of this.pieces) this.disposePiece(piece);
    this.pieces.length = 0;
  }

  private setOpacity(root: THREE.Object3D, opacity: number): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of materials) {
        const std = mat as THREE.MeshStandardMaterial;
        if ("opacity" in std) {
          std.transparent = true;
          std.opacity = opacity;
        }
      }
    });
  }

  private disposePiece(piece: ActiveLootPiece): void {
    this.scene.remove(piece.mesh);
    piece.mesh.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of materials) mat.dispose();
    });
  }
}
