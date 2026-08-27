# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-27 |
| Author (Pusya) | Programmer (Pusya) |
| Task / Story / EPIC | EPIC 52 — Client i18n (RU/EN) + About the Game |
| Branch / commit / PR | `feature/epic-52-i18n-about-page` @ `2799eec` — PR URL filled after open |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Added lightweight client i18n (`client/src/i18n.ts` + `locales/en.ts` + `locales/ru.ts`, 213 keys each): `t` / `getLocale` / `setLocale` / `subscribe` / `applyI18nDom`; persist `cubewars.locale`; default saved → browser `ru*` → `en`.
2. Wired lobby `EN|RU` switcher, `data-i18n` on static HTML, and `t()` across modeSelect / pause / auth / inventory / auction / trade / main / HUD-related surfaces; map picker uses `displayNameRu` when locale is `ru`.
3. Added `client/public/about.html` (changelog chrome) with mechanics sections + images under `client/public/about/`; footer About link beside Changelog / Telegram; ai-office process note + changelog entry + README status line.

## Changed files / areas

- `client/src/i18n.ts`, `client/src/locales/en.ts`, `client/src/locales/ru.ts`
- `client/index.html` (switcher, About link, data-i18n)
- `client/src/modeSelect.ts`, `pauseMenu.ts`, `accountAuth.ts`, `inventoryOverlay.ts`, `auctionPanel.ts`, `tradePanel.ts`, `main.ts`, `killFeed.ts`, `groundHud.ts`
- `client/public/about.html`, `client/public/about/*.png`, `client/public/changelog.json`
- `ai-office/policies/player-facing-docs.md`, `ai-office/global/global-standards.mdc`, `ai-office/README.md`, `README.md`
- `scripts/qa-epic52-programmer-playwright.mjs`
- `docs/tasks/epic-52-*.md` (spec + assignment + this handoff)

## How to verify (steps for Trusya)

1. Open lobby; confirm `EN|RU` switcher; switch languages without full reload — labels/lore/footer flip; map names show Russian when RU.
2. Confirm footer has Changelog · About · Telegram; About opens `/about.html` with required sections, images, Last updated, locale switcher.
3. Spot-check inventory / pause / auth / auction chrome strings in both locales; protocol error **codes** remain English machine codes where shown as codes.
4. Review Playwright evidence under `qa-artifacts/epic-52/` (also copied to parent repo path).

## Build and run

- Build command: `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` then `npm run typecheck --workspace=client` and `npm run build --workspace=client` (green)
- Evidence: `node scripts/qa-epic52-programmer-playwright.mjs`
- Expected smoke result: lobby EN/RU screenshots + About RU/EN; notes show Cyrillic map names

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: N/A (client UI / static About)
- Key success messages: N/A

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged — locale is client-only display
- What the client is allowed to predict/render only: translated UI strings and About static content

## Risks / known limitations

- Some inventory grant detail text still comes from shared English `describePetGrants` / `primaryText` (species codes in tooltips); main chrome/actions are localized.
- Weapon display names from shared `WEAPON_STATS.displayName` remain English.
- About page uses page-local dictionaries (same `cubewars.locale` key) rather than importing the Vite TS module.
- `npm install` without `--ignore-scripts` may fail on older host g++ for `better-sqlite3` (unrelated to this EPIC); client typecheck/build used `--ignore-scripts` install.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
