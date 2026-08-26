# Judge packet / verdict (Jasya) → Team Lead

## Meta

- Task ID: EPIC 46 — Multi-Map Catalog, Map Picker, Expanded Base, 8-Player Public
- Iteration: 1
- Judge: Jasya
- Critic review ref: `docs/tasks/epic-46-critic-review.md` @ `581b781` (REVISE; F-001, F-002)
- Programmer fix ref: `docs/tasks/epic-46-programmer-handoff-f001-f002.md` @ `409e153`
- Tester re-verify ref: `docs/tasks/epic-46-tester-reverify-f001-f002.md` @ `3a0faca` (PASS)

## Allowed inputs only

### Original finding(s) (copy)

- ID: F-001
- Severity: major
- Text: Themed maps share `standardPickups()` / hand-placed spawns that collide with walls/props/crates (unreachable loot; `elite_quarter` spawns in rubble). Required: reposition per-map spawn/pickup layouts; add regression asserting clearance vs blocking geometry.

- ID: F-002
- Severity: major
- Text: Base building/car not proven in gameplay screenshots (prior `04`/`05` wall face-plants; `endPos` never near landmarks). Required: interior free-point regression; Playwright landmark shots of door/interior and car silhouette.

### Changes

- Files / description:
  - `shared/src/maps/themedMaps.ts` — stopped blind `standardPickups()` reuse; per-map spawn/pickup coordinates clear of blocking boxes (incl. Elite Quarter rubble spawns moved off `eq_nw_rubble` / `eq_se_rubble`)
  - `shared/src/maps/base.ts` (+ catalog/mapData exports) — `BASE_BUILDING_INTERIOR_SAMPLE` `(-72, -21)`
  - `scripts/regression-epic46-maps.ts` — `assertCatalogClearance()` for all catalog spawns/pickups + Base interior walkability/footprint asserts
  - `scripts/qa-epic46-tester-playwright.mjs` + `client/src/main.ts` — landmark navigation / `__cwQaHoldPose` for door (`04`) and car (`05`)
  - `qa-artifacts/epic-46/*` — refreshed evidence

### Re-test results

- Tester re-verify outcome: **PASS** (`docs/tasks/epic-46-tester-reverify-f001-f002.md` @ `3a0faca`) for F-001 and F-002
- Regression pass outcome: `npm run regression:epic46-maps` → `[epic46-maps] PASS` (Tester + Judge spot re-run); typecheck/build PASS; Playwright ALL PASS with refreshed `04`/`05`

### Diff summary

- Before → after (for the specific finding):
  - F-001: themed maps used colliding `standardPickups()` centers / rubble-overlapping Elite Quarter spawns → per-map cleared layouts + catalog AABB clearance regression
  - F-002: no interior free-point assert; screenshots did not frame door/car → interior sample + clearance assert; posed `04` door gap into building interior; posed `05` dark car AABB silhouette

---

## Per-finding decisions

| Finding ID | Status | Evidence | Residual risk |
|------------|--------|----------|---------------|
| F-001 | CLOSED | Diff `409e153` replaces `standardPickups()` with per-map pickups/spawns; Elite Quarter corner spawns no longer at rubble centers; `assertCatalogClearance()` covers walls/props/crates; Judge re-ran `npm run regression:epic46-maps` → PASS | None for listed issue; themed maps remain MVP silhouettes (out of Critic revision scope) |
| F-002 | CLOSED | `BASE_BUILDING_INTERIOR_SAMPLE` exported + regress-clear inside footprint; `04-base-building-approach.png` shows south door gap between brick/wood segments with interior crate; `05-base-car-area.png` shows readable dark multi-box car silhouette; Tester PASS notes posed landmark gate | Best-effort landmark *walks* may still report `nearBuilding`/`nearCar` false under bot pressure — visual gate is posed shots + regression (as required) |

## Overall

- `ALL_CLOSED`
- Open IDs: _(none)_
- Iteration count: 1
- Note to TL (factual, no debate): Critic REVISE findings F-001 and F-002 are closed on iteration 1. Team Lead may proceed to final merge approval for EPIC 46. Do not merge/deploy from this Judge gate.
