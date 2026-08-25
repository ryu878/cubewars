# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 45 — Dual Lobby Inventories + Lobby Deathmatch Auction
- Diff / PR reference: branch `feature/epic-45-dual-lobby-inventory-auction` @ `b813aacf0bb8fe8217322c32de1c40ca00d18ea8` (feat `8c45e55050ad3d222a0dc368f01198d1974c7af9`); compare `master...HEAD` (11 files, +640/−61)
- Tester PASS report reference: `docs/tasks/epic-45-tester-report.md` (commit match `b813aac…`, Status **PASS**)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` at `b813aac` — shared/server/client/scripts/README/docs |
| Tester PASS report matches this commit | PASS | `docs/tasks/epic-45-tester-report.md` Meta = `b813aacf0bb8fe8217322c32de1c40ca00d18ea8` (includes feat `8c45e55`); Status **PASS** |
| Every acceptance criterion traceable to a change or explicit note | PASS | Dual buttons + Auction `client/index.html` / `modeSelect.ts` / `main.ts`; `LobbyBindNicknameMessage.economyPool?` `shared/src/index.ts`; `lobbyEconomyPool` + pool-scoped lobby mutations `server/src/index.ts`; auction copy `auctionPanel.ts`; regression dual-pool + auction browse `scripts/regression-lobby-inventory.ts`; README Current status EPIC 45 |
| Scope matches the task (no unexplained extra changes) | PASS | Spec-aligned lobby dual-pool + auction; regression teardown hardening only; no unrelated features |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-45/01`–`07` + `smoke-summary.json` (`ok: true`); dual buttons, pool badges, Auction (Deathmatch) lots/Bid/Buyout UI, hotkeys ignored, in-match move smoke |

- Gate overall: PASS → continue checklist

## Verdict

- `REVISE`
- One-line rationale: Happy-path dual inventory + lobby Auction land correctly (screenshots `02`–`05`, regression OK), but overlapping async `lobby_bind_nickname` profile pushes can deliver a **stale other-pool** `economy_profile` after `lobbyEconomyPool` already switched — UI shows pool A while mutations hit pool B, enabling cross-pool item destruction via colliding per-doc IDs (`server/src/index.ts` lobby bind async; `store.ts` `doc.nextGemId++` per pool).

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | FAIL | major | Buttons/labels/bind/pool badges/auction without join meet AC in diff + `smoke-summary.json`. **Pool isolation AC fails under rapid dual-bind race** — F-001 |
| 2 | Server authority for gameplay-relevant state | FAIL | major | Allow-list `economyPool` + server-tracked `lobbyEconomyPool` for mutations is correct (`server/src/index.ts` ~781–855); auction always Deathmatch (`isAuctionMsg` + `AuctionHouse`). Stale profile push after rebind breaks authority-of-display vs mutation pool — F-001 |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Plain HTML/CSS/TS + `ws` + shared types; no new UI framework/deps |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | note | No secrets; pool allow-list; auth still client-gated for lobby bind (same EPIC 42 nickname model). Pre-existing auction `row.innerHTML` with seller nicknames unchanged |
| 5 | Error handling | PASS | — | `pool_invalid` / `nickname_invalid` / bind `not_found`; drop/trade `match_required` retained |
| 6 | Logging / observability | PASS | — | `[lobby/${requestedPool}]` bind logs; `[economy] … [lobby/${pool}]` mutate logs (`server/src/index.ts`) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | FAIL | major | Regression covers invalid pool, default DM, explicit DM/SB bind, cross-pool discard isolation (sequential), auction **browse**, drop/trade rejects — Critic re-ran `npm run regression:lobby-inventory` → OK. **Missing:** overlapping dual-bind profile race (F-001); list/bid/buyout from lobby only inferred via shared `nicknameReady` gate (note) |
| 8 | Readability / maintainability | PASS | — | Clear `lobbyEconomyPool` comment; modeSelect callbacks typed with `EconomyPool` |
| 9 | Scope discipline | PASS | — | Diff limited to EPIC 45 surfaces + regression/docs/README |
| 10 | Config / docs updated | PASS | — | README Current status EPIC 45; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | — | Legacy `#lobbyInventoryBtn` removed; auction early `return` when non-DM profile is a correct listing hardening |
| 12 | Regression risk considered | FAIL | major | In-match smoke OK (`07`, smoke `moved`); I/P ignored (`06`). New dual-bind path introduces stale-profile race not present when lobby was Deathmatch-only (EPIC 42) — F-001 |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `07-inmatch-gameplay-smoke.png` + smoke `beforePos`→`afterPos` (W/Space); shoot N/A to AC |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Lobby + overlays readable in `01`–`05`; auction lots and inventory grids intact |
| 15 | Controls & feel usable | PASS | — | Three lobby economy buttons visible/enabled after auth (`02`); pool badges match buttons (`03` Deathmatch, `04` Sandbox); Auction panel opens with Bid/Buyout (`05`) |
| 16 | Playability sanity (honest fun/usability call) | PASS* | | Dual inventory + lobby Auction solve the stated pre-match problem on the happy path (`02`–`05`). *Blocked for merge until F-001 closed — wrong-pool discard under race is not player-safe |

## Findings (actionable)

### F-001

- Checklist # / Gate: #1, #2, #7, #12
- Severity: major
- Issue: `lobby_bind_nickname` sets `lobbyEconomyPool` synchronously, then `void (async () => getFullProfile + send economy_profile)` without a bind generation / cancellation guard (`server/src/index.ts` ~805–826). A second bind (other pool) can complete its sync switch first; the first bind’s late profile still arrives. Client `onEconomyProfile` applies every profile (`main.ts` ~481–486) with no “last requested pool” filter. Per-pool docs use independent `nextGemId++` (`store.ts` `grantGem`), so `gem#N` commonly exists in both pools — discarding the item shown from a stale Sandbox profile while `lobbyEconomyPool === "deathmatch"` destroys the Deathmatch twin (and the reverse). Violates AC “No pool bleed” / server-tracked bind as sole mutation scope in practice.
- Required fix (file/behavior): On the server lobby bind path, ignore stale in-flight profile pushes after a newer successful bind (e.g. per-connection bind generation captured in the async closure; skip `sendJson(economy_profile)` + optionally skip bind-ok if generation mismatch). Optionally harden the client to ignore `economy_profile` whose `economyPool` ≠ last lobby button request. Do **not** trust a client-sent pool as mutation authority — keep using server `lobbyEconomyPool`.
- Suggested check to prove closed: Regression (or unit) that fires sandbox bind then immediate deathmatch bind and asserts no sandbox `economy_profile` is delivered after the deathmatch bind’s profile (and/or that a discard of an id only present in the stale UI cannot mutate the other pool). Re-run `npm run regression:lobby-inventory` + light Playwright dual-button open.

## Revision task (if REVISE)

- Finding IDs to fix: **F-001**
- Out of scope for this revision: Lobby gold hint always saying “(Deathmatch pool)”; committing Tester Playwright script; expanding auction list/bid/buyout regression beyond browse (unless cheap while touching bind); account-gating `lobby_bind_nickname` (unchanged EPIC 42 model)
- Re-verify required: yes (Tester re-runs scoped check + light regression)

## Notes (non-blocking)

- **N-001 (coverage):** Lobby auction **list/bid/buyout** share the same `nicknameReady` gate as browse (`server/src/index.ts` `isAuctionMsg`); Playwright `05` shows listing form + Bid/Buyout controls; regression only asserts `economy_auction_browse`. Prefer one seeded lobby list or bid round-trip later — not required to close F-001.
- **N-002:** `scripts/qa-epic45-tester-playwright.mjs` is present on disk but untracked (`??`); evidence under `qa-artifacts/epic-45/` is sufficient for this review. Commit if the team wants reproducible Tester runs in-repo.
- **N-003:** Lobby gold line remains “(Deathmatch pool)” even after Bots Inventory — overlay badge is authoritative (`03`/`04`); cosmetic only.
- **N-004:** Auction listing early `return` when `economyPool !== "deathmatch"` (`auctionPanel.ts` ~95–100) correctly stops filling the list form from a Sandbox snapshot (improvement vs master fall-through into `fill()`).
- **N-005:** Opening Auction after Bots Inventory clobbering an open Sandbox overlay remains accepted per spec §7 risk table.
