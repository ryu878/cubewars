// EPIC 33 regression: avatar colors on PlayerState, validation, bot random assignment.

import assert from "node:assert/strict";
import {
  AVATAR_COLOR_PALETTE,
  defaultAvatarColors,
  isAvatarBodyPart,
  isValidPaletteIndex,
  randomAvatarColors,
} from "@cubewars/shared";
import { BotAI } from "../server/src/botAI.js";
import { PlayerRegistry } from "../server/src/playerRegistry.js";

{
  const registry = new PlayerRegistry();
  const player = registry.spawn("player-a");
  const state = registry.toWorldState().find((p) => p.id === player.id);
  assert.deepEqual(state?.avatarColors, defaultAvatarColors(), "fresh spawn broadcasts default avatar colors");
}

{
  const registry = new PlayerRegistry();
  registry.spawn("player-a");
  registry.setAvatarColors("player-a", { head: 1, torso: 2, hands: 3, legs: 4 });
  const state = registry.toWorldState().find((p) => p.id === "player-a");
  assert.deepEqual(state?.avatarColors, { head: 1, torso: 2, hands: 3, legs: 4 });
  // Isolation: second player stays at defaults.
  registry.spawn("player-b");
  const other = registry.toWorldState().find((p) => p.id === "player-b");
  assert.deepEqual(other?.avatarColors, defaultAvatarColors());
}

{
  assert.equal(isAvatarBodyPart("head"), true);
  assert.equal(isAvatarBodyPart("torso"), true);
  assert.equal(isAvatarBodyPart("hands"), true);
  assert.equal(isAvatarBodyPart("legs"), true);
  assert.equal(isAvatarBodyPart("face"), false);
  assert.equal(isAvatarBodyPart("body"), false);
  assert.equal(isValidPaletteIndex(0), true);
  assert.equal(isValidPaletteIndex(AVATAR_COLOR_PALETTE.length - 1), true);
  assert.equal(isValidPaletteIndex(-1), false);
  assert.equal(isValidPaletteIndex(AVATAR_COLOR_PALETTE.length), false);
  assert.equal(isValidPaletteIndex(1.5), false);
  assert.equal(isValidPaletteIndex("0"), false);
}

{
  // Bots get randomized colors at spawn (independent indices per part).
  const registry = new PlayerRegistry();
  const bots = new BotAI(registry);
  bots.spawnBots(8);
  const keys = new Set<string>();
  for (const state of registry.toWorldState()) {
    const c = state.avatarColors;
    assert.ok(isValidPaletteIndex(c.head));
    assert.ok(isValidPaletteIndex(c.torso));
    assert.ok(isValidPaletteIndex(c.hands));
    assert.ok(isValidPaletteIndex(c.legs));
    keys.add(`${c.head},${c.torso},${c.hands},${c.legs}`);
  }
  // With 8 bots × 8^4 palette space, near-certain to see >1 distinct set.
  assert.ok(keys.size >= 2, `expected varied bot colors, got ${keys.size} unique set(s)`);
}

{
  // randomAvatarColors helper returns in-range indices.
  for (let i = 0; i < 20; i++) {
    const c = randomAvatarColors();
    assert.ok(isValidPaletteIndex(c.head));
    assert.ok(isValidPaletteIndex(c.torso));
    assert.ok(isValidPaletteIndex(c.hands));
    assert.ok(isValidPaletteIndex(c.legs));
  }
}

console.log("[avatar-colors] PASS");
