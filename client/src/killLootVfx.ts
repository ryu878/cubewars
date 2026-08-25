// EPIC 44: world-space kill-loot VFX. Spawns glowing low-poly meshes for
// server-listed grants only — never invents loot kinds. Cosmetic only: no
// pickup radius, no inventory mutation.
//
// F-001 / F-002: outdoor FPS readability — larger characteristic size toward
// the upper AC band, stronger emissive + unlit silhouette shells, higher arc
// so flight clears ground/wood albedo, frustumCulled off for midflight FOV.

import * as THREE from "three";
import type { EconomyKillLootFxMessage, KillLootFxKind, Vector3 } from "@cubewars/shared";

const CHEST_Y_OFFSET = 1.45;
const FLIGHT_DURATION_SEC = 0.9;
const STAGGER_SEC = 0.07;
const ABSORB_POP_SEC = 0.12;
const ARC_HEIGHT = 2.1;
/** Outdoor readability: scale meshes above the raw geometry size a bit. */
const OUTDOOR_SCALE = 1.35;

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
    roughness: 0.28,
    metalness: 0.2,
    // Keep glow punchy under ACES/outdoor exposure so sand/wood do not wash it out.
    toneMapped: false,
  });
}

/** High-contrast unlit halo — readable against bright sky / wood albedo. */
function glowShell(radius: number, color: number, opacity = 0.55): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 8), mat);
  shell.renderOrder = 2;
  shell.frustumCulled = false;
  return shell;
}

function markReadable(root: THREE.Object3D): void {
  root.frustumCulled = false;
  root.traverse((obj) => {
    obj.frustumCulled = false;
  });
}

function buildLootMesh(kind: KillLootFxKind): { root: THREE.Object3D; size: number } {
  const root = new THREE.Group();
  root.name = `killLoot:${kind}`;

  switch (kind) {
    case "gem": {
      const size = 0.62;
      const mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(size * 0.55, 0),
        emissiveMat(0x5ce8ff, 0x2ec8ff, 2.1),
      );
      root.add(mesh, glowShell(size * 0.42, 0x3ad4ff, 0.4));
      markReadable(root);
      return { root, size };
    }
    case "shard": {
      // F-002: fat wedge + strong magenta silhouette (was a thin cone ~36 px).
      const size = 0.78;
      const wedge = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.38, size * 1.05, 5),
        emissiveMat(0xff66ff, 0xd020ff, 2.4),
      );
      wedge.rotation.z = Math.PI * 0.18;
      const facet = new THREE.Mesh(
        new THREE.TetrahedronGeometry(size * 0.32, 0),
        emissiveMat(0xe040ff, 0xb000ff, 2.0),
      );
      facet.position.set(size * 0.12, size * 0.08, size * 0.05);
      facet.rotation.set(0.4, 0.6, 0.2);
      root.add(wedge, facet, glowShell(size * 0.48, 0xff40ff, 0.5));
      markReadable(root);
      return { root, size };
    }
    case "amulet": {
      const size = 0.62;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(size * 0.3, size * 0.1, 8, 16),
        emissiveMat(0xffd060, 0xffa020, 1.8),
      );
      const disk = new THREE.Mesh(
        new THREE.CircleGeometry(size * 0.18, 10),
        emissiveMat(0xffe8a0, 0xffb800, 1.5),
      );
      disk.rotation.x = -Math.PI / 2;
      root.add(ring, disk, glowShell(size * 0.4, 0xffc040, 0.35));
      markReadable(root);
      return { root, size };
    }
    case "gold": {
      // F-001: larger coin/nugget + bright amber shell for outdoor FPS contrast.
      const size = 0.72;
      const coin = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.42, size * 0.42, size * 0.16, 14),
        emissiveMat(0xffe066, 0xffb000, 2.6),
      );
      coin.rotation.x = Math.PI / 2;
      const nugget = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.42, size * 0.34, size * 0.36),
        emissiveMat(0xffc020, 0xff8a00, 2.2),
      );
      nugget.position.set(size * 0.28, -size * 0.04, size * 0.12);
      // Unlit core so midflight pixels stay saturated vs sand/wood.
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.22, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffcc33, toneMapped: false }),
      );
      root.add(coin, nugget, core, glowShell(size * 0.52, 0xffaa00, 0.48));
      markReadable(root);
      return { root, size };
    }
    case "egg": {
      const size = 0.64;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.4, 12, 10),
        emissiveMat(0xfff0d0, 0xffb080, 1.6),
      );
      mesh.scale.set(1, 1.28, 1);
      root.add(mesh, glowShell(size * 0.4, 0xffd0a0, 0.35));
      markReadable(root);
      return { root, size };
    }
    case "stimulator": {
      const size = 0.64;
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.1, size * 0.12, size * 0.9, 8),
        emissiveMat(0x8dff55, 0x4dff20, 1.9),
      );
      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.09, size * 0.22, 6),
        emissiveMat(0xe8ffe8, 0xa0ffb8, 1.4),
      );
      tip.position.y = size * 0.52;
      root.add(body, tip, glowShell(size * 0.36, 0x60ff40, 0.35));
      markReadable(root);
      return { root, size };
    }
    case "repair_kit": {
      const size = 0.6;
      const crate = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.78, size * 0.5, size * 0.6),
        emissiveMat(0xa8b0bc, 0x6a7580, 1.2),
      );
      const accent = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.6, size * 0.14, size * 0.14),
        emissiveMat(0xff8a3a, 0xff5000, 2.0),
      );
      accent.position.y = size * 0.24;
      root.add(crate, accent, glowShell(size * 0.42, 0xff7030, 0.35));
      markReadable(root);
      return { root, size };
    }
    default: {
      const size = 0.5;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size * 0.55, size * 0.55, size * 0.55),
        emissiveMat(0xffffff, 0xcccccc, 1.0),
      );
      root.add(mesh);
      markReadable(root);
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
      const lateral = (index - (message.grants.length - 1) / 2) * 0.32;
      const start = victimBase.clone().add(new THREE.Vector3(lateral, 0.12 * index, lateral * 0.35));
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
        baseScale: OUTDOOR_SCALE * Math.max(0.95, Math.min(1.45, size / 0.55)),
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
        // Brief spawn punch then steady pulse — helps outdoor FOV catch midflight.
        const spawnBoost = flightAge < 0.12 ? 1 + (0.12 - flightAge) * 3.5 : 1;
        const pulse = 1 + 0.12 * Math.sin(flightAge * 14);
        piece.mesh.scale.setScalar(piece.baseScale * pulse * spawnBoost);
      } else {
        const popT = (flightAge - piece.duration) / ABSORB_POP_SEC;
        piece.mesh.position.copy(piece.end);
        const popScale = piece.baseScale * (1.45 * (1 - popT) + 0.2);
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
        const anyMat = mat as THREE.Material & {
          opacity?: number;
          transparent?: boolean;
          userData: Record<string, unknown>;
        };
        if (!("opacity" in anyMat) || anyMat.opacity === undefined) continue;
        if (typeof anyMat.userData.baseOpacity !== "number") {
          anyMat.userData.baseOpacity = anyMat.opacity;
        }
        anyMat.transparent = true;
        anyMat.opacity = (anyMat.userData.baseOpacity as number) * opacity;
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
