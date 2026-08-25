// EPIC 39: companion visual broadcast, side stability, bot pet colors,
// palette validation helpers. Hitscan remains avatar-AABB only (pets are
// client-cosmetic) — confirmed by absence of pet volumes in combat targets.

import assert from "node:assert/strict";
import {
  AVATAR_COLOR_PALETTE,
  isValidPaletteIndex,
  randomPaletteIndex,
  randomPetSide,
} from "@cubewars/shared";
import { BotAI, generateBotLoadout } from "../server/src/botAI.js";
import { PlayerRegistry } from "../server/src/playerRegistry.js";

{
  // Fresh spawn broadcasts empty companion visual list.
  const registry = new PlayerRegistry();
  const player = registry.spawn("player-a");
  const state = registry.toWorldState().find((p) => p.id === player.id);
  assert.deepEqual(state?.equippedPetsVisual, []);
  assert.deepEqual(state?.equippedPetTypes, []);
}

{
  // Side is stable across re-apply with the same slot id; rerolls when slot id changes.
  const registry = new PlayerRegistry();
  registry.spawn("player-a");
  registry.setEquipmentVisual(
    "player-a",
    [{ slotId: "pet:1", type: "lion", colorIndex: 3 }],
    false,
  );
  const first = registry.toWorldState().find((p) => p.id === "player-a")!;
  assert.equal(first.equippedPetsVisual.length, 1);
  assert.equal(first.equippedPetsVisual[0]!.type, "lion");
  assert.equal(first.equippedPetsVisual[0]!.colorIndex, 3);
  assert.ok(first.equippedPetsVisual[0]!.side === "left" || first.equippedPetsVisual[0]!.side === "right");
  assert.deepEqual(first.equippedPetTypes, ["lion"]);

  const side = first.equippedPetsVisual[0]!.side;
  // Same pet id → same side (many re-applies).
  for (let i = 0; i < 20; i++) {
    registry.setEquipmentVisual(
      "player-a",
      [{ slotId: "pet:1", type: "lion", colorIndex: 3 }],
      false,
    );
    const again = registry.toWorldState().find((p) => p.id === "player-a")!;
    assert.equal(again.equippedPetsVisual[0]!.side, side, "side must stay stable for same pet id");
  }

  // Color change alone does not reroll side.
  registry.setEquipmentVisual(
    "player-a",
    [{ slotId: "pet:1", type: "lion", colorIndex: 5 }],
    false,
  );
  assert.equal(
    registry.toWorldState().find((p) => p.id === "player-a")!.equippedPetsVisual[0]!.side,
    side,
  );

  // Different pet id → side is re-rolled (not required to differ from previous,
  // but the slot identity must update and type must change).
  registry.setEquipmentVisual(
    "player-a",
    [{ slotId: "pet:999", type: "dog", colorIndex: 1 }],
    false,
  );
  const afterSwap = registry.toWorldState().find((p) => p.id === "player-a")!;
  assert.equal(afterSwap.equippedPetsVisual[0]!.type, "dog");
  assert.equal(afterSwap.equippedPetTypes[0], "dog");
  assert.ok(
    afterSwap.equippedPetsVisual[0]!.side === "left" ||
      afterSwap.equippedPetsVisual[0]!.side === "right",
  );
}

{
  // Two slots: opposite sides (F-001 — never stack on the same shoulder).
  const registry = new PlayerRegistry();
  registry.spawn("player-a");
  for (let trial = 0; trial < 40; trial++) {
    registry.setEquipmentVisual(
      "player-a",
      [
        { slotId: `pet:a-${trial}`, type: "dog", colorIndex: 0 },
        { slotId: `pet:b-${trial}`, type: "bird", colorIndex: 7 },
      ],
      true,
    );
    const state = registry.toWorldState().find((p) => p.id === "player-a")!;
    assert.equal(state.equippedPetsVisual.length, 2);
    assert.notEqual(
      state.equippedPetsVisual[0]!.side,
      state.equippedPetsVisual[1]!.side,
      `dual-equip sides must differ (trial ${trial})`,
    );
  }
  // Re-apply same ids: sides stay opposite and stable for slot1.
  const before = registry.toWorldState().find((p) => p.id === "player-a")!;
  const side0 = before.equippedPetsVisual[0]!.side;
  const side1 = before.equippedPetsVisual[1]!.side;
  registry.setEquipmentVisual(
    "player-a",
    [
      { slotId: "pet:a-39", type: "dog", colorIndex: 0 },
      { slotId: "pet:b-39", type: "bird", colorIndex: 7 },
    ],
    true,
  );
  const after = registry.toWorldState().find((p) => p.id === "player-a")!;
  assert.equal(after.equippedPetsVisual[0]!.side, side0);
  assert.equal(after.equippedPetsVisual[1]!.side, side1);
  assert.notEqual(after.equippedPetsVisual[0]!.side, after.equippedPetsVisual[1]!.side);
  assert.equal(after.hasAmulet, true);
  assert.deepEqual(after.equippedPetTypes, ["dog", "bird"]);
  assert.equal(after.equippedPetsVisual[1]!.colorIndex, 7);
}

{
  // Palette helpers.
  assert.equal(isValidPaletteIndex(0), true);
  assert.equal(isValidPaletteIndex(AVATAR_COLOR_PALETTE.length - 1), true);
  assert.equal(isValidPaletteIndex(AVATAR_COLOR_PALETTE.length), false);
  assert.equal(isValidPaletteIndex(-1), false);
  for (let i = 0; i < 30; i++) {
    assert.ok(isValidPaletteIndex(randomPaletteIndex()));
    const side = randomPetSide();
    assert.ok(side === "left" || side === "right");
  }
}

{
  // Bot loadouts assign random colorIndex per pet.
  const SAMPLE = 200;
  const colorSet = new Set<number>();
  let petCount = 0;
  for (let i = 0; i < SAMPLE; i++) {
    const loadout = generateBotLoadout();
    for (const pet of loadout.pets) {
      petCount += 1;
      assert.ok(isValidPaletteIndex(pet.colorIndex), `bot pet color out of range: ${pet.colorIndex}`);
      colorSet.add(pet.colorIndex);
    }
  }
  assert.ok(petCount > 50, "expected many bot pets in sample");
  assert.ok(colorSet.size >= 2, `expected varied bot pet colors, got ${colorSet.size}`);
}

{
  // BotAI spawn path broadcasts equippedPetsVisual with colors + sides.
  const registry = new PlayerRegistry();
  const bots = new BotAI(registry);
  bots.spawnBots(12);
  let withPets = 0;
  for (const state of registry.toWorldState()) {
    assert.ok(Array.isArray(state.equippedPetsVisual));
    assert.equal(state.equippedPetsVisual.length, state.equippedPetTypes.length);
    for (const visual of state.equippedPetsVisual) {
      assert.ok(isValidPaletteIndex(visual.colorIndex));
      assert.ok(visual.side === "left" || visual.side === "right");
    }
    if (state.equippedPetsVisual.length > 0) withPets += 1;
    if (state.equippedPetsVisual.length === 2) {
      assert.notEqual(
        state.equippedPetsVisual[0]!.side,
        state.equippedPetsVisual[1]!.side,
        "bot dual-equip sides must differ (F-001)",
      );
    }
  }
  assert.ok(withPets >= 1, "expected at least one bot with companion visuals");
}

console.log("[epic39-companion-pets] PASS");
