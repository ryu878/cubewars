// EPIC 58: cosmetic green respawn column — visible to all clients on RespawnEvent.
// No hitbox or gameplay authority; server position only.

import * as THREE from "three";
import type { Vector3 } from "@cubewars/shared";

const BEAM_DURATION_SEC = 2.5;
const BEAM_TOP_Y = 50;

interface ActiveBeam {
  mesh: THREE.Mesh;
  age: number;
  duration: number;
}

function toVec3(value: Vector3): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

export class SpawnBeamVfx {
  private beams: ActiveBeam[] = [];

  constructor(private scene: THREE.Scene) {}

  spawn(position: Vector3): void {
    const baseY = position.y;
    const height = BEAM_TOP_Y - baseY;
    if (!(height > 0.5)) return;

    const geo = new THREE.CylinderGeometry(0.3, 0.5, height, 14, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x44ff88,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(toVec3(position));
    mesh.position.y = baseY + height / 2;
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    this.beams.push({ mesh, age: 0, duration: BEAM_DURATION_SEC });
  }

  update(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const beam = this.beams[i]!;
      beam.age += dt;
      const t = Math.min(1, beam.age / beam.duration);
      const fade = 1 - t;
      const mat = beam.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.42 * fade * fade;
      if (beam.age >= beam.duration) {
        this.scene.remove(beam.mesh);
        beam.mesh.geometry.dispose();
        mat.dispose();
        this.beams.splice(i, 1);
      }
    }
  }
}
