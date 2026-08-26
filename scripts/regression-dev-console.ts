// EPIC 51 regression: dev console cheat gate helpers + god_mode damage block.

import assert from "node:assert/strict";
import { EYE_HEIGHT } from "@cubewars/shared";
import {
  cheatsEnabledFromEnv,
  devConsoleRequiresUnlock,
  parseDevConsoleCommand,
} from "../server/src/devConsole.js";
import { PlayerRegistry } from "../server/src/playerRegistry.js";

assert.equal(cheatsEnabledFromEnv({ CUBEWARS_ENABLE_CHEATS: "1" }), true);
assert.equal(cheatsEnabledFromEnv({}), true, "default allow when unset");
assert.equal(cheatsEnabledFromEnv({ CUBEWARS_ENABLE_CHEATS: "0" }), false);

assert.equal(parseDevConsoleCommand("  IDDQD  "), "iddqd");
assert.equal(parseDevConsoleCommand("get_pet"), "get_pet");
assert.equal(parseDevConsoleCommand("GOD_MODE"), "god_mode");
assert.equal(parseDevConsoleCommand("noclip"), null);

assert.equal(devConsoleRequiresUnlock("iddqd"), false);
assert.equal(devConsoleRequiresUnlock("get_pet"), true);

function aimAt(
  shooter: { position: { x: number; y: number; z: number }; yaw: number; pitch: number },
  target: { x: number; y: number; z: number },
): void {
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

{
  const registry = new PlayerRegistry();
  const shooter = registry.spawn("shooter");
  const target = registry.spawn("target");
  shooter.position = { x: 0, y: 0, z: 2 };
  target.position = { x: 0, y: 0, z: -2 };
  shooter.spawnProtectedUntilMs = 0;
  target.spawnProtectedUntilMs = 0;
  aimAt(shooter, { x: 0, y: 1.15, z: -2 });
  shooter.equippedWeapon = "pistol";
  shooter.ownedWeapons.add("pistol");

  target.godMode = true;
  const healthBefore = target.health;
  const outcome = registry.fire(shooter.id);
  assert.equal(outcome.hit, false, "god mode target must not register a hit");
  assert.equal(target.health, healthBefore, "god mode target health unchanged");

  const toggled = registry.toggleGodMode("target");
  assert.equal(toggled, false);
  const outcome2 = registry.fire(shooter.id);
  assert.equal(outcome2.hit, true, "god mode off — target hittable again");
}

console.log("[dev-console] PASS");
