# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-24 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 24 — Pets, Eggs, Incubation & Equip Stats (Tasks 24.1–24.6) |
| Branch / commit / PR | `task/epic-24-pets-eggs-equip` tip `8389fdf` (feat `8c17cf1`); base `task/epic-23-economy-foundation` @ `22d4da6` — compare https://github.com/ryu878/cubewars/compare/task/epic-23-economy-foundation...task/epic-24-pets-eggs-equip (`gh pr create` failed: token account cannot see `ryu878/cubewars`) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Shared pet math knobs (`PET_COMBAT`, rating aggregators, DR/speed/damage helpers), drop gates, stimulator deadline clamp, and protocol (`economy_equip_pet` / `unequip` / `hatch` / `apply_stimulator`; extended `economy_profile`; `economy_action_result`).
2. SQLite migration for `eggs` / `pets` / `growth_stimulators`; EconomyStore CRUD + equip/hatch/stim with ownership checks, slot-2 reject, pet/egg/stim caps, `CUBEWARS_INCUBATION_MS` on grant.
3. Kill path: gold unchanged; egg + stimulator drops on **human** victims only (bots gold-only for items). WS handlers for economy actions; ratings applied in `playerRegistry` (max HP, %DR before EPIC 7 armor, speed, weapon damage).
4. Minimal client pets panel (P) + HUD ratings; `npm run regression:economy-pets`.

## Changed files / areas

- `shared/src/economy.ts`, `shared/src/index.ts`
- `server/src/economy/*`, `server/src/match.ts`, `server/src/index.ts`, `server/src/playerRegistry.ts`
- `client/src/petsPanel.ts`, `client/index.html`, `client/src/main.ts`, `client/src/network.ts`, `client/src/combatHud.ts`
- `scripts/regression-economy-pets.ts`, root `package.json`
- `config.vars.example`, `README.md`
- Spec: `docs/tasks/epic-24-pets-eggs-equip.md`, this handoff

## How to verify (steps for Trusya)

1. `npm run typecheck` && `npm run build` && `npm run regression:economy-gold` && `npm run regression:economy-pets` — all PASS.
2. Optional live: `CUBEWARS_INCUBATION_MS=5000 CUBEWARS_ECONOMY_DB=/tmp/cw-e24.sqlite npm run dev` — join bots match, press **P**, grant path via kills on a second human or store-side QA; hatch after deadline; equip and confirm HP/ratings HUD update from server profile only.
3. Confirm forged `economy_equip_pet` for another profile’s `petId` / `slot: 2` returns `economy_action_result` failure (`cross_profile` / `slot2_disabled`) and does not mutate SQLite.

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (optional `CUBEWARS_ECONOMY_DB`, `CUBEWARS_INCUBATION_MS`)
- Expected smoke result: regressions print `[economy-gold] PASS` / `[economy-pets] PASS`; client builds; pets panel toggles with P after join.

## Configuration

- New environment variables: yes → `CUBEWARS_INCUBATION_MS` (optional positive int ms on egg grant; default 24h) documented in `config.vars.example` and README. Existing `CUBEWARS_ECONOMY_DB` unchanged.
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[economy] database ready`, `migration applied: 20260824_002_pets_eggs_stimulators`, `gold minted`, `kill item drops`, `equip/hatch/stimulator ok`, rejected actions with code

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: egg/stim drops, hatch/stim/equip/unequip, ownership/caps/slot2, ratings, max HP / DR / speed / damage modifiers
- What the client is allowed to predict/render only: display `economy_profile` / action results; send action intents only — never invent pets, ratings, or hatch outcomes

## Risks / known limitations

- Nickname-key identity still spoofable (known until auth EPIC).
- Short `CUBEWARS_INCUBATION_MS` left in prod would accelerate hatching — documented; default remains 24h.
- Slot 2 / gems / amulets / 8×8 grid / auction out of scope (EPIC 25–28).
- High lion pets can spike damage — balance deferred to EPIC 29.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
