# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-26 |
| Task / Story / EPIC | EPIC 46 — Critic REVISE re-verify F-001, F-002 |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-46-programmer-handoff-f001-f002.md` @ impl `409e153` / branch tip at verify `ddd273c` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | yes — finding IDs re-checked: **F-001**, **F-002** (+ light regression) |

## Environment

- OS / Docker: Linux 5.15 (host Node v24.18.1 / npm 11.16.0; Playwright-managed server `:7798` + Vite client `:5218`)
- Branch / commit: `task/epic-46-multi-map-select-capacity` @ `ddd273c` (impl fix `409e153`); worktree `.claude/worktrees/epic-46-multi-map`

## Scope note

Scoped Critic/Judge revision re-verify only — not a full EPIC 46 redo. Checklist sections applied: Universal (AC for findings), Build/Run, Client smoke, Gameplay & feel (landmark evidence), light lobby/map regression. Server-authority path not re-audited beyond existing map catalog remaining shared/server source (unchanged authority model).

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client typecheck clean; server `tsc` + client Vite production build succeeded

### Run

- Command: `npm run regression:epic46-maps`
- Result: OK — `[epic46-maps] PASS` (includes spawn/pickup AABB clearance + `BASE_BUILDING_INTERIOR_SAMPLE` walkable/interior footprint asserts)

- Command: `node scripts/qa-epic46-tester-playwright.mjs` (re-run; refreshed `qa-artifacts/epic-46/`)
- Result: OK — `[epic46-qa] ALL PASS`

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| F-001 catalog clearance | No spawn/pickup overlap vs walls/props (pickups also crates); regression green | `npm run regression:epic46-maps` PASS; `assertCatalogClearance()` in `scripts/regression-epic46-maps.ts` exercised |
| F-002 interior sample | `BASE_BUILDING_INTERIOR_SAMPLE` (-72,-21) clear + inside building footprint | Regression asserts PASS; export in `shared/src/maps/base.ts` |
| F-002 door / interior shot | `04-base-building-approach.png` shows south door gap into building | Posed shot from exterior (~-68,-36) looking north through flanking brick/wood wall segments with interior crate visible |
| F-002 car silhouette | `05-base-car-area.png` shows dark car AABB | Dark multi-box car prop cluster clearly framed mid-view |
| Light regression: lobby picker | 8 map options | `smoke-summary.json` `mapPicker.optionCount: 8` |
| Light regression: movement | Player position changes on Base | `gameplay.moved: true` / `sessionMoved: true` |
| Console | No hard pageerrors on exercised path | `consoleErrors: []` |

### Finding evidence

| Finding | Closed? | Evidence |
|---------|---------|----------|
| **F-001** | yes | Themed maps no longer blind-reuse colliding `standardPickups` centers; per-map spawn/pickup clearance + regression overlap asserts. `npm run regression:epic46-maps` → PASS |
| **F-002** | yes | Interior sample `(-72,-21)` regress-clear; Playwright landmark poses refreshed — `04` door opening/interior framing, `05` readable car silhouette; `smoke-summary.json` `landmarkShots` notes posed frames |

**Note (non-blocking):** best-effort landmark *walks* this run recorded `nearBuilding: false` / `nearCar: false` (bots can interrupt mid-route). Per handoff/script, F-002 visual gate is the posed `04`/`05` shots + regression interior sample — both PASS.

### Config and secrets

- `config.vars.example` / README up to date: N/A for this revision (no new env vars)
- No secrets in diff: yes

### Documentation

- README / docs updated: N/A for this scoped re-verify (revision handoff + Critic review already on branch); this report added

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — map geometry/spawns/pickups remain shared catalog consumed server-side; `__cwQaHoldPose` is screenshot-only camera override

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-46/01`–`09` + `smoke-summary.json` (re-run 2026-08-26)
- Movement: OK — WASD move evidenced (`moved: true`)
- Jump: OK — `07-base-jump.png` captured (light regression)
- Shoot / hit registration: OK — `08-base-fire.png` captured; bots exchanging hits in server logs (light regression)
- Camera / controls feel: OK — pointer lock + posed landmark frames usable
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — Base/Rust Canyon shots readable; door gap + car silhouette visible in `04`/`05`
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky brick/wood props, sandy floor, gradient sky

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** Critic/Judge revision re-verify for **F-001** and **F-002** signed off. Next step is **Judge (Jasya)** per `ai-office/process/review-judge-cycle.md` (not Critic re-open, not Team Lead merge). Briefly verified: catalog spawn/pickup clearance regression green; Base interior sample clear; Playwright landmark screenshots show door opening/interior framing and car silhouette; typecheck/build green; light lobby/movement regression OK.
- Do **not** merge or deploy from this gate.
