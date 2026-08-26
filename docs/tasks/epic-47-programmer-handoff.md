# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 47 — Map Density + Bots MapId + ESC Menu + Changelog + Auth UX |
| Branch / commit / PR | `task/epic-47-map-density-bots-esc` — see PR (opened after this handoff); tip SHA filled at push |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Densified all 8 catalog maps to **56 pickups** each (EPIC 46 was **14**: 4/4/3/3 → 16/16/12/12) via `densePickups` + more AABB cover/walls with clearance.
2. Bots join always sends lobby `mapId`; server `createBotsMatch(mapId)` + `join_accepted.mapId` / `map_state.mapId` prove non-Base (`rust_canyon`).
3. In-match ESC pause menu: Resume, Exit to Lobby (`leave_match` → `leave_match_ack`, no ghosts), Change map / Reload Endless, Inventory (match pool), Auction (Deathmatch); pointer unlocked while open.
4. Lobby footer **Changelog** next to Telegram → static `/changelog.html` + `/changelog.json` (newest first, 10/page, works in Vite prod `dist/`).
5. `account_reset_code` → `account_reset_code_result`: new `NNN-NNN` stored (bcrypt), shown on screen honestly (not emailed), rate-limited like login; sessions kept.
6. Login accepts `NNN-NNN` and `NNNNNN` (spaces ok): server `normalizeCode` before bcrypt; client light-normalizes and does not block digit-only (`maxlength=16`).

## Changed files / areas

- `shared/src/maps/{densify,base,themedMaps}.ts`, `shared/src/mapData.ts`, `shared/src/index.ts` (protocol: `leave_match`, `account_reset_code`, mapId echoes)
- `server/src/{index,match}.ts`, `server/src/accounts/{store,index}.ts`
- `client/src/{pauseMenu,main,modeSelect,network,uiInput,accountAuth}.ts`, `client/index.html`
- `client/public/changelog.{html,json}`
- `scripts/regression-epic47.ts`, `scripts/qa-epic47-programmer-playwright.mjs`, `scripts/regression-account-auth.ts`
- `package.json` (`regression:epic47`), `README.md`, `docs/tasks/epic-47-*.md`

## How to verify (steps for Trusya)

1. `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"`
2. `npm run typecheck && npm run build`
3. `npm run regression:epic47` — density/clearance, bots `rust_canyon`, `leave_match` rejoin
4. `npm run regression:account-auth` — digit-only login + reset code + rate limit
5. `npm run regression:epic46-maps` — public map select / capacity still OK
6. `node scripts/qa-epic47-programmer-playwright.mjs` — bots non-Base screenshot, ESC menu, Exit to Lobby, changelog page 1→2
7. Manual: lobby Changelog link near Telegram; auth “Send password / Resend code” shows new code on screen (no “email sent” copy)

## Build and run

- Build command: `npm run build`
- Run command: `npm run dev` (or production static client + server)
- Expected smoke result: typecheck/build clean; regressions PASS; Playwright writes `qa-artifacts/epic-47/` with PASS summary

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout
- Key success messages:
  - `[server] match created: bots:… map=rust_canyon`
  - `[server] player left match "…" via leave_match: …`
  - `[accounts] reset_code ok accountId=…`
  - `[accounts] login ok …` after dashed or digit-only code

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: match `mapId`/geometry/pickups; `leave_match` removes human; auth register/login/reset hash + rate limits; client never invents codes or map geometry
- What the client is allowed to predict/render only: pause UI, changelog static page, display of stub codes returned once by server

## Risks / known limitations

- Email delivery still stubbed — reset/register honestly show codes on screen
- Successful `account_reset_code` counts toward the same failure window as login (aggressive anti-spam)
- Existing sessions remain valid after code reset (documented choice)
- Playwright needs free ports 7799 / 5219 when self-managing stack

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)

## Pickup before/after (all catalog maps)

| Era | weapon | ammo | health | armor | total |
|-----|--------|------|--------|-------|-------|
| EPIC 46 | 4 | 4 | 3 | 3 | **14** |
| EPIC 47 | 16 | 16 | 12 | 12 | **56** (~4×) |

## Bots mapId root cause

Client could omit `mapId` on bots join; server defaulted `createBotsMatch` to `DEFAULT_MAP_ID` (Base). Fix: mode-select always sends catalog `mapId` for public/bots; main join hardens with selected/default mapId; server logs when bots omit mapId.

## Protocol names

- ESC leave: `leave_match` / `leave_match_ack`
- Password reset: `account_reset_code` / `account_reset_code_result`
- Changelog path: `/changelog.html` (data `/changelog.json`)
