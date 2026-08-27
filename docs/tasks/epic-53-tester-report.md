# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-27 |
| Task / Story / EPIC | EPIC 53 — Inventory 6×5 grid + hero loadout preview |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-53-programmer-handoff.md` @ pin `38133ec96483431741776302d321c832023bed5f` (handoff meta may lag; verified `git rev-parse HEAD`) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node `v24.18.1` via nvm; local Redis `127.0.0.1:6379`
- Branch / commit: `feature/epic-53-inventory-grid-hero-preview` @ `38133ec96483431741776302d321c832023bed5f`
- Worktree: `.claude/worktrees/epic-53-inventory-grid-hero-preview`
- Compare: https://github.com/ryu878/cubewars/compare/master...feature/epic-53-inventory-grid-hero-preview?expand=1

## Checklist sections applied

- Universal (AC item-by-item, secrets, docs)
- Build and run
- Client (web/game client)
- Backend / game server (economy migration + move validation — authority)
- Gameplay & feel (player-facing inventory overlay visuals)
- Documentation (About / changelog / README)

N/A: Real-time reconnect/rate-limit (not in scope); Movement/Jump/Shoot (inventory UI only — no combat control changes).

## Check results

### Build

- Command: `npm run typecheck` ; `npm run build`
- Result: OK — shared/server/client typecheck green; server `tsc` + client Vite production build green

### Run

- Command: `npm run regression:economy-inventory` ; `node scripts/qa-epic53-programmer-playwright.mjs`
- Result: OK — `[economy-inventory] PASS`; Playwright wrote evidence with `cellCount=30`, caps `/30`, hero amulet + dog/cat, HP/Armor/Speed/Damage (no FAIL lines in `notes.txt`)

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Shared grid/caps | `INVENTORY_GRID` 6×5/30; `inventoryCells === 30`; `INVENTORY_GRID_VERSION === 2` | Confirmed in `shared/src/economy.ts` + regression asserts |
| Client grid CSS / cells | `#inventoryGrid` `repeat(6)` × `repeat(5)`; 30 `.inv-cell` | Playwright: `cellCount=30`, `gridTemplateColumns` six columns; CSS in `client/index.html` |
| Caps / aria — no stale 8×8 | Caps show `/30`; overlay aria 6×5; no player-facing 8×8 in `client/src` | Caps `Cells 30/30`; `inv.gridAria` EN/RU 6×5; grep client/src clean of 8×8/64/0–63 |
| Place/move validation | Server rejects bad anchors outside 30; 2-cell same-row still valid | Covered by `regression-economy-inventory` move/overlap/bad_anchor cases |
| Shrink migration | Preserve-then-pack; overflow `slotAnchor: null` never deleted; version guard | Regression: preserve/reloc/OOB/overflow=1 kept; `needsAutoPack`/`needsInventoryGridMigration` false after v2 |
| Load path both scopes | `loadDoc` → `ensureInventoryPacked` for deathmatch + sandbox | `store.ts` `loadDoc`/`ensureInventoryPacked` scoped for both |
| Hero preview | Body colors, amulet tell, pets type/side/color + gem pips, HP/Armor/Speed%/Damage% | Screenshots + notes: blue avatar, gold amulet, dog·left / cat·right with gem pips, all four stats |
| Lobby Deathmatch inventory | Overlay opens with grid + side + hero | Playwright lobby Deathmatch Inventory — PASS |
| Laptop 1280×720 | Side-by-side readable (EPIC 43 discipline) | `04-laptop-1280x720.png` — grid + rail + loadout visible without broken layout |
| i18n EN/RU | New hero/overflow/aria keys | Present in `client/src/locales/en.ts` and `ru.ts` |
| About + changelog | Inventory section 6×5 + preview; Last updated; newest changelog entry | `about.html` EN/RU inventory copy; `LAST_UPDATED = "2026-08-27"`; changelog EPIC 53 first |
| README | No stale 8×8 player inventory claim | README documents 6×5 / 0–29 + migration |

### Config and secrets

- `config.vars.example` / README up to date: N/A new env vars; README inventory section updated — yes
- No secrets in diff: yes (no `.env`/credential paths in `master...HEAD`)

### Documentation

- README / docs updated: yes (`about.html`, `changelog.json`, `README.md`, task docs)

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — anchors/migration/move in `server/src/economy/*`; ratings via shared `aggregateEquippedRatings` on profile data; client preview is display-only

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-53/01-inventory-6x5-hero-preview.png`
  - `qa-artifacts/epic-53/02-hero-preview-closeup.png`
  - `qa-artifacts/epic-53/03-grid-side-layout.png`
  - `qa-artifacts/epic-53/04-laptop-1280x720.png`
  - `qa-artifacts/epic-53/notes.txt`
- Movement: N/A — inventory overlay only
- Jump: N/A
- Shoot / hit registration: N/A
- Camera / controls feel: N/A
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — inventory chrome + hero CSS preview readable; grid filled; loadout panel present
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky colored avatar + pet icons + gold amulet tell

## Caveats (non-blocking)

1. **Overflow UI** not visually captured in Playwright (seed fills bag without null anchors). Behavior covered by `npm run regression:economy-inventory` (overflow never deleted + Unplaced DOM exists in `index.html` / `inventoryOverlay.ts`).
2. **Sandbox/Bots pool** and **in-match** inventory not separately screenshot-exercised. Same `InventoryOverlay` + scoped `loadDoc`/`ensureInventoryPacked` for both pools; lobby Deathmatch path verified live.
3. Historical changelog entry for EPIC 29 still mentions 8×8 (historical — correct). Player-facing About/README/overlay copy is 6×5.

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified: 6×5/30 grid + caps, safe shrink migration + version guard via regression, hero loadout preview (colors/amulet/pets+gems/stats) with Playwright screenshots at laptop viewport, EN/RU i18n, About/changelog/README, typecheck/build green. Do not merge/deploy — Critic next.
