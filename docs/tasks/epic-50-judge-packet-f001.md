# Judge packet — EPIC 50 / F-001

**Prepared by:** Team Lead (Tusya)  
**Date:** 2026-08-26  
**Branch:** `task/epic-50-half-maps-pet-clarity`  
**HEAD:** `cb35b6165a59aa6c6acd91821c4e13a43f815cd0`  
**Iteration:** 1 (after Critic REVISE)

## Original finding(s)

### F-001 (major)

- **Source:** `docs/tasks/epic-50-critic-review.md`
- **Issue:** Lion inventory glyph was concentric orange circles (`.inv-pet-lion-mane` / `.inv-pet-lion-face`) — not species-readable at bag/rail size; failed Story B “icon must match pet type.”
- **Required fix:** Redesign lion glyph with mane silhouette + face features (eyes/nose), distinct from dog/cat/bird, readable at ~36px bag and ~22px rail; inline CSS/SVG only.

## Changes made (Programmer)

- **Handoff:** `docs/tasks/epic-50-programmer-handoff-f001.md`
- Lion icon: **6-tuft mane** (`clip-path`) + face disc + round eyes + short muzzle/nose in `client/index.html` / `createPetIcon` (`inventoryOverlay.ts`); shared by bag, rail, ghost, detail.
- Commit: `cb35b61` (on branch tip).

## Re-test results (Tester)

- **Report:** `docs/tasks/epic-50-tester-reverify-f001.md` — **PASS** for F-001
- Evidence: regenerated `qa-artifacts/epic-50/09`–`11`; lion identifiable as mane + face without relying on `+100 Damage`
- Light regression: grant labels OK; maps still ±46/±26; typecheck + economy-pets + epic46-maps PASS
- Residual noted: shot `11` equips dog on rail; lion `inv-icon-sm` inferred from shared builder (non-blocking)

## Diff summary (F-001 only)

- `client/index.html` — lion CSS glyph redesign (tufted mane + face features)
- `client/src/inventoryOverlay.ts` — `createPetIcon` lion parts if touched
- Docs: F-001 handoff + tester reverify
- No map/economy formula changes in this revision

## Out of scope for Judge

Do not invent new findings. Close F-001 only (CLOSED / STILL_OPEN / PARTIAL / REGRESSION). Overall: ALL_CLOSED | REVISE_AGAIN | ESCALATE_HUMAN.
