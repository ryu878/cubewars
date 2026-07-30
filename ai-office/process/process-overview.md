# Process: main chain

The **unified canon**: the user enters through **Team Lead** for all implementation work. **Infosec (Isya)** — **dual entry** (via Team Lead or direct agent invoke); details — `ai-office/global/handoff-contracts.mdc` §7.

## Canon (general)

```text
User → Team Lead → internal roles → Team Lead → User
```

- **Team Lead** — primary contact: specification, merge/release, packaging of formal security findings.
- **Internal roles** — execution (code, QA, review, security review); **merge/release** — with Team Lead; **Isya** may respond to the user on **direct invoke** (see contracts).

## Implementation (delivery): code, config, repository artifacts

**Chain:**

```text
User → Team Lead → Programmer → Tester → Critic → (revise loop → Judge) → Team Lead → User
```

**With role nicknames:**

```
User → Tusya (spec, EPIC → Story → Task, architecture)
            ↓
       Pusya (implementation)
            ↓
       Trusya (QA per checklist)
            ↓
       Krisya (review of diff + PASS report)
            ↓
  APPROVED → Tusya (final review) → User
            ↓
  REVISE → Tusya issues revision task (finding IDs) → Pusya → Trusya (re-verify) → Jasya (closes findings)
            ↓
  ALL_CLOSED → Tusya (final review) → User
  REVISE_AGAIN → back to Pusya (iteration++)
  ESCALATE_HUMAN → human decides
```

Full detail on the Critic/Judge stage: `ai-office/process/review-judge-cycle.md`.

### One chat — not a role shortcut

The user may keep **one chat** with Team Lead (convenient for specification). That is **not** a separate "mode" and **not** permission for the Team Lead to do Programmer, Tester, Critic, or Judge work. Implementation, QA, and review **always** stay with the respective role (separate role invokes via the `Agent` tool, or explicit handoffs via templates). The Team Lead only **assigns** and **accepts the outcome after** the full chain.

### Rules (delivery)

- **Tusya** does not accept "done" from Pusya directly — only after the full **Trusya → Krisya → (Jasya)** chain. The Team Lead **does not** replace any of them.
- **Pusya** hands work to **Trusya** using template `ai-office/templates/programmer-handoff-template.md`.
- **Trusya** hands to **Krisya** only after `ai-office/checklists/qa-checklist.md` passes; report — `ai-office/templates/tester-report-template.md`.
- **Krisya** hands its verdict to **Tusya** using `ai-office/templates/critic-review-template.md`.
- **Jasya** (only on `REVISE`) hands its verdict to **Tusya** using `ai-office/templates/judge-verdict-template.md`.

## Roles

| Role | Name | Role file |
|------|------|-----------|
| Team Lead | Tusya | `ai-office/agents/team-lead/role.mdc` |
| Programmer | Pusya | `ai-office/agents/programmer/role.mdc` |
| Tester | Trusya | `ai-office/agents/tester/role.mdc` |
| Critic | Krisya | `ai-office/agents/critic/role.mdc` |
| Judge | Jasya | `ai-office/agents/judge/role.mdc` |
| Infosec | Isya | `ai-office/agents/infosec/role.mdc` |

## Task intake

- Spec from the user — **only to Tusya** (`ai-office/global/global-standards.mdc`, `ai-office/global/handoff-contracts.mdc`).
- Intake template: `ai-office/task-intake.md`.

## Security review — Infosec (Isya)

**Formal path:**

```text
User → Team Lead → Infosec → Team Lead → User
```

**Direct invoke** (allowed by contracts): the user explicitly works with the **Isya** role — technical security findings in that context; **official** merge/release still with **Tusya**, see `handoff-contracts.mdc` §7.

- If **repository changes** are needed — Isya notifies **only Team Lead** → chain **Programmer → Tester → Critic → (Judge) → Team Lead**.

Output template: `ai-office/templates/infosec-findings-template.md`.

## Rework

- Plain QA **FAIL** (Tester rejects) — see `ai-office/process/process-rework-loop.md`.
- Critic **REVISE** and the Judge-arbitrated close-out — see `ai-office/process/review-judge-cycle.md`.
