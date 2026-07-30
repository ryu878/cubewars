# Deployment policy (deploy / release execution)

Goal: fix the **order of actions** after merge into the main line and align it with the approval policy.

## Required links

- Approvals and merge: [`approval-policy.md`](approval-policy.md) — PASS from Tester, `APPROVED`/`ALL_CLOSED` from Critic/Judge, approve from Team Lead, then merge.
- Branches and PR: [`branch-and-pr-policy.md`](branch-and-pr-policy.md).
- Role contracts and user-facing: [`ai-office/global/handoff-contracts.mdc`](../global/handoff-contracts.mdc).

## Deployment

- **Deploy / release** to the target environment runs **after** Team Lead approve for integration (or per an explicit release step from the task spec).
- Checklist guide: [`ai-office/checklists/release-checklist.md`](../checklists/release-checklist.md).
- **Outcome to the user** (what was deployed, links) — **only Team Lead**, not Programmer/Tester/Critic/Judge.

## Short scheme

```text
merge to main (per approval-policy)
    → deploy/release per spec and release-checklist
    → report to user (Team Lead)
```
