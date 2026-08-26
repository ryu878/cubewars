# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 13:09 UTC |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 46 — Critic REVISE F-001, F-002 |
| Branch / commit / PR | `task/epic-46-multi-map-select-capacity` @ impl `409e153` / tip `b317a09` |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: F-001, F-002 |

## What was done (brief)

1. **F-001:** Stopped blind `standardPickups()` reuse on themed maps; per-map spawn/pickup coordinates cleared of walls/props/crates (including Elite Quarter rubble spawns). Added catalog clearance assertions to `scripts/regression-epic46-maps.ts`.
2. **F-002:** Exported `BASE_BUILDING_INTERIOR_SAMPLE` `(-72, -21)` and regress walkable clearance inside the Base building. Updated Playwright with yaw-aimed walks + temporary `__cwQaHoldPose` camera frames for door opening (`04`) and car silhouette (`05`); regenerated `qa-artifacts/epic-46/`.

## Changed files / areas

- `shared/src/maps/themedMaps.ts` — per-map pickups/spawns
- `shared/src/maps/base.ts`, `catalog.ts`, `mapData.ts`, `primitives.ts` — interior sample export + comment
- `scripts/regression-epic46-maps.ts` — spawn/pickup/interior clearance
- `scripts/qa-epic46-tester-playwright.mjs` — landmark navigation + posed shots
- `client/src/main.ts` — QA hold-pose hook for landmark screenshots
- `qa-artifacts/epic-46/*` — refreshed evidence
- `docs/tasks/epic-46-programmer-handoff-f001-f002.md` — this handoff

## How to verify (steps for Trusya)

1. `npm run regression:epic46-maps` — must PASS (includes F-001 clearance + F-002 interior sample).
2. Spot-check Crystal Cave mid GL / Elite Quarter rubble spawns are off blocking boxes (or re-probe with regression).
3. `node scripts/qa-epic46-tester-playwright.mjs` — confirm `04-base-building-approach.png` shows south door gap and `05-base-car-area.png` shows dark car AABB; `smoke-summary.json` notes posed landmark shots.
4. Optional: join Base bots match and walk into building at door `(-68,-30)` to sample `(-72,-21)`.

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run regression:epic46-maps`; `node scripts/qa-epic46-tester-playwright.mjs`
- Expected smoke result: regression PASS; Playwright ALL PASS with updated `04`/`05` artifacts

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: regression stdout `[epic46-maps] PASS`; Playwright `[epic46-qa] ALL PASS`
- Key success messages: clearance asserts silent on success; `smoke-summary.json` `gameplay.landmarkShots`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: map geometry / spawn / pickup catalogs remain shared server-authoritative sources for matches
- What the client is allowed to predict/render only: `__cwQaHoldPose` is screenshot-only camera override; does not change server positions or combat

## Risks / known limitations

- Playwright landmark *walks* are best-effort (bots can kill mid-route); F-002 visual gate is the posed `04`/`05` shots + regression interior sample
- Themed maps remain MVP silhouettes; only clearance was fixed, not art density

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
