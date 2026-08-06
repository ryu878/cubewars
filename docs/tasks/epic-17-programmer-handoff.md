# Handoff: Programmer -> Tester

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-06 |
| Author (Pusya) | Programmer (emulated locally by Codex) |
| Task / Story / EPIC | EPIC 17 / Animated Humanoid Player Avatars |
| Branch / commit / PR | `task/epic-17-animated-player-avatars` / local working tree / PR not opened |
| Revision round | no |

## What was done (brief)

1. Replaced remote capsule placeholders with low-poly humanoid avatars containing torso, head, face markers, arms, legs, back panel, and a held weapon.
2. Added `PlayerState.equippedWeapon` from server-authoritative state so avatars can render pistol/rifle/grenade-launcher props.
3. Added simple stand/run animation driven by world-state position deltas, plus regression/visual selfcheck scripts.

## Changed files / areas

- `shared/src/index.ts` — `PlayerState.equippedWeapon`.
- `server/src/playerRegistry.ts` — world-state serialization now includes authoritative equipped weapon.
- `client/src/remotePlayers.ts` — humanoid avatar renderer, held weapon props, run/stand pose system.
- `client/src/main.ts` — `remotePlayers.update(dt)` and server timestamp passed into `sync()`.
- `scripts/regression-playerstate-equipped-weapon.ts`, `scripts/qa-epic17-avatar-selfcheck.mjs`, `package.json` — verification scripts.
- `README.md`, `docs/backlog.md`, `docs/tasks/epic-17-animated-player-avatars.md` — docs/spec.

## How to verify

1. Run `npm run typecheck`.
2. Run `npm run build`.
3. Run `npm run regression:playerstate-equipped-weapon`.
4. Run `npm run qa:epic17-avatar-selfcheck`.
5. Inspect screenshots in `qa-artifacts/epic-17-avatar-selfcheck/`.

## Build and run

- Build command: `npm run build`
- Run command: `npm run qa:epic17-avatar-selfcheck`
- Expected smoke result: screenshots show three avatars with front/side/back orientation and three different held weapons; checks pass with zero console errors.

## Configuration

- New environment variables: no.
- Secrets in the repository: no.

## Logs / observability

- No new server log path required; no material gameplay-state transition was added.
- Verification output logs avatar graph checks and visible weapon props.

## Server-authority note

- `equippedWeapon` is broadcast from server-owned `PlayerRecord.equippedWeapon`.
- The client never sends a weapon target in world state and still cannot claim weapon, ammo, hit, damage, or position authority.
- Avatar animation is inferred locally from already-broadcast positions and is cosmetic only.

## Risks / known limitations

- `equippedWeapon` is now visible before firing; accepted by the EPIC because visible held weapons are the feature.
- Run/stand detection is based on 20Hz position deltas and may briefly animate during reconciliation snaps; purely cosmetic.
- Hitboxes remain unchanged and do not match every limb shape exactly.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP
