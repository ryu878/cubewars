# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-27 |
| Task / Story / EPIC | EPIC 52 — Client i18n (RU/EN) + About the Game |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-52-programmer-handoff.md` (handoff cites `68dcad7`; QA verified at HEAD `17f69aa`) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux local (Node `v24.18.1` via nvm); dedicated server port **7852** + Vite client **5252** (footer spot-check on **5253**)
- Branch / commit: `feature/epic-52-i18n-about-page` @ `17f69aa5673eb2a6748f76f8b828d5456cfc9b34`

## Check results

### Build

- Command: `npm run typecheck --workspace=client` then `npm run build --workspace=client`
- Result: OK — both green (`tsc --noEmit`; Vite client build succeeded)

### Run

- Command: `node scripts/qa-epic52-tester-playwright.mjs` (+ footer screenshots via Vite :5253)
- Result: OK — harness exit 0; `qa-artifacts/epic-52/qa-result.txt` = `PASS`

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Lobby EN\|RU switcher | Visible on lobby | PASS — `#modeSelect .locale-switcher` with `data-locale` EN/RU; `01-lobby-en.png`, `02-lobby-ru.png` |
| Strings flip without reload | Main menus/buttons/panels switch | PASS — EN subtitle “Sign in…” → RU “Войдите…”; Quick Join / inventory / lore / hints Cyrillic; pause/inv titles `Пауза` / `Инвентарь` |
| Persist `cubewars.locale` | Survives reload | PASS — after RU click, reload keeps `localStorage=ru` + RU UI (`06-lobby-ru-after-reload.png`) |
| Default locale | saved → browser `ru*` → `en` | PASS — no key + `ru-RU` → `lang=ru` + Cyrillic (`07-…`); no key + `en-US` → `lang=en` (`08-…`) |
| Map picker RU | `displayNameRu` when locale=`ru` | PASS — e.g. `База \| Ржавый Каньон \| Стеклянный Купол` (`03-lobby-ru-map-picker.png`) |
| Footer About | Beside Changelog/Telegram → `/about.html` | PASS — order Changelog → About → Telegram; href `/about.html`; `10-lobby-footer-en.png`, `11-lobby-footer-ru.png` |
| About page | Sections + examples/images + Last updated + locale | PASS — 9 sections; 8 images loaded; RU title «Об игре», EN “About the game”; Last updated `2026-08-27`; pets dog Armor / cat HP / bird speed% / lion damage% (`04`/`05`/`09`) |
| Process docs | Same-delivery About obligation | PASS — `ai-office/policies/player-facing-docs.md` + `global-standards.mdc` DoD + README status line; changelog EPIC 52 entry present |
| Dictionaries | ~190–200 keys, EN/RU parity | PASS — **213** keys each; no missing/extra keys |
| Console errors (lobby path) | None on main path | PASS — none observed during harness lobby exercise |

Checklist sections applied: **Universal**, **Build and run**, **Client (web/game client)**, **Docs**, **Gameplay & feel** (player-facing UI — exercised switcher + About; movement/jump/shoot N/A for this UI-only epic).

### Config and secrets

- `config.vars.example` / README up to date: yes — no new env vars; README documents EPIC 52 i18n/About
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — README status; `ai-office/policies/player-facing-docs.md`; `ai-office/global/global-standards.mdc`; `client/public/changelog.json` EPIC 52 entry; About sync note on page

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: **N/A** — locale is client-only display; no gameplay authority change

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-52/` (`01`–`11` PNGs, `notes.txt`, `qa-result.txt`) — also synced to parent repo `qa-artifacts/epic-52/`
- Movement: N/A — UI/i18n/About only; no match join required for AC
- Jump: N/A —
- Shoot / hit registration: N/A —
- Camera / controls feel: N/A —
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — lobby and About render; About images all `naturalWidth > 0`
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — lobby/About chrome consistent with existing client; About embeds prior gameplay/inventory captures

**Non-blocking notes (not FAIL):** RU dictionary keeps footer “Changelog” as English loanword; shared weapon `displayName` and some inventory grant detail strings remain English (called out in Programmer handoff). Illustrative About inventory crop may still show older “DR” chrome in the embedded PNG while live pet-grant copy on the page is correct.

## Outcome

- **PASS:** ready for **Critic** review (`ai-office/agents/critic/role.mdc`).

Briefly verified: lobby EN\|RU switcher with live string flip; `cubewars.locale` persistence; browser-default `ru*`/`en`; map `displayNameRu`; footer About → `/about.html`; About sections/images/Last updated/locale; process docs + changelog; typecheck/build green; Playwright evidence under `qa-artifacts/epic-52/`.
