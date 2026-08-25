# EPIC 39: Visible Companion Pets + Pet Color Customization

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User ask (RU, 2026-08-25): Pets must be visible while playing; shooting them does nothing (non-solid, bullets pass through); sit randomly left or right of the player; hang in a light cyan/blue glow so they are noticeable; silhouette must read as lion / dog / cat / bird; players can pick pet colors; bot pets get random colors too.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Visible Companion Pets + Pet Color Customization |
| **System goal** | Replace the EPIC 31 color-orb pet tell with recognizable, non-collidable companion meshes beside the avatar (left or right), wrapped in a soft cyan glow, with per-pet palette colors (player-chosen; bots random). |
| **Business/gameplay problem** | Current pet orbs are abstract and not type-recognizable; user wants fantasy companions that are clearly present but never affect combat/hitscan. |
| **Architectural role** | shared (pet color types + protocol) / server (persist colors, broadcast, bot random) / client (meshes, glow, inventory UI) |
| **Stack** | Fixed stack + existing Redis (avatar-style keys, **not** inside economy item docs unless attaching color to pet entity is cleaner — see §2) |
| **Interaction** | Extends EPIC 31 `equippedPetTypes` / `hasAmulet` and EPIC 33 palette patterns. Must compose with EPIC 36 spawn-protection opacity. Hitscan must ignore pets (already should — client-only meshes; confirm no server collision volume is added). |

## 2. Design

### 2.1 Presentation (client)

- For each equipped pet (slot 1, and slot 2 if present), render a **low-poly recognizable silhouette**:
  - **dog** — quadruped, longer snout
  - **cat** — quadruped, pointed ears, shorter face
  - **bird** — small body + wings
  - **lion** — quadruped + mane volume
- Soft **cyan/blue glow** (emissive + optional light PointLight low intensity, or AdditiveBlending shell) around each pet — “small fire/aura,” not a large bloom.
- **Side:** for each pet, choose left or right of the avatar **randomly per equip event** (server-authoritative so all clients agree): field `petSide: ("left"|"right")[]` parallel to equipped pets, or include in broadcast companion descriptor.
- Anchor beside shoulder/hip (clear of torso); bob gently optional (cosmetic only).
- **Non-solid:** pets are **client-render-only** (or server-broadcast cosmetic state only). Never added to hitscan candidates, never block movement, never receive damage. Shooting “through” them is the correct feel.

### 2.2 Colors

- Reuse `AVATAR_COLOR_PALETTE` (or a dedicated pet palette of same size) — palette **indices**, not raw hex on the wire.
- Each **owned pet** (not only equipped) has `colorIndex` persisted with the pet in the economy document (Deathmatch and Sandbox pools independently — color is part of the pet entity).
- Protocol: `economy_set_pet_color` `{ petId, paletteIndex, scope? }` — scope derived server-side from match context when in-match; from Deathmatch when in lobby (same pattern as inventory). Validate ownership + index range.
- Inventory Appearance / pet row: color swatches per selected pet.
- **Bots:** when assigning random loadout pets (EPIC 31), also assign random `colorIndex` per pet; broadcast with companion visual state.

### 2.3 Broadcast

Extend cosmetic companion state on `PlayerState` (or keep `equippedPetTypes` and add):

```ts
equippedPetsVisual: Array<{ type: PetType; colorIndex: number; side: "left" | "right" }>
```

Server computes from equipped pets + stored colors + stable side (reroll side only when that slot’s pet id changes). Client never invents sides/colors for other players.

### 2.4 Out of scope

Pet combat AI, pet blocking shots, 3D high-poly models, auction of “color only.”

## 3. Tasks

| # | Task | Place |
|---|------|-------|
| 39.1 | Shared pet visual types + protocol `economy_set_pet_color` + PlayerState field | `shared/` |
| 39.2 | Persist `colorIndex` on pets in EconomyStore; bot random colors; side assignment | `server/` |
| 39.3 | Client companion meshes + cyan glow + sides; remove/replace abstract orbs | `client/src/remotePlayers.ts` |
| 39.4 | Inventory UI pet color swatches | `client/src/inventoryOverlay.ts` |
| 39.5 | Regression: broadcast visual state; set color; hitscan unaffected | `scripts/` |

**Branch:** `task/epic-39-visible-companion-pets`  
**Base:** `master` (after push)

## 4. Acceptance criteria

- [ ] Equipped pets visible in-match as type-recognizable companions with soft cyan glow
- [ ] Each pet left or right (server-agreed); random on equip change
- [ ] Bullets/movement ignore pets (no hit, no block)
- [ ] Player can set pet colors; persists across restart (Redis)
- [ ] Bot pets have random colors
- [ ] Spawn-protection opacity still applies to companions or owner as designed (companions should fade with owner while protected — preferred)
- [ ] typecheck / build / regressions PASS
- [ ] Branch pushed to origin

## 5. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25  
- **Assignee:** Programmer (Pusya)  
- **Ops note:** Always push feature branch + merge to master and `git push origin master` without waiting for user confirmation.
