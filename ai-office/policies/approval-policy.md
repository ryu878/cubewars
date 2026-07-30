# Approval and release policy

Goal: **merge into the main branch**, **release**, and **message to the user** happen only after the agreed verification chain. See also [`branch-and-pr-policy.md`](branch-and-pr-policy.md).

**Terms:** **QA PASS / sign-off** — Tester result against the checklist; **Critic verdict** — `APPROVED` / `REVISE` / `REJECT` against the diff; **Judge verdict** — `ALL_CLOSED` / `REVISE_AGAIN` / `ESCALATE_HUMAN`, only produced after a `REVISE`; **approve merge** — Team Lead's process approval for merge. None of Tester, Critic, or Judge replace Team Lead for merge approval.

## Chain is mandatory

1. **Programmer → Tester:** formal handoff per [`ai-office/templates/programmer-handoff-template.md`](../templates/programmer-handoff-template.md).
2. **Tester:** check per [`ai-office/checklists/qa-checklist.md`](../checklists/qa-checklist.md); outcome — **PASS** or **FAIL** in [`ai-office/templates/tester-report-template.md`](../templates/tester-report-template.md).
3. **Critic:** on PASS, review diff + Tester report per `ai-office/agents/critic/role.mdc`; outcome — `APPROVED` / `REVISE` / `REJECT` in [`ai-office/templates/critic-review-template.md`](../templates/critic-review-template.md).
4. **Judge (only if REVISE):** after Programmer fixes the listed findings and Tester re-verifies, Judge closes findings per `ai-office/agents/judge/role.mdc`; outcome — `ALL_CLOSED` / `REVISE_AGAIN` / `ESCALATE_HUMAN` in [`ai-office/templates/judge-verdict-template.md`](../templates/judge-verdict-template.md).
5. **Team Lead:** code review and **approve** merge/release **only after** `APPROVED` (Critic) or `ALL_CLOSED` (Judge).

## Approve rules

- **Team Lead does not approve** merge without: a documented **PASS** from Tester, **and** a documented **`APPROVED`** from Critic (or **`ALL_CLOSED`** from Judge if the delivery went through a revision).
- On Tester **FAIL** — return to the Programmer via `ai-office/process/process-rework-loop.md`; Tester cycle again → on PASS → Critic.
- On Critic **REVISE** — return to Programmer with finding IDs only; after fix + Tester re-verify → **Judge**, not back to Team Lead directly.
- On Critic **REJECT** — the task itself needs to be redefined; back to Team Lead, not a patch loop.
- On Judge **REVISE_AGAIN** — back to Programmer (iteration count increases); do not let this bypass Judge on the next round.
- On Judge **ESCALATE_HUMAN** — Team Lead brings the decision to the user/human reviewer; **do not** merge around this state.

## Merge to main

- **Merge PR** into `main` (or the target release branch) — **after**:
  - PASS from Tester;
  - `APPROVED` from Critic, or `ALL_CLOSED` from Judge;
  - review and **approve** from Team Lead (and repository requirements: CI, linters — if enabled).

Who physically clicks "Merge" (Team Lead or a trusted maintainer) is a repository agreement; **responsibility for compliance with this policy** is with Team Lead.

## Deploy / release

- **Deploy to an environment** (staging/production) and **release actions** — **after** Team Lead approve for integration (merge into the main line) or after an explicit release step described in the spec.
- Checklist guide: [`ai-office/checklists/release-checklist.md`](../checklists/release-checklist.md); deployment order — [`deployment-policy.md`](deployment-policy.md).
- Do not release "around" approve if the task followed the office process.

## Message to the user

- **Task outcome** (done, what was done, links to PR/release) is reported by **only Team Lead** — per [`ai-office/global/handoff-contracts.mdc`](../global/handoff-contracts.mdc) (single user-facing entry).

## Short scheme

```text
task branch → implementation (Programmer)
    → handoff → QA (Tester) → PASS
    → Critic review → APPROVED
        (or: REVISE → fix → re-verify → Judge → ALL_CLOSED)
    → review + approve (Team Lead)
    → merge → (deploy/release per spec)
    → report to user (Team Lead)
```
