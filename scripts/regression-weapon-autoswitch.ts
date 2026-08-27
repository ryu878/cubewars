// EPIC 13 "Weapon Auto-Switch on Empty Ammo & HUD Stat Sizing" Story 13.3
// regression/evidence script: exercises both new auto-switch rules (server/
// src/playerRegistry.ts fire()'s autoSwitchDown() and applyPickup()'s
// generalized auto-equip rule) and their documented interaction, against the
// real `PlayerRegistry`/`WEAPON_STATS`/`WEAPON_ORDER` — same style/rigor as
// scripts/regression-crate-mount.ts / scripts/regression-bot-aim-miss-rate.ts:
// drive real fire()/applyPickup()/cycleWeapon() calls (no mocked weapon
// table), report the actual observed equipped-weapon/ammo state before and
// after each step, non-zero exit on any failure.
//
// Whitebox note: this script reaches into PlayerRecord fields (ownedWeapons/
// ammo/equippedWeapon) directly via registry.getPlayer(id) to SET UP each
// case's starting state deterministically (e.g. "grenade launcher owned with
// exactly 1 round left") — this is the same pattern
// scripts/regression-bot-aim-miss-rate.ts already uses to place a bot/target
// at an exact test distance. Every ASSERTION below, though, only reads state
// back through the same public API real callers use (registry.fire(),
// registry.applyPickup(), registry.cycleWeapon(), registry.getLoadout()) —
// this is not testing against a duplicated/hardcoded weapon table.
//
// Run: npx tsx scripts/regression-weapon-autoswitch.ts
// (or `npm run regression:weapon-autoswitch` from the repo root)
//
// Exit code is non-zero if any coverage case fails (EPIC 13 Story 13.3
// plus EPIC 55 ammo-ownership / maxHealth heal cases).

import { WEAPON_ORDER, WEAPON_STATS, type WeaponType } from "@cubewars/shared";
import { PlayerRegistry } from "../server/src/playerRegistry.js";

let anyFailed = false;

function report(caseLabel: string, passed: boolean, detail: string): void {
  const status = passed ? "PASS" : "FAIL";
  console.log(`[${status}] ${caseLabel}: ${detail}`);
  if (!passed) anyFailed = true;
}

/** Fresh registry with one spawned player, id "p1" — every case starts from a clean slate so cases can't leak state into each other. */
function freshPlayer(): { registry: PlayerRegistry; id: string } {
  const registry = new PlayerRegistry();
  const id = "p1";
  registry.spawn(id);
  // EPIC 41: spawn protection blocks fire() (no ammo consume). Clear it so
  // auto-switch-on-empty coverage can exercise the real fire path.
  registry.getPlayer(id)!.spawnProtectedUntilMs = 0;
  return { registry, id };
}

function equippedOf(registry: PlayerRegistry, id: string): WeaponType {
  return registry.getPlayer(id)!.equippedWeapon;
}

// --- Case 1: auto-switch-down picks the next-best owned, non-empty weapon
// by tier (mid-tier fallback), NOT straight to the pistol, when one exists. ---
function case1_midTierFallback(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  player.ownedWeapons = new Set<WeaponType>(["pistol", "rifle", "grenade_launcher"]);
  player.equippedWeapon = "grenade_launcher";
  player.ammo.grenade_launcher = 1; // this fire attempt will drain it to 0
  player.ammo.rifle = 12; // rifle still has ammo — the expected fallback

  const before = equippedOf(registry, id);
  const outcome = registry.fire(id);
  const after = equippedOf(registry, id);

  const passed = after === "rifle" && outcome.autoSwitchedTo === "rifle";
  report(
    "1. mid-tier fallback (not straight to pistol)",
    passed,
    `equipped ${before} (1 grenade round) -> fired -> equipped=${after}, outcome.autoSwitchedTo=${outcome.autoSwitchedTo ?? "none"}`,
  );
}

// --- Case 2: auto-switch-down falls back to the pistol when nothing else
// has ammo left. ---
function case2_fallsBackToPistol(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  player.ownedWeapons = new Set<WeaponType>(["pistol", "rifle", "grenade_launcher"]);
  player.equippedWeapon = "grenade_launcher";
  player.ammo.grenade_launcher = 1; // drains to 0 this shot
  player.ammo.rifle = 0; // nothing usable above the pistol

  const before = equippedOf(registry, id);
  const outcome = registry.fire(id);
  const after = equippedOf(registry, id);

  const passed = after === "pistol" && outcome.autoSwitchedTo === "pistol";
  report(
    "2. falls back to pistol when nothing else has ammo",
    passed,
    `equipped ${before} (1 grenade round, 0 rifle ammo) -> fired -> equipped=${after}, outcome.autoSwitchedTo=${outcome.autoSwitchedTo ?? "none"}`,
  );
}

// --- Case 3: auto-equip-on-pickup re-equips an already-owned higher-tier
// weapon on an ammo-refill pickup (not just a first-time unlock). ---
function case3_autoEquipOnRefill(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  // Simulates "ran dry, got auto-switched to pistol" — rifle already owned,
  // 0 ammo, pistol currently equipped.
  player.ownedWeapons = new Set<WeaponType>(["pistol", "rifle"]);
  player.equippedWeapon = "pistol";
  player.ammo.rifle = 0;

  const before = equippedOf(registry, id);
  const result = registry.applyPickup(id, "ammo", "rifle");
  const after = equippedOf(registry, id);
  const rifleAmmoAfter = player.ammo.rifle ?? 0;

  const passed = result.applied && result.autoSwitchedTo === "rifle" && after === "rifle" && rifleAmmoAfter > 0;
  report(
    "3. auto-equip-on-pickup refill (already-owned, higher tier)",
    passed,
    `equipped ${before}, rifle ammo 0 -> picked up rifle ammo -> applied=${result.applied}, equipped=${after}, rifleAmmo=${rifleAmmoAfter}, autoSwitchedTo=${result.autoSwitchedTo ?? "none"}`,
  );
}

// --- Case 4: auto-equip-on-pickup does NOT re-equip a lower-or-equal-tier
// weapon's ammo pickup (no downgrade-on-pickup regression). ---
function case4_noDowngradeOnLowerTierPickup(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  player.ownedWeapons = new Set<WeaponType>(["pistol", "rifle", "grenade_launcher"]);
  player.equippedWeapon = "grenade_launcher"; // already on the best weapon
  player.ammo.rifle = 0; // below max, so this pickup will be applied

  const before = equippedOf(registry, id);
  const result = registry.applyPickup(id, "ammo", "rifle"); // rifle (tier 1) < grenade_launcher (tier 2)
  const after = equippedOf(registry, id);

  const passed = result.applied && result.autoSwitchedTo === undefined && after === "grenade_launcher";
  report(
    "4. no downgrade on lower-tier pickup",
    passed,
    `equipped ${before} -> picked up rifle ammo (lower tier) -> applied=${result.applied}, equipped=${after}, autoSwitchedTo=${result.autoSwitchedTo ?? "none"}`,
  );
}

// --- Case 5: the documented full interaction sequence (Section 2) — dry
// rifle -> auto-switch to pistol -> pick up rifle ammo -> auto-switch back
// to rifle — resolves deterministically with no oscillation within a single
// call at each step. ---
function case5_fullSequenceNoOscillation(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  player.ownedWeapons = new Set<WeaponType>(["pistol", "rifle"]);
  player.equippedWeapon = "rifle";
  player.ammo.rifle = 1; // this shot drains it to 0

  const step1Before = equippedOf(registry, id);
  const fireOutcome = registry.fire(id);
  const step1After = equippedOf(registry, id);
  const step1Passed = step1After === "pistol" && fireOutcome.autoSwitchedTo === "pistol";
  report(
    "5a. dry rifle -> auto-switch to pistol",
    step1Passed,
    `equipped ${step1Before} (1 round) -> fired -> equipped=${step1After}, autoSwitchedTo=${fireOutcome.autoSwitchedTo ?? "none"}`,
  );

  const pickupOutcome = registry.applyPickup(id, "ammo", "rifle");
  const step2After = equippedOf(registry, id);
  const step2Passed = step2After === "rifle" && pickupOutcome.autoSwitchedTo === "rifle" && pickupOutcome.applied;
  report(
    "5b. pick up rifle ammo -> auto-switch back to rifle (no oscillation)",
    step2Passed,
    `equipped ${step1After} -> picked up rifle ammo -> applied=${pickupOutcome.applied}, equipped=${step2After}, autoSwitchedTo=${pickupOutcome.autoSwitchedTo ?? "none"}`,
  );
}

// --- Case 6: manual cycleWeapon() still behaves correctly immediately after
// an auto-switch — cycling from whatever the auto-switch just landed on
// works exactly like a normal cycle from that weapon. ---
function case6_manualCycleAfterAutoSwitch(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  player.ownedWeapons = new Set<WeaponType>(["pistol", "rifle", "grenade_launcher"]);
  player.equippedWeapon = "grenade_launcher";
  player.ammo.grenade_launcher = 1; // drains to 0 this shot
  player.ammo.rifle = 12; // fallback candidate

  const fireOutcome = registry.fire(id);
  const afterAutoSwitch = equippedOf(registry, id);

  const owned = WEAPON_ORDER.filter((w) => player.ownedWeapons.has(w));
  const expectedNextIndex = (owned.indexOf(afterAutoSwitch) + 1) % owned.length;
  const expectedNext = owned[expectedNextIndex];

  const cycled = registry.cycleWeapon(id);
  const afterCycle = equippedOf(registry, id);

  const passed =
    fireOutcome.autoSwitchedTo === "rifle" &&
    afterAutoSwitch === "rifle" &&
    cycled &&
    afterCycle === expectedNext;
  report(
    "6. manual cycleWeapon() right after an auto-switch",
    passed,
    `auto-switched to ${afterAutoSwitch} -> cycleWeapon() -> changed=${cycled}, equipped=${afterCycle} (expected ${expectedNext})`,
  );
}

// --- EPIC 55 Case 7: unowned ammo stockpiles without unlock / auto-equip;
// E cannot cycle to that weapon. ---
function case7_unownedAmmoStockpileNoUnlock(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  player.ownedWeapons = new Set<WeaponType>(["pistol"]);
  player.equippedWeapon = "pistol";
  player.ammo.rifle = 0;

  const result = registry.applyPickup(id, "ammo", "rifle");
  const owned = [...player.ownedWeapons].sort();
  const loadout = registry.getLoadout(id)!;
  const cycled = registry.cycleWeapon(id);
  const afterCycle = equippedOf(registry, id);
  const rifleAmmo = player.ammo.rifle ?? 0;

  const passed =
    result.applied &&
    result.autoSwitchedTo === undefined &&
    !player.ownedWeapons.has("rifle") &&
    owned.length === 1 &&
    owned[0] === "pistol" &&
    rifleAmmo === WEAPON_STATS.rifle.ammoPerPickup &&
    !loadout.ownedWeapons.includes("rifle") &&
    !cycled &&
    afterCycle === "pistol";
  report(
    "7. unowned ammo stockpile — no unlock, no auto-equip, E cannot cycle",
    passed,
    `applied=${result.applied}, owned=[${owned.join(",")}], rifleAmmo=${rifleAmmo}, autoSwitchedTo=${result.autoSwitchedTo ?? "none"}, cycleWeapon=${cycled}, equipped=${afterCycle}`,
  );
}

// --- EPIC 55 Case 8: stockpile then weapon pickup — own + capped ammo. ---
function case8_stockpileThenWeaponPickup(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  player.ownedWeapons = new Set<WeaponType>(["pistol"]);
  player.equippedWeapon = "pistol";

  const ammo1 = registry.applyPickup(id, "ammo", "rifle");
  const ammo2 = registry.applyPickup(id, "ammo", "rifle");
  const stockpile = player.ammo.rifle ?? 0;
  const ownedAfterAmmo = player.ownedWeapons.has("rifle");
  const weaponPickup = registry.applyPickup(id, "weapon", "rifle");
  const finalAmmo = player.ammo.rifle ?? 0;
  const expected = Math.min(
    WEAPON_STATS.rifle.maxAmmo,
    stockpile + WEAPON_STATS.rifle.ammoPerPickup,
  );

  const passed =
    ammo1.applied &&
    ammo2.applied &&
    !ownedAfterAmmo &&
    stockpile === WEAPON_STATS.rifle.ammoPerPickup * 2 &&
    player.ownedWeapons.has("rifle") &&
    weaponPickup.applied &&
    weaponPickup.autoSwitchedTo === "rifle" &&
    equippedOf(registry, id) === "rifle" &&
    finalAmmo === expected &&
    finalAmmo <= WEAPON_STATS.rifle.maxAmmo;
  report(
    "8. ammo stockpile then weapon pickup — owned, ammo capped",
    passed,
    `stockpile=${stockpile} (ownedAfterAmmo=${ownedAfterAmmo}) -> weapon pickup -> owned=${player.ownedWeapons.has("rifle")}, ammo=${finalAmmo} (expected ${expected}), equipped=${equippedOf(registry, id)}, autoSwitchedTo=${weaponPickup.autoSwitchedTo ?? "none"}`,
  );
}

// --- EPIC 55 F-001 Case 10: unowned stockpile already at maxAmmo must still
// unlock on a weapon pickup (ammo stays at cap). ---
function case10_fullStockpileThenWeaponUnlock(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  player.ownedWeapons = new Set<WeaponType>(["pistol"]);
  player.equippedWeapon = "pistol";

  const perPickup = WEAPON_STATS.rifle.ammoPerPickup;
  const maxAmmo = WEAPON_STATS.rifle.maxAmmo;
  const pickupsNeeded = Math.ceil(maxAmmo / perPickup);
  let ammoPickupsApplied = 0;
  for (let i = 0; i < pickupsNeeded; i++) {
    if (registry.applyPickup(id, "ammo", "rifle").applied) ammoPickupsApplied++;
  }
  const stockpile = player.ammo.rifle ?? 0;
  const rejectExtraAmmo = registry.applyPickup(id, "ammo", "rifle");
  const ownedBeforeWeapon = player.ownedWeapons.has("rifle");
  const weaponPickup = registry.applyPickup(id, "weapon", "rifle");
  const finalAmmo = player.ammo.rifle ?? 0;
  const ownedRefillNoop = registry.applyPickup(id, "weapon", "rifle");

  const passed =
    ammoPickupsApplied === pickupsNeeded &&
    stockpile === maxAmmo &&
    !rejectExtraAmmo.applied &&
    !ownedBeforeWeapon &&
    weaponPickup.applied &&
    player.ownedWeapons.has("rifle") &&
    weaponPickup.autoSwitchedTo === "rifle" &&
    equippedOf(registry, id) === "rifle" &&
    finalAmmo === maxAmmo &&
    !ownedRefillNoop.applied;
  report(
    "10. F-001 full unowned stockpile then weapon unlock (ammo stays at max)",
    passed,
    `stockpile=${stockpile}/${maxAmmo}, ownedBefore=${ownedBeforeWeapon}, weapon applied=${weaponPickup.applied}, owned=${player.ownedWeapons.has("rifle")}, ammo=${finalAmmo}, equipped=${equippedOf(registry, id)}, extraAmmoApplied=${rejectExtraAmmo.applied}, ownedRefillApplied=${ownedRefillNoop.applied}`,
  );
}

// --- EPIC 55 Case 9: pet-boosted maxHealth survives damage; health pickup
// heals above baseline 100 toward maxHealth. ---
function case9_petBoostedHealAbove100(): void {
  const { registry, id } = freshPlayer();
  const player = registry.getPlayer(id)!;
  registry.applyPetRatings(id, {
    healthRating: 145,
    armorRating: 0,
    speedRating: 0,
    damageRating: 0,
  });
  const maxAfterBoost = player.maxHealth;
  const stateBoosted = registry.toWorldState().find((p) => p.id === id)!;
  player.health = 80; // below baseline 100
  const before = player.health;
  const heal = registry.applyPickup(id, "health");
  const after = player.health;
  const state = registry.toWorldState().find((p) => p.id === id)!;

  const passed =
    maxAfterBoost === 245 &&
    stateBoosted.maxHealth === 245 &&
    stateBoosted.maxArmor === 100 &&
    heal.applied &&
    after === before + 25 &&
    after > 100 &&
    after <= maxAfterBoost &&
    state.maxHealth === 245 &&
    state.health === after;
  report(
    "9. pet boost -> damage below 100 -> health pickup heals above 100",
    passed,
    `maxHealth=${maxAfterBoost}, heal ${before}->${after}, applied=${heal.applied}, broadcast maxHealth=${state.maxHealth} maxArmor=${state.maxArmor}`,
  );
}

function main(): void {
  console.log("EPIC 13 + EPIC 55: weapon auto-switch / ammo ownership / maxHealth heal\n");
  console.log(`WEAPON_ORDER (real, from shared/src/weapons.ts): ${WEAPON_ORDER.join(" -> ")}`);
  console.log(
    `Tiers: ${WEAPON_ORDER.map((w) => `${w}=${WEAPON_STATS[w].tier}`).join(", ")}\n`,
  );

  case1_midTierFallback();
  case2_fallsBackToPistol();
  case3_autoEquipOnRefill();
  case4_noDowngradeOnLowerTierPickup();
  case5_fullSequenceNoOscillation();
  case6_manualCycleAfterAutoSwitch();
  case7_unownedAmmoStockpileNoUnlock();
  case8_stockpileThenWeaponPickup();
  case9_petBoostedHealAbove100();
  case10_fullStockpileThenWeaponUnlock();

  console.log(anyFailed ? "\nOVERALL: FAIL — at least one case above failed." : "\nOVERALL: PASS — all coverage cases hold.");
  process.exit(anyFailed ? 1 : 0);
}

main();
