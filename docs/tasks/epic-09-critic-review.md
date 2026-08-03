# Critic review (Krisya) → Team Lead — EPIC 9, Bots & Match Modes

## Meta

- Diff: `git diff ff9154c..2dc458b` (+1413/-335)
- Tester PASS: `docs/tasks/epic-09-tester-report.md`

## Independent verification performed (beyond reading the diff)

1. Line-by-line regression diff: pulled the pre-EPIC-9 tick-loop body and compared against `Match.tick()`/`resolveFire()` — byte-for-byte identical sequencing, only addition is a bot-skip no-op that short-circuits to nothing in `public` matches.
2. Confirmed `playerRegistry.ts`'s entire diff against `main` is the one new `getPlayer()` read-only accessor — bunny-hop latch logic genuinely untouched.
3. Built and ran the real stack independently; re-ran Tester's own committed Playwright script against a fresh instance, reproduced PASS.
4. Wrote and ran an independent adversarial raw-WS script (not reusing Programmer/Tester code): forged matchId/targetMatch/id fields, mode-field matchId-smuggling attempt, duplicate join, gameplay-before-join — all correctly rejected. Independently confirmed clean match teardown in own server log.

## Verdict

**APPROVED** — tick loop verified verbatim re-homing (not a silent rewrite), match isolation holds under own adversarial probing, teardown clean and leak-free, bot AI goes through the same authoritative path as a human with no unfair shortcut.

## Checklist

15/16 PASS, 1 minor FAIL (README gap, non-blocking, same pattern as EPICs 7/8).

## Findings

### F-001 (minor, non-blocking)

README not updated for EPIC 9 (mode-select screen, join flow, bots mode). Fixed by Team Lead directly (small doc addition), not routed through the revision loop.

## Notes (non-blocking)

- Bot aim turn-rate (180° in ~0.5s) is snappy but not an aimbot — still rate-limited, wall-occluded, deterministic hitscan. Tuning observation only.
- `SIGINT` handler no longer explicitly clears each match's tick interval before `process.exit(0)` — functionally moot (process death kills all timers) but a future graceful-shutdown refactor should route through MatchManager.
- Bot labels ("Bot 1"/"Bot 2") are per-match, not globally unique — by design, no state collision, purely cosmetic reuse across different matches.
