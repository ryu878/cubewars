# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-24 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 23 foundation slice — Tasks 23.1–23.4 |
| Branch / commit / PR | `task/epic-23-economy-foundation` (see PR; base = `task/epic-21-nickname-leaderboard`) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Added shared economy constants (`GOLD_DROP_MIN/MAX`, caps, drop chances) and protocol messages `economy_profile` / `economy_gold_update`.
2. Added server SQLite economy store (`better-sqlite3`) under `server/src/economy/` with migrations, `getOrCreateProfile` / `addGold` / `getProfile`, env `CUBEWARS_ECONOMY_DB`.
3. Hooked confirmed kill path (including bot victims / endless) to mint random gold to the human killer’s nickname profile and push a private gold update; fog/self/non-human shooters skipped.
4. Client lobby + HUD show server-provided gold only; regression script `regression:economy-gold` covers range, persistence, and no negative gold.

## Changed files / areas

- `shared/src/economy.ts`, `shared/src/index.ts`
- `server/src/economy/*`, `server/src/match.ts`, `server/src/matchManager.ts`, `server/src/index.ts`, `server/package.json`
- `client/src/combatHud.ts`, `client/src/network.ts`, `client/src/main.ts`, `client/src/modeSelect.ts`, `client/index.html`
- `scripts/regression-economy-gold.ts`, root `package.json`
- `config.vars.example`, `README.md`, `.gitignore` (`server/data/`)
- Specs/docs: `docs/product/emerald-wasteland-economy-tz-v2.1.md`, `docs/tasks/epic-23-economy-persistence-foundation.md`, this handoff

## How to verify (steps for Trusya)

1. `npm install` (native `better-sqlite3` must build/load on the host).
2. `npm run typecheck` && `npm run build` && `npm run regression:economy-gold` — all PASS.
3. Manual/play: `npm run dev` → join with a nickname → kill a bot or player → GOLD HUD updates; restart server → same nickname still has gold.
4. Fog death in Endless must not grant gold to the victim; bot-as-killer must not mint gold profiles.

## Build and run

- Build command: `npm run build`
- Run command: `npm run dev`
- Expected smoke result: lobby shows Gold after join snapshot; in-match top-right GOLD updates after kills; no client-set gold path exists.

## Configuration

- New environment variables: yes → `CUBEWARS_ECONOMY_DB` (optional; default `server/data/economy.sqlite`) documented in `config.vars.example` and README
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[economy] database ready: …`, `[economy] migration applied: …`, `[economy] gold minted: +N -> Nickname (total T) …`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: gold mint amount, profile balance, eligibility (human killer only; no fog/self)
- What the client is allowed to predict/render only: display `economy_profile` / `economy_gold_update` values; never invent or accumulate gold

## Risks / known limitations

- Nickname-key identity is spoofable until auth EPIC (accepted in EPIC 23 / TZ).
- SQLite is single-process only; do not share the DB file across multiple server processes.
- Pinned `better-sqlite3@11.10.0` (not latest 13.x) because this Ubuntu 20.04 host (glibc 2.31 / g++ 9) cannot load/build 13.x prebuilds (needs GLIBC_2.33+ / C++20). Newer CI hosts should still work with 11.x; bump later if toolchain allows.
- Pets/eggs/gems/inventory/auction remain out of scope (EPICs 24+).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
