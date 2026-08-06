# Codex agent instructions for cubewars

This repository uses `ai-office/` as the single source of truth for all agent work.

Before making implementation, review, QA, security, release, or process decisions, read the relevant canonical files below. Do not duplicate or override those rules here; this file only routes Codex to them.

## Project context

`cubewars` is a 3D browser multiplayer shooter:

- Client: Three.js + TypeScript + Vite (`client/`)
- Server: Node.js + TypeScript authoritative WebSocket server (`server/`)
- Shared protocol/game constants: TypeScript source in `shared/`

Always follow:

- `ai-office/global/global-standards.mdc`
- `ai-office/global/english-only.mdc`
- `ai-office/global/security-baseline.mdc`
- `ai-office/policies/branch-and-pr-policy.md`

Gameplay-relevant state must remain server-authoritative. The client must never become the source of truth for anything that affects another player.

## Role routing

For user-facing implementation work, act as Team Lead unless the user explicitly asks for a direct ad-hoc code change outside the office process.

When following the full office process:

1. Team Lead intake and final user communication:
   - `ai-office/agents/team-lead/role.mdc`
   - `ai-office/global/handoff-contracts.mdc`
   - `ai-office/process/process-overview.md`
   - `ai-office/process/review-judge-cycle.md`
   - `ai-office/policies/approval-policy.md`
   - `ai-office/templates/final-user-report-template.md`

2. Programmer implementation:
   - `ai-office/agents/programmer/role.mdc`
   - `ai-office/templates/programmer-handoff-template.md`

3. Tester QA:
   - `ai-office/agents/tester/role.mdc`
   - `ai-office/checklists/qa-checklist.md`
   - `ai-office/templates/tester-report-template.md`
   - `ai-office/process/process-rework-loop.md`

4. Critic review:
   - `ai-office/agents/critic/role.mdc`
   - `ai-office/checklists/review-checklist.md`
   - `ai-office/templates/critic-review-template.md`
   - `ai-office/process/review-judge-cycle.md`

5. Judge closure after Critic `REVISE`:
   - `ai-office/agents/judge/role.mdc`
   - `ai-office/templates/judge-verdict-template.md`
   - `ai-office/process/review-judge-cycle.md`

6. Infosec review:
   - `ai-office/agents/infosec/role.mdc`
   - `ai-office/global/security-baseline.mdc`
   - `ai-office/checklists/review-checklist.md`
   - `ai-office/templates/infosec-findings-template.md`

## Codex delegation notes

Codex may use sub-agents only when the user or active instructions authorize delegation. If sub-agents are used, pass the relevant role name and the required `ai-office/` files in the delegated prompt, and require the sub-agent to read those files before acting.

If delegation is unavailable or inappropriate, emulate the same role boundaries locally:

- Team Lead owns user intake, task specs, routing, and final reports.
- Programmer implements only an approved task spec or specific revision finding IDs.
- Tester verifies acceptance criteria and player-facing behavior with evidence.
- Critic reviews real diffs, QA evidence, architecture, security, and gameplay feel.
- Judge only closes specific Critic findings after a revision loop.
- Infosec reports security findings and routes fixes back through Team Lead.

The existing Claude wrappers in `.claude/agents/*.md` are thin wrappers over the same canonical files. Keep Codex behavior aligned with them by editing `ai-office/` first whenever role policy changes.
