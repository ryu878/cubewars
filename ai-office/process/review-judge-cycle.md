# Review/Judge cycle (Programmer → Tester → Critic → Judge)

Canonical process for the **implementation delivery chain**. This is the standing gate every task-branch delivery goes through before Team Lead's final merge approval — not an optional extra.

Roles:

| Role | Name | File |
|------|------|------|
| Team Lead | Tusya | `ai-office/agents/team-lead/role.mdc` |
| Programmer | Pusya | `ai-office/agents/programmer/role.mdc` |
| Tester | Trusya | `ai-office/agents/tester/role.mdc` |
| Critic | Krisya | `ai-office/agents/critic/role.mdc` |
| Judge | Jasya | `ai-office/agents/judge/role.mdc` |

All are **internal** except Team Lead (user-facing packaging).

## Cycle

```
1.  TL assigns the task            → task-template.md
2.  Programmer (Pusya) implements   → branch, commits, PR
3.  Programmer hands off            → programmer-handoff-template.md
4.  Tester (Trusya) runs QA         → qa-checklist.md
5.  FAIL?                          → back to Programmer (process-rework-loop.md, no Critic yet)
6.  PASS                           → tester-report-template.md, forwarded to Critic
7.  Critic (Krisya) audits DIFF + PASS report
       (NOT a narrative summary)   → critic-review-template.md
8.  APPROVED?                      → TL final review → merge → user
9.  REJECT?                        → back to TL to redefine the task (not a Programmer patch loop)
10. REVISE?                        → TL issues revision task (finding IDs only) to Programmer
11. Programmer fixes listed findings only
12. Tester re-verifies (scoped fix + light regression pass)
13. Judge (Jasya)                  → judge-verdict-template.md
       (inputs: finding, changes, retests, diff summary — NO chat)
14. ALL_CLOSED                     → TL final review → merge → user
15. REVISE_AGAIN                   → back to step 11 (iteration++)
16. After 3–5 iterations still open → ESCALATE_HUMAN — human decides, loop stops
```

## Critic control principle (key)

| Reviews | Does not review as primary evidence |
|---------|-------------------------------------|
| The actual diff / PR | A prose description of "what was done" |
| Tester's verified PASS report | "It works, trust me" / unverified claims |
| Acceptance criteria mapped to specific changes | Paraphrased summaries without file references |
| Server-side validation of gameplay-relevant state | Client-side-only checks presented as sufficient |
| Actual gameplay screenshots/evidence, opened and looked at (or a personal spot-check) | "Gameplay verified" written with no screenshots attached |

If the diff or Tester PASS report is missing → Critic **`REJECT`/`REVISE`** at the gate — no long debate with Programmer.

## Critic's scope is both technical and product/gameplay

Critic does not only check that the code is correct and on-stack — for anything player-facing, Critic also judges whether the game **actually works and feels right**: can the player move, jump, shoot, and land hits; does the scene look like the intended colorful low-poly "Roblox-like" direction rather than a bare default render; are controls usable. A clean diff that produces a broken or unconvincing result is **not** `APPROVED`. See `ai-office/agents/critic/role.mdc` checklist items 13–16.

## Why Judge exists, specifically

Critic → fix → Critic-finds-something-new can loop forever if nothing bounds it. **Judge is the bound.** Once Critic has issued `REVISE`, Judge — not Critic — evaluates whether the *listed* findings are closed. Judge does not go looking for new problems (except an explicit regression check), and Judge is the one who calls `ESCALATE_HUMAN` when a fix isn't converging after 3–5 rounds, taking the decision out of the automated loop entirely.

## Deterministic evidence (step 7 / step 13)

Minimum for Critic:

- Diff/PR corresponds to the task and commit referenced in the Tester report
- Acceptance criteria each map to a visible change or an explicit "not implemented, because..." note
- Tester report actually exercises the risky paths the diff introduces

Minimum for Judge:

- Re-test results reference the specific finding IDs
- Diff summary shows what changed for each finding, before → after
- No new open-ended critique — only closed/still-open/partial/regression per listed finding

**Critical failure examples (Critic gate):** no diff to review, Tester report references a different commit, acceptance criteria silently dropped, client-trusted state presented as "validated" without server-side checks.

## Artifacts

| Step | Template |
|------|----------|
| Task | `ai-office/templates/task-template.md` |
| Programmer → Tester handoff | `ai-office/templates/programmer-handoff-template.md` |
| Tester report | `ai-office/templates/tester-report-template.md` |
| Critic review | `ai-office/templates/critic-review-template.md` |
| Judge packet / verdict | `ai-office/templates/judge-verdict-template.md` |

## How you (user) start such work

Write to **this chat** (Team Lead / Tusya) as usual, or invoke the `team-lead` subagent directly. You do not need to separately invoke Programmer, Tester, Critic, or Judge — Team Lead routes the chain and only comes back to you with the final outcome.

## Handoffs

See `ai-office/global/handoff-contracts.mdc` §3–§6.
