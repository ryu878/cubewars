# EPIC 45: Dual Lobby Inventories + Lobby Deathmatch Auction

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User ask (RU, 2026-08-25), intent:

1. On the **main/lobby screen**, expose **two inventories** — **Deathmatch** and **Bots/Sandbox** — because they are separate economy pools (EPIC 35). Both must be reachable **without joining a match**.
2. Also show an **Auction** button for the **Deathmatch** pool on the lobby, so players can buy/sell **without entering a match**.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Dual Lobby Inventories + Lobby Deathmatch Auction |
| **System goal** | Authenticated lobby players can open the **Deathmatch** inventory, the **Sandbox (Bots)** inventory, and the **Deathmatch Auction** from mode-select — without joining a match — using the existing `InventoryOverlay` / `AuctionPanel` UIs and server-authoritative economy messages. |
| **Business/gameplay problem** | EPIC 42 added a single lobby Inventory button that always loads the Deathmatch pool. Sandbox (bots/endless) inventory is unreachable pre-match. Auction (EPIC 38) already works once `nicknameReady`, but there is no lobby Auction button; players must join (or open inventory and use in-overlay Auction…) to buy/sell. |
| **Architectural role** | **Client** lobby UI (HTML/CSS/TS) + reuse overlays; **server** lobby bind with pool selection + lobby inventory mutations scoped to bound pool + auction ops from lobby for Deathmatch; **shared** protocol extend `lobby_bind_nickname` (or equivalent) with pool. |
| **Main components** | `client/index.html`, `client/src/modeSelect.ts`, `client/src/main.ts`, `client/src/inventoryOverlay.ts`, `client/src/auctionPanel.ts`, `server/src/index.ts`, `shared/src/index.ts`, regression + Playwright, `README.md` Current status |
| **Stack** | Fixed project stack. No new UI framework / dependency. |
| **Interaction** | Builds on EPIC 35 (split pools), EPIC 38 (auction Deathmatch-only), EPIC 42 (lobby_bind_nickname + Deathmatch lobby inventory). |

## 2. Current state (verified in code — do not invent)

- Lobby has one `#lobbyInventoryBtn` ("Inventory") → `lobby_bind_nickname` → server always pushes **`deathmatch`** profile; lobby inventory mutations always use `"deathmatch"` (`server/src/index.ts`).
- `LobbyBindNicknameMessage` has only `{ nickname }` — no pool field (`shared/src/index.ts`).
- Auction handlers already run when `nicknameReady` (including after lobby bind) and always mutate Deathmatch; **no** dedicated lobby Auction button. In-overlay "Auction…" only appears when `economyPool === "deathmatch"`.
- Auction panel listing form refuses non-Deathmatch profile with copy that still mentions "after joining Deathmatch once".
- Drop / trade / ground stay match-only (`match_required`) — keep that.
- I/P hotkeys remain ignored on lobby (`shouldIgnoreGameHotkey`) — keep that.
- Pool bleed is a hard security/product bug (EPIC 35).

## 3. Design

### 3.1 Story A — Dual lobby inventory buttons (client)

1. Replace the single **Inventory** button with **two** clearly labeled buttons visible on the main lobby / mode-select card (first viewport of the lobby panel), e.g.:
   - **Deathmatch Inventory**
   - **Bots Inventory** (or **Sandbox Inventory** — Programmer picks one English label; must make "vs Bots / Endless pool" obvious; prefer **Bots Inventory**)
2. Both open the **same** existing `#inventoryOverlay` via `setOpen(true)` — **do not** duplicate the inventory UI.
3. Each click: validate auth + nickname (same UX as EPIC 42), then send bind with the correct pool, set a clear loading status (e.g. "Loading Deathmatch inventory…" / "Loading Bots inventory…"), open overlay.
4. Overlay badge / `economyPool` from server profile must match the button that was pressed.
5. Do **not** enable I/P hotkeys on the lobby.

### 3.2 Story B — Server: lobby bind + mutations per pool

1. Extend `lobby_bind_nickname` (preferred) with optional or required `economyPool: "deathmatch" | "sandbox"` (name may be `pool` if shorter — document in shared). Invalid pool → reject with clear `economy_action_result`.
   - Default if omitted: `"deathmatch"` for backward compatibility with any old client.
2. On success: set `nickname` / `nicknameKey` / `nicknameReady`; stay in `lobbySockets`; remember **`lobbyEconomyPool`** (or equivalent) on the connection for subsequent lobby inventory mutations.
3. Push `economy_profile` for the **requested** pool only.
4. Lobby inventory-family mutations (`applyInventoryEconomyAction` path): use the connection's bound lobby pool — **never** cross pools. Re-bind (or explicit pool on each bind) switches the active lobby pool.
5. Drop / trade / ground: still `match_required` from lobby.
6. Logging: include pool in success/reject logs (`[lobby/deathmatch]` / `[lobby/sandbox]`).

### 3.3 Story C — Lobby Auction button (Deathmatch only)

#### Client

1. Add a visible **Auction** button on the lobby / mode-select panel (near the inventory buttons).
2. On click (auth + valid nickname): bind **Deathmatch** pool (same bind message), open existing `AuctionPanel` (`setOpen(true)` / `cubewars-open-auction`), which already sends `economy_auction_browse`.
3. Reuse `#auctionPanel` / `AuctionPanel` — do not duplicate.
4. Update auction listing UX copy that still implies "join Deathmatch once" so lobby Deathmatch bind is enough.
5. In-match U hotkey / in-inventory Auction… behavior unchanged.

#### Server

1. Auction list/bid/buyout/browse already allowed when `nicknameReady` — confirm they work after lobby bind **without** `join`. Fix any remaining gate that requires `match` / `joined` for auction.
2. Auction **always** Deathmatch pool only — never sandbox. If lobby was last bound to sandbox, auction ops still mutate Deathmatch; after auction profile push, use existing `pushDeathmatchProfileIfSafe` (lobby `!match` already allows Deathmatch push). Do not push sandbox after auction.
3. Optional hardening: if useful, ensure lobby auction after sandbox bind still refreshes Deathmatch profile for the auction listing form (already the intent of `pushDeathmatchProfileIfSafe`).

### 3.4 Out of scope

- Re-keying economy to `accountId`
- Enabling I/P or U hotkeys on lobby for inventory/auction (buttons only on lobby)
- Trade / ground / drop from lobby
- Redesigning inventory grid or auction house UI
- Sandbox auction (forbidden)

## 4. Architecture

```text
Lobby (authenticated, modeSelect visible)
  → [Deathmatch Inventory] → lobby_bind_nickname { nickname, economyPool: "deathmatch" }
       → InventoryOverlay + deathmatch profile / mutations
  → [Bots Inventory]       → lobby_bind_nickname { nickname, economyPool: "sandbox" }
       → InventoryOverlay + sandbox profile / mutations
  → [Auction]              → lobby_bind_nickname { nickname, economyPool: "deathmatch" }
       → AuctionPanel + economy_auction_* (Deathmatch only)

Server
  → normalize nickname; nicknameReady; lobbyEconomyPool = requested
  → push economy_profile(pool)
  → lobby inventory_* → applyInventoryEconomyAction(..., lobbyEconomyPool)
  → auction_* → deathmatch only (existing AuctionHouse)
  → drop/trade/ground → match_required
```

## 5. Stories / Tasks

### Story 45.1 — As a player I want two lobby inventory buttons for Deathmatch and Bots pools

| # | Task | Place |
|---|------|-------|
| 45.1.1 | Replace single Inventory button with Deathmatch Inventory + Bots Inventory; wire callbacks with pool | `client/index.html`, `modeSelect.ts`, `main.ts` |
| 45.1.2 | Open shared InventoryOverlay; loading status + badge match pool | `inventoryOverlay.ts` / `main.ts` |

### Story 45.2 — As the server I bind lobby nickname to a chosen economy pool and mutate only that pool

| # | Task | Place |
|---|------|-------|
| 45.2.1 | Extend `LobbyBindNicknameMessage` with pool; validate | `shared/src/index.ts` |
| 45.2.2 | Bind + push requested profile; track lobbyEconomyPool; lobby mutations use it | `server/src/index.ts` |

### Story 45.3 — As a player I want an Auction button on the lobby for Deathmatch buy/sell

| # | Task | Place |
|---|------|-------|
| 45.3.1 | Add lobby Auction button; bind Deathmatch + open AuctionPanel | `client/index.html`, `modeSelect.ts`, `main.ts` |
| 45.3.2 | Confirm/fix server auction path for pre-join `nicknameReady`; update misleading client copy | `server/src/index.ts`, `auctionPanel.ts` |

### Story 45.4 — Docs / regression / QA evidence

| # | Task | Place |
|---|------|-------|
| 45.4.1 | Extend or add regression: dual-pool bind, no cross-pool mutate, lobby auction without join | `scripts/`, `package.json` |
| 45.4.2 | README Current status EPIC 45 | `README.md` |

## 6. Acceptance criteria

- [ ] Lobby shows **two** inventory entry points (Deathmatch + Bots/Sandbox) **and** an **Auction** button, all visible on the main lobby screen without joining a match.
- [ ] Opening Deathmatch Inventory loads/shows Deathmatch pool; badge matches; mutations affect Deathmatch only.
- [ ] Opening Bots Inventory loads/shows Sandbox pool; badge matches; mutations affect Sandbox only.
- [ ] Lobby Auction opens auction UI; list/browse/bid/buyout work with auth + valid nickname bind, **without** `join`.
- [ ] Auction never touches Sandbox pool.
- [ ] No pool bleed between Deathmatch and Sandbox.
- [ ] Drop/trade/ground from lobby still rejected (`match_required`).
- [ ] I/P hotkeys still ignored on lobby.
- [ ] Security baseline: server-authoritative economy; no client-trusted pool for mutations beyond the server-tracked lobby bind.
- [ ] `npm run typecheck`, `npm run build`, and lobby dual-inventory/auction regression PASS.
- [ ] Playwright evidence for lobby dual buttons + auction open (Tester).

## 7. Risks

| Risk | Mitigation |
|------|------------|
| Pool bleed via stale lobbyEconomyPool | Re-bind on every lobby button click; server uses last successful bind pool only for inventory; auction always Deathmatch |
| Auction profile push clobbers open Sandbox inventory | Acceptable: Auction is Deathmatch-only; opening Auction implies Deathmatch context; optional status note |
| Old clients omit pool | Default `deathmatch` |
| UX confusion on labels | Prefer clear **Deathmatch Inventory** / **Bots Inventory** / **Auction** |

## 8. Branch / delivery

- Branch: `feature/epic-45-dual-lobby-inventory-auction` (from current `master`)
- One PR into `master`
- Chain: Programmer → Tester → Critic → (Judge if REVISE) → Team Lead merge + push + production deploy

## 9. Sign-off

- **Specification (author):** Tusya (Team Lead) — 2026-08-25
- **Approval (Team Lead):** Tusya — approved for implementation
- **Assignee:** Pusya (Programmer)
