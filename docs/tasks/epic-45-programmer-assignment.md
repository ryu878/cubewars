# EPIC 45 — Programmer assignment (Team Lead → Pusya)

Implement `docs/tasks/epic-45-dual-lobby-inventory-auction.md` in full.

## Branch

- Create from current `master`: `feature/epic-45-dual-lobby-inventory-auction`
- Do **not** commit unrelated dirty files on master (deploy scripts, other EPICs, ai-office edits). Only EPIC 45 work + the filed spec under `docs/tasks/`.

## Must deliver

1. Dual lobby buttons: **Deathmatch Inventory** + **Bots Inventory** (reuse `InventoryOverlay`).
2. Extend `lobby_bind_nickname` with `economyPool: "deathmatch" | "sandbox"` (default deathmatch); server tracks lobby pool; mutations scoped to that pool only.
3. Lobby **Auction** button: bind Deathmatch + open existing `AuctionPanel`; auction ops without join; never sandbox.
4. Drop/trade/ground stay `match_required`; no I/P on lobby.
5. Regression(s) + README Current status.
6. Handoff to Tester per `ai-office/templates/programmer-handoff-template.md` → write `docs/tasks/epic-45-programmer-handoff.md`.
7. Open PR into `master` when ready for QA.

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/global-standards.mdc`, `english-only.mdc`, `security-baseline.mdc`
- EPIC 42/38 patterns in `server/src/index.ts`, `client/src/modeSelect.ts`, `client/src/main.ts`

## Out of scope

Sandbox auction; lobby trade/drop/ground; redesign overlay UIs; accountId re-key.
