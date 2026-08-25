# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 42 — Stories 42.1 + 42.2 (Lobby Telegram Label + Pre-Match Inventory) |
| Branch / commit / PR | `task/epic-42-lobby-telegram-inventory` @ `e9d7d72` — push OK; PR create blocked by `gh` auth (logged in as wrong GitHub user). Open/compare: https://github.com/ryu878/cubewars/compare/master...task/epic-42-lobby-telegram-inventory |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Story A:** Lobby Telegram anchor label set to exactly `Game Developers Telegram Chat - t.me/cubewarsgame`; href unchanged (`https://t.me/cubewarsgame`).
2. **Story B:** Lobby **Inventory** button opens the existing `#inventoryOverlay` via `setOpen(true)`. Client sends `lobby_bind_nickname`; server binds nickname without joining a match and pushes Deathmatch `economy_profile`. Inventory-family `economy_*` mutations work from lobby on Deathmatch only; drop/trade/ground reject with `match_required`. I/P hotkeys remain ignored on lobby (`shouldIgnoreGameHotkey` unchanged). Shared helpers: `applyInventoryEconomyAction`, `toEconomyProfileMessage`. README Current status + `npm run regression:lobby-inventory` smoke added.

## Changed files / areas

- `client/index.html` — Telegram label, Inventory button + CSS
- `client/src/modeSelect.ts` — Inventory button UX (auth/nickname gates)
- `client/src/main.ts` — bind + open overlay wiring
- `client/src/inventoryOverlay.ts` — empty-profile copy, `setStatus`, clearer action errors
- `shared/src/index.ts` — `lobby_bind_nickname`, `lobby_bind` action result
- `server/src/index.ts` — lobby bind, lobby inventory path, match-only rejects, lobby avatar persist
- `server/src/economy/inventoryActions.ts`, `profileMessage.ts`, `index.ts` — shared helpers
- `server/src/match.ts` — uses shared inventory/profile helpers
- `scripts/regression-lobby-inventory.ts`, `package.json` — regression smoke
- `README.md`, `docs/tasks/epic-42-lobby-telegram-inventory.md`, this handoff

## How to verify (steps for Trusya)

1. Sign in on the lobby; confirm Telegram footer text is `Game Developers Telegram Chat - t.me/cubewarsgame` and link opens `https://t.me/cubewarsgame`.
2. With a valid nickname, click **Inventory** — `#inventoryOverlay` opens; gold/pets load from Deathmatch pool (lobby gold updates). Equip/move/etc. still round-trip via server (`economy_action_result` + `economy_profile`).
3. Empty/invalid nickname: click Inventory → clear `#modeSelectError` ("Enter a valid nickname…"); no crash. Before sign-in: Inventory disabled / "Sign in first…".
4. On lobby, type in email/nickname fields including letter **i** — inventory must **not** open via hotkey. After joining a match, **I**/**P** still toggle inventory.
5. From lobby (bound nickname), attempt drop/trade if possible via console/tools — expect `match_required` result; Sandbox pool never used from lobby.
6. Optional: `npm run regression:lobby-inventory`.

## Build and run

- Build command: `npm run typecheck` && `npm run build`
- Run command: `npm run dev` (or usual docker/compose flow)
- Expected smoke result: typecheck/build PASS; `npm run regression:lobby-inventory` prints `regression:lobby-inventory OK`

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages: `[lobby] nickname bound for inventory: <nick> (<playerId>)`; `[economy] <action> ok for <nick> [lobby/deathmatch]`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: nickname normalize + bind; Deathmatch `getFullProfile` / inventory mutations via `applyInventoryEconomyAction`; drop/trade/ground rejected without a match
- What the client is allowed to predict/render only: overlay open/close, optimistic appearance swatches; bag state only from `economy_profile`

## Risks / known limitations

- Avatar color from lobby persists to Redis by nicknameKey (allowed); there is no world_state echo until match join — UI uses optimistic local highlight (same as in-match optimistic path).
- Economy remains nickname-keyed (not accountId) — same trust model as join/auction.
- Auction from lobby still requires prior nicknameReady (now achievable via lobby bind without match join).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
