# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-27 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 57 — Hold-fire all weapons; cooldown ring + no fake juice; repairKit 0.002; sandbox bot amulet shards |
| Branch / commit / PR | `feature/epic-57-hold-fire-cooldown-ring-drops` — compare https://github.com/ryu878/cubewars/compare/master...feature/epic-57-hold-fire-cooldown-ring-drops (push OK; `gh pr create` auth cannot resolve repo — open PR from compare URL). Confirm HEAD with `git rev-parse HEAD` on branch. |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Hold-to-fire all weapons:** `shouldAutoFire` for every weapon; `getAutoFireIntervalMs` = `WEAPON_STATS[currentWeapon].cooldownMs`.
2. **Honest fire juice + cooldown ring:** Local fire-ready gate (alive, not spawn-protected, ammo/infinite, cooldown elapsed) before muzzle/viewmodel/gunshot/`fire` send. SVG ring around `#crosshair` fills as cooldown recovers (full/transparent = ready).
3. **`DROP_CHANCE.repairKit = 0.002`** + regression asserts updated.
4. **Sandbox bot shards:** `VictimDropContext` now has `victimHasAmulet` + optional human `nickname`; sandbox bots pass combat `hasAmulet` and track once-per-bot via `bot:${victimId}` (never Redis profile). Shard path no longer gates on killer amulet count; gem/amulet copies still require human Redis nickname.
5. **About EN+RU + changelog** for hold-fire, cooldown ring, rarer repair kits, sandbox bot shards.

## Drop-audit table (implementation)

| Drop | Chance / rule | Sandbox human | Sandbox bot | Deathmatch human | Deathmatch bot |
|------|---------------|---------------|-------------|------------------|----------------|
| Gold | GOLD_DROP_MIN–MAX | yes | yes | yes | **no** |
| Egg | 0.15 + caps | yes | yes | yes | no |
| Stim | 0.08 + soft cap | yes | yes | yes | no |
| Repair kit | **0.002** + soft cap | yes | yes | yes | no |
| Gem | 0.2 + victim equipped gem copy | yes (Redis) | **no** (no Redis gems) | yes | no |
| Amulet item | 0.02 + victim has amulet copy | yes (Redis) | **no** (do not invent) | yes | no |
| Shard | 100% once/victim if victimHasAmulet; shard-cap → gold substitute | yes (Redis) | **yes** (`hasAmulet`) | yes | no |

## Changed files / areas

- `client/src/main.ts` — hold-fire all weapons; fire-ready gate; cooldown ring drive; QA pin `__cwQaCooldownProgress`
- `client/src/combatHud.ts` — `setCooldownProgress`
- `client/index.html` — `#cooldownRing` SVG + CSS
- `shared/src/economy.ts` — `repairKit: 0.002`; `shouldGrantShard` (no killer-amulet gate)
- `server/src/economy/store.ts` — `VictimDropContext`; bot-safe shard; human-only gem/amulet copy
- `server/src/match.ts` — sandbox bot shard context + `bot:` once-per-victim keys
- `client/public/about.html`, `client/public/changelog.json`
- `scripts/regression-economy-gems-amulets.ts`, `scripts/regression-economy-persistence.ts`
- `scripts/regression-epic57-bot-shards.ts` (new), `scripts/qa-epic57-programmer-playwright.mjs` (new)
- `package.json` — `regression:epic57-bot-shards`
- Spec/assignment: `docs/tasks/epic-57-*.md`

## How to verify (steps for Trusya)

1. In-match: hold LMB on pistol / rifle / GL — each fires at its own cooldown; ring fills between shots.
2. Dry ammo / spawn protect / dead / mid-cooldown: no muzzle flash, no gunshot, no outbound `fire`.
3. Sandbox: kill amulet-bot → shard once; non-amulet bot → no shard from amulet path; second kill same bot → no second shard.
4. Deathmatch: bot kill → still no economy reward; human-with-amulet → shard still works.
5. Killer at amulet cap still receives shards (under shard cap).
6. About EN|RU + Changelog mention hold-fire, ring, rarer repair kits, sandbox bot shards.
7. Review Playwright screenshots under `qa-artifacts/epic-57/`.

## Build and run

- Build command: `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` then `npm run typecheck` and `npm run build`
- Regressions:
  - `npm run regression:economy-gems-amulets` → PASS
  - `npm run regression:economy-persistence` → PASS
  - `npm run regression:epic57-bot-shards` → PASS
  - `npm run regression:bot-kill-no-reward` → PASS
  - `npm run regression:split-economy` → PASS
- Playwright: `node scripts/qa-epic57-programmer-playwright.mjs` → PASS (evidence in `qa-artifacts/epic-57/`)
- Run command: `npm run dev` (or deploy script — do **not** deploy this PR)
- Expected smoke result: hold-fire works on all weapons; ring visible while recovering; sandbox amulet-bot can grant shard

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout `[economy] kill item drops ... shard`, `[economy] kill vs bot victim -> no reward` (DM only)
- Key success messages: `kill item drops -> <nick> ... shard [scope=sandbox ...]` after sandbox amulet-bot kill

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: hits, ammo, cooldown accept, all economy grants (gold/items/shards)
- What the client is allowed to predict/render only: hold-fire interval, juice suppression, cooldown ring (cosmetic); server still rejects invalid fire

## Risks / known limitations

- Client cooldown can briefly desync vs server; juice/spam suppressed client-side only — server remains authoritative.
- Playwright evidence pins ring via `__cwQaCooldownProgress` (same pattern as `__cwQaHoldPose`).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
