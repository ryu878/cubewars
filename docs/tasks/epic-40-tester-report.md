# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 40 — Companion Pet Distance & Scale Polish |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-40-programmer-handoff.md`; impl `101183b`; QA on branch tip `a5f35950d673616e7ba6fa5988c8d73138b571ac` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node via nvm v24.18.1 / npm 11.16.0; Redis `PONG` on `:6379`; Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-40-companion-pet-distance-scale` @ `a5f35950d673616e7ba6fa5988c8d73138b571ac` (tracks `origin/task/epic-40-companion-pet-distance-scale`)
- Live stack for smoke: dedicated `CUBEWARS_SERVER_PORT=7790` + Vite client `http://127.0.0.1:5211/` (`VITE_CUBEWARS_WS_URL=ws://127.0.0.1:7790`); selfcheck Vite `:5192`
- Evidence script: `scripts/qa-epic40-tester-playwright.mjs` → `qa-artifacts/epic-40/` (script left untracked for TL/Critic; not part of product delivery)

## Checklist sections applied

- Universal (AC, secrets, docs)
- Build and run
- Client (companion anchors + root scale + cyan glow; amulet pendant untouched)
- Real-time / multiplayer (light live bots smoke: `equippedPetsVisual` still broadcast; no protocol change)
- Gameplay & feel (selfcheck screenshots for placement/scale/glow/amulet; live move / jump / shoot smoke)
- Server authority N/A for new gameplay state (cosmetic client layout only; no server/shared diff)

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client `tsc --noEmit` clean; server `tsc` + client Vite production build OK

### Run

- Command: `npm run regression:epic39-companion-pets`; `node scripts/qa-epic40-tester-playwright.mjs`
- Result: OK — `[epic39-companion-pets] PASS`; Playwright `[epic40-qa] ALL PASS` (`qa-artifacts/epic-40/playwright-run.log`)

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| AC: pets farther (~arm’s length) | `PET_SIDE_X` ±0.9, `PET_ANCHOR_Z` 0.3 | **PASS** — code + selfcheck scene-graph: `sideX` −0.9 / +0.9, `z` 0.3 (`selfcheck-lineup.json`) |
| AC: ~45° upward | `PET_ANCHOR_Y_OFFSET` 0.9 (≈ \|sideX\|) | **PASS** — `dy = petY − torsoY ≈ 0.901` on all companions; screenshots show head-adjacent float (`01`–`03`) |
| AC: slightly larger | `PET_ROOT_SCALE` 1.35; glow scales with root | **PASS** — companion `scale` 1.35; glow local `r=0.22` → world ≈ 0.297; cyan `0x4ec8ff` opacity 0.28 |
| AC: cyan glow + amulet distinct | glow frames pet; gold pendant unchanged | **PASS** — glow present; amulet `TorusGeometry` gold `0xffd75e` / emissive `0xffb300` at chest `(0, 1.4744, −0.23)`; AMULET_* + pendant position identical to `master` (git show); front shot `02` shows gold ring distinct from pets |
| AC: dual left/right deconflict | opposite sides, never stacked | **PASS** — dual avatar companions at −0.9 and +0.9; epic39 regression still PASS (server side assignment); live bots sample had single-pet bot (RNG), dual proven in selfcheck |
| AC: cosmetic only | no hitscan/collision/server authority change | **PASS** — `git diff master...HEAD` touches only `client/src/remotePlayers.ts` (+ README/docs); empty server/shared diff |
| AC: typecheck / build / epic39 regression | PASS | **PASS** |
| Branch tip matches handoff | tip SHA `a5f3595…` | **PASS** — checked out and verified `HEAD` |

### Config and secrets

- `config.vars.example` / README up to date: N/A new env vars (none); README Current status updated with EPIC 40 bullet
- No secrets in diff: yes (client layout constants + docs only)

### Documentation

- README / docs updated: yes — README Current status + `docs/tasks/epic-40-companion-pet-distance-scale.md` + programmer handoff

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: N/A for new authority — no server/shared changes; `equippedPetsVisual` (type/color/side) remains server-authored; client only retunes mesh offsets/scale/glow

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-40/`
  - `01-selfcheck-lineup-back.png` / `02-…-front.png` — arm’s-length elevated pets + cyan glow; gold amulet on chest (front)
  - `03-selfcheck-dual-pets-close.png` — dual L/R deconflict + scale/glow close-up
  - `04`–`07` — live vs Bots: match, movement, jump, fire
  - `selfcheck-lineup.json`, `smoke-summary.json`, `server.log`, `playwright-run.log`
  - Runner: `scripts/qa-epic40-tester-playwright.mjs`
- Movement: OK — WASD in bots match (`05`)
- Jump: OK — Space mid-air capture (`06`)
- Shoot / hit registration: OK — fire smoke (`07`); server hit logs continue on bot AABB during match (pets not involved)
- Camera / controls feel: OK — pointer lock + canvas usable
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — arena, viewmodel, HUD, companions render in selfcheck
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky avatars + larger readable pet silhouettes with cyan aura; amulet gold tell remains separate

### Notes (non-blocking)

- Primary layout/scale/amulet proof is the deterministic RemotePlayers selfcheck (real `client/src/remotePlayers.ts`). Live bots prove match join + move/jump/shoot regression smoke; companion silhouette readability at distance in FPS is secondary to selfcheck numbers/screenshots.
- Live sample saw Bot 2 with one pet (`lion`/`right`); dual opposite sides covered by selfcheck + `regression:epic39-companion-pets`.
- Programmer handoff listed impl SHA `101183b` and earlier docs tips; QA verified full branch tip `a5f3595` (includes handoff pin commits).

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: companions at `PET_SIDE_X` ±0.9 / `Z` 0.3 / `Y_OFFSET` 0.9 (~45°), `PET_ROOT_SCALE` 1.35 with cyan glow world radius ≈0.297; gold amulet pendant unchanged and distinct; dual L/R deconflict retained; cosmetic client-only (no server/shared); typecheck/build/`regression:epic39-companion-pets` PASS; Playwright evidence under `qa-artifacts/epic-40/`. Tip SHA verified: `a5f35950d673616e7ba6fa5988c8d73138b571ac`.
- Per Team Lead intake for this run: **do not assign Critic** and **do not merge** — returning QA verdict + evidence package to Team Lead for routing.
