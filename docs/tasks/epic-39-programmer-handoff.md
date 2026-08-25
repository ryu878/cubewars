# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 39: Visible Companion Pets + Pet Color Customization |
| Branch / commit / PR | `task/epic-39-visible-companion-pets` (origin tip); PR: https://github.com/ryu878/cubewars/pull/new/task/epic-39-visible-companion-pets |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: F-001, F-002 |

## What was done (brief)

1. **F-001:** Dual-equip companions always get opposite sides (slot2 forced opposite of slot1 when they would collide); regression asserts opposite sides across many dual rolls + bot dual-equip.
2. **F-002:** On companion body rebuild, dispose geometry/materials of the removed subtree to avoid GPU leaks.

## Changed files / areas

- `server/src/playerRegistry.ts` — side deconflict in `setEquipmentVisual`
- `client/src/remotePlayers.ts` — `disposeCompanionSubtree` on rebuild
- `scripts/regression-epic39-companion-pets.ts` — F-001 opposite-side assertions

## How to verify (steps for Trusya)

1. Equip two pets (or watch archetype-D bots): companions must sit on **opposite** sides (never stacked).
2. Change one pet / recolor: sides stay opposite; same pet ids keep prior sides when still valid.
3. Re-run: `npm run typecheck`, `npm run regression:epic39-companion-pets`.
4. Optional smoke: long session with frequent pet type changes — no growing GPU memory from companion rebuilds (F-002).

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev`
- Expected smoke result: dual pets on opposite shoulders; regressions PASS

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout (unchanged)
- Key success messages: unchanged from first pass

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: companion `side` assignment + dual-equip deconflict
- What the client is allowed to predict/render only: meshes/glow/bob; dispose on rebuild is client-local

## Risks / known limitations

- When deconflicting, slot2 yields to slot1 (may flip slot2 side if both rolled the same)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
