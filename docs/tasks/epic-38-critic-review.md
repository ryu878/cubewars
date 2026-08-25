# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 38 — Auction, P2P Trade & Ground Item Drops (`docs/tasks/epic-38-auction-trade-ground.md`)
- Diff / PR reference: branch `task/epic-38-auction-trade-ground` @ `5e85fe66a1a1438c70de6d0001476c1eaac68f7a` vs `master` (feature `1a2ba9b` + docs tip pins)
- Tester PASS report reference: `docs/tasks/epic-38-tester-report.md` (PASS on same tip SHA; evidence `qa-artifacts/epic-38/`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...task/epic-38-auction-trade-ground` — 22 files / +2712; core: `server/src/economy/auction.ts`, `escrow.ts`, `matchMarket.ts`, `match.ts`, `shared/src/index.ts` |
| Tester PASS report matches this commit | PASS | Tester meta commit `5e85fe66…` = branch tip; regression.log + smoke-summary.json aligned |
| Every acceptance criterion traceable to a change or explicit note | PASS | Shared constants/protocol; auction settle/fee; buyer-cap cancel; trade; ground TTL; sandbox pool gate; `scripts/regression-auction-trade-ground.ts` |
| Scope matches the task (no unexplained extra changes) | PASS | Market + protocol + client UX + regression + README/`config.vars.example` only |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-38/01–15*.png`; move/jump (`03`), auction (`08`/`09`), trade (`10`–`12`), sandbox isolation UI (`14`/`15`) |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Happy-path fee burn and Deathmatch-pool sandbox isolation hold, but escrow is not race-safe — concurrent ground pickup can duplicate items (`match.ts` pickup await gap), and P2P trade / auction settle paths are not truly atomic under mid-failure (item duplication or double-settle gold mint).

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | critical | Fee burn OK (`auction.ts` `splitAuctionFee` + settle log burn/dev/sellerNet); sandbox pool gate OK; **escrow races / non-atomic settle** — F-001–F-003 |
| 2 | Server authority for gameplay-relevant state | PASS | — | Client intents only; `AUCTION_SCOPE="deathmatch"`; `assertDeathmatchMarket()`; extract/insert/debit server-side |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | TS/`ws`/Redis/shared; plain HTML/CSS auction/trade/ground panels |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets; payload type checks in `server/src/index.ts` auction/trade/drop handlers |
| 5 | Error handling | FAIL | critical | Pickup catch after `remove` does not restore entity (`match.ts` 673–686); trade rollback after partial insert duplicates (`matchMarket.ts` 305–348) |
| 6 | Logging / observability | PASS | — | `[auction] settled … burn=… dev=…`, `[trade] atomic swap ok`, `[ground] drop/pickup/expired` |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | FAIL | major | Regression covers buyout fee, buyer-cap, trade success/pre-insert rollback, TTL, sandbox list `not_found`; **no concurrent pickup, concurrent bid, or mid-insert trade failure** |
| 8 | Readability / maintainability | PASS | — | Clear module split auction / escrow / matchMarket |
| 9 | Scope discipline | PASS | — | EPIC 38 surface only |
| 10 | Config / docs updated | PASS | — | `CUBEWARS_AUCTION_MS` in `config.vars.example`; README market notes |
| 11 | No dead code / debug scaffolding | PASS | note | `AUCTION_FEE.totalFraction` unused in `splitAuctionFee` (only burn/dev fractions) — N-001 |
| 12 | Regression risk considered | FAIL | major | Same-match dual pickup / concurrent bids can corrupt economy; prior inventory EPICs assume single-writer happy path |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `03-public-move-jump.png`, `04-public-fire-smoke.png`; trade gold 500→498 = −5+3 no fee (`12-trade-after-confirm.png`) |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Arena + HUD consistent with prior EPICs; overlays functional (AC) |
| 15 | Controls & feel usable | PASS | note | U/T/F/I work in public; bots HUD still advertises U/T/F though inventory hides Drop/Auction — N-002 |
| 16 | Playability sanity (honest fun/usability call) | PASS | note | Market UX is minimal (trade: gold + one item id) but AC-sufficient per handoff |

## Findings (actionable)

### F-001

- Checklist # / Gate: 1, 5, 12
- Severity: critical
- Issue: Ground pickup is not exclusive/atomic across concurrent handlers. `get` → `await assertCanAcceptEscrow` → `remove` → `await insertEscrowItem` yields the event loop while the entity remains in the map. Two humans can both observe the same `groundId`, both insert reminted copies → **duplicate items**. If `insertEscrowItem` throws after `remove`, the catch path does not re-drop the entity → **item destroyed**.
- Required fix (file/behavior): `server/src/match.ts` `handlePickupGround` — claim/remove (or mark in-flight) **synchronously before any await**; only then insert; on insert failure, restore the entity to `groundItems` (or equivalent single-flight lock per `groundId`).
- Suggested check to prove closed: regression with two overlapping `handlePickupGround` calls on one entity (second must fail `not_found`; profiles must show exactly one copy); insert-fail after claim restores ground list.

### F-002

- Checklist # / Gate: 1, 5
- Severity: critical
- Issue: `executeAtomicTrade` is not atomic under mid-transfer failure. After some `insertEscrowItem` calls succeed and a later insert throws, `transferred` is still `false`, so rollback re-inserts **all** `extractedA`/`extractedB` to original owners while the successful inserts already placed copies on the counterparty → **duplicated escrow items**. Also `transferred = true` is set before gold credits; gold-credit failure skips rollback entirely (`matchMarket.ts` 305–350).
- Required fix (file/behavior): `server/src/matchMarket.ts` `executeAtomicTrade` — track which inserts completed and reverse only those; do not set an all-or-nothing flag that leaves partial inserts unrestored; keep gold debit/credit inside the same recoverable unit (or stage all mutations then commit). Prefer a single document-level transactional approach consistent with TZ §4.1 preference for atomic Redis updates.
- Suggested check to prove closed: force failure after first counterparty insert (mock/stub or full-bag race); assert both profiles return to pre-trade item/gold totals with no extras.

### F-003

- Checklist # / Gate: 1, 12
- Severity: critical
- Issue: `AuctionHouse.settleLot` applies winner insert + seller pay + burn/dev ledger + status flip as separate Redis ops with no compensation (`auction.ts` 347–356). If the process fails after `insertEscrowItem` but before `status = "settled"`, a later `tick`/`settleLot` can run again on an still-`active` lot → second insert (duplicate item) and/or second `addGold`/`creditDeveloper` (**gold inflation**). Same class of gap on `bid` (debit → refund previous → `saveLot` without lot lock).
- Required fix (file/behavior): `server/src/economy/auction.ts` — make settle idempotent (e.g. mark lot `settling`/`settled` and clear escrow **before** or in the same atomic write as paying out; or Lua/MULTI that cannot partially apply); protect `bid`/`buyout` with per-lot mutual exclusion so two bidders cannot both debit against stale `highestBid`.
- Suggested check to prove closed: simulate settle interrupted after winner insert (or call `settleLot` twice on same in-memory lot fixture); winner inventory and ledgers must not double; concurrent double-bid must leave exactly one escrowed high bidder and conserved gold.

### F-004

- Checklist # / Gate: 7
- Severity: major
- Issue: `scripts/regression-auction-trade-ground.ts` and live Playwright only exercise single-threaded happy paths and pre-insert trade cap failure. They do not cover the concurrent/partial-failure paths that F-001–F-003 require, so Tester PASS does not bound escrow risk.
- Required fix (file/behavior): Extend `scripts/regression-auction-trade-ground.ts` (and keep `npm run regression:auction-trade-ground` green) with explicit cases for: concurrent ground pickup; trade mid-insert failure rollback; double `settleLot` / concurrent bid conservation.
- Suggested check to prove closed: new `[ok]` lines in regression output for those cases; Tester re-run PASS referencing F-001–F-003.

## Revision task (if REVISE)

- Finding IDs to fix: F-001, F-002, F-003, F-004
- Out of scope for this revision: polished multi-slot trade UI; world ground markers; OBS; changing auction’s intentional Deathmatch-pool-from-any-match design (see Notes)
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- **Fee burn (scrutiny):** Correct on the implemented happy path. `splitAuctionFee` uses `Math.floor(price * 0.05)` twice; buyout 200 → burn=10, dev=10, sellerNet=180 (`auction.ts` 50–54, 348–358; regression + `[auction] settled … burn=10 dev=10`). Escrowed bid is fully accounted (no leftover). Buyer-cap cancel refunds full escrow with no fee. Flooring means odd prices can yield slightly under 10% total fee (remainder stays with seller) — acceptable unless TL wants `totalFraction`-based split; `AUCTION_FEE.totalFraction` is currently unused (N-001).
- **Sandbox cannot enter market (scrutiny):** Pool isolation holds. Auction hardcodes `AUCTION_SCOPE = "deathmatch"`; sandbox gem list → `not_found` in regression; match drop/trade gated by `assertDeathmatchMarket()` (`match.ts` 589–592). Live evidence: sandbox inventory hides Drop/Auction (`14`/`15`); WS `drop_item`/`trade_open` → `not_deathmatch` (`smoke-summary.json`). Auction remains reachable from bots/lobby and mutates **Deathmatch** bag only (smoke `auction_list` ok while in bots; server log `listed lot#3` for deathmatch gem) — matches handoff/spec “Deathmatch pool only,” not “public-match-only auction.”
- **N-002:** Bots HUD still lists `U auction` / `T trade` / `F pickup` while inventory correctly omits Drop/Auction — cosmetic; server rejects match market intents.
- **Gameplay:** Trade confirm evidence shows GOLD 498 after 5/3 swap (no fee). Auction UI states “10% fee on settle (5% burn / 5% developer)” (`08-auction-panel.png`).
