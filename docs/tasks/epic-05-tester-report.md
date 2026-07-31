# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-07-31 |
| Task / Story / EPIC | EPIC 5 — Match Flow Polish (`docs/tasks/epic-05-match-flow.md`) |
| Handoff from Pusya (link/commit) | `feature/match-flow` @ `6115c75` |
| Status | **PASS** |

## Check results

### Build

`npm run typecheck` / `npm run build`: both clean.

### Smoke / scenarios (independently scripted, raw WS + Playwright)

| Step | Actual |
|------|--------|
| Kill feed visible to shooter + victim + uninvolved bystander | PASS — raw-WS and Playwright both confirm, including a client never involved in either fight |
| Kill feed entries expire (~5s) | PASS — DOM child count 0 six seconds after last kill |
| Scoreboard live-updates on kill | PASS — shooter's and bystander's scoreboards both reflect the kill immediately |
| Late joiner sees correct current state (not zeros) | PASS — first `ScoreboardMessage` a fresh client receives already shows prior kills correctly |
| Join/leave reflected in scoreboard | PASS |
| Server authority: forged `kill`/`scoreboard` client messages | PASS — no effect; no client-originated `kill`/`scoreboard` message type exists in `ClientMessage` at all — structurally impossible, same posture as EPIC 4's `FireEvent` |
| Spawn anti-clustering, 6 simultaneous connections | PASS — min pairwise distance 15.76 units (threshold 12), spread across both sites |
| Respawn spread, 3 consecutive respawns with 2 other alive players | PASS — all >3 units clear of shooter |
| 7th alive player when all 6 spawn points occupied | Non-blocking edge case — min distance drops to ~1.7 units. Outside spec's explicit scope (AC only requires no-stacking "with 2+ players" against the stated 4-6 point pool, not graceful degradation beyond spawn-point count). Flagged for awareness, not a rework trigger. |
| Core death→respawn flow (EPIC 4 regression) | PASS — real hitscan kills, correct health decrements, automatic respawn, full HP restore |
| Movement/jump | PASS — server-confirmed exact-distance movement |
| Click-to-fire | PASS — real fire messages reach server, muzzle flash renders |
| Console errors | 0 across the full session |

### Testing-tool caveat (transparency note, not a regression)

Mouse-look (yaw) could not be conclusively re-exercised this round: Playwright's synthetic `mouse.move()` produced zero `movementX` under pointer lock in this sandboxed environment. `client/src/fpsController.ts` is unchanged by EPIC 5's diff, so this is a pre-existing testing-tool limitation (already documented in EPIC 2/4 QA), not a new regression risk from this work.

### Config, secrets, docs

All clean/up to date. No secrets in diff.

### Server authority

Confirmed structurally and empirically — kill count incremented in exactly one place (`fire()`, same spot as death resolution), scoreboard entirely server-sorted/broadcast, spawn selection entirely server-side using tracked alive-player positions.

### Gameplay & feel

Screenshots: `qa-artifacts/epic-05/01-pageA-spawn.png` … `11-pageA-killfeed-expired.png`. HUD/crosshair/health/kill-feed/scoreboard all render cleanly, readable, consistent with established visual language. No visual bugs.

## Outcome

**PASS** — ready for Critic review. One non-blocking edge case (7th player spawn crowding) and one testing-tool transparency note flagged, neither blocking.

New reusable QA tooling added: `scripts/qa-epic05-e2e.mjs`, `scripts/qa-epic05-playwright.mjs`.
