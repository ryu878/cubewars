# EPIC 47: Map Density + Bots MapId + ESC Menu + Changelog + Auth UX

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User asks (RU, 2026-08-26), combined intent:

1. After EPIC 46 ~4× map **area**, scale **~4×** weapons/ammo/armor/health pickups; increase wall/cover density.
2. **Bug:** Play vs Bots must load lobby-selected map (not always Base).
3. **ESC in-game pause menu:** Exit to Lobby, change/reload map, inventory, auction (players cannot tell how to leave).
4. **Changelog link** near Telegram at lobby bottom → Changelog page, **10 entries/page**, pagination, **newest first**.
5. **"Send password" / resend code** button: issue new 6-digit code wired to EPIC 34 auth; if email not implemented, generate+store and show on-screen honestly (same stub pattern as register).
6. **Code input normalization:** accept `123-345` **or** `123345` (ignore spaces); both must succeed. Normalize before compare (server mandatory; client UX helpful).

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Map Density + Bots MapId + ESC Menu + Changelog + Auth UX |
| **System goal** | Dense playable maps; bots honor map picker; clear in-match leave/menu; visible changelog; recoverable login codes with flexible typing. |
| **Architectural role** | shared maps + auth protocol; server match leave + account reset; client pause/changelog/auth UI. |
| **Stack** | Fixed project stack. Plain HTML/CSS/TS. AABB maps only. |
| **Main components** | `shared/src/maps/`, `shared/src/index.ts`; `server/src/{index,match,matchManager,accounts}`; `client/{index.html,main,modeSelect,pauseMenu,accountAuth}`; changelog page/data; regressions; Playwright; README |

## 2. Current state (intake notes)

- Catalog pickups ~14/map → target ~4×; cover sparse on expanded arenas.
- Bots `mapId` appears wired but user reports Base always — must fix + prove.
- ESC unlocks pointer without actionable menu; no in-band leave (only disconnect → `removeHuman`).
- Lobby footer has Telegram link only — no changelog.
- Auth (EPIC 34): register shows `NNN-NNN` once on screen; bcrypt hash; `AccountStore.normalizeCode` already strips spaces/dashes to `NNN-NNN` for login — **verify both input forms always succeed end-to-end**; no “send/reset password” path yet.
- Email delivery still not implemented — reset must **not** claim email was sent.

## 3. Design

### 3.1–3.3 Maps (unchanged intent)

- Bots honor selected `mapId` with non-Base QA evidence.
- ~4× pickup counts per catalog map; clearance + balance rules kept; before/after in handoff.
- More interior walls/cover; navigable; themed; AABB-only.

### 3.4 In-match ESC pause menu

- ESC → menu: Resume; **Exit to Lobby** (clean leave, no ghosts, mode-select); Change/Reload map + picker; Inventory (correct pool); Auction (prefer Deathmatch auction usable).
- Prefer in-band `leave_match` (or equivalent) preserving WS/auth.
- Pointer-lock / input gating; Playwright Exit-to-Lobby.

### 3.5 Changelog page + lobby link

- Add link **near** the Telegram footer link (same lobby footer area), e.g. “Changelog” / «Список изменений».
- Opens a **Changelog page** (static HTML under Vite `client/` public/or routed page is fine — must work in prod static deploy).
- Entries: product-facing changes (EPICs / notable fixes), **newest first**.
- **Pagination: 10 per page** with next/prev (or page numbers).
- Seed content from recent EPICs (at least through 46/47) in English (RU titles optional if natural). Maintain as a simple data file (JSON/TS/MD→build) so future EPICs can append.

### 3.6 Send password / resend code

- Auth UI button: **“Send password” / “Resend code”** (EN+RU label OK), visible when logging in / code entry (forgot or wrong password).
- Server: new message e.g. `account_reset_code` / `account_send_password` with email:
  - Validate email exists (do not leak timing more than existing patterns allow — prefer same rate-limit discipline as login).
  - Generate new 6-digit display code (`NNN-NNN`), **replace** stored bcrypt hash, return code **once** in result (same reveal UI as register).
  - **Honest UX:** if email is not sent, label clearly that the **new code is shown on screen** — do **not** say “check your email” unless real email exists.
- Rate-limit resets aggressively (reuse/extend login rate limits).
- Invalidate or keep sessions: prefer keep existing sessions unless easy to revoke all — document choice (keeping sessions OK for stub auth).

### 3.7 Code normalization

- Canonical stored/display form remains `NNN-NNN`.
- Login (and reset-confirm if any) must accept `123-345`, `123345`, and spaced variants; **server normalize before bcrypt compare**.
- Verify existing `normalizeCode` is used on all compare paths; hash registration/reset with canonical dashed form.
- Client: allow typing either form (maxlength, no client-only reject of digit-only); optional light normalize before send.
- Regression: login succeeds for both dashed and digit-only for same account.

### 3.8 Out of scope

- Real SMTP email (unless already present — it is not).
- Endless map picker beyond leave/menu needs.
- New map ids; Rapier; combat redesign.

## 4. Stories / Tasks

### Story 47.1 — Bots selected map
### Story 47.2 — ~4× pickups
### Story 47.3 — More cover
### Story 47.4 — ESC pause menu + leave
### Story 47.5 — Changelog link + paginated page (10/page, newest first)
### Story 47.6 — Send/resend password code (on-screen stub, honest labels, rate-limited)
### Story 47.7 — Code input accepts dashed and digit-only (server normalize + regression)
### Story 47.8 — Docs / typecheck / regressions / Playwright / handoff / PR

## 5. Acceptance criteria

- [ ] Bots loads lobby-selected map (non-Base proven).
- [ ] Public map select still works.
- [ ] Pickups ~4×; before/after documented; more cover; navigable.
- [ ] ESC menu: Resume, Exit to Lobby, Change map, Inventory, Auction; clean leave; no stuck pointer.
- [ ] Lobby Changelog link near Telegram; page lists changes newest-first, 10/page with pagination.
- [ ] Send/Resend password generates new code, stores hash, shows on screen honestly; rate-limited.
- [ ] Login works with `NNN-NNN` and `NNNNNN` (and spaces); regression evidence.
- [ ] Typecheck/build + regressions + Playwright.
- [ ] After Critic APPROVED or Judge ALL_CLOSED: merge master, push, deploy http://195.60.237.4/.

## 6. Branch / delivery

- Branch/worktree: `task/epic-47-map-density-bots-esc` at `.claude/worktrees/epic-47-map-density-bots-esc` (**continue existing WIP** — do not restart from scratch).
- One PR into `master`.
- Standing ops: TL merge + push + `scripts/deploy-production.sh`.

## 7. Sign-off

- **Author:** Team Lead (Tusya) — 2026-08-26 (expanded: ESC; then changelog + auth UX)
- **Approved for Programmer**
