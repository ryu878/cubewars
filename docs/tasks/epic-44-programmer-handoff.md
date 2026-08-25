# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 44 — Kill Loot Drop VFX (Victim → Killer) |
| Branch / commit / PR | `task/epic-44-kill-loot-drop-vfx` / (see git) / (PR if opened) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Added shared `economy_kill_loot_fx` message (`KillLootFxKind` / `KillLootFxGrant` / `EconomyKillLootFxMessage`) to the `ServerMessage` union.
2. After successful grants in `grantKillGold`, broadcast loot FX listing **only** actually granted kinds (gold when primary and/or substituted; never failed substituted item kinds as fake drops). No emit on DM bot / early-return no-reward paths. Drop chances and EPIC 32/35 rules unchanged.
3. Client `KillLootVfx` (`client/src/killLootVfx.ts`): distinct emissive low-poly meshes per kind (~0.35–0.7u), staggered arc victim→killer, cleanup; wired via `network.ts` + `main.ts` update loop.
4. Regression `scripts/regression-kill-loot-vfx.ts` + `npm run regression:kill-loot-vfx`; README Current status blurb.

## Changed files / areas

- `shared/src/index.ts` — protocol message + union
- `server/src/match.ts` — emit after `grantKillGold` grants
- `client/src/killLootVfx.ts` — new VFX module
- `client/src/network.ts`, `client/src/main.ts` — wire + update
- `scripts/regression-kill-loot-vfx.ts`, `package.json` — regression script
- `README.md` — Current status
- `docs/tasks/epic-44-kill-loot-drop-vfx.md` — spec (filed by TL)
- `docs/tasks/epic-44-programmer-handoff.md` — this handoff

## How to verify (steps for Trusya)

1. `npm run regression:kill-loot-vfx` — expects PASS (DM bot → no fx; forced drops → kinds match; substitute → gold only).
2. `npm run typecheck` and `npm run build`.
3. Manual / Playwright (Tester): join Multiplayer with two humans (or sandbox with forced drops), score a rewarding kill — confirm large glowing multicolored loot leaves the victim and arcs to the killer; kinds match HUD/inventory grants; DM bot kill shows no loot VFX.
4. Confirm client never invents kinds not present in `economy_kill_loot_fx.grants`.

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run dev` (or existing compose/dev flow)
- Expected smoke result: typecheck/build clean; regression PASS; in-match kill with grants shows VFX

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages:
  - `[economy] kill_loot_fx kinds=... <killer> <- <victim> [scope=... match=...]`
  - Existing gold/drop logs unchanged; DM bot still logs `kill vs bot victim -> no reward` with **no** `kill_loot_fx` line

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: kill rewards, drop rolls, substitute gold, and the `grants[]` list on `economy_kill_loot_fx` (positions from server registry at grant time)
- What the client is allowed to predict/render only: spawn/animate/despawn meshes for listed kinds only — no inventory mutation from VFX

## Risks / known limitations

- Drop rates are low in live play; regression stubs `resolveKillDrops` for forced kinds. Tester may need Playwright evidence (Story 44.3.1) with forced/high-rate setup — no dedicated `qa-epic44-*.mjs` shipped in this Programmer pass.
- Flight uses grant-time server positions; mid-flight killer movement can drift slightly (acceptable per spec).
- Sandbox bot-victim rewards still emit FX when gold/items are granted (EPIC 35 unchanged).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
