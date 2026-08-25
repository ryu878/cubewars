# EPIC 40: Companion Pet Distance & Scale Polish

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User ask (RU, 2026-08-25): Pets are hard to notice vs amulets; pets sit too close to the avatar. Make them a bit larger and hang farther away — roughly at arm’s length, at about 45° upward from the player.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Companion Pet Distance & Scale Polish |
| **System goal** | Make equipped companion pets clearly readable at engagement range by moving them farther from the avatar (arm’s-length float at ~45° up) and slightly enlarging silhouettes/glow, without changing combat authority or amulet visibility. |
| **Business/gameplay problem** | After EPIC 39, pets cling near the torso (`PET_SIDE_X ≈ ±0.48`, small Y offset) and read as waist-level clutter; amulets remain obvious while pets do not telegraph “has pets.” |
| **Architectural role** | **Client-only** cosmetic layout/scale in `client/src/remotePlayers.ts`. Server/shared already broadcast `equippedPetsVisual` (type/color/side); no protocol change expected. |
| **Stack** | Fixed stack — Three.js/TS client only for this EPIC. |
| **Interaction** | Builds on EPIC 39 companions + cyan glow; preserves EPIC 39 F-001 dual-side deconflict; preserves EPIC 31 amulet pendant distinctness; preserves EPIC 36 spawn-protection opacity on companions. |

## 2. Design

### 2.1 Current baseline (EPIC 39)

In `client/src/remotePlayers.ts`:

- `PET_SIDE_X = { left: -0.48, right: 0.48 }`
- `PET_ANCHOR_Y_OFFSET = 0.12` (relative to torso center → `petCompanionBaseY`)
- `PET_ANCHOR_Z = 0.22`
- Glow shell `SphereGeometry(0.22, …)`
- Companion body meshes at natural ~0.2 unit size (no root scale multiplier)

### 2.2 Target presentation

Treat the torso/shoulder as the origin of a short radial “arm”:

1. **Distance:** pets hang roughly **arm’s length** from the avatar — clearly outside the shoulder silhouette (not hugging the torso). Suggested starting band for Programmer to tune:
   - `|PET_SIDE_X|` in **~0.75–1.05** (was 0.48)
   - Keep a modest forward/back `PET_ANCHOR_Z` so pets do not intersect the torso (tune as needed; may rise slightly with distance)
2. **Elevation (~45° up):** pet anchor Y should read as a clear elevated float above waist/hip cling — approximately **45° upward** from the player (shoulder/torso reference). Suggested:
   - Increase `PET_ANCHOR_Y_OFFSET` so base Y sits near **shoulder → head-adjacent** float (roughly offset ≈ horizontal radius × `tan(45°)` ≈ same order as lateral distance). Target feel: pets float **up and out**, not beside the hips.
3. **Scale:** apply a modest root scale on the companion group (body + glow), e.g. **~1.25–1.45×**, and grow the cyan glow shell proportionally so the aura still frames the silhouette.
4. **Amulet:** leave amulet pendant position/materials alone; gold tell must remain distinct and visible.
5. **Dual pets:** left/right still come from server `side`; client must keep using `PET_SIDE_X[visual.side]` so EPIC 39 F-001 deconflict remains effective (opposite sides never stack).
6. **Non-solid:** cosmetic client meshes only — no hitscan/collision/server authority changes.

### 2.3 Out of scope

New pet types, combat pets, protocol fields, inventory UI, pet colors, server side-assignment logic (unless a regression assertion needs a constant comment update).

## 3. Architecture

```text
Server equippedPetsVisual (unchanged)
        │
        ▼
client remotePlayers.applyPetVisual / buildCompanionSlot
        │  update PET_* anchors + scale + glow radius
        ▼
Visible companions: farther, higher (~45°), slightly larger + cyan glow
Amulet pendant: unchanged gold tell
```

## 4. Stories / Tasks

### Story 40.1 — Readable companion float

| # | Task | Place |
|---|------|-------|
| 40.1 | Retune `PET_SIDE_X`, `PET_ANCHOR_Y_OFFSET`, `PET_ANCHOR_Z` for arm’s-length + ~45° up | `client/src/remotePlayers.ts` |
| 40.2 | Slightly enlarge companion body + cyan glow shell (shared scale or matched constants) | `client/src/remotePlayers.ts` |
| 40.3 | Confirm dual-slot left/right still opposite; amulet unchanged; typecheck/build | client + existing `regression:epic39-companion-pets` if still green |

**Branch:** `task/epic-40-companion-pet-distance-scale`  
**Base:** `master`

## 5. Acceptance criteria

- [ ] Pets hang **farther** from the avatar (~arm’s length lateral/forward offset; clearly outside shoulder hug)
- [ ] Pets sit **~45° upward** relative to player torso/shoulder (clear elevated float, not waist-level cling)
- [ ] Pets are **slightly larger** so silhouette/type (dog/cat/bird/lion) reads at engagement range
- [ ] Cyan glow still visible and frames the pet; **amulet** remains distinct and visible (gold pendant)
- [ ] Dual pets still deconflict left/right (EPIC 39 F-001 server + client sides)
- [ ] Non-solid / cosmetic only — no collision/hitscan/server authority change
- [ ] `npm run typecheck` and `npm run build` PASS; relevant companion regression still PASS
- [ ] Branch pushed; after Critic APPROVED (or Judge ALL_CLOSED), merge to `master` and `git push origin master`; README Current status updated if house pattern applies

## 6. Risks

- Over-large scale or extreme offset may clip camera / obscure nameplates — keep “slightly larger” and arm’s-length, not orbit radius.
- Glow shell too big may wash out amulet gold tell — keep glow local to the pet.
- Dual pets at larger size may visually crowd if sides collide — rely on existing opposite-side deconflict; do not collapse both to center.

## 7. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25  
- **Assignee:** Programmer (Pusya)  
- **Ops note:** After Critic `APPROVED` (or Judge `ALL_CLOSED`), Team Lead merges to `master` and pushes `origin master` without waiting for user confirmation. Keep GitHub current.
