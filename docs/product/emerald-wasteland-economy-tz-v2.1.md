# Emerald Wasteland — Economy & Pets TZ (v2.1 revised)

**Project:** cubewars  
**Lore overlay:** Emerald Wasteland (Изумрудная Пустошь)  
**Date:** 2026-08-24  
**Status:** Revised by Team Lead (Tusya) from user TZ v2.0  
**Base game:** existing 3D browser multiplayer shooter (Three.js + Node `ws` server)

This document is the **product source of truth** for the pets / inventory / economy feature line. Implementation is sliced into EPICs under `docs/tasks/`. Numeric knobs live in `shared/` config (not hardcoded magic numbers in handlers).

---

## 0. Revisions vs user TZ v2.0 (mandatory)

| Topic | v2.0 | v2.1 decision |
|-------|------|----------------|
| Stack | Generic shooter | Fixed cubewars stack only (`ai-office/global/global-standards.mdc`) |
| Persistence | Implied DB | **SQLite** via `better-sqlite3` (new dep — approved for this feature line) |
| Player identity | `Player.id` accounts | **Nickname key** (existing lobby nicknames) until a real auth EPIC; profile keyed by `normalizeNickname().key` |
| Match HP / armor | Four abstract stats only | Compose with EPIC 7: see §2.1 |
| Crypto OBS / blockchain | Optional in core TZ | **Out of scope** for EPICs 23–29; separate optional EPIC later with legal + Infosec gate |
| Selling gold for real money | Monetization note | **Out of scope** (policy/legal); not implemented |
| Drop victims | Ambiguous | Economy item drops only from **human** kills; bots grant **gold only** (configurable) |
| Stimulator | Wording ambiguous when remaining &lt; 1h | `hatch_deadline = min(hatch_deadline, now + 1h)` — never extends past ready |
| Auction “seller limit” rule | Contradictory | Seller may list owned items; **buyer** inventory/limit check at settle; fail → cancel, refund bid |
| Inventory UI framework | Implied rich UI | Plain HTML/CSS + TypeScript (no React) unless user later approves a UI framework |
| Delivery process | Sprints only | Office chain: Team Lead → Programmer → Tester → Critic → (Judge) per task |

---

## 1. Lore (unchanged intent)

Players enter the post-experiment dimension **Emerald Wasteland**. Symbiotic **Pets** boost the host. Kill rewards feed an open **gold** market (auction + P2P). Goal: survive, breed strong pets, gather amulets/gems, lead the wasteland.

---

## 2. Core mechanics

### 2.1 Player profile stats (persistent) vs match combat (session)

**Persistent profile ratings** (from equipped pets + gems):

| Rating | Effect in match |
|--------|-----------------|
| Health | Adds to `COMBAT.maxHealth` for that life (respawn to new max) |
| Armor | Flat **% damage reduction** applied to incoming damage **before** EPIC 7 absorptive armor pool |
| Speed | Multiplier on movement speed (server-authoritative clamp still applies) |
| Damage | Multiplier on weapon damage dealt |

**Session match state** (unchanged EPIC 7):

- Absorptive armor pool 0–100 from map pickups, resets on death.
- Current HP 0–maxHealth for this life.

Profile ratings recalculate on equip/unequip and are pushed to the client for HUD/profile UI. Server is source of truth.

### 2.2 Pets

| Type | Rating boosted |
|------|----------------|
| dog | Armor |
| cat | Health |
| bird | Speed |
| lion | Damage |

- `base_value`: integer 1–200 (bonus magnitude; exact mapping formula in `shared` config, e.g. linear scale).
- Obtained **only** by hatching eggs (never as direct kill drop).
- Equip: **1** active slot by default; **2nd slot** if an amulet is equipped — 2nd pet contributes **40%** of its total rating (base + gems).
- Inventory cap: **8** pets (equipped count toward the cap).

### 2.3 Eggs & incubation

- Drop chance **15%** on eligible human kill if killer has &lt; 3 eggs and &lt; 8 pets.
- Incubation: **24h** real time from acquire (`hatch_deadline`).
- UI: countdown + progress; notify when ready; explicit “open” action.
- Hatch: random type + `base_value` 1–200; blocked if pet cap reached.
- Stimulator: sets `hatch_deadline = min(hatch_deadline, now + 1 hour)`.

### 2.4 Growth stimulator

- Drop **8%** on eligible kill.
- One inventory cell; consumed on use; tradable.

### 2.5 Gems

- Types: health / armor / speed / damage; value **5–100** at creation.
- Per pet: **4 slots**, one per type (no duplicate type on same pet).
- Drop **20%** if killer gem count &lt; 20: copy a **random gem from victim’s active pet(s)**; if none equipped, no gem this roll.
- Insert/remove free; remove requires free inventory capacity under gem cap **20**.

### 2.6 Amulets

- Enable pet slot 2 (40% contribution).
- Durability **10**; on owner death: durability −1; all **active** pets lose **10%** of current effectiveness (base+gems, floored, min 1 while equipped values remain &gt; 0 — exact floor in config).
- Durability 0 → amulet destroyed; slot 2 unequips if it was the enabling amulet.
- Craft: **10 shards → 1** full-durability amulet.
- Drop: **2%** when victim had an amulet; transfers **current** durability; only if killer amulet count &lt; 4.
- Cap: **4** amulets.

### 2.7 Shards

- On killing a human who has an amulet: **+1 shard** if killer amulet count &lt; 4 and killer has not already taken a shard from that victim **in this match**.
- Stack max **10** in one logical stack / inventory rules.
- Tradable; craft as above.

### 2.8 Repair kits

- Drop **10%**; restore **+1** amulet durability (cap 10); tradable.

### 2.9 Inventory

- Grid **8×8 = 64** cells.
- Footprint: gems/shards/eggs/stimulators/repair kits = **1**; pets/amulets = **2** (contiguous).
- Caps (equipped + bag): pets 8, amulets 4, eggs 3, gems 20, shards 10.
- Overflow: item not granted; for kill drops substitute **gold** (same roll band) when a rolled item cannot fit; auction/trade reject if buyer would exceed.
- Discard: destroy forever, or drop to map for **60s** pickup.

### 2.10 Kill drop table (authoritative)

| Item | Chance | Extra conditions |
|------|--------|------------------|
| Gold | 100% | 1–500 |
| Egg | 15% | &lt;3 eggs and &lt;8 pets |
| Gem | 20% | &lt;20 gems and victim has ≥1 gem on active pet |
| Shard | 100% if victim has amulet | killer amulets &lt; 4; once per victim per match |
| Amulet | 2% if victim has amulet | killer amulets &lt; 4; durability = victim’s |
| Repair kit | 10% | — |
| Growth stimulator | 8% | — |

Gold always; other rolls independent. Failed condition → that item skipped (gold still granted).

**Bot kills:** gold only (default); configurable later.

---

## 3. Economy

### 3.1 Gold

- Primary currency; kill drop 1–500; auction buy/sell; P2P transfer.
- Auction fee **10%** of closing price: **5% burned**, **5%** to developer ledger account (in-DB balance, not a player).

### 3.2 Auction

- List pets, gems, amulets, eggs, shards, repair kits, stimulators for gold.
- Start price + optional buyout; bidding window **24h**.
- Settle: item → winner, gold → seller minus fee; buyer limit failure → cancel + refund.

### 3.3 P2P trade

- Same-match trade window; both confirm; **no fee**.
- Ground drops: 60s TTL.

### 3.4 OBS crypto (deferred)

Not in current delivery. Future optional EPIC only after explicit user sign-off + Infosec review. No TRC-20/BEP-20 work in EPICs 23–29.

### 3.5 Monetization (deferred)

No real-money gold sales in-repo. Auction developer cut is in-game gold ledger only.

---

## 4. Technical requirements (cubewars)

### 4.1 Persistence

- SQLite file path via env (`CUBEWARS_ECONOMY_DB`, default under server data dir).
- Tables mirror entities: Profile, Pet, Gem, Egg, Amulet, ShardStack, InventorySlot, AuctionLot, RepairKit, GrowthStimulator, EconomyLedger, MatchShardGrant.
- All mutations server-side inside transactions.

### 4.2 Authority

- Client never invents drops, hatches, crafts, bids, or equip bonuses.
- Validate every inventory/economy WebSocket (or HTTP) action: ownership, caps, timers, rates.

### 4.3 Config

- All chances, caps, durations, fee % in `shared/src/economy.ts` (or equivalent) imported by server.

### 4.4 Telemetry

- Structured logs: gold minted (kills), auction volume, burns, crafts, hatches — for balance review.

### 4.5 UI

- Header: gold (+ OBS placeholder hidden until crypto EPIC).
- Inventory grid, incubation affordances, equip panel, auction, trade — plain HTML/CSS/TS.

---

## 5. Delivery roadmap (EPICs)

| EPIC | Focus | Est. |
|------|-------|------|
| **23** | Persistence foundation, profile, gold on kill, economy config | Sprint 1 start |
| **24** | Pets, eggs, incubation, stimulators, equip + stat application | Sprint 1 |
| **25** | Gems, amulets, shards, repair, death penalties, craft | Sprint 1 end |
| **26** | Full kill drop table + limit/overflow gold substitute | Sprint 1–2 |
| **27** | Inventory / equip / incubation UI | Sprint 2 |
| **28** | Auction, P2P trade, ground item drops | Sprint 3 |
| **29** | Balance pass, stimulator polish, economy simulation scripts | Sprint 4 |
| **30** | Optional OBS / chain (blocked until sign-off) | Sprint 5 optional |
| **31** | Polish, load test economy paths, player guide | Sprint 6 |

One Task → one branch → one PR (office policy).

---

## 6. Acceptance criteria (program complete = EPICs 23–29)

Same checklist as user §6, minus OBS until EPIC 30. Plus:

- [ ] Server-authoritative; regression scripts for drop, hatch, fees, caps.
- [ ] Stable with existing multiplayer/endless modes (economy does not break match tick).
- [ ] Config-driven numbers; no secrets in git.

---

## 7. Sign-off

- **Revised by:** Team Lead (Tusya), 2026-08-24  
- **User request:** implement pets/economy TZ; revise as needed; start work  
- **Stack addition approved by intake:** SQLite (`better-sqlite3`) for persistence  
- **Explicitly deferred:** OBS blockchain, real-money gold sales
