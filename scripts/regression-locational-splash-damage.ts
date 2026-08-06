// EPIC 18 regression: server-authoritative locational damage and grenade
// splash damage. Uses PlayerRegistry directly so formulas are deterministic
// and independent of browser input timing.

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

function assertDirect(weapon: WeaponType, zone: "head" | "body" | "legs", aimY: number, expectedDamage: number) {
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

assert.equal(WEAPON_STATS.pistol.cooldownMs, 500, "pistol cooldown should be 500ms");

assertDirect("pistol", "head", 1.85, 10);
assertDirect("pistol", "body", 1.15, 5);
assertDirect("pistol", "legs", 0.35, 4);
assertDirect("grenade_launcher", "head", 1.85, 140);
assertDirect("grenade_launcher", "body", 1.15, 70);
assertDirect("grenade_launcher", "legs", 0.35, 53);

{
  const { registry, shooter, target } = setup("grenade_launcher");
  shooter.position = { x: 0, y: 0, z: 0 };
  target.position = { x: 1.8, y: 0, z: -2.6 };
  aimAt(shooter, { x: 0, y: EYE_HEIGHT, z: -4 });

  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, true, "grenade wall impact near target should produce splash hit");
  if (!outcome.hit) throw new Error("unreachable");
  assert.equal(outcome.damageKind, "splash");
  assert.equal(outcome.hitZone, "splash");
  assert.ok(outcome.damage > 0 && outcome.damage < WEAPON_STATS.grenade_launcher.damage);
  assert.equal(target.health, 100 - outcome.damage);
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
