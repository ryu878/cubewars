# EPIC 42: Lobby Telegram Label + Pre-Match Inventory

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User ask (RU, 2026-08-25):

1. Change lobby Telegram link label to **`Game Developers Telegram Chat - t.me/cubewarsgame`** (URL stays `https://t.me/cubewarsgame`).
2. Add an **Inventory** button on the main/lobby screen so players can manage pets/items **before** joining a match (today inventory is only reachable in-match via I/P, and players keep dying before they can use it).

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Lobby Telegram Label + Pre-Match Inventory |
| **System goal** | (A) Correct community/developer Telegram copy on the lobby. (B) Let authenticated players open the **same** inventory overlay from the lobby and load/mutate the **Deathmatch** economy profile via existing server-authoritative `economy_*` messages — without joining a match first. |
| **Business/gameplay problem** | Inventory/pets are only reachable in-match (I/P). Players die before they can manage loadout. Telegram lobby label is outdated wording. |
| **Architectural role** | **Client** lobby UI (HTML/CSS/TS) + reuse `InventoryOverlay`; **server** pre-join nickname bind + Deathmatch-pool economy read/mutate path; **shared** protocol only if a new bind/request message is needed. |
| **Main components** | `client/index.html`, `client/src/modeSelect.ts`, `client/src/inventoryOverlay.ts`, `client/src/main.ts`, `client/src/uiInput.ts` (keep lobby hotkey ignore), `server/src/index.ts`, possibly small helper extracted near auction/economy push, `shared/` if new message type, `README.md` |
| **Stack** | Fixed project stack. No new UI framework / dependency. |
| **Interaction** | Builds on EPIC 23–29 (economy + inventory overlay), EPIC 34 (auth gates mode-select), EPIC 35 (Deathmatch vs Sandbox pools), EPIC 38 (auction already has a partial lobby Deathmatch profile push pattern after `nicknameReady`). |

## 2. Current state (read before implementing)

- Lobby Telegram anchor in `client/index.html`: text `Telegram developers — t.me/cubewarsgame`, `href="https://t.me/cubewarsgame"`.
- Inventory overlay: `client/src/inventoryOverlay.ts` — I/P toggle via keydown; **already** calls `shouldIgnoreGameHotkey`, so I/P do **not** open on lobby (correct — typing "i" in email must not open inventory).
- Empty-profile UX already exists in overlay render: *"Join a match to load your inventory."* — update this copy for lobby-capable flow.
- `nicknameReady` is set only inside the `join` handler (`server/src/index.ts`). Most `economy_*` handlers sit behind `if (!match) { notJoinedDropTracker…; return; }`. Auction handlers are **before** that gate and work when `nicknameReady` — but true pre-join lobby never sets `nicknameReady` today.
- Economy is keyed by **nickname** (not `accountId` yet). Auth (EPIC 34) gates mode-select; nickname remains separate.
- Lobby gold (`#lobbyGoldValue`) only updates when an `economy_profile` / `economy_gold_update` arrives — typically after match join today.

## 3. Design

### 3.1 Story A — Telegram label (client copy only)

Change visible lobby link text to exactly:

`Game Developers Telegram Chat - t.me/cubewarsgame`

Keep `href="https://t.me/cubewarsgame"`, `target="_blank"`, `rel="noopener noreferrer"`.

### 3.2 Story B — Lobby Inventory button + wiring

#### Client

1. Add a visible **Inventory** button on the mode-select / lobby panel (near gold / mode buttons — Programmer picks a clean placement; must be obvious on first viewport of the lobby card).
2. Button opens the **existing** `InventoryOverlay` via explicit `setOpen(true)` (or a small public `open()` alias) — **do not** duplicate the UI.
3. **Do not** enable I/P hotkeys on the lobby. `uiInput.shouldIgnoreGameHotkey` / overlay keydown gate stays as-is so lobby typing is safe.
4. UX when profile cannot load:
   - If not authenticated / mode-select still disabled: button disabled or click shows a clear message (e.g. sign in first).
   - If nickname empty/invalid: do **not** crash; show clear status in overlay and/or `#modeSelectError` (e.g. "Enter a valid nickname to load inventory").
   - If profile missing after open: overlay shows a clear waiting/error message (update the old "join a match to load" string).
5. On successful lobby open: request Deathmatch profile from server (see 3.3); `setProfile` path unchanged.
6. In-match I/P behavior unchanged.

#### Server / protocol (authoritative — mandatory for mutations)

Players must manage pets/items **before** join. That requires a pre-match path:

1. **Bind nickname in lobby** without joining a match. Suggested approach (Programmer may choose equivalent shape):
   - New client→server message e.g. `lobby_bind_nickname` `{ nickname: string }`, **or** `economy_request_profile` `{ nickname: string }` that also binds.
   - Server: `normalizeNickname`; on failure send a clear reject / `economy_action_result` / dedicated result — no crash.
   - On success: set connection `nickname` / `nicknameKey` / `nicknameReady = true`; keep socket in `lobbySockets` (do **not** create/join a match).
   - Push `economy_profile` for **`deathmatch`** pool only (lobby has no match mode; Sandbox pool is in-match bots/endless only). Mirror the auction `pushDeathmatchProfileIfSafe` mapping.
2. **Inventory mutations from lobby** when `nicknameReady && !match`:
   - Allow the same bag/equip/hatch/craft/repair/move/discard/set_pet_color/socket/… intents that today go through `match.handleEconomyAction`, but execute against `economyStore` with scope **`deathmatch`**, then push updated `economy_profile` (+ `economy_action_result` as today).
   - Prefer extracting a small shared helper used by match + lobby rather than copy-pasting the whole switch — keep server-authoritative validation.
3. **Stay match-only** (reject / no-op with clear result if attempted from lobby):
   - `economy_drop_item`, `economy_pickup_ground`, all `economy_trade_*`
   - Anything that needs world position or a second player in-match
4. **Avatar color** from inventory appearance rail: if easy to route through existing avatar Redis by `nicknameKey` without a match, allow it; otherwise leave appearance match-gated and document in handoff — **pets/items are the required AC**.
5. After bind, lobby gold readout should update from the pushed profile (existing `modeSelect.setGold` path).

#### Pool rule

| Context | Economy pool |
|---------|----------------|
| Lobby (pre-match) | **Deathmatch** only |
| In `public` match | Deathmatch (unchanged) |
| In `bots` / `endless` | Sandbox (unchanged) |

Never let lobby actions touch Sandbox. Never invent client-only inventory state.

### 3.3 Out of scope

- Re-keying economy to `accountId`
- Sandbox inventory from lobby
- Enabling I/P hotkeys on lobby
- Redesigning inventory grid UI
- Changing Telegram URL
- Trade / ground / auction feature work beyond what’s needed to not regress them

## 4. Architecture

```text
Lobby (authenticated, modeSelect visible)
  → [A] Telegram <a> label copy update
  → [B] Inventory button click
       → validate nickname locally (UX)
       → send lobby_bind_nickname / economy_request_profile
       → InventoryOverlay.setOpen(true)

Server
  → normalize nickname; set nicknameReady; stay in lobbySockets
  → economyStore.getFullProfile(nickname, "deathmatch") → economy_profile
  → on economy_* (inventory family) with !match && nicknameReady:
       mutate deathmatch pool → economy_action_result + economy_profile
  → drop/trade/ground: still require match

In-match
  → I/P + existing match.handleEconomyAction unchanged
```

## 5. Stories / Tasks

### Story 42.1 — As a player I want the lobby Telegram link to say Game Developers Telegram Chat

| # | Task | Place |
|---|------|-------|
| 42.1.1 | Update lobby Telegram anchor visible text; keep href | `client/index.html` |

### Story 42.2 — As a player I want an Inventory button on the lobby so I can manage Deathmatch pets/items before joining

| # | Task | Place |
|---|------|-------|
| 42.2.1 | Add Inventory button to lobby HTML + minimal CSS consistent with mode-select | `client/index.html` |
| 42.2.2 | Wire button → open existing `InventoryOverlay`; gate on auth/nickname UX; request profile | `client/src/modeSelect.ts`, `client/src/main.ts`, `client/src/inventoryOverlay.ts` |
| 42.2.3 | Keep I/P ignored on lobby (`uiInput` / overlay keydown) — no regression | `client/src/uiInput.ts`, overlay |
| 42.2.4 | Protocol: lobby nickname bind + Deathmatch profile request (new message if needed) | `shared/`, `server/src/index.ts` |
| 42.2.5 | Server: allow inventory-family `economy_*` when `nicknameReady && !match` on deathmatch pool; push profile; reject match-only actions | `server/src/index.ts` (+ extract helper from `match.ts` if needed) |
| 42.2.6 | Clear empty/missing-profile messaging in overlay | `client/src/inventoryOverlay.ts` |
| 42.2.7 | README Current status note for EPIC 42 | `README.md` |
| 42.2.8 | Optional but preferred: small regression or Playwright smoke for lobby bind → profile + button opens overlay | `scripts/` or `qa-artifacts/` |

**Branch:** `task/epic-42-lobby-telegram-inventory`  
**Base:** `master` (tip at task start: `ef60f46`)

## 6. Acceptance criteria

- [ ] Lobby Telegram visible text is exactly (or clearly matches) `Game Developers Telegram Chat - t.me/cubewarsgame`; href remains `https://t.me/cubewarsgame`
- [ ] Main/lobby screen has an **Inventory** button that opens the **same** inventory overlay (`#inventoryOverlay`)
- [ ] With auth + valid nickname, lobby open loads server `economy_profile` for **Deathmatch** pool; equip/move/etc. still server-authoritative (no client-only bag)
- [ ] Missing nickname / missing profile: no crash; clear player-facing message
- [ ] In-match **I** / **P** still toggle inventory; lobby typing does **not** open inventory via hotkeys
- [ ] Lobby actions never mutate Sandbox pool; drop/trade/ground remain match-only
- [ ] `npm run typecheck` / `npm run build` PASS
- [ ] README Current status updated for EPIC 42

## 7. Risks

- Opening a second inventory UI by mistake — **reuse** `InventoryOverlay`.
- Enabling I/P on lobby and breaking email/nickname typing — keep `shouldIgnoreGameHotkey`.
- Routing lobby mutations through Sandbox or requiring a fake match — forbidden; use Deathmatch + `!match` path.
- Nickname bind without normalize / collision rules — reuse `normalizeNickname`; same trust model as join (economy still nickname-keyed).
- Forgetting to push `economy_profile` after lobby mutate — client would look stale.

## 8. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25
- **Assignee:** Programmer (Pusya)
