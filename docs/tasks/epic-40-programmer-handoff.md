# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 40: Companion Pet Distance & Scale Polish |
| Branch / commit / PR | `task/epic-40-companion-pet-distance-scale` @ tip after this file’s pin commit; compare: https://github.com/ryu878/cubewars/compare/master...task/epic-40-companion-pet-distance-scale (gh PR create failed: auth account cannot resolve repo — TL may open PR) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Retuned companion anchors in `client/src/remotePlayers.ts` for arm’s-length float at ~45° upward from torso center.
2. Applied modest companion root scale so body + cyan glow enlarge together; left amulet pendant layout/materials untouched.
3. Documented EPIC 40 under README Current status; included epic spec on the branch.

### Final layout / scale numbers (authoritative)

| Constant | Before (EPIC 39) | After (EPIC 40) |
|----------|------------------|-----------------|
| `PET_SIDE_X` | ±0.48 | ±0.9 |
| `PET_ANCHOR_Y_OFFSET` | 0.12 | 0.9 (≈ `|PET_SIDE_X|` → ~45° up) |
| `PET_ANCHOR_Z` | 0.22 | 0.3 |
| `PET_ROOT_SCALE` | (none / 1.0) | 1.35 |
| Glow `SphereGeometry` radius | 0.22 | 0.22 (scaled by root → visual ≈ 0.297) |

Dual pets still use server `visual.side` → `PET_SIDE_X[side]` (EPIC 39 F-001).

## Changed files / areas

- `client/src/remotePlayers.ts` — `PET_*` anchors, `PET_ROOT_SCALE` on companion root
- `README.md` — Current status EPIC 40 bullet
- `docs/tasks/epic-40-companion-pet-distance-scale.md` — approved epic spec
- `docs/tasks/epic-40-programmer-handoff.md` — this handoff

## How to verify (steps for Trusya)

1. Join a match with bots (or equip pets): companions should float **farther out** and **higher** (shoulder/head-adjacent), not waist-cling.
2. Dual-pet loadout (archetype D / two equipped pets): left and right stay opposite; never stacked.
3. Confirm cyan glow still frames the pet; gold amulet pendant still distinct at neck/chest (unchanged).
4. Confirm pets look slightly larger (~1.35×) so dog/cat/bird/lion silhouette reads at engagement range.
5. Re-run: `npm run typecheck`, `npm run build`, `npm run regression:epic39-companion-pets`.

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (or project docker compose if preferred)
- Expected smoke result: farther/higher/slightly larger companions + cyan glow; amulet unchanged; epic39 regression PASS

### Checks performed (Programmer)

- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run regression:epic39-companion-pets` — PASS

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: N/A for this cosmetic client layout change
- Key success messages: `[epic39-companion-pets] PASS`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged — `equippedPetsVisual` (type/color/side) still server-authored; dual-side deconflict remains server-side
- What the client is allowed to predict/render only: companion mesh position offsets, root scale, glow, bob — cosmetic only; no hitscan/collision

## Risks / known limitations

- Larger / higher pets may slightly crowd nameplates or FPS fringe at extreme camera angles — kept within arm’s-length / 1.35× “slightly larger” band per spec
- Visual QA is the primary gate for “~45° / arm’s length” feel; numbers are within the spec bands

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
