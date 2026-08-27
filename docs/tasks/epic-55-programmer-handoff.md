# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-27 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 55 — Ammo does not unlock weapons; HUD current/max; maxHealth integrity |
| Branch / commit / PR | `feature/epic-55-ammo-not-unlock-hud-maxhp` (HEAD filled after push); `gh pr create` blocked. Compare URL: https://github.com/ryu878/cubewars/compare/master...feature/epic-55-ammo-not-unlock-hud-maxhp?expand=1 |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: **F-001** |

## What was done (brief)

1. **Original EPIC 55:** ammo vs weapon split; HUD current/max; maxHealth broadcast; About/changelog; regressions 7–9.
2. **Revision F-001:** `applyPickup` no longer rejects an **unowned** `"weapon"` pickup solely because ammo stockpile is already at `maxAmmo`. Unlock still applies; ammo stays at cap. Still reject full `"ammo"` (owned or unowned) and owned `"weapon"` at maxAmmo. Added regression case 10 (4× rifle ammo → 48, then weapon → owns, ammo 48).

### maxHealth / “heal capped at 100” root cause

**No server mid-life heal-cap bug found** (unchanged from first handoff). Health pickups use `player.maxHealth`; HUD opacity was the plausible player confusion.

## Changed files / areas

- `server/src/playerRegistry.ts` — F-001 unlock-at-full-stockpile gate
- `scripts/regression-weapon-autoswitch.ts` — case 10
- `docs/tasks/epic-55-programmer-handoff.md` — this revision note
- (prior EPIC 55 files unchanged in this revision)

## How to verify (steps for Trusya)

1. Run `npm run regression:weapon-autoswitch` — expect OVERALL PASS including **case 10** (full unowned stockpile → weapon unlock).
2. Whitebox/manual: fill unowned rifle ammo to 48 via ammo crates only → still not owned; pick rifle **weapon** → `applied: true`, owned, ammo stays 48, auto-equip if higher tier.
3. Confirm full ammo pickup still rejected; owned weapon at maxAmmo still rejected.
4. Light smoke: prior cases 7–9 and HUD current/max still OK (no intentional regression outside F-001).

## Build and run

- Build command: `npx tsc --noEmit -p shared && npx tsc --noEmit -p server && npx tsc --noEmit -p client`
- Run command: `npm run regression:weapon-autoswitch`
- Expected smoke result: OVERALL PASS including case 10

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: N/A for this revision (logic-only)
- Key success messages: regression case 10 PASS

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: ownership unlock on weapon pickup even at max stockpile; ammo/equip rules unchanged otherwise
- What the client is allowed to predict/render only: HUD from server fields only

## Risks / known limitations

- `gh pr create` blocked by CLI auth mismatch — open PR from compare URL
- Scope limited to F-001 only

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
