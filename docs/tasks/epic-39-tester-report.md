# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 39 — Visible Companion Pets + Pet Color Customization |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-39-programmer-handoff.md` (feature `c0d3889`); QA on branch tip `55f13f2` (docs pin commits atop feature) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node via nvm v24.18.1 / npm 11.16.0; Redis `PONG` on `:6379`; Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-39-visible-companion-pets` @ `55f13f242c72aa97253722a9ceb21c6955ced6d7` (tracks `origin/task/epic-39-visible-companion-pets`)
- Live stack for smoke: dedicated `CUBEWARS_SERVER_PORT=7789` + Vite client `http://127.0.0.1:5210/` (`VITE_CUBEWARS_WS_URL=ws://127.0.0.1:7789`); selfcheck Vite `:5191`
- Evidence script: `scripts/qa-epic39-tester-playwright.mjs` → `qa-artifacts/epic-39/`

## Checklist sections applied

- Universal (AC, secrets, docs)
- Build and run
- Backend / game server (`economy_set_pet_color` ownership + palette validation; bot random `colorIndex`; server-authoritative `side` + `equippedPetsVisual` broadcast)
- Client (companion meshes + cyan glow + inventory Pet colors)
- Real-time / multiplayer (world_state companion visuals on bots; color persist in Redis sandbox pool)
- Gameplay & feel (move / jump / shoot smoke; recognizable silhouettes; spawn-protection opacity on companions)

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client `tsc --noEmit` clean; server `tsc` + client Vite production build OK

### Run

- Command: `npm run regression:epic39-companion-pets`; `npm run regression:epic31-bot-loadouts`; live Playwright evidence
- Result: OK — `[epic39-companion-pets] PASS`; `[epic31-bot-loadouts] PASS`; Playwright `ALL PASS` (`qa-artifacts/epic-39/playwright-run.log`)

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| AC: typecheck / build | PASS | **PASS** |
| Recognizable companions + cyan glow | dog/cat/bird/lion silhouettes with soft cyan aura | **PASS** — selfcheck scene-graph: distinct geo signatures; glow hex `0x4ec8ff` opacity 0.28; legacy `pet-orb` count 0 (`01`/`02`) |
| Left / right sides (server-agreed) | each pet `left` or `right`; stable until equip id change | **PASS** — selfcheck sideX ±0.48; live bots `equippedPetsVisual.side` left/right; regression covers side stability on same slot id |
| Non-solid (no hit / no block) | pets never in hitscan / movement collision | **PASS** — companions client-cosmetic only; no pet volumes in `server/src/combat.ts` / shared combat AABB (player body only); live fire smoke OK; bot↔player hits still register on avatar AABB |
| Player pet colors + Redis persist | set via inventory swatches; survives restart/rejoin | **PASS** — Sandbox seed + Pet colors UI (8 swatches); `set_pet_color ok`; Redis colorIndex 2→0; rejoin selected `lion color 1` (`09`–`11`) |
| Bot random pet colors | bots broadcast `colorIndex` + sides | **PASS** — live world_state sample + server `[bots] … @cN` loadout lines (`smoke-summary.json`) |
| Spawn-protection opacity on companions | companions fade with owner while protected | **PASS** — companion body opacity 0.35 / glow scaled (~0.098) in selfcheck (`03`); live HUD SPAWN PROTECTED with faded companion in inventory shot (`09`) |
| typecheck / build / regressions | PASS | **PASS** |
| Branch pushed | origin tip matches QA | **PASS** — `origin/task/epic-39-visible-companion-pets` @ `55f13f2` |

### Config and secrets

- `config.vars.example` / README up to date: N/A new env vars (none); README unchanged (no setup change)
- No secrets in diff: yes (shared/server/client/scripts/docs/package.json vs `master`)

### Documentation

- README / docs updated: task spec + programmer handoff yes; README not required (no run/config change)

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — `economy_set_pet_color` ownership + palette index; companion `side` stable until pet slot id change; `colorIndex` + `equippedPetsVisual` broadcast from server; bots assign colors server-side. Client renders meshes/glow/bob only.

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-39/`
  - `01-selfcheck-companions-back.png` / `02-…-front.png` — dog/cat/bird/lion + cyan glow + left/right + palette colors (real `remotePlayers.ts`)
  - `03-selfcheck-companions-spawn-protected.png` — companions + owners at opacity ~0.35
  - `04`–`08` — live vs Bots: companions in world_state, movement / jump / fire / after protection
  - `09`–`11` — inventory Pet colors / after swatch / rejoin persist
  - `smoke-summary.json`, `server.log`, `playwright-run.log`, runner `scripts/qa-epic39-tester-playwright.mjs`
- Movement: OK — WASD in bots match
- Jump: OK — mid-air capture (`06`)
- Shoot / hit registration: OK — fire smoke (`07`); server hit logs continue on player/bot AABB (pets not targets)
- Camera / controls feel: OK — pointer lock + canvas usable
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — arena, viewmodel, HUD, companions render
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky avatars + low-poly pet silhouettes with readable cyan aura

### Notes (non-blocking)

- Clearest type/side/glow/opacity proof is the deterministic RemotePlayers selfcheck; live bots prove broadcast `equippedPetsVisual` + loadout `@cN` colors in a real match.
- Pet color persist verified on Sandbox pool (bots/endless) — matches EPIC 35 scope routing for bots matches.
- Programmer handoff tip SHA lagged docs commits; QA verified branch tip `55f13f2` (includes handoff pin commits atop `c0d3889`).

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: recognizable dog/cat/bird/lion companions with cyan glow and left/right sides; non-solid (no combat pet volumes); player pet color swatches persist in Redis; bots broadcast random pet colors; spawn-protection opacity fades companions with owner; typecheck/build/epic39+epic31 regressions PASS; branch pushed.
