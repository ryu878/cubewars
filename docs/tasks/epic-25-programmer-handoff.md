# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-24 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 25 — Gems, Amulets, Shards & Death Penalties (Tasks 25.1–25.6) |
| Branch / commit / PR | `task/epic-25-gems-amulets-shards` (revision after Critic REVISE); base `task/epic-24-pets-eggs-equip` @ `110857b` — compare https://github.com/ryu878/cubewars/compare/task/epic-24-pets-eggs-equip...task/epic-25-gems-amulets-shards (`gh pr create` failed: token account cannot see `ryu878/cubewars`) |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: **F-001**, **F-002** (F-003 note-only, skipped) |

## What was done (brief)

1. Original EPIC 25 implementation (gems/amulets/shards/repair, death penalties, loot copies, panel, regression).
2. **F-001:** Kill gem loot copy uses `grantGem(..., { allowExistingValue: true })` so decayed values 1–4 are valid; loot catch no longer rethrows non-`EconomyActionError` (kill path never aborts on gem loot).
3. **F-002:** `applyHumanDeathPenalties` snapshots active pets (slots 1+2), applies 10% decay, then unequips slot2 if amulet destroyed.
4. Regression coverage added for F-001 (decayed gem loot) and F-002 (slot2 decay on amulet destroy).

## Changed files / areas (this revision)

- `server/src/economy/store.ts` — F-001 + F-002
- `scripts/regression-economy-gems-amulets.ts` — F-001 + F-002 coverage
- `docs/tasks/epic-25-programmer-handoff.md` — this revision note

## How to verify (steps for Trusya)

1. `npm run typecheck` and `npm run build`
2. `npm run regression:economy-gold` && `npm run regression:economy-pets` && `npm run regression:economy-gems-amulets`
3. Confirm regression asserts for F-001 (loot value 4) and F-002 (both pets decay when amulet destroyed at durability 1).
4. Optional manual: decayed victim gem loot; die with amulet dur 1 + slot2 pet → both pets −10%, slot2 unequipped.

## Build and run

- Build command: `npm run build`
- Run command: `npm run dev` (existing server+client)
- Expected smoke result: join match → press P → economy actions + profile refresh; kill path stable with decayed gems.

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[economy] … ok`, `[economy] death penalties → …`, `[economy] kill item drops → …`; optional warn `[economy] gem loot copy skipped …` only on unexpected failures (cap still silent via EconomyActionError)

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged authority; loot copy allows existing (possibly decayed) gem values; death decay order fixed for slot2.
- What the client is allowed to predict/render only: panel intents + display of server profile.

## Risks / known limitations

- Amulet/gem kill drops remain **loot copies** (MVP).
- F-003 (Critic note-only) not addressed this round.

## Status

- [x] Ready for QA (Trusya) — re-verify F-001 / F-002
- [ ] Draft / WIP (do not take into QA)
