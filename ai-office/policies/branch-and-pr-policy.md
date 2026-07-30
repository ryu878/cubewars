# Branch and pull request policy

Goal: isolate work per **task** in a separate branch; integrate into the main line only through a **transparent PR** and the agreed process (see [`approval-policy.md`](approval-policy.md)).

This project uses a **full PR flow** — every task goes through a Pull Request into `main`, reviewed and gated per the chain below, regardless of team size.

## Branch per task

- Each **Task** from the specification (EPIC → Story → Task) is done in a **separate branch**, branched from the **target base branch** (default `main`; if the project agrees another flow — Team Lead records it in the task).
- Do not mix several unrelated tasks in one branch without an explicit Team Lead decision.

## Branch naming

**Default in this repository** — prefixes by work type:

```text
feature/<short-name>
fix/<short-name>
hotfix/<short-name>
refactor/<short-name>
```

Examples: `feature/match-join-flow`, `fix/movement-desync`, `hotfix/server-crash-on-disconnect`.

**Allowed alternative** — tie to a task id in the spec/tracker:

```text
task/<task-id>-<kebab-case-short-slug>
```

Examples: `task/7-4-match-join-endpoint`, `task/STORY-12-fix-reconnect`.
`<task-id>` is set by **Team Lead** in the spec; the suffix is a short summary (Latin, hyphens).

Principle unchanged: **one task — one branch**; choose the prefix by task meaning or by agreement with Team Lead.

## Constraints for Programmer

- **Do not commit directly** to `main` (and protected release branches), except when Team Lead explicitly described another process for a specific case (rare, e.g. emergency hotfix).
- All implementation is in the task branch; base-branch updates — via **rebase/merge from `main`** per team agreement or Team Lead instructions.

## Pull Request

- A **PR** into `main` is opened (or brought to ready) when work is **ready for process review**: **Programmer → Tester** handoff done, **QA PASS** recorded (Tester sign-off) per [`ai-office/checklists/qa-checklist.md`](../checklists/qa-checklist.md).
- In the PR description: link to task/spec, briefly what was done, how it was verified.
- **Critic** reviews the PR diff directly, once Tester PASS is recorded — see `ai-office/agents/critic/role.mdc`.
- **Merge** into `main` — only after [`approval-policy.md`](approval-policy.md): documented **QA PASS**, **Critic `APPROVED`** (or **Judge `ALL_CLOSED`**), and **merge approval** from Team Lead.

## Branch protection (repository recommendation)

- Enable `main` protection: no direct push, required PR, required approve from Team Lead (or an agreed rule).
- CI/checks — per project policy; Team Lead defines what is required for merge.

## Related documents

- [`approval-policy.md`](approval-policy.md) — who and when approve, merge, release.
- [`ai-office/global/handoff-contracts.mdc`](../global/handoff-contracts.mdc) — role contracts.
- [`ai-office/templates/programmer-handoff-template.md`](../templates/programmer-handoff-template.md) — Programmer handoff.
