# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 39: Visible Companion Pets + Pet Color Customization |
| Branch / commit / PR | `task/epic-39-visible-companion-pets` (origin tip; feature `c0d3889`); PR: open manually at https://github.com/ryu878/cubewars/pull/new/task/epic-39-visible-companion-pets (`gh` auth account cannot resolve repo) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Replaced EPIC 31 abstract pet orbs with low-poly dog/cat/bird/lion companion meshes + soft cyan additive glow; left/right side + palette color from server `equippedPetsVisual`.
2. Persisted `colorIndex` on economy pets (Redis); added `economy_set_pet_color`; inventory Pet colors swatches; bots get random pet colors at loadout; spawn-protection opacity still fades companions with the owner.

## Changed files / areas

- `shared/` — `EquippedPetVisual`, `PetSide`, `economy_set_pet_color`, `PlayerState.equippedPetsVisual`, `EconomyPetDto.colorIndex`
- `server/` — economy persist/set color; `setEquipmentVisual` side stability by pet slot id; bot random colors; broadcast
- `client/src/remotePlayers.ts` — companion meshes + glow + bob; EPIC 36 opacity compose
- `client/src/inventoryOverlay.ts` + `client/index.html` — pet color swatches
- `scripts/regression-epic39-companion-pets.ts` + package script

## How to verify (steps for Trusya)

1. Join a bots/public match with equipped pets (or watch bots): companions should read as type silhouettes with cyan aura, sitting left or right of the avatar.
2. Inventory (I) → Pet colors: change a pet swatch; rejoin / re-equip — color persists; other clients see the new color on equipped companions.
3. Shoot through companions — no hit/block (client cosmetic only). While spawn-protected, companions fade with the owner.
4. Run: `npm run typecheck`, `npm run build`, `npm run regression:epic39-companion-pets`, `npm run regression:epic31-bot-loadouts`.

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (or docker compose per README)
- Expected smoke result: remote avatars with pets show companions; world_state includes `equippedPetsVisual`; regressions PASS

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[economy] set_pet_color ok for <nick>`, `[bots] ... pets=[type#value@cN] ...`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: pet ownership + palette index for `economy_set_pet_color`; companion `side` (stable until pet id change) and `colorIndex` broadcast; bot colors assigned server-side
- What the client is allowed to predict/render only: companion meshes, glow, bob; never hitscan/collision/damage

## Risks / known limitations

- Companion silhouettes are low-poly (intentional); not high-poly art assets
- Pets remain non-solid; no pet combat AI

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
