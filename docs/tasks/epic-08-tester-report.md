# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Task / Story / EPIC | EPIC 8 — Movement Tuning: Speed Increase & Bunny Hop (`docs/tasks/epic-08-movement-tuning.md`) |
| Handoff from Pusya (link/commit) | `feature/movement-tuning` @ `c865633` |
| Status | **PASS** |

## Check results

### Build/typecheck

Both clean.

### Smoke / scenarios (raw WS + real Playwright client)

| Step | Actual |
|------|--------|
| Base speed | Exactly 6.65 m/s, single shared `MOVEMENT.maxSpeed` constant, confirmed via raw WS math and real WASD hold |
| Normal single jump | Apex 0.855 exactly, unchanged from EPIC 2/3 baseline |
| Bunny hop boost | Apex 1.155-1.635 depending on trigger timing (hand-derived physics confirms this range is expected, not noise); boosted horizontal speed up to 8.82 m/s (expected 8.645) |
| Spam mid-air (2 independent patterns: 25-edge toggle, 2ms extreme flood) | Only one boost applied both times, no compounding |
| Held key (not a genuine second edge) | No boost — apex stayed exactly 0.855, confirms edge-detection not level-sampling |
| Boost reset on landing | Available again after landing, confirmed 2 sequential boosted jumps |
| Forged/malformed jump field (number/string/null/array/object) | All dropped, logged, no crash |
| Diagonal/corner collision at boosted speed (F-NB-1 regression, Programmer explicitly untested) | Independently reproduced — worst single-tick overshoot *decreases* both absolute and percentage as speed rises baseline→new→boosted (104%→66%→42%), self-limiting at all three speeds |

### Server authority

Confirmed: boost magnitude not client-specifiable (raw client only sends boolean jump); edge-detection against server's own stored intent; bunnyHopAvailable/pendingBunnyHopTrigger server-only fields.

### Design deviation judgment (Tester's own view, not deferred to Critic)

"Zero displacement with no input held during boost window" deviation from literal spec wording is reasonable given this game's intent-driven movement model — real bunny-hop play requires holding forward anyway. Critic/TL should decide if spec wording itself needs updating.

### Gameplay & feel

7 screenshots in `qa-artifacts/epic-08/`. Objective pixel-measurement (not eyeballing) confirms monotonic camera-height increase across grounded→normal-jump→boosted-jump. Regression: shoot/hit/kill-feed/scoreboard/health-armor HUD all unaffected.

## Non-blocking finding

README not updated for EPIC 8 (Controls/Current-status) — same pattern as EPIC 7's flagged-but-non-blocking gap. Not gating PASS.

## Outcome

**PASS** — ready for Critic review.
