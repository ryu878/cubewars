// Generic pickup spawner (EPIC 6 Story 6.1) — server-authoritative
// occupancy + respawn timing for the fixed PICKUP_SPAWN_POINTS list
// (shared/src/pickups.ts). Deliberately transport-agnostic (no `ws` types)
// and decoupled from PlayerRegistry: this module only tracks WHICH pickups
// exist and whether each is currently active, never player state — applying
// a pickup's gameplay effect (unlocking a weapon, adding ammo) is
// PlayerRegistry's job (server/src/playerRegistry.ts `applyPickup()`),
// called by server/src/index.ts's tick loop, which is what actually wires
// "a player walked near an active pickup" to "consume it".
//
// Instantiable (not a module-level singleton) and takes its player-count
// source as a constructor parameter, per the EPIC 6 Story 6.1 "Design note
// for EPIC 9 compatibility": EPIC 9 will need one instance per match, each
// with its own player-count source.

import { PICKUP_RESPAWN, PICKUP_SPAWN_POINTS, type PickupCategory, type PickupSpawnPoint, type Vector3, type WeaponType } from "@cubewars/shared";

export interface PickupRuntimeState {
  id: string;
  category: PickupCategory;
  /** Only meaningful for "weapon"/"ammo" categories — undefined for EPIC 7's "health"/"armor" categories (see PickupSpawnPoint doc comment, shared/src/pickups.ts). */
  weapon?: WeaponType;
  position: Vector3;
  active: boolean;
  /** Server timestamp (Date.now()-based) at which an inactive pickup should respawn; null while active. */
  respawnAtMs: number | null;
}

/** clamp(value, min, max) per the EPIC 6 Story 6.1 respawn-delay formula. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class PickupSpawner {
  private items = new Map<string, PickupRuntimeState>();

  constructor(
    /** Source of "currently connected+alive player count in this match" for the respawn-delay formula (EPIC 6 Story 6.1). A callback (not a snapshot) so it always reflects live state. */
    private getPlayerCount: () => number,
    points: readonly PickupSpawnPoint[] = PICKUP_SPAWN_POINTS,
  ) {
    for (const point of points) {
      this.items.set(point.id, {
        id: point.id,
        category: point.category,
        weapon: point.weapon,
        position: point.position,
        active: true,
        respawnAtMs: null,
      });
    }
  }

  /** Every pickup's current runtime state — used to build the full PickupStateMessage (server/src/index.ts). */
  list(): PickupRuntimeState[] {
    return [...this.items.values()];
  }

  /**
   * The nearest ACTIVE pickup within PICKUP_RADIUS of `position` (horizontal
   * distance only, matching the rest of this codebase's ground-plane
   * proximity checks — e.g. playerRegistry.ts's spawn anti-clustering), or
   * null if none. Does not mutate anything; the caller decides whether the
   * player actually benefits (PlayerRegistry.applyPickup()) before calling
   * consume() below.
   */
  findNearby(position: Vector3, radius: number): PickupRuntimeState | null {
    let nearest: PickupRuntimeState | null = null;
    let nearestDistance = radius;
    for (const item of this.items.values()) {
      if (!item.active) continue;
      const distance = Math.hypot(position.x - item.position.x, position.z - item.position.z);
      if (distance <= nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  /**
   * Mark a pickup consumed: goes inactive immediately and schedules its
   * respawn per the category's base/min delay, scaled by the current
   * player-count source. Returns the consumed item, or null if `id` doesn't
   * exist or is already inactive (defensive — callers should already have
   * checked via findNearby()).
   */
  consume(id: string, nowMs: number): PickupRuntimeState | null {
    const item = this.items.get(id);
    if (!item || !item.active) return null;

    item.active = false;
    const { baseDelayMs, minDelayMs } = PICKUP_RESPAWN[item.category];
    const playerCount = Math.max(1, this.getPlayerCount());
    item.respawnAtMs = nowMs + clamp(baseDelayMs / playerCount, minDelayMs, baseDelayMs);
    return item;
  }

  /**
   * Check every inactive pickup's respawn timer against `nowMs` (server
   * clock) and reactivate any that are due. Returns the set that changed
   * this call, for the caller to broadcast — same time-driven pattern as
   * PlayerRegistry.processRespawns().
   */
  processRespawns(nowMs: number): PickupRuntimeState[] {
    const changed: PickupRuntimeState[] = [];
    for (const item of this.items.values()) {
      if (item.active || item.respawnAtMs === null) continue;
      if (nowMs < item.respawnAtMs) continue;
      item.active = true;
      item.respawnAtMs = null;
      changed.push(item);
    }
    return changed;
  }
}
