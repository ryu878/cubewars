# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 41 — Spawn Protection Must Block Firing (`docs/tasks/epic-41-spawn-protection-no-fire.md`) |
| Branch / commit / PR | `task/epic-41-spawn-protection-no-fire` / tip `e43a9b5b147eeb25210c1f97124ac8c9acf4fcb3` (impl `05ca5a1`) / PR not opened via `gh` (CLI auth is `ltrvtrb2`; push used SSH as `ryu878`). Compare: https://github.com/ryu878/cubewars/compare/master...task/epic-41-spawn-protection-no-fire |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Server (authoritative):** `PlayerRegistry.fire()` returns `{ hit: false, dry: false }` (no `weapon`) when the shooter is spawn-protected — no ammo consume, no hitscan, no projectile, no `fire_broadcast` from `match.resolveFire`.
2. **Cooldown fairness:** Human (`index.ts`) and bot (`botAI.ts`) skip `lastFireAcceptedAt` stamps when blocked by spawn protection.
3. **Client UX:** While `serverTimeMs < self.spawnProtectedUntilMs` from latest `world_state`, `onFire` does not send `{ type: "fire" }` and does not play muzzle/viewmodel/gunshot; pistol auto-fire also gated.
4. Extended `scripts/regression-spawn-protection.ts` with protected-shooter cases (no ammo/hit/weapon; fire after window; bot id same path); existing protected-target cases still pass (shooters cleared in `placeFacing`).
5. README Current status note for EPIC 41.

## Changed files / areas

- `server/src/playerRegistry.ts` — EPIC 41 fire gate after alive check
- `server/src/index.ts` — skip cooldown stamp when spawn-protected
- `server/src/botAI.ts` — skip bot fire + cooldown stamp when spawn-protected
- `server/src/match.ts` — doc comment: `weapon` absent also for EPIC 41 bail
- `client/src/main.ts` — local fire juice + outbound `fire` gated on broadcast protection
- `scripts/regression-spawn-protection.ts` — EPIC 41 shooter-blocked cases + placeFacing clears shooter protection
- `README.md` — Current status EPIC 41 note
- `docs/tasks/epic-41-spawn-protection-no-fire.md` — approved spec (committed with branch)

## How to verify (steps for Trusya)

1. `npm run typecheck` and `npm run build` — expect PASS.
2. `npm run regression:spawn-protection` — expect `[spawn-protection] PASS` (incoming immunity + new shooter-blocked cases).
3. Live/smoke (or Playwright): join/respawn → while HUD shows SPAWN PROTECTED / nearly transparent, click fire — no muzzle, no gunshot, no ammo change, no hit on others.
4. After ~2s window ends: fire works normally (muzzle + hits possible).
5. Confirm a non-protected player still cannot damage a protected target (EPIC 36 unchanged).

## Build and run

- Build command: `npm run typecheck && npm run build`
- Run command: `npm run regression:spawn-protection` (and normal client/server via project README / docker compose as usual)
- Expected smoke result: regression prints `[spawn-protection] PASS`; live ghost cannot fire; after window, fire resumes; protected targets still immune

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout — protected fire attempts produce no hit/death/auto-switch/ammo-depleted lines and no fire_broadcast path (outcome lacks `weapon`)
- Key success messages: regression `[spawn-protection] PASS`; live — no local muzzle while protected

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: spawn-protected shooters cannot fire — gated in `PlayerRegistry.fire()` (shared by humans and bots via `match.resolveFire`). Cooldown stamps skipped in index/botAI so blocked attempts do not burn RoF.
- What the client is allowed to predict/render only: suppress local muzzle/viewmodel/gunshot and do not send `fire` while protected (UX only; server remains authoritative if a client cheats past the gate)

## Risks / known limitations

- Client gate uses last `world_state` `serverTimeMs` vs `spawnProtectedUntilMs` (same as HUD) — brief lag vs true server clock is possible; server gate still enforces.
- Live muzzle-suppression evidence is for Tester (Playwright/smoke), not automated in this regression script.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
