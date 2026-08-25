# EPIC 38: Auction, P2P Trade & Ground Item Drops

Spec format per `ai-office/task-intake.md`.  
Product TZ: `docs/product/emerald-wasteland-economy-tz-v2.1.md` §2.9 discard-to-map, §3.2–3.3.  
Depends on: `master` after EPIC 34 (economy inventory + Redis scopes from EPIC 35).

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Auction, P2P Trade & Ground Item Drops |
| **System goal** | Let players trade economy items for gold via a server-authoritative auction, same-match P2P trades (no fee), and temporary ground drops (60s) pickable by others. |
| **Business/gameplay problem** | Inventory exists but has no player-to-player market; discard only destroys items. |
| **Architectural role** | shared protocol + server Redis economy + match ground entities + client UI |
| **Stack** | Fixed stack + existing Redis; no new DB tech |
| **Scope note** | All auction/trade gold and items operate on the **Deathmatch** pool only (`scope: "deathmatch"`). Sandbox pool is excluded from auction/trade/ground (test economy must not enter the market). |

## 2. Design

### 2.1 Auction (Deathmatch pool)

- List owned bag items (pets, gems, amulets, eggs, shards stack qty, repair kits, stimulators) with `startPrice` and optional `buyoutPrice`.
- Bidding window: `AUCTION_FEE` / TZ 24h (`INCUBATION`-style constant `AUCTION_DURATION_MS` in shared).
- On settle: winner gets item (must pass buyer caps/footprint); seller gets gold minus **10%** fee (**5% burn**, **5%** developer ledger in Redis); fail buyer fit → cancel + refund bids.
- Buyout: immediate settle at buyout price if set.
- Server cron/tick: expire lots and settle highest bid ≥ start (or return item if no valid bid).

### 2.2 P2P trade (same match only)

- Two humans in same match open trade; each offers items and/or gold from **Deathmatch** pool; both confirm; atomic swap; **no fee**.
- Cancel if either leaves match / disconnects / inventory would violate caps.

### 2.3 Ground drops

- `economy_drop_item` places item at player position in match; TTL **60s** (`GROUND_DROP_TTL_MS`); other humans can `economy_pickup_ground` if caps allow; owner can pick up too.
- Broadcast ground item list to match; remove on pickup/expire (expire = destroy, same as discard).

### 2.4 Client

- Auction panel from lobby or inventory (Deathmatch only).
- Trade window in-match.
- Ground markers in world or simple HUD list + interact key.

### 2.5 Out of scope

Sandbox auction, OBS, email delivery, accountId economy re-key.

## 3. Tasks

| # | Task | Place |
|---|------|-------|
| 38.1 | Shared auction/trade/ground constants + protocol | `shared/` |
| 38.2 | Redis auction lots + developer gold ledger + settle/burn | `server/src/economy/` |
| 38.3 | Match P2P trade + ground drop entities | `server/src/match.ts` etc. |
| 38.4 | Client auction / trade / ground UX | `client/` |
| 38.5 | Regressions: fee burn, isolation deathmatch-only, ground TTL, trade atomicity | `scripts/` |

**Branch:** `task/epic-38-auction-trade-ground`  
**Base:** current `master`

## 4. Acceptance criteria

- [ ] typecheck / build PASS
- [ ] Auction list/bid/buyout/expire with 10% fee (5% burn, 5% ledger)
- [ ] Buyer cap failure cancels settle and refunds
- [ ] P2P trade same-match, both confirm, no fee, atomic
- [ ] Ground drop 60s pickup/expire
- [ ] Sandbox items/gold cannot enter auction/trade
- [ ] Regression scripts PASS

## 5. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25  
- **Assignee:** Programmer (Pusya)
