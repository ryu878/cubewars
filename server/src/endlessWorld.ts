import {
  CRATE_HEIGHT,
  CRATE_Y,
  MOVEMENT,
  WALL_HEIGHT,
  WALL_Y,
  type MapBox,
  type PickupCategory,
  type PickupSpawnPoint,
  type Vector3,
  type WeaponType,
} from "@cubewars/shared";

const MAZE_HALF_WIDTH = 22;
const CHUNK_LENGTH = 28;
const SEGMENT_CHUNKS = 180;
const SEGMENT_LENGTH = SEGMENT_CHUNKS * CHUNK_LENGTH;
const WRAP_AT_Z = -SEGMENT_LENGTH + CHUNK_LENGTH * 3;
const WRAP_TO_Z = -CHUNK_LENGTH * 2;
const WRAP_SHIFT_Z = Math.abs(WRAP_AT_Z - WRAP_TO_Z);
const FOG_START_Z = 16;
const FOG_SPEED_METERS_PER_SECOND = 2.4;
const FOG_DAMAGE_PER_SECOND = 12;
const LANE_CENTERS = [-14, 0, 14] as const;
const LANE_WIDTH = 14;
const INNER_WALL_X = 7;
const INNER_WALL_THICKNESS = 1;
const MAZE_DOOR_HALF_WIDTH = 4;

export interface EndlessRuntimeState {
  fogZ: number;
  distanceMeters: number;
  wrapped: boolean;
  wrapShiftZ: number;
}

export class EndlessWorld {
  private boxes: MapBox[] = [];
  private pickupTemplates: PickupSpawnPoint[] = [];
  private botSpawnTemplates: Vector3[] = [];
  private availableBotSpawns: Vector3[] = [];
  private fogZ = FOG_START_Z;
  private runSeq = 0;
  private segmentLoop = 0;
  private segmentFurthestDistanceMeters = 0;
  private totalDistanceMeters = 0;
  private version = 0;

  constructor() {
    this.buildSegment();
  }

  getGeometry(): readonly MapBox[] {
    return this.boxes;
  }

  getPickups(): readonly PickupSpawnPoint[] {
    return this.pickupTemplates.map((pickup) => ({
      ...pickup,
      id: `run_${this.runSeq}_loop_${this.segmentLoop}_${pickup.id}`,
    }));
  }

  getVersion(): number {
    return this.version;
  }

  getSpawnPoints(): readonly Vector3[] {
    return [{ x: 0, y: MOVEMENT.groundY, z: 0 }];
  }

  getWaypoints(): readonly Vector3[] {
    const pickupPoints = this.pickupTemplates.slice(-24).map((pickup) => pickup.position);
    return [...this.getSpawnPoints(), ...pickupPoints, ...this.availableBotSpawns.slice(-12)];
  }

  reset(): void {
    this.fogZ = FOG_START_Z;
    this.runSeq += 1;
    this.segmentLoop = 0;
    this.segmentFurthestDistanceMeters = 0;
    this.totalDistanceMeters = 0;
    this.availableBotSpawns = this.botSpawnTemplates.map((point) => ({ ...point }));
    this.version += 1;
  }

  getBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return {
      minX: -MAZE_HALF_WIDTH - 2,
      maxX: MAZE_HALF_WIDTH + 2,
      minZ: -SEGMENT_LENGTH,
      maxZ: 20,
    };
  }

  update(dtSeconds: number, playerPosition: Vector3 | null): EndlessRuntimeState {
    this.fogZ -= FOG_SPEED_METERS_PER_SECOND * dtSeconds;
    if (playerPosition) {
      this.segmentFurthestDistanceMeters = Math.max(this.segmentFurthestDistanceMeters, Math.max(0, -playerPosition.z));
      this.totalDistanceMeters = Math.max(
        this.totalDistanceMeters,
        this.segmentLoop * WRAP_SHIFT_Z + this.segmentFurthestDistanceMeters,
      );

      if (playerPosition.z <= WRAP_AT_Z) {
        this.segmentLoop += 1;
        this.segmentFurthestDistanceMeters = Math.max(0, -WRAP_TO_Z);
        this.totalDistanceMeters = Math.max(
          this.totalDistanceMeters,
          this.segmentLoop * WRAP_SHIFT_Z + this.segmentFurthestDistanceMeters,
        );
        this.fogZ += WRAP_SHIFT_Z;
        this.availableBotSpawns = this.botSpawnTemplates.map((point) => ({ ...point }));
        this.version += 1;
        return this.state(true, WRAP_SHIFT_Z);
      }
    }
    return this.state(false, 0);
  }

  state(wrapped = false, wrapShiftZ = 0): EndlessRuntimeState {
    return {
      fogZ: this.fogZ,
      distanceMeters: this.totalDistanceMeters,
      wrapped,
      wrapShiftZ,
    };
  }

  isInFog(position: Vector3): boolean {
    return position.z > this.fogZ;
  }

  fogDamagePerTick(dtSeconds: number): number {
    return Math.max(1, Math.round(FOG_DAMAGE_PER_SECOND * dtSeconds));
  }

  takeBotSpawns(maxCount: number, playerZ: number): Vector3[] {
    const ready = this.availableBotSpawns
      .filter((point) => point.z < playerZ - 24)
      .sort((a, b) => b.z - a.z)
      .slice(0, maxCount);
    const used = new Set(ready.map((point) => `${point.x}:${point.z}`));
    this.availableBotSpawns = this.availableBotSpawns.filter((point) => !used.has(`${point.x}:${point.z}`));
    return ready;
  }

  private buildSegment(): void {
    this.boxes = [];
    this.pickupTemplates = [];
    this.botSpawnTemplates = [];
    for (let index = 1; index <= SEGMENT_CHUNKS; index += 1) {
      this.generateChunk(index);
    }
    this.availableBotSpawns = this.botSpawnTemplates.map((point) => ({ ...point }));
    this.version += 1;
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

    const routeLane = index % LANE_CENTERS.length;
    const doorZ = centerZ - 4;
    for (const dividerX of [-INNER_WALL_X, INNER_WALL_X]) {
      const segmentLength = (CHUNK_LENGTH - MAZE_DOOR_HALF_WIDTH * 2) / 2;
      this.boxes.push(
        {
          id: `${prefix}_divider_${dividerX}_north`,
          kind: "wall",
          center: { x: dividerX, y: WALL_Y, z: northZ - segmentLength / 2 },
          size: { x: INNER_WALL_THICKNESS, y: WALL_HEIGHT, z: segmentLength },
        },
        {
          id: `${prefix}_divider_${dividerX}_south`,
          kind: "wall",
          center: { x: dividerX, y: WALL_Y, z: southZ + segmentLength / 2 },
          size: { x: INNER_WALL_THICKNESS, y: WALL_HEIGHT, z: segmentLength },
        },
      );
    }

    for (let laneIndex = 0; laneIndex < LANE_CENTERS.length; laneIndex += 1) {
      if (laneIndex === routeLane) continue;
      this.boxes.push({
        id: `${prefix}_cross_lane_${laneIndex}`,
        kind: "wall",
        center: { x: LANE_CENTERS[laneIndex], y: WALL_Y, z: doorZ },
        size: { x: LANE_WIDTH - 1, y: WALL_HEIGHT, z: 1 },
      });
    }

    const crateX = index % 2 === 0 ? -12 : 12;
    this.boxes.push({
      id: `${prefix}_crate`,
      kind: "crate",
      center: { x: crateX, y: CRATE_Y, z: centerZ + 6 },
      size: { x: 2, y: CRATE_HEIGHT, z: 2 },
    });

    this.addPickup(index, "health", undefined, { x: LANE_CENTERS[index % 3], y: 0, z: centerZ + 4 });
    if (index % 2 === 0) this.addPickup(index, "ammo", "rifle", { x: LANE_CENTERS[(index + 1) % 3], y: 0, z: centerZ - 5 });
    if (index % 4 === 0) this.addPickup(index, "weapon", "rifle", { x: LANE_CENTERS[(index + 2) % 3], y: 0, z: centerZ - 1 });
    if (index % 6 === 0) this.addPickup(index, "weapon", "grenade_launcher", { x: 0, y: 0, z: centerZ - 9 });
    if (index % 5 === 0) this.addPickup(index, "armor", undefined, { x: -LANE_CENTERS[index % 3], y: 0, z: centerZ + 9 });

    if (index >= 2) {
      this.botSpawnTemplates.push({ x: LANE_CENTERS[(index + 2) % 3], y: MOVEMENT.groundY, z: southZ + 8 });
      if (index % 5 === 0) {
        this.botSpawnTemplates.push({ x: LANE_CENTERS[index % 3], y: MOVEMENT.groundY, z: southZ + 15 });
      }
    }
  }

  private addPickup(index: number, category: PickupCategory, weapon: WeaponType | undefined, position: Vector3): void {
    this.pickupTemplates.push({
      id: `endless_${index}_${category}${weapon ? `_${weapon}` : ""}`,
      category,
      weapon,
      position,
    });
  }
}
