# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 42 — Lobby Telegram Label + Pre-Match Inventory (Stories 42.1 + 42.2) |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-42-programmer-handoff.md` @ feature tip `ca19b2b` (feat commit `e9d7d72`; branch tip includes docs note) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (host); Node v22.20.0 via nvm; Redis local `redis://127.0.0.1:6379`
- Branch / commit: `task/epic-42-lobby-telegram-inventory` @ `ca19b2b8bac7f11decfeb4188f2a5cd58940c7c2`

## Check results

Checklist sections applied: **Universal**, **Build and run**, **Client**, **Backend / game server** (authority + lobby bind), **Real-time / multiplayer** (economy WS), **Gameplay & feel** (lobby UI + in-match I/P + move/jump smoke). Docs/config-only N/A beyond README Current status check.

### Build

- Command: `npm run typecheck` && `npm run build`
- Result: OK — typecheck (shared/server/client) and server+client production build completed with exit 0

### Run

- Command: `npm run regression:lobby-inventory`; Playwright `node scripts/qa-epic42-tester-playwright.mjs` (dedicated server `:7796` + Vite `:5216`)
- Result: OK — `regression:lobby-inventory OK`; Playwright summary `ok: true`, exit PASS

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Lobby Telegram label + href | Text `Game Developers Telegram Chat - t.me/cubewarsgame`; href `https://t.me/cubewarsgame` | DOM + focused shot match; `target=_blank`, `rel=noopener noreferrer` |
| Pre-auth Inventory button | Present, labeled Inventory, disabled until sign-in | Present, disabled before auth (`01-lobby-preauth-telegram.png`) |
| Invalid nickname + Inventory | Clear `#modeSelectError`; overlay stays closed; no crash | Error `Enter a valid nickname to load inventory`; overlay not visible (`02-invalid-nickname-error.png`) |
| Auth + valid nickname → Inventory | Opens `#inventoryOverlay`; `lobby_bind_nickname`; Deathmatch `economy_profile`; no `join` | Overlay visible; bind sent; pool Deathmatch; gold `0`; lobby gold updated; `joinCount: 0` (`03-lobby-inventory-open.png`) |
| Lobby type letter `i` | Inventory does **not** open via hotkey | Nickname became `iiii`; overlay stayed closed (`04-lobby-type-i-no-hotkey.png`) |
| In-match I / P | I opens same overlay; P toggles | `openedByI: true`; after P closed (`05-inmatch-inventory-I.png`); bots match correctly shows Sandbox pool |
| Drop/trade from lobby (regression) | `match_required`; no Sandbox mutate | Regression asserts drop_item + trade_open → `match_required`; bind profile `economyPool === "deathmatch"`; no `join_accepted` |
| Move / jump (in-match smoke) | Position changes; camera usable | W + Space: z/y changed; pointer lock OK (`06-inmatch-gameplay.png`) |

### Config and secrets

- `config.vars.example` / README up to date: yes (no new env vars; README Current status notes EPIC 42)
- No secrets in diff: yes (reviewed handoff + exercised paths; auth uses throwaway `@example.com`)

### Documentation

- README / docs updated: yes — README Current status documents lobby Inventory + Deathmatch bind + regression command

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — `normalizeNickname` + `lobby_bind_nickname`; Deathmatch `getFullProfile` / `applyInventoryEconomyAction`; match-only drop/trade/ground reject with `match_required`; client bag only from `economy_profile`

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-42/`
  - `01-lobby-preauth-telegram.png`, `01b-telegram-footer.png`
  - `02-invalid-nickname-error.png`
  - `03-lobby-inventory-open.png`
  - `04-lobby-type-i-no-hotkey.png`
  - `05-inmatch-inventory-I.png`
  - `06-inmatch-gameplay.png`
  - `smoke-summary.json`, `playwright-console.log`
- Movement: OK — W moved player in bots match (server `world_state` position delta)
- Jump: OK — Space produced y lift in sampled positions
- Shoot / hit registration: N/A — not in EPIC 42 AC (bots did deal damage in background; not asserted)
- Camera / controls feel: OK — pointer lock acquired; no stuck look observed in smoke
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — lobby + blocky arena readable
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — arena bricks/figures readable in in-match shots

## On FAIL: reproduction

### Failure reason

- FAIL cause: N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: Telegram copy/href; lobby Inventory → same `#inventoryOverlay` + Deathmatch profile without join; invalid-nickname UX; lobby I-hotkey ignore; in-match I/P; server-authoritative bind/mutations and match-only drop/trade (regression); typecheck/build/regression PASS.
