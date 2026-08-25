# Tester report (Trusya) — EPIC 39 re-verify F-001 / F-002

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 39 — Visible Companion Pets + Pet Color Customization |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-39-programmer-handoff.md` (revision); tip `c16014fc94218c4ca4d9c5b4a1dbae7a6cb33f81` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | **yes** — finding IDs re-checked: **F-001**, **F-002** |

## Environment

- OS / Docker: Linux 5.15; Node via nvm v24.18.1 / npm 11.16.0; Redis `PONG` on `:6379`; Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-39-visible-companion-pets` @ `c16014fc94218c4ca4d9c5b4a1dbae7a6cb33f81` (matches `origin/task/epic-39-visible-companion-pets`)
- Critic review under re-verify: `docs/tasks/epic-39-critic-review.md` (REVISE; F-001 major, F-002 minor)
- Evidence: `scripts/qa-epic39-reverify-f001-f002.mjs` → `qa-artifacts/epic-39-f001-f002/`

## Scope of this re-verify

Scoped to Critic findings **F-001** / **F-002** plus a light regression pass (typecheck, epic39 regression, live bots join + move/jump smoke). Full EPIC 39 AC was already PASS on prior tip `55f13f2` (`docs/tasks/epic-39-tester-report.md`); not re-run end-to-end.

## Checklist sections applied

- Universal (secrets; docs for this re-verify report)
- Build and run (typecheck; regression)
- Backend / game server (F-001 side deconflict in `setEquipmentVisual`; regression dual-side asserts)
- Client (F-001 dual mesh placement; F-002 `disposeCompanionSubtree` on rebuild)
- Real-time / multiplayer (live archetype-D bot `equippedPetsVisual` left≠right)
- Gameplay & feel (selfcheck dual-equip screenshots; live move/jump smoke)

## Check results

### Build

- Command: `npm run typecheck`
- Result: OK — shared/server/client `tsc --noEmit` clean

### Run

- Command: `npm run regression:epic39-companion-pets`; `node scripts/qa-epic39-reverify-f001-f002.mjs`
- Result: OK — `[epic39-companion-pets] PASS` (40 dual-equip trials + bot dual-equip opposite sides); Playwright `RESULT: ALL PASS`

### Finding closure

| ID | Severity | Expected | Actual | Closed? |
|----|----------|----------|--------|---------|
| **F-001** | major | Dual-equip never shares `side`; client `|sideX|≈0.48` on opposite signs | Server deconflict in `playerRegistry.ts` (`slot2` flips when colliding). Regression asserts opposite sides across 40 trials + bots. Selfcheck: dog@`sideX=-0.48` + bird@`+0.48`; flipped loadout also opposite. Live Bot 1: `sides:["left","right"]` bird+dog | **yes** |
| **F-002** | minor | On companion body replace, dispose geometry/materials before leak | `disposeCompanionSubtree` in `remotePlayers.ts` traverses meshes and disposes geometry + materials after `remove`. Rebuild churn ×16 completed with no selfcheck console errors; scene still shows two opposite companions | **yes** (code path + churn smoke; Critic noted long-session GPU optional) |

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| F-001 regression | Dual visuals never share `side` | **PASS** — 40 trials + bot dual-equip asserts |
| F-001 selfcheck dual mesh | One avatar, two companions, opposite anchors | **PASS** — `01`/`02` dog left + bird right; `03` cat/lion flipped opposite |
| F-002 dispose path | Rebuild does not leave broken scene / console errors | **PASS** — `04` after 16 rebuilds still two opposite companions; dispose helper present in diff |
| Live dual-equip broadcast | Archetype D bot visuals left≠right | **PASS** — WS tap: Bot 1 `["left","right"]` bird+dog; server loadout `archetype=D pets=[bird#136@c3,dog#33@c2]` |
| Light move / jump | Match join + WASD / Space usable | **PASS** — `05`/`06` live bots HUD + canvas (close-range pet silhouette weak; F-001 proven via selfcheck + WS) |

### Config and secrets

- `config.vars.example` / README up to date: N/A (no new env / setup change in revision)
- No secrets in revision diff: yes (`c16014f` touches server/client/scripts/docs handoff only)

### Documentation

- Re-verify report: this file
- Programmer handoff updated for F-001/F-002: yes

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: **yes** — dual-equip `side` deconflict is server-side in `PlayerRegistry.setEquipmentVisual`; client only places meshes at `PET_SIDE_X[side]`

### Gameplay & feel

- Screenshot/evidence path(s): `qa-artifacts/epic-39-f001-f002/`
  - `01-dual-dog-left-bird-right-back.png` / `02-…-front.png` — two companions clearly on opposite shoulders
  - `03-dual-cat-right-lion-left-back.png` — flipped dual sides still opposite
  - `04-after-dispose-churn-rebuild.png` — post F-002 rebuild churn still readable dual companions
  - `05-live-bots-move-smoke.png` / `06-live-bots-jump-smoke.png` — live match smoke
  - `smoke-summary.json`, `server.log`, `playwright-run.log`
- Movement: OK — live WASD smoke
- Jump: OK — Space capture
- Shoot / hit registration: N/A for this re-verify (unchanged; prior PASS + live hit logs still present in server output during join)
- Camera / controls feel: OK — pointer lock + canvas
- Visual sanity: OK — dual companions + cyan glow, no stacking
- Matches intended "Roblox-like" look: yes — low-poly dual companions readable on opposite sides

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** Critic findings **F-001** and **F-002** verified closed on `c16014f`. Ready for **Judge** (`ai-office/agents/judge/role.mdc`) — not Critic again per `ai-office/process/review-judge-cycle.md`.

Briefly verified:

1. **F-001:** Dual-equip sides forced opposite (server + regression + selfcheck `|sideX|≈±0.48` + live Bot 1 `left`/`right`).
2. **F-002:** `disposeCompanionSubtree` on companion body replace; rebuild churn remains stable.
3. Light regression: typecheck + epic39 regression + live bots move/jump smoke.
