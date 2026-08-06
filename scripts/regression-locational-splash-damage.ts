// EPIC 18/19 regression: server-authoritative locational damage, grenade
// splash damage, and grenade-launcher projectile spawning. Uses
// PlayerRegistry directly so formulas are deterministic and independent of
// browser input timing.

import assert from "node:assert/strict";
import { EYE_HEIGHT, WEAPON_STATS, type WeaponType } from "@cubewars/shared";
import { PlayerRegistry, type PlayerRecord } from "../server/src/playerRegistry.js";

function aimAt(shooter: PlayerRecord, target: { x: number; y: number; z: number }): void {
  const origin = {
    x: shooter.position.x,
    y: shooter.position.y + EYE_HEIGHT,
    z: shooter.position.z,
  };
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  shooter.yaw = Math.atan2(-dx, -dz);
  shooter.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

function setup(weapon: WeaponType = "pistol") {
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("shooter");
  const target = registry.spawn("target");
  shooter.position = { x: 0, y: 0, z: 2 };
  target.position = { x: 0, y: 0, z: -2 };
  shooter.yaw = 0;
  shooter.pitch = 0;
  shooter.equippedWeapon = weapon;
  shooter.ownedWeapons.add(weapon);
  if (!WEAPON_STATS[weapon].infiniteAmmo) shooter.ammo[weapon] = 6;
  target.health = 100;
  target.armor = 0;
  return { registry, shooter, target };
}

function assertHitscanDirect(weapon: Exclude<WeaponType, "grenade_launcher">, zone: "head" | "body" | "legs", aimY: number, expectedDamage: number) {
  const { registry, shooter } = setup(weapon);
  aimAt(shooter, { x: 0, y: aimY, z: -2 });
  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, true, `${weapon} ${zone} should hit`);
  if (!outcome.hit) throw new Error("unreachable");
  assert.equal(outcome.hitZone, zone);
  assert.equal(outcome.damageKind, "direct");
  assert.equal(outcome.damage, expectedDamage);
  assert.equal(outcome.targetHealth, Math.max(0, 100 - expectedDamage));
  assert.equal(outcome.damageEvents.length, 1);
}

function assertGrenadeDirect(zone: "head" | "body" | "legs", expectedDamage: number) {
  const { registry, target } = setup("grenade_launcher");
  const events = registry.applyGrenadeProjectileDirect("shooter", "target", zone, {
    x: target.position.x,
    y: target.position.y + (zone === "head" ? 1.85 : zone === "body" ? 1.15 : 0.35),
    z: target.position.z,
  });
  assert.equal(events.length, 1, `grenade ${zone} projectile direct hit should damage`);
  assert.equal(events[0].hitZone, zone);
  assert.equal(events[0].damageKind, "direct");
  assert.equal(events[0].damage, expectedDamage);
  assert.equal(events[0].targetHealth, Math.max(0, 100 - expectedDamage));
}

assert.equal(WEAPON_STATS.pistol.cooldownMs, 500, "pistol cooldown should be 500ms");

assertHitscanDirect("pistol", "head", 1.85, 10);
assertHitscanDirect("pistol", "body", 1.15, 5);
assertHitscanDirect("pistol", "legs", 0.35, 4);
assertGrenadeDirect("head", 140);
assertGrenadeDirect("body", 70);
assertGrenadeDirect("legs", 53);

{
  const { registry, shooter, target } = setup("grenade_launcher");
  shooter.position = { x: 0, y: 0, z: 0 };
  target.position = { x: 1.8, y: 0, z: -2.6 };
  aimAt(shooter, { x: 0, y: EYE_HEIGHT, z: -4 });

  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, false, "grenade fire should spawn a projectile instead of immediate splash");
  assert.equal(outcome.projectileSpawn?.weapon, "grenade_launcher");
  assert.ok(outcome.shotTrace, "grenade fire should carry a server-computed visual/projectile trace");

  const events = registry.applyGrenadeSplashImpact(shooter.id, { x: 0, y: EYE_HEIGHT, z: -4 });
  assert.equal(events.length, 1, "grenade wall impact near target should produce splash hit");
  assert.equal(events[0].damageKind, "splash");
  assert.equal(events[0].hitZone, "splash");
  assert.ok(events[0].damage > 0 && events[0].damage < WEAPON_STATS.grenade_launcher.damage);
  assert.equal(target.health, 100 - events[0].damage);
}

{
  const { registry } = setup("pistol");
  const shooter = registry.getPlayer("shooter");
  const target = registry.getPlayer("target");
  if (!shooter || !target) throw new Error("test setup failed");
  shooter.position = { x: 0, y: 0, z: 0 };
  target.position = { x: 1.8, y: 0, z: -2.6 };
  aimAt(shooter, { x: 0, y: EYE_HEIGHT, z: -4 });

  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, false, "pistol wall miss should not splash");
  assert.equal(target.health, 100);
}

console.log("[locational-splash-damage] PASS");
