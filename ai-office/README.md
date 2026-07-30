# AI Office — rules and process

This folder holds the **unified structure** for agent work in this repository (cubewars — browser online game).

Adapted from a sibling project's `ai-office/` layout, with the **quant research roles removed** (not relevant here) and **Critic + Judge folded into the delivery chain** instead: they now review the **Programmer/Tester** output, not research packages.

## How files are organized

| Type | Purpose |
|------|---------|
| **`.mdc`** | Hard agent instructions (role, prohibitions, mandatory actions). Also the canonical source that `.claude/agents/*.md` subagents are built from. |
| **`.md`** | Process description, templates, reference, examples (not binding "law" for the agent). |

## Two ways these rules are consumed

1. **As documentation / shared law** — every role file (`agents/*/role.mdc`) is the canonical, single-source-of-truth definition of that role.
2. **As real Claude Code subagents** — `.claude/agents/*.md` in the repository root wraps each role into an invocable subagent (via the `Agent` tool). Each subagent is a **thin wrapper**: its first instruction is to read its canonical `ai-office/agents/<role>/role.mdc` (plus the relevant `global/`, `process/`, and `templates/` files) before doing anything else. There is only **one copy** of the actual rules — edit `ai-office/`, and every subagent picks up the change on its next invocation.

## Navigation

- **Task intake:** [`ai-office/task-intake.md`](task-intake.md) (specification template).
- **Global agent rules:** [`ai-office/global/`](global/) — standards, handoff contracts, security.
- **Roles:** [`ai-office/agents/`](agents/) — Team Lead, Programmer, Tester, Critic, Judge, Infosec.
- **Process:** [`ai-office/process/`](process/) — main chain, rework loop, review/judge cycle.
- **Templates:** [`ai-office/templates/`](templates/) — task, handoff, reports, critic review, judge verdict.
- **Checklists:** [`ai-office/checklists/`](checklists/) — QA, review, release.
- **Policies:** [`ai-office/policies/`](policies/) — branches/PR, approval, deployment.

## Routing principle

**All implementation work intake goes only through Team Lead (Tusya).**
Exceptions are fixed in `ai-office/global/handoff-contracts.mdc` and in the agent roles.

**User-facing:** **Team Lead** — primary entry for implementation, merge/release, and final outcomes. **Programmer, Tester, Critic, Judge** — internal roles. **Infosec (Isya)** — dual entry, see **§6** in `ai-office/global/handoff-contracts.mdc`.

## The chain, in one line

```text
User → Team Lead → Programmer → Tester → Critic → (revise loop → Judge) → Team Lead → User
```

Critic reviews every Tester-passed delivery before Team Lead's final approval. Judge only enters after a `REVISE` verdict, to close findings and — critically — to **stop endless rework** by escalating to human review after 3–5 iterations. Full detail: [`process/review-judge-cycle.md`](process/review-judge-cycle.md).
