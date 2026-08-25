# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 13:22 UTC |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 35 — Split Economy — Deathmatch vs Sandbox Pools (Tasks 35.1–35.3, 35.5–35.7; **not** 35.4) |
| Branch / commit / PR | `task/epic-35-split-economy-deathmatch-sandbox` @ `2371da6` (feature `708af28`; base `master` @ `8115674` incl. EPIC 37). Push OK; `gh pr create` failed on remote name resolution — open PR from GitHub UI if needed. |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Threaded `EconomyScope` (`deathmatch` \| `sandbox`) through `EconomyStore` Redis keying (`economy:v1:{scope}:{nicknameKey}`), cache, and all profile mutators; career/endless leaderboard fields stay on the deathmatch document.
2. Idempotent migration: legacy unscoped `economy:v1:{nicknameKey}` → deathmatch on first read (`SET NX` + delete legacy).
3. `grantKillGold()` derives scope from match mode: deathmatch keeps EPIC 32 human-only gate; sandbox rewards bot+human kills into sandbox only (no phantom bot profiles).
4. Client: mode-select Deathmatch/Sandbox labels + inventory `economyPool` badge from server `economy_profile`.
5. Docs (README + TZ) and regressions: `regression:split-economy` + updated `regression:bot-kill-no-reward`.

## Changed files / areas

- `server/src/economy/store.ts`, `server/src/economy/index.ts` — scoped keys, migration, API `scope` params (default `deathmatch`)
- `server/src/match.ts` — scope-aware economy reads/writes + kill reward routing
- `shared/src/index.ts` — `economyPool` on `EconomyProfileMessage`
- `client/index.html`, `client/src/inventoryOverlay.ts` — pool labeling
- `scripts/regression-split-economy.ts`, `scripts/regression-bot-kill-no-reward.ts`, `package.json`
- `README.md`, `docs/product/emerald-wasteland-economy-tz-v2.1.md`

## How to verify (steps for Trusya)

1. `npm run typecheck` && `npm run build`
2. `npm run regression:split-economy` — isolation (sandbox gold/eggs invisible to deathmatch), sandbox bot-kill routing, legacy→deathmatch migration
3. `npm run regression:bot-kill-no-reward` — public/deathmatch non-human → zero; bots/sandbox bot kill → sandbox gold only
4. `npm run regression:economy-gold` / `pets` / `gems-amulets` / `persistence` / `inventory` — existing economy suite (defaults to deathmatch)
5. Manual smoke: mode-select shows Deathmatch vs Sandbox labels; join public vs bots and open **I** — badge shows matching pool; sandbox gold must not appear after switching to a deathmatch match under the same nickname

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (Redis required — `docker compose up -d redis`)
- Expected smoke result: typecheck/build green; split-economy + bot-kill + economy-* regressions PASS (see notes on redis-safety)

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages:
  - `[economy] migrated legacy profile -> deathmatch for <key>`
  - `[economy] gold minted: +N -> <nick> [scope=deathmatch|sandbox …]`
  - `[economy] kill vs bot victim -> no reward … [scope=deathmatch …]`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: economy scope from `match.mode` only; all gold/item grants, inventory actions, and profile snapshots for the active pool
- What the client is allowed to predict/render only: display `economyPool` / gold / inventory from server messages; never chooses or sends a pool

## Risks / known limitations

- Highest risk area is isolation + migration (called out in EPIC §9) — covered by `regression:split-economy`, still warrants Infosec/Critic scrutiny
- `npm run regression:economy-redis-safety` failed in this environment due to missing `better-sqlite3` native bindings (pre-existing local tooling issue, not introduced by this diff); SQLite import callback now targets deathmatch keys
- Task 35.4 intentionally skipped (EPIC 37 already on `master`)
- Victim-dependent drops (gem/amulet/shard copy) still need a human victim profile; sandbox bot kills get gold + non-victim item rolls (egg/stim/repair kit)

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
