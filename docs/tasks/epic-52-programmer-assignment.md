# EPIC 52 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- Create from current `master` (tip should be EPIC 51 merge `f005951` or later).
- Branch: `feature/epic-52-i18n-about-page`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-52-i18n-about-page`
- Spec (authoritative): `docs/tasks/epic-52-i18n-about-page.md` — copy/sync into worktree.

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Explore findings (fold into implementation — mandatory)

- No i18n yet; ~190–200 player-facing UI strings to cover.
- Footer already has Changelog + Telegram in `client/index.html` — **add About beside them**.
- Maps already have `displayNameRu` in shared catalog — **use it when locale is `ru`**.

## Preferred approach (do this)

1. `client/src/i18n.ts` + `client/src/locales/en.ts` + `client/src/locales/ru.ts`
2. `localStorage` key **`cubewars.locale`**; default: saved → browser `ru*` → `en`
3. Switcher **EN|RU** on lobby; `data-i18n` for static HTML + `t()` in modeSelect / pause / auth / inventory / auction / trade / main / HUD
4. Map picker: `displayNameRu` when locale is `ru`, else `displayName`
5. `client/public/about.html` mirroring **changelog chrome**; mechanics with examples + images under `client/public/about/`
6. Process note in ai-office: **player-facing mechanic changes must update About in the same delivery** (+ Last updated + Changelog)

## Must deliver

### Story A — i18n + language switcher

1. i18n module + en/ru locale files as above (`t`, `getLocale`, `setLocale`, `subscribe` / apply DOM).
2. Visible lobby language switcher; changing locale re-applies UI (prefer no full reload).
3. Localize lobby/auth/mode select/map picker/economy hint/footer, inventory/auction/trade, pause/ESC, practical HUD labels, player-facing status/errors.
4. Protocol **codes** stay English; translate display text only. No i18n framework deps.

### Story B — About page

5. `client/public/about.html` (changelog-like chrome) with sections: modes, maps, weapons/pickups, pets (dog Armor / cat HP / bird speed% / lion damage%), inventory/auction/trade, spawn protection, ESC, hotkeys, economy pools — examples + pictures.
6. Assets under `client/public/about/` (from `qa-artifacts` copy or Playwright).
7. Locale-aware About; **Last updated** shown.
8. Footer link: About next to Changelog / Telegram → `/about.html`.

### Story C — Process docs

9. ai-office note (required): same-delivery About update obligation for player-facing mechanic changes. README optional if it helps discoverability.
10. Changelog entry for EPIC 52.

### Delivery hygiene

11. Typecheck + client build green.
12. Playwright evidence under `qa-artifacts/epic-52/` (lobby EN, lobby RU after switch, About page, ideally map names in RU).
13. `docs/tasks/epic-52-programmer-handoff.md`; open PR to `master`.
14. Do **not** merge or deploy. Do not mix unrelated dirty parent files (favicons, `docs/ops/mail.md`, other worktrees, epic-51 leftovers unless required).

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/{global-standards,handoff-contracts,english-only,security-baseline}.mdc`
- `ai-office/templates/programmer-handoff-template.md`
- Spec: `docs/tasks/epic-52-i18n-about-page.md`
- Lobby footer: `client/index.html` (`.lobby-footer-links`)
- UI: `modeSelect.ts`, `accountAuth.ts`, `inventoryOverlay.ts`, pause wiring, `combatHud.ts`, `main.ts`
- Maps: `shared/src/maps/*` (`displayName` / `displayNameRu`)
- Changelog chrome to mirror: `client/public/changelog.html`

## Return summary (to Team Lead)

Branch, PR URL, HEAD SHA, locale behavior, UI surfaces covered, key count approximate, About path + assets, docs updated, build commands, handoff path, blockers.
