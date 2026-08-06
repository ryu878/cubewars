import {
  MOVEMENT,
  type MapBox,
  type PickupCategory,
  type PickupSpawnPoint,
  type Vector3,
  type WeaponType,
} from "@cubewars/shared";

const WALL_HEIGHT = 4;
const WALL_Y = WALL_HEIGHT / 2;
const CRATE_HEIGHT = 1.2;
const CRATE_Y = CRATE_HEIGHT / 2;

const MAZE_HALF_WIDTH = 22;
const CHUNK_LENGTH = 28;
const KEEP_AHEAD_CHUNKS = 16;
const KEEP_BEHIND_CHUNKS = 3;
const FOG_START_Z = 16;
const FOG_SPEED_METERS_PER_SECOND = 2.4;
const FOG_DAMAGE_PER_SECOND = 12;

export interface EndlessRuntimeState {
  fogZ: number;
  distanceMeters: number;
}

export class EndlessWorld {
  private generatedUntilChunk = 0;
  private boxes: MapBox[] = [];
  private pickups: PickupSpawnPoint[] = [];
  private botSpawns: Vector3[] = [];
  private fogZ = FOG_START_Z;
  private furthestDistanceMeters = 0;

  constructor() {
    this.ensureGeneratedToDistance(0);
  }

  getGeometry(): readonly MapBox[] {
    return this.boxes;
  }

  getPickups(): readonly PickupSpawnPoint[] {
    return this.pickups;
  }

  getSpawnPoints(): readonly Vector3[] {
    return [{ x: 0, y: MOVEMENT.groundY, z: 0 }];
  }

  getBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return {
      minX: -MAZE_HALF_WIDTH - 2,
      maxX: MAZE_HALF_WIDTH + 2,
      minZ: -this.generatedUntilChunk * CHUNK_LENGTH,
      maxZ: 20,
    };
  }

  update(dtSeconds: number, playerPosition: Vector3 | null): EndlessRuntimeState {
    this.fogZ -= FOG_SPEED_METERS_PER_SECOND * dtSeconds;
    if (playerPosition) {
      this.furthestDistanceMeters = Math.max(this.furthestDistanceMeters, Math.max(0, -playerPosition.z));
      this.ensureGeneratedToDistance(this.furthestDistanceMeters + KEEP_AHEAD_CHUNKS * CHUNK_LENGTH);
      this.trimBehind(playerPosition.z);
    }
    return this.state();
  }

  state(): EndlessRuntimeState {
    return {
      fogZ: this.fogZ,
      distanceMeters: this.furthestDistanceMeters,
    };
  }

  isInFog(position: Vector3): boolean {
    return position.z > this.fogZ;
  }

  fogDamagePerTick(dtSeconds: number): number {
    return Math.max(1, Math.round(FOG_DAMAGE_PER_SECOND * dtSeconds));
  }

  takeBotSpawns(maxCount: number, playerZ: number): Vector3[] {
    const ready = this.botSpawns
      .filter((point) => point.z < playerZ - 24)
      .sort((a, b) => b.z - a.z)
      .slice(0, maxCount);
    const used = new Set(ready.map((point) => `${point.x}:${point.z}`));
    this.botSpawns = this.botSpawns.filter((point) => !used.has(`${point.x}:${point.z}`));
    return ready;
  }

  private ensureGeneratedToDistance(distanceMeters: number): void {
    const neededChunk = Math.max(KEEP_AHEAD_CHUNKS, Math.ceil(distanceMeters / CHUNK_LENGTH));
    while (this.generatedUntilChunk < neededChunk) {
      this.generatedUntilChunk += 1;
      this.generateChunk(this.generatedUntilChunk);
    }
  }

  private trimBehind(playerZ: number): void {
    const trimAfterZ = playerZ + KEEP_BEHIND_CHUNKS * CHUNK_LENGTH;
    this.boxes = this.boxes.filter((box) => box.center.z - box.size.z / 2 <= trimAfterZ);
    this.pickups = this.pickups.filter((pickup) => pickup.position.z <= trimAfterZ);
  }

  private generateChunk(index: number): void {
    const northZ = -(index - 1) * CHUNK_LENGTH;
    const centerZ = northZ - CHUNK_LENGTH / 2;
    const southZ = northZ - CHUNK_LENGTH;
    const prefix = `endless_${index}`;

    this.boxes.push(
      {
        id: `${prefix}_west_wall`,
        kind: "wall",
        center: { x: -MAZE_HALF_WIDTH, y: WALL_Y, z: centerZ },
        size: { x: 1, y: WALL_HEIGHT, z: CHUNK_LENGTH },
      },
      {
        id: `${prefix}_east_wall`,
        kind: "wall",
        center: { x: MAZE_HALF_WIDTH, y: WALL_Y, z: centerZ },
        size: { x: 1, y: WALL_HEIGHT, z: CHUNK_LENGTH },
      },
    );

    const gapIndex = index % 3;
    const laneCenters = [-14, 0, 14];
    for (const [laneIndex, x] of laneCenters.entries()) {
      if (laneIndex === gapIndex) continue;
      this.boxes.push({
        id: `${prefix}_gate_${laneIndex}`,
        kind: "wall",
        center: { x, y: WALL_Y, z: centerZ - 2 },
        size: { x: 8, y: WALL_HEIGHT, z: 1 },
      });
    }

    const crateX = laneCenters[(index + 1) % laneCenters.length];
    this.boxes.push({
      id: `${prefix}_crate`,
      kind: "crate",
      center: { x: crateX, y: CRATE_Y, z: centerZ + 6 },
      size: { x: 2, y: CRATE_HEIGHT, z: 2 },
    });

    this.addPickup(index, "health", undefined, { x: laneCenters[index % 3], y: 0, z: centerZ + 4 });
    if (index % 2 === 0) this.addPickup(index, "ammo", "rifle", { x: laneCenters[(index + 1) % 3], y: 0, z: centerZ - 5 });
    if (index % 4 === 0) this.addPickup(index, "weapon", "rifle", { x: laneCenters[(index + 2) % 3], y: 0, z: centerZ - 1 });
    if (index % 6 === 0) this.addPickup(index, "weapon", "grenade_launcher", { x: 0, y: 0, z: centerZ - 9 });
    if (index % 5 === 0) this.addPickup(index, "armor", undefined, { x: -laneCenters[index % 3], y: 0, z: centerZ + 9 });

    if (index >= 2) {
      this.botSpawns.push({ x: laneCenters[(index + 2) % 3], y: MOVEMENT.groundY, z: southZ + 8 });
      if (index % 5 === 0) {
        this.botSpawns.push({ x: laneCenters[index % 3], y: MOVEMENT.groundY, z: southZ + 15 });
      }
    }
  }

  private addPickup(index: number, category: PickupCategory, weapon: WeaponType | undefined, position: Vector3): void {
    this.pickups.push({
      id: `endless_${index}_${category}${weapon ? `_${weapon}` : ""}`,
      category,
      weapon,
      position,
    });
  }
}
