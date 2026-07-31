# Tester report (Trusya) — EPIC 4, round 2 (scoped re-verify)

## Meta

| Field | Value |
|---|---|
| Date | 2026-07-31 |
| Task / EPIC | EPIC 4 — Shooting & Combat |
| Handoff from Pusya | `feature/shooting-combat` @ `28a2949` (fix for F-001, round 1) |
| Status | **PASS** |

## Scope confirmation

`git show --stat 28a2949`: only `server/src/index.ts` changed (+48/-10). No changes to combat/collision/client — confirms fix is isolated to message-dispatch/flood-guard code.

## F-001 re-verify — independent reproduction

- 1s fire-only flood: 194,930 messages sent, only 4 log lines total (vs round 1's 169,459 per-message lines).
- 6s flood: 1,180,691 messages sent, only 6 log lines (aggregated counts: 982,769 flood-guard drops, 319 cooldown drops).
- Instrumented ground truth (temporary counters, reverted after, confirmed clean): only 67 of 194,930 messages passed the 15ms debounce; only 4 actual `registry.fire()` calls occurred — matches the 300ms weapon cooldown, not raw message count. Consistent with Programmer's own numbers at a different flood intensity.
- Normal ~30Hz input session (90 msgs/3s): zero flood-guard lines — no regression in quiet-under-normal-play.

**F-001 fixed.**

## Light regression pass

- Clear-LOS hit (mid-lane): exact 25 damage.
- Wall-blocked shot (through tunnel wall): 0 damage, no hit event.
- Fire-rate-vs-DPS: 50 msgs @ 20ms → only 3 hits landed (75→50→25→0 on a 75HP target), spaced ~300ms, one aggregated log line not 50.
- Death/respawn: killed exactly on the 0-HP hit, dead player frozen (0.000 position delta on move/fire attempts), respawned to full HP within ~3s.

All 5 checks passed first try.

## Live smoke check

Two-client Playwright smoke test — confirmed HUD, arena, crates, remote avatar all render correctly (after ruling out an initial test-tooling artifact in the QA script itself, not a product bug — documented headless pointer-lock quirk plus an oversized synthetic mouse delta in the first script attempt). Round-1's 10-screenshot suite remains valid since client code is untouched by this fix.

## Build/typecheck

Both clean.

## Outcome

**PASS.** F-001 genuinely fixed (independently measured), light regression holds, scope confirmed narrow. Ready for Critic.
