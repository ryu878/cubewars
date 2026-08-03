# Judge verdict (Jasya) → Team Lead — EPIC 8, F-001, iteration 1

## Per-finding decision

| Finding | Status | Evidence |
|---|---|---|
| F-001 | **CLOSED** | Committed, independently-reproduced regression script (Judge re-ran it directly against `9c6ab8c`, matching output). Genuine root-cause fix (square-corner-approximation bug), not a defer — cuts overshoot ~4.6-10x at baseline/new-base speeds. Residual boosted-speed number (0.267m→0.2564m, ~4% reduction) did not get worse, and Tester's dedicated exploit investigation (second independent geometry spot, 200-tick oscillation test, multi-hundred-tick realistic approach) shows it's single-tick, non-repeating, non-compounding — same category already accepted for EPIC 3's F-NB-1 under "self-limiting in aggregate." |

Residual risk: boosted-bunny-hop worst-case single-tick overshoot at genuine sharp outer-arena corners remains ~0.26m, requiring swept/continuous collision to fully eliminate (out of scope, documented in-code). Carried to `docs/backlog.md`.

## Overall

- **ALL_CLOSED**
- Iteration: 1

F-001 closed. F-002 (spec wording) already resolved separately, no code change, not part of this packet.
