# Rework mode (QA rework loop)

When the Tester **does not** sign off the build (plain **FAIL** — bug, unmet acceptance criteria), the chain returns to the developer directly. This is the lightweight loop for ordinary bugs — it does **not** involve Critic or Judge.

## Trigger

- Any item in `ai-office/checklists/qa-checklist.md` is not met.
- Acceptance Criteria from the specification are not met.

## Steps

1. **Trusya** records the result in `ai-office/templates/tester-report-template.md` (status: **FAIL**): steps, expected, actual, logs/screenshots.
2. **Pusya** fixes the issues within the same Task/Story (or escalates ambiguity to **Tusya**).
3. **Pusya** hands work to **Trusya** again via `ai-office/templates/programmer-handoff-template.md` (state the new commit/changes).
4. **Trusya** repeats the full QA run (or a subset agreed with Tusya for a minor fix — full by default).
5. Only after **PASS** — handoff to **Krisya** (Critic) for review, per `ai-office/process/review-judge-cycle.md`.

## Forbidden

- "Quietly" delivering fixes to the user without Trusya/Krisya/Tusya in the standard mode.
- Mixing different Tasks in one handoff without an explicit note in the template.

## Relation to the Critic/Judge cycle

This loop only covers **Programmer ↔ Tester**, before Critic has looked at the delivery. Once Critic has reviewed and returned `REVISE`, the fix-and-recheck loop is governed by `ai-office/process/review-judge-cycle.md` instead (bounded iterations, closed out by Judge) — do not silently fall back to this looser loop once Critic is in the picture.
