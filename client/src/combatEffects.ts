import * as THREE from "three";
import type { DamageZone, ShotTrace, Vector3, WeaponType } from "@cubewars/shared";

const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface ActiveProjectileVisual {
  id: string | null;
  weapon: WeaponType;
  root: THREE.Group;
  body: THREE.Object3D;
  trail: THREE.Mesh | null;
  origin: THREE.Vector3;
  end: THREE.Vector3;
  direction: THREE.Vector3;
  totalDistance: number;
  travelled: number;
  speed: number;
}

interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
  gravity: boolean;
}

function toVector3(value: Vector3): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function configureSegment(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 1e-5) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, delta.normalize());
}

function makeCylinder(radius: number, color: number, opacity: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 1, 8),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );
}

function makeProjectileBody(weapon: WeaponType): { body: THREE.Object3D; trail: THREE.Mesh | null } {
  if (weapon === "pistol") {
    const body = makeCylinder(0.025, 0x66f8ff, 0.9);
    const trail = makeCylinder(0.012, 0xb9fbff, 0.35);
    return { body, trail };
  }

  if (weapon === "rifle") {
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    const trail = makeCylinder(0.018, 0xffffff, 0.42);
    return { body, trail };
  }

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 16, 12),
    new THREE.MeshStandardMaterial({
      color: 0x9b30ff,
      emissive: 0x3b0a66,
      emissiveIntensity: 0.8,
      roughness: 0.45,
    }),
  );
  const trail = makeCylinder(0.055, 0xb86cff, 0.38);
  return { body, trail };
}

export class CombatEffects {
  private projectiles: ActiveProjectileVisual[] = [];
  private particles: Particle[] = [];

  constructor(private scene: THREE.Scene) {}

  spawnShot(weapon: WeaponType, trace: ShotTrace, projectileId?: string): void {
    const origin = toVector3(trace.origin);
    const end = toVector3(trace.end);
    const delta = end.clone().sub(origin);
    const totalDistance = delta.length();
    if (totalDistance <= 1e-5) return;

    const root = new THREE.Group();
    root.name = projectileId ? `projectile:${projectileId}` : `shot:${weapon}`;
    const { body, trail } = makeProjectileBody(weapon);
    root.add(body);
    if (trail) root.add(trail);
    this.scene.add(root);

    this.projectiles.push({
      id: projectileId ?? null,
      weapon,
      root,
      body,
      trail,
      origin,
      end,
      direction: delta.normalize(),
      totalDistance,
      travelled: 0,
      speed: trace.speed,
    });
  }

  spawnHit(point: Vector3, hitZone?: DamageZone): void {
    const origin = toVector3(point);
    const count = hitZone === "head" ? 18 : hitZone === "legs" ? 10 : 14;
    const size = hitZone === "head" ? 0.105 : 0.085;

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xff4a4a : 0xb81018 }),
      );
      mesh.position.copy(origin);
      const spread = new THREE.Vector3(
        (Math.random() * 2 - 1) * 1.7,
        Math.random() * 1.9 + 0.25,
        (Math.random() * 2 - 1) * 1.7,
      );
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: spread,
        age: 0,
        lifetime: 0.55 + Math.random() * 0.25,
        gravity: true,
      });
    }
  }

  spawnExplosion(point: Vector3): void {
    const origin = toVector3(point);
    const material = new THREE.MeshBasicMaterial({ color: 0xd287ff, transparent: true, opacity: 0.5 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 18, 12), material);
    mesh.name = "grenade-explosion";
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3(0, 0, 0),
      age: 0,
      lifetime: 0.3,
      gravity: false,
    });
  }

  impactProjectile(projectileId: string, point: Vector3): void {
    const index = this.projectiles.findIndex((projectile) => projectile.id === projectileId);
    if (index >= 0) {
      const [projectile] = this.projectiles.splice(index, 1);
      this.scene.remove(projectile.root);
    }
    this.spawnExplosion(point);
  }

  update(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      projectile.travelled = Math.min(projectile.totalDistance, projectile.travelled + projectile.speed * dt);

      const head = projectile.origin.clone().addScaledVector(projectile.direction, projectile.travelled);
      if (projectile.weapon === "pistol") {
        const tail = projectile.origin
          .clone()
          .addScaledVector(projectile.direction, Math.max(0, projectile.travelled - 8));
        configureSegment(projectile.body as THREE.Mesh, tail, head);
      } else {
        projectile.body.position.copy(head);
      }

      if (projectile.trail) {
        const trailLength = projectile.weapon === "grenade_launcher" ? 1.4 : 2.8;
        const tail = projectile.origin
          .clone()
          .addScaledVector(projectile.direction, Math.max(0, projectile.travelled - trailLength));
        configureSegment(projectile.trail, tail, head);
      }

      if (projectile.travelled >= projectile.totalDistance) {
        this.scene.remove(projectile.root);
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.age += dt;
      const t = particle.age / particle.lifetime;
      if (t >= 1) {
        this.scene.remove(particle.mesh);
        this.particles.splice(i, 1);
        continue;
      }

      if (particle.gravity) particle.velocity.y -= 5.5 * dt;
      particle.mesh.position.addScaledVector(particle.velocity, dt);
      particle.mesh.rotation.x += dt * 7;
      particle.mesh.rotation.y += dt * 5;
      const scale = particle.gravity ? 1 - t : 1 + t * 4;
      particle.mesh.scale.setScalar(Math.max(0.05, scale));
      const material = particle.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.transparent = true;
        material.opacity = Math.max(0, 1 - t);
      }
    }
  }
}
