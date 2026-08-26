# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-26 |
| Task / Story / EPIC | EPIC 48 — Pickup Balance / Spread + Map Select Fix |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-48-programmer-handoff.md` (implementation tip `a8a1d91`; handoff docs tip `b271458`) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (host Node `v24.18.1` via nvm); Redis local for server; Playwright Chromium headless + SwiftShader
- Branch / commit: `task/epic-48-pickup-balance-map-select` @ `b271458de74a00e78fdb92fac4f619cef700612a` (worktree `.claude/worktrees/epic-48-pickup-balance-map-select`; matches expected tip)
- Compare: https://github.com/ryu878/cubewars/compare/master...task/epic-48-pickup-balance-map-select?expand=1

## Checklist sections applied

- Universal (AC, secrets, docs)
- Build and run
- Backend / game server (join/map_state authority)
- Client (lobby/in-match map paths)
- Real-time / multiplayer (public + bots + leave→rejoin)
- Gameplay & feel (Playwright screenshots + move/jump/fire smoke)

## Check results

### Build

- Command: `npm run typecheck` then `npm run build`
- Result: OK — shared/server/client typecheck clean; server `tsc` + client Vite build OK

### Run

- Command: `npm run regression:epic48`; `npm run regression:epic47`; `npm run regression:epic46-maps`; `node scripts/qa-epic48-tester-playwright.mjs`
- Result: OK — all regressions PASS; Playwright `ALL PASS` (`qa-artifacts/epic-48/playwright-run.log`)

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Catalog densify counts | 8/8/6/6 = 28 total (band ~20–32) | OK — `EPIC48_PICKUP_COUNTS` + `regression:epic48` catalog loop all maps |
| No weapon runway / spread | No same-Z row with >3 weapons; max pairwise >40 | OK — regression asserts; negative synthetic row fails as expected |
| Clearance | `isPickupClear` preserved | OK — densify still uses clearance; `regression:epic47` clearance still green |
| Fresh lobby | No empty Base public trap | OK — WS lobby_state length 0; UI “No games yet” (`01-…png`) |
| Public Quick Join `rust_canyon` | `join_accepted` + `map_state` not Base (`rc_*`) | OK — regression + Playwright status `map rust_canyon` + themed geometry (`02`/`06`) |
| Bots `glass_dome` | Non-Base geometry (`gd_*`) | OK — regression + Playwright status `map glass_dome` (`07`) |
| ESC change-map → `fuel_depot` | leave→rejoin loads `fuel_depot` (`fd_*`), not Base flash path | OK — regression leave→rejoin; Playwright Confirm → `map fuel_depot` (`09`) |
| Base-geometry regression guard | Assert fails if Base geometry fed for non-Base | OK — negative check trips on `base_*` ids; branch run PASS |
| Related regressions | epic47 / epic46 green | OK — both PASS |

### Config and secrets

- `config.vars.example` / README up to date: yes (no new env vars; README EPIC 48 blurb present)
- No secrets in diff: yes (spot-scan of `master...HEAD`; only docs wording hits on “password”/auth UX)

### Documentation

- README / docs updated: yes — README EPIC 48 status; `docs/tasks/epic-48-*.md` on branch

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — match `mapId`, catalog geometry/pickups/bounds; join-existing ignores client mapId (documented); densify spawn lists shared/server-side

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-48/01-lobby-empty-no-base-trap.png`
  - `qa-artifacts/epic-48/02-public-rust-canyon-spawn.png`
  - `qa-artifacts/epic-48/03-public-rust-movement.png`
  - `qa-artifacts/epic-48/04-public-rust-jump.png`
  - `qa-artifacts/epic-48/05-public-rust-fire.png`
  - `qa-artifacts/epic-48/06-public-rust-wide-pickups.png`
  - `qa-artifacts/epic-48/07-bots-glass-dome.png`
  - `qa-artifacts/epic-48/08-esc-pause-change-map.png`
  - `qa-artifacts/epic-48/09-esc-rejoin-fuel-depot.png`
  - `qa-artifacts/epic-48/summary.json`, `playwright-run.log`, `playwright-console.log`
  - Helper used: `scripts/qa-epic48-tester-playwright.mjs` (Tester-authored for this gate)
- Movement: OK — position delta on W (`summary.gameplay.moved=true`; `03`)
- Jump: OK — Space exercised; screenshot `04`
- Shoot / hit registration: OK — left-click fire smoke captured (`05`); hit registration against bots not required for this map/pickup-scoped epic beyond fire input smoke
- Camera / controls feel: OK — pointer-lock path used; no stuck-look observed on public rust path
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK on rust_canyon (`02`/`06` show arena + spread pickups). Note: `07`/`09` captured immediately after join with “Click to play” overlay (sky/pistol only) — map id confirmed via status bar + WS `map_state` prefixes; not treated as geometry paint failure
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — rust_canyon wide shot shows blocky cover + colored pickups, not unstyled empty Three.js defaults

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified: pickup band 8/8/6/6 (28) with spread/anti-runway + clearance; public/bots/ESC change-map load non-Base maps; `regression:epic48` PASS with Base-geometry negative guard; epic47/epic46 green; typecheck/build OK; Playwright evidence under `qa-artifacts/epic-48/`.
