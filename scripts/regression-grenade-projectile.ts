// EPIC 19 regression: grenade launcher shots are server-simulated
// projectiles, not instant hitscan damage. This uses Match directly with
// fake sockets so broadcasts and damage application are exercised together.

import assert from "node:assert/strict";
import type { ServerMessage, WeaponType } from "@cubewars/shared";
import { WEAPON_STATS } from "@cubewars/shared";
import { Match } from "../server/src/match.js";

interface FakeSocket {
  OPEN: 1;
  readyState: 1;
  messages: ServerMessage[];
  send(payload: string): void;
}

function socket(): FakeSocket {
  return {
    OPEN: 1,
    readyState: 1,
    messages: [],
    send(payload: string) {
      this.messages.push(JSON.parse(payload) as ServerMessage);
    },
  };
}

function equip(match: Match, id: string, weapon: WeaponType): void {
  const player = match.registry.getPlayer(id);
  if (!player) throw new Error(`missing player ${id}`);
  player.position = id === "shooter" ? { x: -34, y: 0, z: -8 } : { x: -34, y: 0, z: -18 };
  player.yaw = 0;
  player.pitch = 0;
  player.equippedWeapon = weapon;
  player.ownedWeapons.add(weapon);
  if (!WEAPON_STATS[weapon].infiniteAmmo) player.ammo[weapon] = 2;
  player.health = 100;
  player.armor = 0;
}

function stepProjectiles(match: Match, steps: number): void {
  for (let i = 0; i < steps; i++) {
    (match as unknown as { stepProjectiles(dtSeconds: number): void }).stepProjectiles(0.05);
  }
}

{
  const match = new Match({ id: "projectile-test", mode: "public" });
  const shooterSocket = socket();
  const targetSocket = socket();
  match.addHuman("shooter", shooterSocket as never);
  match.addHuman("target", targetSocket as never);
  equip(match, "shooter", "grenade_launcher");
  equip(match, "target", "pistol");

  const outcome = match.resolveFire("shooter");
  assert.equal(outcome.hit, false, "grenade fire should not damage instantly");
  assert.ok(!targetSocket.messages.some((message) => message.type === "hit"), "no immediate hit broadcast");

  stepProjectiles(match, 20);

  const target = match.registry.getPlayer("target");
  assert.ok(target && target.health < 100, "projectile should damage the target after travel");
  assert.ok(targetSocket.messages.some((message) => message.type === "projectile_impact"), "impact should be broadcast");
  assert.ok(
    targetSocket.messages.some((message) => message.type === "hit" && message.damageKind === "direct" && message.hitZone === "head"),
    "direct projectile hit should broadcast locational hit context",
  );
}

{
  const match = new Match({ id: "projectile-dodge-test", mode: "public" });
  const shooterSocket = socket();
  const targetSocket = socket();
  match.addHuman("shooter", shooterSocket as never);
  match.addHuman("target", targetSocket as never);
  equip(match, "shooter", "grenade_launcher");
  equip(match, "target", "pistol");

  match.resolveFire("shooter");
  const target = match.registry.getPlayer("target");
  if (!target) throw new Error("missing target");
  target.position.x = -29;

  stepProjectiles(match, 20);

  assert.equal(target.health, 100, "moving away before projectile arrival should avoid direct grenade damage");
  assert.ok(!targetSocket.messages.some((message) => message.type === "hit"), "dodged target should receive no hit broadcast");
}

console.log("[grenade-projectile] PASS");
