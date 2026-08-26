# EPIC 47 — Programmer assignment (Team Lead → Pusya)

**CONTINUE** existing WIP — do not discard work already in the worktree.

## Branch / worktree

- Path: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-47-map-density-bots-esc`
- Branch: `task/epic-47-map-density-bots-esc`
- Spec (authoritative, expanded): copy/sync from repo `docs/tasks/epic-47-map-density-bots-mapid.md` into the worktree and implement **all** stories including new auth/changelog.

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Already in progress (keep / finish)

Uncommitted WIP includes densify maps, pause menu, leave protocol paths — finish those, then add new scope below.

## Must deliver (full EPIC)

1. Bots mapId fix + non-Base proof
2. ~4× pickups (before/after counts) + more cover
3. ESC pause menu (Resume, Exit to Lobby, Change map, Inventory, Auction) + clean leave
4. **NEW:** Changelog link near Telegram + changelog page (10/page, newest first, pagination)
5. **NEW:** Send password / Resend code — new 6-digit code, store hash, show on-screen honestly (no fake email), rate-limit
6. **NEW:** Code normalize — `123-345` and `123345` both login; server-side normalize; regression (note: `normalizeCode` may already exist — verify e2e and fix gaps)
7. Typecheck/build/regressions/Playwright; README; `docs/tasks/epic-47-programmer-handoff.md`; PR to `master`

## Read first

- `ai-office/agents/programmer/role.mdc`
- globals + handoff template
- Spec: `docs/tasks/epic-47-map-density-bots-mapid.md`
- Auth: `server/src/accounts/store.ts`, `client/src/accountAuth.ts`

## Constraints

- Do not mix unrelated parent dirty files
- Do not merge/deploy
- English artifacts; hand off to Tester only

## Return summary

Branch, PR URL, HEAD SHA, pickup before/after, bots root cause, ESC leave message name, changelog URL path, reset message name, normalize verification note, handoff path, blockers.
