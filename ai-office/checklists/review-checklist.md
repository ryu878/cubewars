# Team Lead final review checklist

Use before approving merge, **after** Tester PASS and Critic `APPROVED` (or Judge `ALL_CLOSED`).

## Chain evidence

- [ ] Tester PASS report present and matches the reviewed commit.
- [ ] Critic verdict is `APPROVED`, or Judge verdict is `ALL_CLOSED` if a revision happened.
- [ ] No open `REVISE_AGAIN` or `ESCALATE_HUMAN` state on this task.

## Architecture and stack

- [ ] Matches the **fixed** stack in `ai-office/global/global-standards.mdc` (Three.js/TS client + Vite, Node.js/TS + `ws` server, shared `shared/` protocol types, Rapier only if physics is in scope); no substitutions or competing libraries.
- [ ] No extra technologies "from thin air" without the user's explicit sign-off recorded in the task spec.
- [ ] Client/server separation intact; server remains authoritative for gameplay-relevant state.

## Security

- [ ] Secrets not in the repository; `config.vars.example` / README up to date.
- [ ] No sensitive data leaking into logs.
- [ ] Server-authoritative for any gameplay-relevant state introduced or touched.

## Observability

- [ ] Key actions are logged; errors are not swallowed without reason.

## Infrastructure

- [ ] `docker compose` builds and starts (if applicable to the task).

## Documentation

- [ ] README / docs updated if run method or contracts changed.

## Outcome

- [ ] **Approve** — can merge and deliver to the user (template `ai-office/templates/final-user-report-template.md`).
- [ ] **Reject** — return for rework with an explicit findings list (via the normal chain per process).
