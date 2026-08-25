# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 36: Post-Respawn Spawn Protection (tasks 36.1–36.7) |
| Branch / commit / PR | `task/epic-36-spawn-protection` @ `5920377` (`5920377cb434d5edbaff62b03b8cb8745529ebaf`); base `master` @ `6f5b365`; pushed to origin; PR create via `gh` failed (repo resolve) — open from https://github.com/ryu878/cubewars/pull/new/task/epic-36-spawn-protection |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Added `COMBAT.spawnProtectionMs = 2000` and `PlayerState.spawnProtectedUntilMs`; server sets the deadline on initial `spawn()`/`spawnAt()` and on `processRespawns()`.
2. Server filters spawn-protected players out of hitscan, grenade splash, and projectile direct-hit candidates so shots pass through with **no** HitEvent/hit-marker; `applyDamage` returns `null` as a safety net (also gates environmental/fog damage).
3. Client renders protected remote avatars at low opacity from `serverTimeMs < spawnProtectedUntilMs` only (per-avatar cloned materials); recommended local HUD "SPAWN PROTECTED" countdown near HP, same broadcast-driven comparison. Regression script covers protected miss, unprotected hit, post-window damage, splash/env, and respawn re-arm.

## Changed files / areas

- `shared/src/combat.ts` — `COMBAT.spawnProtectionMs`
- `shared/src/index.ts` — `PlayerState.spawnProtectedUntilMs`
- `server/src/combat.ts` — `isSpawnProtected`, hitscan/splash candidate filtering
- `server/src/playerRegistry.ts` — field + set on spawn/respawn; `applyDamage` null no-op; broadcast in `toWorldState`
- `server/src/match.ts` — projectile step skips protected targets
- `client/src/remotePlayers.ts` — per-avatar material clones + opacity toggle
- `client/src/combatHud.ts`, `client/src/main.ts`, `client/index.html` — SPAWN PROTECTED HUD cue
- `scripts/regression-spawn-protection.ts`, `package.json` — new regression
- Existing combat regressions (`locational-splash-damage`, `grenade-projectile`, `bot-aim-miss-rate`) clear protection so they still exercise unprotected combat math

## How to verify (steps for Trusya)

1. `npm run typecheck` and `npm run build` — expect PASS.
2. `npm run regression:spawn-protection` — expect `[spawn-protection] PASS` (protected no hit/damage; unprotected still hittable; damage at deadline; splash/env; respawn re-arms).
3. Spot-check combat regressions: `npm run regression:locational-splash-damage`, `regression:grenade-projectile`.
4. Live two-client (or bots mode): kill/respawn into line of fire — confirmed zero damage / no hit marker for ~2s; remote avatar looks transparent; local HUD shows SPAWN PROTECTED countdown; after window, normal damage and full opacity. Spot-check at least two of public / bots / endless.
5. Optional screenshot evidence under `qa-artifacts/epic-36/` (git-ignored).

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (or project docker/compose if used locally)
- Expected smoke result: join any mode → brief SPAWN PROTECTED HUD; other players see you translucent; shots pass through until window ends

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout — existing `[server] […] hit:` lines must **not** appear against a protected target during the window
- Key success messages: regression script prints `[spawn-protection] PASS`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: protection deadline (`spawnProtectedUntilMs`), candidate filtering, damage application / kill resolution
- What the client is allowed to predict/render only: avatar opacity and local HUD cue from broadcast `spawnProtectedUntilMs` vs `world_state.serverTimeMs` — no client-owned free-running protection timer, no client authority over immunity

## Risks / known limitations

- Hitscan hot path now skips protected candidates — covered by explicit "unprotected still hittable" regression case
- Per-avatar material clones in `remotePlayers.ts` (needed for independent opacity); overlaps EPIC 33 material work if that lands later — rebase should be low-risk (color vs opacity)
- `PlayerState` construction lives in `toWorldState()` (not `match.ts`); match only gained projectile filtering
- Live two-client transparency screenshots left for Tester (programmer covered with server-side regression)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
