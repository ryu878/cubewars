// Weapon tier system (EPIC 6 "Weapons & Ammo"). Single source of truth for
// weapon identity/balance, consumed by both server (authoritative damage/
// cooldown/ammo enforcement) and client (HUD display + pickup mesh color) —
// one definition, not duplicated, same discipline as MOVEMENT/COMBAT in
// shared/src/index.ts and shared/src/combat.ts.
//
// Balance numbers below are fixed by Team Lead. Damage values were rebalanced
// in EPIC 10 (docs/tasks/epic-10-weapon-viewmodel-visual-polish.md Section 2,
// superseding the original EPIC 6 damage table — see
// docs/tasks/epic-06-weapons-ammo.md Section 2 for the superseded numbers)
// to slow down time-to-kill per user feedback. EPIC 18 then changed only
// the pistol cadence to 500ms for hold-to-fire; rifle/grenade cooldowns and
// ammo economy remain unchanged from EPIC 6. Do not rebalance without a spec
// update. They are named constants specifically so they stay easy to tune
// later without hunting through server/client code (EPIC 6 spec Risks).

export type WeaponType = "pistol" | "rifle" | "grenade_launcher";

export interface WeaponStats {
  type: WeaponType;
  /** Higher tier = strictly stronger; used for auto-equip ("always have the best") and the `E` cycle order. */
  tier: number;
  displayName: string;
  /** Flat damage applied per confirmed hit. */
  damage: number;
  /** Minimum interval the server allows between accepted fire events for this weapon, ms. */
  cooldownMs: number;
  /** Ammo granted per weapon/ammo pickup for this weapon (identical effect for both pickup kinds, see EPIC 6 spec). Unused (0) for the pistol, which never runs out. */
  ammoPerPickup: number;
  /** Ammo cap; pickups beyond this are wasted (and thus not consumed — see EPIC 6 pickup-consumption rule). Unused for the pistol. */
  maxAmmo: number;
  /** True only for the pistol: never tracked/decremented, always fireable. */
  infiniteAmmo: boolean;
  /** Hex color identity for pickups in the world and the HUD (EPIC 6 spec Section 2: "so weapon and its matching ammo pickup are recognizable at a glance"). */
  color: number;
}

/** Tier order, also the `E` cycle order (pistol -> rifle -> grenade launcher -> pistol -> ...). */
export const WEAPON_ORDER: readonly WeaponType[] = ["pistol", "rifle", "grenade_launcher"];

export const WEAPON_STATS: Record<WeaponType, WeaponStats> = {
  pistol: {
    type: "pistol",
    tier: 0,
    displayName: "Pistol",
    damage: 5, // EPIC 10 rebalance: 20 hits to kill at full HP (was 25/4 hits)
    cooldownMs: 500,
    ammoPerPickup: 0,
    maxAmmo: 0,
    infiniteAmmo: true,
    color: 0x9e9e9e, // grey
  },
  rifle: {
    type: "rifle",
    tier: 1,
    displayName: "Rifle",
    damage: 20, // EPIC 10 rebalance: 5 hits to kill at full HP (was 50/2 hits)
    cooldownMs: 250,
    ammoPerPickup: 12,
    maxAmmo: 48,
    infiniteAmmo: false,
    color: 0xff8c00, // orange
  },
  grenade_launcher: {
    type: "grenade_launcher",
    tier: 2,
    displayName: "Grenade Launcher",
    damage: 70, // EPIC 10 rebalance: guaranteed 2-hit kill at full HP, often a 1-hit finisher on a chipped target (was 100/1 hit)
    cooldownMs: 1500,
    ammoPerPickup: 2,
    maxAmmo: 6,
    infiniteAmmo: false,
    color: 0x9b30ff, // red/purple
  },
};
