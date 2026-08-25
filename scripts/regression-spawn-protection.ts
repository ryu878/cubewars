// EPIC 36 + EPIC 41 regression: post-spawn / post-respawn protection window.
// Server-authoritative —
//   EPIC 36: protected players take no damage and produce no hit event;
//            unprotected players remain hittable; damage resumes after the window.
//   EPIC 41: protected shooters cannot fire (no ammo consume, no hit, no weapon
//            on outcome so no fire_broadcast); fire works after the window.

import assert from "node:assert/strict";
import { COMBAT, EYE_HEIGHT, WEAPON_STATS } from "@cubewars/shared";
import { isSpawnProtected } from "../server/src/combat.js";
import { PlayerRegistry, type PlayerRecord } from "../server/src/playerRegistry.js";

assert.equal(COMBAT.spawnProtectionMs, 2000, "spawnProtectionMs default must be 2000");

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

function placeFacing(registry: PlayerRegistry, shooterId: string, targetId: string): void {
  const shooter = registry.getPlayer(shooterId);
  const target = registry.getPlayer(targetId);
  if (!shooter || !target) throw new Error("setup failed");
  shooter.position = { x: 0, y: 0, z: 2 };
  target.position = { x: 0, y: 0, z: -2 };
  aimAt(shooter, { x: 0, y: 1.15, z: -2 });
  shooter.equippedWeapon = "pistol";
  shooter.ownedWeapons.add("pistol");
  // EPIC 41: most cases need an unprotected shooter so target-immunity tests
  // still exercise hitscan; dedicated shooter-blocked cases re-arm protection.
  shooter.spawnProtectedUntilMs = 0;
}

{
  // Fresh spawn broadcasts spawnProtectedUntilMs and is protected immediately.
  const registry = new PlayerRegistry();
  const target = registry.spawn("target");
  const now = Date.now();
  assert.ok(target.spawnProtectedUntilMs > now, "fresh spawn must set a future protection deadline");
  assert.ok(
    target.spawnProtectedUntilMs <= now + COMBAT.spawnProtectionMs + 50,
    "protection deadline should be ~spawnProtectionMs ahead",
  );
  assert.equal(isSpawnProtected(target, now), true);
  const state = registry.toWorldState().find((p) => p.id === "target");
  assert.equal(state?.spawnProtectedUntilMs, target.spawnProtectedUntilMs);
}

{
  // Protected hitscan: miss / no damage / no hit event.
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("shooter");
  const target = registry.spawn("target");
  placeFacing(registry, "shooter", "target");
  // Keep target inside the window.
  target.spawnProtectedUntilMs = Date.now() + 5_000;
  const healthBefore = target.health;
  const armorBefore = target.armor;

  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, false, "hitscan against protected target must not register a hit");
  assert.equal(target.health, healthBefore, "protected target health unchanged");
  assert.equal(target.armor, armorBefore, "protected target armor unchanged");
  if ("damageEvents" in outcome) {
    assert.equal(outcome.damageEvents?.length ?? 0, 0, "no damage events against protected target");
  }
}

{
  // Unprotected still hittable (regression against accidental permanent immunity).
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("shooter");
  const target = registry.spawn("target");
  placeFacing(registry, "shooter", "target");
  target.spawnProtectedUntilMs = 0; // past / cleared
  assert.equal(isSpawnProtected(target), false);

  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, true, "unprotected target must still be hittable");
  if (!outcome.hit) throw new Error("unreachable");
  assert.ok(outcome.damage > 0);
  assert.equal(target.health, 100 - outcome.damage);
}

{
  // After the window elapses, damage resumes exactly (no extra grace).
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("shooter");
  const target = registry.spawn("target");
  placeFacing(registry, "shooter", "target");
  const now = Date.now();
  target.spawnProtectedUntilMs = now; // deadline == now → not protected (strict <)
  assert.equal(isSpawnProtected(target, now), false, "protection ends at the deadline instant");

  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, true, "shot at/after deadline must deal damage");
  if (!outcome.hit) throw new Error("unreachable");
  assert.equal(target.health, 100 - outcome.damage);
}

{
  // Grenade splash skips protected targets; unprotected still takes splash.
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("shooter");
  const protectedTarget = registry.spawn("protected");
  const openTarget = registry.spawn("open");
  shooter.position = { x: 0, y: 0, z: 0 };
  protectedTarget.position = { x: 1.5, y: 0, z: -1.5 };
  openTarget.position = { x: -1.5, y: 0, z: -1.5 };
  protectedTarget.spawnProtectedUntilMs = Date.now() + 5_000;
  openTarget.spawnProtectedUntilMs = 0;

  const events = registry.applyGrenadeSplashImpact(shooter.id, { x: 0, y: EYE_HEIGHT, z: -1.5 });
  assert.ok(events.every((e) => e.targetId !== "protected"), "splash must not hit protected player");
  assert.ok(events.some((e) => e.targetId === "open"), "splash must still hit unprotected player");
  assert.equal(protectedTarget.health, 100);
  assert.ok(openTarget.health < 100);
}

{
  // Environmental damage is also gated.
  const registry = new PlayerRegistry();
  const target = registry.spawn("fog-victim");
  target.spawnProtectedUntilMs = Date.now() + 5_000;
  const event = registry.applyEnvironmentalDamage("fog-victim", 25, { ...target.position });
  assert.equal(event, null, "environmental damage must no-op while protected");
  assert.equal(target.health, 100);

  target.spawnProtectedUntilMs = 0;
  const after = registry.applyEnvironmentalDamage("fog-victim", 25, { ...target.position });
  assert.ok(after, "environmental damage resumes after protection");
  assert.equal(target.health, 75);
}

{
  // Respawn renews the protection window.
  const registry = new PlayerRegistry();
  const victim = registry.spawn("victim");
  const killer = registry.spawn("killer");
  placeFacing(registry, "killer", "victim");
  victim.spawnProtectedUntilMs = 0;
  // Kill the victim.
  victim.health = 1;
  victim.armor = 0;
  const killShot = registry.fire(killer.id);
  assert.equal(killShot.hit, true);
  if (!killShot.hit) throw new Error("unreachable");
  assert.equal(killShot.killed, true);
  assert.equal(victim.alive, false);

  const respawnAt = victim.respawnAtMs!;
  const outcomes = registry.processRespawns(respawnAt);
  assert.equal(outcomes.length, 1);
  assert.equal(victim.alive, true);
  assert.ok(isSpawnProtected(victim, respawnAt), "respawn must re-arm spawn protection");
  assert.equal(victim.spawnProtectedUntilMs, respawnAt + COMBAT.spawnProtectionMs);

  // Still protected right after respawn → no hit.
  placeFacing(registry, "killer", "victim");
  victim.spawnProtectedUntilMs = respawnAt + COMBAT.spawnProtectionMs;
  const blocked = registry.fire(killer.id);
  assert.equal(blocked.hit, false, "just-respawned player must not take a hit");
}

{
  // Direct grenade projectile path also yields no events while protected.
  const registry = new PlayerRegistry();
  registry.spawn("shooter");
  const target = registry.spawn("target");
  target.spawnProtectedUntilMs = Date.now() + 5_000;
  const events = registry.applyGrenadeProjectileDirect("shooter", "target", "body", {
    x: target.position.x,
    y: target.position.y + 1.15,
    z: target.position.z,
  });
  assert.equal(events.length, 0);
  assert.equal(target.health, 100);
}

// Sanity: pistol damage table unchanged for unprotected body hit (combat regression).
{
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("shooter");
  const target = registry.spawn("target");
  placeFacing(registry, "shooter", "target");
  target.spawnProtectedUntilMs = 0;
  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, true);
  if (!outcome.hit) throw new Error("unreachable");
  assert.equal(outcome.damage, WEAPON_STATS.pistol.damage); // body zone multiplier 1
}

// --- EPIC 41: spawn-protected shooter cannot fire ---

{
  // Protected shooter: no-op (no ammo loss, no hit, no weapon → no fire_broadcast).
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("ghost-shooter");
  const target = registry.spawn("open-target");
  placeFacing(registry, "ghost-shooter", "open-target");
  target.spawnProtectedUntilMs = 0;
  // Re-arm shooter protection after placeFacing cleared it.
  shooter.spawnProtectedUntilMs = Date.now() + 5_000;
  shooter.equippedWeapon = "rifle";
  shooter.ownedWeapons.add("rifle");
  shooter.ammo.rifle = 12;
  const ammoBefore = shooter.ammo.rifle;
  const targetHealthBefore = target.health;

  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, false, "protected shooter must not register a hit");
  assert.equal(outcome.dry, false, "protection block is not a dry-fire");
  assert.equal(
    "weapon" in outcome && outcome.weapon !== undefined,
    false,
    "protected shooter outcome must omit weapon (no fire_broadcast)",
  );
  assert.equal(shooter.ammo.rifle, ammoBefore, "protected shooter must not consume ammo");
  assert.equal(target.health, targetHealthBefore, "target health unchanged when shooter is protected");
  assert.ok(
    isSpawnProtected(shooter),
    "attempting to fire must not clear or shorten spawn protection",
  );
}

{
  // After shooter protection expires, fire works normally (ammo + hit).
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("ready-shooter");
  const target = registry.spawn("open-target");
  placeFacing(registry, "ready-shooter", "open-target");
  target.spawnProtectedUntilMs = 0;
  const now = Date.now();
  shooter.spawnProtectedUntilMs = now; // deadline == now → not protected (strict <)
  assert.equal(isSpawnProtected(shooter, now), false);
  shooter.equippedWeapon = "rifle";
  shooter.ownedWeapons.add("rifle");
  shooter.ammo.rifle = 12;

  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, true, "unprotected shooter must be able to hit");
  if (!outcome.hit) throw new Error("unreachable");
  assert.equal(outcome.weapon, "rifle");
  assert.equal(shooter.ammo.rifle, 11, "accepted shot must consume one rifle round");
  assert.equal(target.health, 100 - outcome.damage);
}

{
  // Humans and bots share registry.fire() — same no-op for a protected bot id.
  const registry = new PlayerRegistry();
  const bot = registry.spawn("bot-ghost");
  const target = registry.spawn("open-target");
  placeFacing(registry, "bot-ghost", "open-target");
  target.spawnProtectedUntilMs = 0;
  bot.spawnProtectedUntilMs = Date.now() + 5_000;
  const healthBefore = target.health;
  const outcome = registry.fire(bot.id);
  assert.equal(outcome.hit, false);
  assert.equal("weapon" in outcome && outcome.weapon !== undefined, false);
  assert.equal(target.health, healthBefore);
}

console.log("[spawn-protection] PASS");
