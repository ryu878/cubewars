# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 49 — Critic REVISE F-001 only (dry-bed rock materials) |
| Branch / commit / PR | `task/epic-49-map-palettes-thematic-props` (SHA filled after commit) |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: F-001 |

## What was done (brief)

1. **F-001:** Extracted `propMaterialKind` (`client/src/propMaterialKind.ts`) so rock/rubble/`_rock_` match **before** car body, and dropped unused `_hood`/`_bed` matchers (`carSilhouette` only emits `_body` / `_cabin` / `_wheel_*`).
2. `materialForProp` in `client/src/main.ts` now switches on that classifier — dry-bed piles like `rc_bed_w_rock_a` get rock grey, not `propAccent`.
3. Extended `scripts/regression-epic49-palettes.ts` to assert `propMaterialKind("rc_bed_*_rock_*") === "rock"` against live `rust_canyon` geometry ids.

## Changed files / areas

- `client/src/propMaterialKind.ts` (new)
- `client/src/main.ts` (`materialForProp` uses classifier)
- `scripts/regression-epic49-palettes.ts` (F-001 asserts)
- `docs/tasks/epic-49-programmer-handoff-f001.md` (this handoff)

## How to verify (steps for Trusya)

1. `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"`
2. `npm run typecheck`
3. `npm run regression:epic49-palettes` — must pass F-001 rock vs body asserts
4. Optional visual: load `rust_canyon` and confirm dry-bed rock piles (near map center beds) read as grey stone, not rust car-body accent; car wrecks still use accent metal on `_body`

## Build and run

- Build command: `npm run typecheck`
- Run command: `npm run regression:epic49-palettes` (and/or `npm run dev` for visual spot-check)
- Expected smoke result: regression OK; `rc_bed_w_rock_a` → rock; `rc_wreck_a_body` → body

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: regression stdout
- Key success messages: `EPIC 49 palette + pickup regression OK`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged (shared AABBs / collision untouched)
- What the client is allowed to predict/render only: prop material tint selection (visual only)

## Risks / known limitations

- Scope limited to F-001; no palette/map redesign
- If future car silhouettes add real `_bed`/`_hood` boxes, reintroduce those matchers **after** rock/rubble checks (or use stricter tokens like `_car_bed_`)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
