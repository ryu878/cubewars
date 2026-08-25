# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 33 — Avatar Color Customization |
| Branch / commit / PR | `task/epic-33-avatar-color-customization` tip `425440e` (impl `31d7ce0`; base `master` @ `f87190b`) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Shared `AVATAR_COLOR_PALETTE` (8 colors) + `AvatarColors` / `AvatarBodyPart` + `avatar_set_color` client message; `PlayerState.avatarColors` broadcast field.
2. Redis-backed `AvatarProfileStore` (`cw:avatar:v1:<nicknameKey>`) — separate from EconomyStore / EPIC 35 pools; validate + persist + apply on join / color change.
3. Client: per-avatar body materials (arms vs legs split), colors from `PlayerState`; Appearance swatch UI in inventory overlay (I); bots get independent random palette indices at spawn (logged).

## Changed files / areas

- `shared/src/avatar.ts`, `shared/src/index.ts`
- `server/src/avatarProfile.ts`, `playerRegistry.ts`, `match.ts`, `matchManager.ts`, `botAI.ts`, `index.ts`
- `client/src/remotePlayers.ts`, `inventoryOverlay.ts`, `main.ts`, `client/index.html`
- `scripts/regression-avatar-colors.ts`, `package.json` (`regression:avatar-colors`)

## How to verify (steps for Trusya)

1. Start Redis + `npm run dev`. Join vs Bots with nickname A; open inventory (I) → Appearance; set distinct colors per part.
2. Second client (nickname B) joins same public match (or observe A from B’s view): A’s remote avatar must show the chosen colors; B changing colors must not recolor A.
3. Disconnect/reconnect as A: colors persist. Check server log `[avatar] <nick> set <part>=<index>`.
4. vs Bots: bots show varied colors; server log includes `colors=h#/t#/a#/l#` on spawn.
5. Send illegal payload (e.g. `paletteIndex: 99` or `part: "face"`) — ignored, no crash; spawn-protection opacity still works on colored avatars.

## Build and run

- Build command: `npm run typecheck` && `npm run build`
- Run command: `npm run regression:avatar-colors` (also spawn-protection / epic31 / playerstate-equipped-weapon PASS locally)
- Expected smoke result: typecheck/build clean; `[avatar-colors] PASS`

## Configuration

- New environment variables: no (reuses `CUBEWARS_REDIS_URL` / same Redis prefix as economy)
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[avatar] redis ready: …`, `[avatar] <nickname> set <part>=<index> (match=…)`, `[bots] … colors=h#/t#/a#/l#`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: `part` ∈ head|torso|hands|legs; `paletteIndex` in palette range; persist + `PlayerRecord.avatarColors`; broadcast only server copy
- What the client is allowed to predict/render only: send `avatar_set_color` intent; render remote materials from `world_state` (optimistic UI highlight only)

## Risks / known limitations

- Local player still has no third-person self avatar (first-person only) — Appearance UI + other clients see the result; viewmodel out of scope.
- Second Redis TCP connection for avatar store (same URL/prefix as economy); keys never share economy documents.
- Bot color choice: **independent random index per body part** (stated Programmer choice).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
