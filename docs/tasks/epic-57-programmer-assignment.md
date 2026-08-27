# EPIC 57 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- From current `master` (EPIC 56 merged `bd49e74`).
- Branch: `feature/epic-57-hold-fire-cooldown-ring-drops`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-57-hold-fire-cooldown-ring-drops`
- Spec: `docs/tasks/epic-57-hold-fire-cooldown-ring-drops.md` (sync into worktree).

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver

### A — Hold-to-fire (Story 57.1)

1. `client/src/main.ts`: `shouldAutoFire` for **all** weapons (keep spawn-protect / alive gates if already there).
2. `getAutoFireIntervalMs` → `WEAPON_STATS[currentWeapon].cooldownMs` (not pistol-hardcoded).

### B — Cooldown ring + no fake juice (Story 57.2)

3. Local fire-ready: spawn-protected OR dry ammo (non-infinite) OR local cooldown not elapsed OR dead → **return early** before juice + `send({ type: "fire" })`.
4. Track last successful local fire time; interval = current weapon `cooldownMs`.
5. Crosshair ring: fills as cooldown recovers; **full/transparent = ready**. Implement in HUD/CSS around `#crosshair`.
6. Playwright screenshots under `qa-artifacts/epic-57/` (ready + recovering).

### C — Repair kit 0.002 (Story 57.3)

7. `DROP_CHANCE.repairKit = 0.002` in `shared/src/economy.ts`.
8. Update any regression/assert that expects `0.1`.

### D — Sandbox bot shards + shard gate (Story 57.4)

9. Root cause: victim context only for humans; store requires Redis `amulets.length > 0`.
10. Extend `VictimDropContext` with `victimHasAmulet` (and optional human `nickname` for gem/amulet **copy** only).
11. `match.ts` `grantKillGold`: for sandbox bot victims, pass `{ victimHasAmulet: player.hasAmulet, alreadyGrantedShard }` with bot key in `matchShardGrants` — **never** `getOrCreateProfile` for bots.
12. Store: grant shard when `victimHasAmulet && !alreadyGranted && killerShards < cap`; **remove** killer amulet-count gate from shard path; align `shouldGrantShard`.
13. Do **not** `grantAmulet` / gem copy from bots (no Redis source).
14. Regressions: sandbox amulet-bot → shard; non-amulet bot → no shard; DM bot → no reward; human amulet shard still works; killer at amulet cap still gets shard.

### E — Docs / audit / delivery (Story 57.5)

15. Document drop gate table in handoff (spec § Story 57.5).
16. About EN+RU + Last updated + `client/public/changelog.json` (hold-fire, cooldown ring, rarer repair kits, sandbox bot shards).
17. Typecheck/build; `docs/tasks/epic-57-programmer-handoff.md`; open PR to `master`.
18. Do **not** merge/deploy. Ignore unrelated dirty parent files.

## Read first

- `ai-office/agents/programmer/role.mdc`, global standards, handoff template, `player-facing-docs.md`, branch policy
- Spec `docs/tasks/epic-57-hold-fire-cooldown-ring-drops.md`
- Key: `client/src/main.ts`, `fpsController.ts`, `combatHud.ts`, `client/index.html` `#crosshair`
- Key: `shared/src/economy.ts` (`DROP_CHANCE`, `shouldGrantShard`), `server/src/match.ts` `grantKillGold`, `server/src/economy/store.ts` `resolveKillDrops` / `VictimDropContext`
- EPIC 31 bots: `PlayerRecord.hasAmulet`; EPIC 32/35 drop scopes

## Return to Team Lead

Branch, PR/compare URL, HEAD SHA, files touched, drop-audit table, regression results, evidence paths, handoff path, blockers.
