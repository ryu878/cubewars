# Tester report (Trusya) — EPIC 9, Bots & Match Modes

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Handoff from Pusya (link/commit) | `feature/bots-and-modes` @ `eb4999e` |
| Status | **PASS** |

## Check results

### Build/typecheck

Both clean.

### Smoke / scenarios (independent, this EPIC's regression claims specifically not taken at face value)

| Step | Actual |
|------|--------|
| Gameplay msgs before join | Dropped+logged, zero world_state ever reaches the connection |
| Duplicate join | Dropped, logged as anomaly, no re-parenting |
| Invalid mode string | Rejected, connection never joins any match |
| Attempt to join another connection's private bots match (forged matchId/target fields) | Always resolves to attacker's own fresh match — server never reads a client-supplied match id |
| Match isolation, public+bots concurrent | Zero cross-contamination — verified via raw WS AND a protocol-level WS-hook logging every world_state frame over 15s of continuous concurrent combat, never once leaked |
| Bots: patrol/engage/fire/die/respawn | All confirmed, pistol-only, correct labels ("Bot 1"/"Bot 2") |
| Bot-vs-bot combat rendering to human bystander | Confirmed via kill feed ("Bot 2 eliminated Bot 1") |
| Late joiner scoreboard | Immediately correct, not zeros |
| Match teardown, 8 repeated connect/disconnect cycles | Clean every time, live-match count returns to 1, no leaks |
| Full EPIC 1-8 regression on public mode | Movement, normal jump, **bunny hop** (Programmer explicitly hadn't re-checked — Tester did, 5/5 realistic-timing triggers), wall/crate collision, all weapon/pickup/health/armor mechanics, kill feed, scoreboard, F-NB-1 regression script — all pass |

### Non-blocking backlog note

Ultra-rapid synthetic press/release/press (faster than one 50ms tick) can occasionally collapse two bunny-hop edge events into one, silently swallowing the boost. Confirmed pre-existing (EPIC 8 latch-timing, `playerRegistry.ts` untouched by EPIC 9 except a new read-only `getPlayer()` accessor). Not a real keyboard double-tap scenario, not a regression from this EPIC.

### Server authority

Confirmed: join protocol only accepts the two literal mode strings, no client-suppliable match id anywhere; bots:<id> derived server-side from server-generated UUID; bot AI computes intent server-side through the same applyInput()/fire() path as humans.

### Gameplay & feel

9 own screenshots in `qa-artifacts/epic-09-tester/` (separate from Programmer's own evidence dir) — mode-select screen, bots match with avatars, engagement/combat, death/respawn, concurrent public-match unaffected (both visually and protocol-level).

## Outcome

**PASS** — ready for Critic review. Highest-risk EPIC to date, received correspondingly deep verification. No blocking issues found.
