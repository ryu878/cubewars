# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 36 — Post-Respawn Spawn Protection (Transparency + Invincibility); AC §6; tasks 36.1–36.7 |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-36-programmer-handoff.md` (pinned tip `5cdc112` / impl `5920377`); QA on branch tip `922ed8c` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node via nvm v24.18.1 / npm 11.16.0; Redis `PONG` on `:6379`; Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-36-spawn-protection` @ `922ed8c65761059aa9b748071433b48662d47b60`
- Live stack for smoke: `CUBEWARS_SERVER_PORT` default → `ws://localhost:7777`; client Vite `http://127.0.0.1:5196/`
- Evidence script: `scripts/qa-epic36-tester-playwright.mjs`

## Check results

Checklist sections applied: **Universal**, **Build and run**, **Backend / game server**, **Client**, **Real-time / multiplayer** (server authority / no client-owned protection timer), **Gameplay & feel**. Docs: task handoff present; README not required by AC §6 (no new env / run steps).

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client `tsc --noEmit` clean; server `tsc` + client Vite production build OK

### Run

- Command: `npm run regression:spawn-protection`; spot `regression:locational-splash-damage`, `regression:grenade-projectile`, `regression:bot-aim-miss-rate`; live `PORT`/`CUBEWARS` server + Vite client + Playwright smoke
- Result: OK — `[spawn-protection] PASS`; combat spot regressions PASS; live join bots/public/endless with SPAWN PROTECTED HUD; 0 console errors on exercised paths

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| AC: typecheck/build | PASS | **PASS** |
| Fresh spawn / respawn immunity (hitscan, splash, grenade direct, env) | Zero damage / no hit while protected; unprotected still hittable; damage at deadline (`strict <`); respawn re-arms | **PASS** — `npm run regression:spawn-protection` → `[spawn-protection] PASS` |
| No hit event against protected | Shots pass through (no HitEvent / hit-marker path) | **PASS** — regression asserts `outcome.hit === false` + empty damage events; splash/projectile direct skip protected ids |
| Protection ends at deadline | Shot at `now == spawnProtectedUntilMs` deals normal damage | **PASS** — regression case “protection ends at the deadline instant” |
| Client opacity (other players) | Protected remote avatar ~0.35; restores to 1.0 from broadcast `serverTimeMs` only | **PASS** — selfcheck materials `0.35` / `1` then both `1` after advancing `serverTimeMs` (`01`/`02` screenshots) |
| Live modes ≥2 | SPAWN PROTECTED HUD on join; clears after ~2s | **PASS** — bots + public two-client + endless (`03`/`07`/`13`); HUD gone after window (`06`/`12`) |
| Combat / respawn timing regression | `respawnDelayMs` still 3000; unprotected damage math unchanged | **PASS** — `COMBAT.respawnDelayMs: 3000` unchanged; pistol body damage assert in spawn-protection script; locational-splash / grenade-projectile / bot-aim-miss-rate PASS (those scripts clear protection) |
| Live bots after window | Damage can apply again | **PASS** — `06-bots-after-protection-window.png` shows HP 55 (took bot fire after HUD cleared) |

### Config and secrets

- `config.vars.example` / README up to date: N/A new env vars (none); README unchanged (no setup change)
- No secrets in diff: yes (feature diff vs `master`: shared/server/client/scripts/docs/package.json only)

### Documentation

- README / docs updated: task specs/handoff yes; README not updated — acceptable for AC §6 (behavior covered by HUD + regressions; no run/config change)

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — `spawnProtectedUntilMs` set on `spawn`/`spawnAt`/`processRespawns`; candidate filtering + `applyDamage` null no-op server-side; client only compares broadcast deadline vs `world_state.serverTimeMs` for opacity/HUD (no free-running local protection timer)

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-36/`
  - `01-selfcheck-protected-vs-open.png` — protected opacity 0.35 vs open 1.0 (real `remotePlayers.ts`)
  - `02-selfcheck-opacity-restored.png` — both opacity 1.0 after serverTime advances past deadline
  - `03-bots-spawn-protected-hud-and-ghosts.png` — live bots join; `SPAWN PROTECTED` HUD (~1.x s)
  - `04`/`05` — jump + fire smoke in bots
  - `06-bots-after-protection-window.png` — HUD gone; HP reduced (post-window damage)
  - `07`/`08`/`12` — public two-client HUD on join B / observer A / B after window
  - `09`/`10`/`11` — public movement / jump / fire
  - `13`/`14` — endless SPAWN PROTECTED + movement
  - `smoke-summary.json`, `server.log` / `client.log`, runner `scripts/qa-epic36-tester-playwright.mjs`
- Movement: OK — WASD in bots, public, endless
- Jump: OK — mid-air capture in bots + public
- Shoot / hit registration: OK — fire smoke live; server-side hit/no-hit covered by regressions; post-window damage observed in bots (HP 100→55)
- Camera / controls feel: OK — pointer lock + canvas usable in smoke
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — arena, viewmodel, HUD, remote avatars render
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky avatars/arena in selfcheck + live shots

### Notes (non-blocking)

- Live public two-client screenshots emphasize HUD + co-presence; clearest remote **opacity** A/B proof is the deterministic RemotePlayers selfcheck (same client module used in-match). Live bots match exercises broadcast-driven protection in a real session.
- Programmer handoff tip SHA lagged docs commits; QA verified branch tip `922ed8c` (includes handoff pin commits atop `5920377`).

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: AC §6 typecheck/build; server regression for immunity / no-hit / deadline / splash-env / respawn re-arm / unprotected still hittable; client opacity 0.35→1.0 from broadcast clock; SPAWN PROTECTED HUD in bots + public + endless with clear-after-window; move/jump/shoot smoke; combat spot regressions; server-authoritative protection.
