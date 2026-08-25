# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 38 — Auction, P2P Trade & Ground Item Drops; AC §4 |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-38-programmer-handoff.md` (feature `1a2ba9b`); QA on branch tip `5e85fe6` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node via nvm v24.18.1 / npm 11.16.0; Redis `PONG` on `:6379`; Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-38-auction-trade-ground` @ `5e85fe66a1a1438c70de6d0001476c1eaac68f7a`
- Live stack for smoke: server `CUBEWARS_SERVER_PORT=7788` → `ws://127.0.0.1:7788`; client Vite `http://127.0.0.1:5208/`
- Evidence script: `qa-artifacts/epic-38/qa-epic38-tester-playwright.mjs`

## Checklist sections applied

- Universal (AC, secrets, docs)
- Build and run
- Backend / game server (auction fee burn/ledger, buyer-cap refund, trade atomicity, ground TTL, Deathmatch-only market gate)
- Client (auction / trade / ground / inventory UX)
- Real-time / multiplayer (same-match trade; server-authoritative settle/drop/trade)
- Gameplay & feel (public Deathmatch move/jump/shoot smoke + market UX; bots sandbox isolation)

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client `tsc --noEmit` clean; server `tsc` + client Vite production build OK (`qa-artifacts/epic-38/typecheck.log`, `build.log`)

### Run

- Command: `npm run regression:auction-trade-ground`; live Playwright smoke
- Result: OK — `regression-auction-trade-ground: PASS`; `[epic38-qa] PASS` (`regression.log`, `playwright-run.log`)

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| AC: typecheck / build | PASS | **PASS** |
| Auction buyout 10% fee (5% burn / 5% ledger) | seller net = price − burn − dev; ledgers match | **PASS** — regression: buyout 200 → burn=10, dev=10, sellerNet=180 (`[ok] auction buyout fee burn/ledger`) |
| Buyer cap failure on settle | cancel + refund bid; item back to seller | **PASS** — regression: bid 50 refunded; seller gem restored (`settle cancelled … refund`) |
| P2P trade same-match, both confirm, no fee, atomic | gold/items swap; rollback on cap fail | **PASS** — regression atomic success + rollback; live two-client confirm → `status: completed` + `[trade] atomic swap ok … gold 5/3` |
| Ground drop 60s pickup/expire | TTL destroy; pickup restores when caps allow | **PASS** — regression expire-destroy; live Drop → HUD `Ground: gem armor (59s) ← F` → F pickup empties ground |
| Sandbox cannot enter auction/trade/ground market | bots/sandbox pool excluded | **PASS** — regression: sandbox gem list → `not_found`; bots drop does not extract; live bots inventory: Pool Sandbox, no Drop/Auction buttons; WS `drop_item`/`trade_open` → `not_deathmatch` (sandbox gem unchanged). Note: `economy_auction_list` still operates on Deathmatch bag (handoff: auction always uses Deathmatch pool) — sandbox bag not mutated |
| Regression script | PASS | **PASS** — `npm run regression:auction-trade-ground` |
| Live auction UI | panel + list lot | **PASS** — U opens Auction (Deathmatch); listed lot#2 start=50 buyout=100; UI states 10% fee 5%/5% |
| Live trade UI | both see window; confirm | **PASS** — screenshots 10–12; both confirm |
| Move / jump / shoot smoke | no new break | **PASS** — WASD + Space + fire in public (`03`/`04`) |

### Config and secrets

- `config.vars.example` / README up to date: yes — optional `CUBEWARS_AUCTION_MS`; README auction/trade/ground bullets
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — README market notes + `docs/tasks/epic-38-*.md`

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — escrow extract/insert, fee burn/ledger, settle cancel+refund, trade atomic swap/rollback, ground TTL, `assertDeathmatchMarket()` for drop/trade; client sends intents only and renders server snapshots

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-38/`
  - `01-auth-mode-select.png` … `04-public-fire-smoke.png` — auth + public join + move/jump/fire
  - `05-inventory-deathmatch.png` / `06-after-ground-drop.png` / `07-after-ground-pickup.png` — Deathmatch Drop + ground HUD TTL + pickup
  - `08-auction-panel.png` / `09-auction-after-list.png` — auction UI + listed lot
  - `10-trade-window-a.png` / `11-trade-window-b.png` / `12-trade-after-confirm.png` — P2P trade both sides
  - `13-bots-sandbox-joined.png` / `14-bots-inventory-no-market.png` / `15-bots-after-illegal-market-intents.png` — sandbox isolation
  - `smoke-summary.json`, `server-log.txt`, `regression.log`, runner `qa-epic38-tester-playwright.mjs`
- Movement: OK — WASD in public
- Jump: OK — Space mid-air capture
- Shoot / hit registration: OK — fire smoke (market EPIC; hit math not in scope)
- Camera / controls feel: OK for exercised path; U/T/F/I bindings present in HUD hint bar
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — arena + HUD + overlays readable
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — consistent with existing client; auction/trade are plain functional overlays (AC-sufficient per handoff)

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: AC §4 typecheck/build; auction fee burn/ledger + buyer-cap refund; P2P trade atomic success/rollback + live dual-confirm; ground 60s drop/pickup + expire-destroy regression; sandbox/Deathmatch isolation (UI + match gate; auction Deathmatch-bag semantics); live Playwright evidence under `qa-artifacts/epic-38/`.
