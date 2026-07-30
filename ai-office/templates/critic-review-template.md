# Critic review (Krisya) → Team Lead

## Meta

- Task ID:
- Diff / PR reference:
- Tester PASS report reference:
- Iteration (1 if first pass):
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS/FAIL | |
| Tester PASS report matches this commit | PASS/FAIL | |
| Every acceptance criterion traceable to a change or explicit note | PASS/FAIL | |
| Scope matches the task (no unexplained extra changes) | PASS/FAIL | |
| Gameplay evidence present (player-facing tasks only) | PASS/FAIL/N/A | |

- Gate overall: PASS → continue checklist / FAIL → stop with `REVISE` or `REJECT`

## Verdict

- `APPROVED` | `REVISE` | `REJECT`
- One-line rationale (must reference file/line, not "looks fine"):

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS/FAIL/N/A | | |
| 2 | Server authority for gameplay-relevant state | | | |
| 3 | Stack compliance (fixed stack, no substitutions) | | | |
| 4 | Security baseline (secrets, injection, XSS, auth) | | | |
| 5 | Error handling | | | |
| 6 | Logging / observability | | | |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | | | |
| 8 | Readability / maintainability | | | |
| 9 | Scope discipline | | | |
| 10 | Config / docs updated | | | |
| 11 | No dead code / debug scaffolding | | | |
| 12 | Regression risk considered | | | |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS/FAIL/N/A | | |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS/FAIL/N/A | | |
| 15 | Controls & feel usable | PASS/FAIL/N/A | | |
| 16 | Playability sanity (honest fun/usability call) | PASS/FAIL/N/A | | |

## Findings (actionable)

### F-001

- Checklist # / Gate:
- Severity: critical | major | minor | note
- Issue:
- Required fix (file/behavior):
- Suggested check to prove closed:

### F-002

- …

## Revision task (if REVISE)

- Finding IDs to fix:
- Out of scope for this revision:
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

-
