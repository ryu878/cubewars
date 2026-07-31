# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 2 — Player Movement & Multiplayer Sync (`docs/tasks/epic-02-movement-and-sync.md`)
- Diff / PR reference: `git diff 794bed4..feature/movement-and-sync` (implementation `2e56620`, Tester report `d895df0`)
- Tester PASS report reference: `docs/tasks/epic-02-tester-report.md`
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status |
|------|--------|
| Diff/PR present and reviewable | PASS |
| Tester PASS report matches this commit | PASS |
| Every acceptance criterion traceable to a change or explicit note | PASS |
| Scope matches the task (no unexplained extra changes) | PASS |
| Gameplay evidence present (player-facing tasks only) | PASS |

- Gate overall: **PASS** → full checklist ran

## Verdict

- **`REVISE`**
- Rationale: solid, server-authoritative implementation with real gameplay evidence, but the flood-guard debounce in `server/src/index.ts` silently drops rate-exceeding input with zero log line — unlike every other reject path in the same handler — a direct gap against `security-baseline.mdc`'s "log anomalous input patterns" for exactly the abuse case (flooding) this EPIC's own risk section calls security-relevant.

## Checklist

| # | Item | Status | Severity |
|---|------|--------|----------|
| 1 | Correctness vs acceptance criteria | PASS | — |
| 2 | Server authority for gameplay-relevant state | PASS | — |
| 3 | Stack compliance | PASS | — |
| 4 | Security baseline | **FAIL (partial)** | major |
| 5 | Error handling | PASS | — |
| 6 | Logging / observability | **FAIL (partial)** | major |
| 7 | Test/QA coverage adequacy | PASS | — |
| 8 | Readability / maintainability | PASS | — |
| 9 | Scope discipline | PASS | — |
| 10 | Config / docs updated | PASS | — |
| 11 | No dead code | PASS | — |
| 12 | Regression risk | PASS | — |
| 13 | Core mechanics work (movement/jump, per evidence) | PASS | note |
| 14 | Visual direction | PASS | — |
| 15 | Controls & feel | PASS | — |
| 16 | Playability sanity | PASS | note |

## Findings

### F-001

- Severity: **major**
- Issue: `server/src/index.ts` logs every rejected WS input except one — the flood-guard debounce (`MIN_INPUT_INTERVAL_MS` path) drops silently, with zero log trace, while binary/oversized/malformed-JSON/unknown-type/out-of-range are all logged. Tester's own flood test (479 msgs/1.2s at a 2ms interval) means the overwhelming majority of that flood left no trace. `security-baseline.mdc` pairs rate-limiting with logging anomalous input as one requirement.
- Required fix: add aggregate/rate-limited logging for the debounce path (e.g. a per-connection drop counter, one summary log line on first hit + periodically thereafter — not one line per dropped message, that would be its own log-spam problem).
- Suggested check to prove closed: re-run the flood scenario, confirm at least one log line appears; confirm normal ~30Hz play produces no extra log spam.

## Revision task

- Finding IDs to fix: **F-001 only**
- Out of scope: physics/clamping, client controller, protocol types, README — do not touch; do not change `MIN_INPUT_INTERVAL_MS` itself
- Re-verify required: yes — Tester re-runs the flood scenario + light regression (typecheck/build, single-client smoke)

## Notes (non-blocking)

- `MAX_MESSAGE_BYTES` compares against `raw.length` (UTF-16 code units) not true byte size — fine for current ASCII-only payloads, worth remembering if non-ASCII text (chat/names) is ever added.
- `fpsController.ts` reads keyboard state twice per frame cycle — harmless duplication, worth collapsing if the file grows.
- Jump screenshot evidence is visually weak (capture landed post-arc); Tester's Y-sampling substitutes adequately.
- Spawn position distribution is center-biased (cosmetic only, not blocking).
