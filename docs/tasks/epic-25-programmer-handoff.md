# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-24 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 25 — Gems, Amulets, Shards & Death Penalties (Tasks 25.1–25.6) |
| Branch / commit / PR | `task/epic-25-gems-amulets-shards` @ feat `cea0275` + handoff commit; base `task/epic-24-pets-eggs-equip` @ `110857b`. Compare: https://github.com/ryu878/cubewars/compare/task/epic-24-pets-eggs-equip...task/epic-25-gems-amulets-shards |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Shared: gem/amulet/shard/repair constants, death effectiveness factor 0.9, rating math with gems + slot2 ×0.4, drop helpers, protocol messages (`economy_socket_gem`, unsocket, equip/unequip amulet, craft, repair) and extended `economy_profile`.
2. Server: migration `20260824_003` (gems/amulets/shards/repair_kits; pets slot 2); store APIs; WS handlers; human death penalties; human-kill loot **copies** (gem/shard/amulet/repair) + match-scoped shard grant memory.
3. Client: pets panel (P) — gems select/socket/unsocket, amulets equip/repair/craft, shards/kits counts, slot 2 when enabled.
4. `npm run regression:economy-gems-amulets` plus green gold/pets regressions, typecheck, build.

## Changed files / areas

- `shared/src/economy.ts`, `shared/src/index.ts`
- `server/src/economy/migrations.ts`, `store.ts`, `index.ts`
- `server/src/match.ts`, `server/src/index.ts`
- `client/src/petsPanel.ts`, `client/index.html`
- `scripts/regression-economy-gems-amulets.ts`, `package.json`, `README.md`
- `docs/tasks/epic-25-gems-amulets-shards.md`

## How to verify (steps for Trusya)

1. `npm run typecheck` and `npm run build`
2. `npm run regression:economy-gold` && `npm run regression:economy-pets` && `npm run regression:economy-gems-amulets`
3. Manual (optional): seed two humans; equip amulet → slot 2; socket gems; die as human → durability −1 + 10% pet/gem decay; kill human with amulet → shard once/match; craft with 10 shards; confirm loot is copy (victim keeps items).

## Build and run

- Build command: `npm run build`
- Run command: `npm run dev` (existing server+client)
- Expected smoke result: join match → press P → see gems/amulets/shards/kits; economy actions return `economy_action_result` + refreshed `economy_profile`.

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[economy] … ok`, `[economy] death penalties → …`, `[economy] kill item drops → … gem# / shard / amulet# / repairKit`, `[economy] migration applied: 20260824_003_gems_amulets_shards_repair`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: all gem/amulet/shard/repair mutations, ownership, caps, socket uniqueness per type, slot2 only with equipped amulet, death penalties, kill drop rolls/copies, ratings with gems + 40% slot2, match shard-once memory.
- What the client is allowed to predict/render only: panel UI intents and display of server `economy_profile` / action results.

## Risks / known limitations

- Amulet/gem kill drops are **loot copies** (MVP fairness; documented in README) — not inventory theft.
- Auction/trade/8×8 grid/OBS out of scope.
- Existing local `economy.sqlite` from EPIC 24 migrates on next server open (pets table rebuild for slot 2 CHECK).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
