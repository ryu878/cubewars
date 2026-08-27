# EPIC 52 — Client i18n (RU/EN) + About the Game page

**Status:** Approved for implementation (Team Lead)  
**Date:** 2026-08-27  
**Depends on:** EPIC 51 merged (`f005951`+)  
**Branch:** `feature/epic-52-i18n-about-page`  
**Worktree (preferred):** `.claude/worktrees/epic-52-i18n-about-page`

## User intent

1. **Language switcher** — Russian and English for all player-facing UI (menus, buttons, panels, practical HUD labels). Persist choice in `localStorage`. Default: last saved choice, else browser language if `ru*`, else English.
2. **"About the game" page** — footer link near Changelog / Telegram. Page explains game mechanics with examples and pictures. Must stay current when features change.
3. **Process obligation** — document that About/mechanics must be updated when shipping new player-facing features or mechanic changes.

---

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Client i18n (RU/EN) + About the Game mechanics page |
| **System goal** | Players can use the full lobby/match UI in Russian or English; newcomers can learn mechanics from an About page with examples and images |
| **Business/gameplay problem** | UI is English-only; no single place that explains modes, pets, economy, hotkeys with visuals |
| **Architectural role** | **Client UI only** — display strings, static About page, docs. Server protocol message **codes** stay English; translate only client-displayed text |
| **Main components** | `client/src/i18n.ts` + `client/src/locales/en.ts` + `client/src/locales/ru.ts` (~190–200 UI strings), lobby/mode/inventory/auction/trade/pause/HUD, map picker `displayNameRu`, `client/public/about.html`, footer About link, README / ai-office process note, changelog entry |
| **Stack** | Fixed: Three.js/TS client + Vite. **No** i18n framework dependency (no i18next etc.). Plain module + dictionaries. Shared map catalog already has `displayNameRu` — client selects by locale. No server protocol changes required |
| **Explore baseline** | No i18n exists yet. Footer already has Changelog + Telegram in `client/index.html` — add About beside them. |
| **Interaction** | Locale is local-only (`localStorage`). No server round-trip. About is static HTML under Vite public assets |

---

## 2. Architecture

```text
Browser locale / localStorage (`cubewars.locale`)
        │
        ▼
  client/src/i18n.ts
    getLocale / setLocale / t(key, params?) / subscribe
    dictionaries: locales/en.ts + locales/ru.ts (~190–200 keys)
        │
        ├── index.html static labels via data-i18n (+ applyI18nDom on boot/locale change)
        ├── t() in modeSelect / pause / auth / inventory / auction / trade / main / HUD
        ├── map picker: displayName when en, displayNameRu when ru
        └── about.html (changelog-like chrome; locale-aware content)

Protocol error codes remain English machine codes;
map `code` → localized player string on the client when shown.
```

### Preferred implementation (explore findings — mandatory)

1. **`client/src/i18n.ts`** + **`client/src/locales/en.ts`** + **`client/src/locales/ru.ts`**
2. **`localStorage` key:** `cubewars.locale`; default: saved → browser `ru*` → `en`
3. **Switcher:** `EN|RU` on lobby; `data-i18n` for static HTML + `t()` in TS modules listed above
4. **Maps:** use existing shared `displayNameRu` when locale is `ru`
5. **`client/public/about.html`** mirroring changelog chrome; mechanics + examples + images under `client/public/about/`
6. **Process:** player-facing mechanic changes must update About **in the same delivery** (ai-office note + epic AC)

### Locale rules

| Rule | Detail |
|------|--------|
| Locales | `en`, `ru` only for this EPIC |
| Storage key | **`cubewars.locale`** (exact) |
| Default | If key present → use it. Else if `navigator.language` / `navigator.languages` starts with `ru` → `ru`. Else `en` |
| Switcher | Visible on **lobby** as `EN\|RU` (mandatory). Pause locale control optional |
| Re-render | `setLocale` notifies subscribers; `data-i18n` + module refresh without full page reload where feasible |
| Map names | Prefer `displayNameRu` when locale=`ru`, else `displayName` |

### About page content (minimum sections)

Static page: **`client/public/about.html`** (English filename), **mirroring changelog chrome** (`changelog.html` look/feel). Bilingual via same i18n pattern (preferred) or page-local JS locale.

Must cover with short prose + **examples** + **images** (under `client/public/about/`):

1. **Modes** — Deathmatch / Sandbox / vs Bots / Endless (separate economy pools)
2. **Maps** — map picker; maps are shared across modes as applicable
3. **Weapons & pickups** — shooting, pickups (health/armor/ammo/weapons) at high level
4. **Pets** — dog = flat Armor, cat = flat HP, bird = speed %, lion = damage % (EPIC 51 mapping)
5. **Inventory / auction / trade** — bag, equip rail, auction (Deathmatch), trade basics
6. **Spawn protection** — brief
7. **ESC / pause menu** — resume, change map, inventory, auction, exit lobby
8. **Hotkeys** — movement, shoot, jump, inventory, pause, console chrome if public-facing (do not document cheat unlock codes as a feature for players; `~` console may be mentioned as developer-oriented only or omitted)
9. **Economy pools** — Deathmatch vs Sandbox separation

Images: reuse illustrative screenshots from `qa-artifacts` (copy into `client/public/about/`), or capture via Playwright, or simple annotated stills. Commit assets under `client/public/about/`.

Page must show a **"Last updated"** date (and preferably link to Changelog).

### Process obligation (docs)

Document that shipping **new player-facing features or mechanic changes** requires updating:

1. **About page** content (+ bump "Last updated")
2. **Changelog** entry (`client/public/changelog.json` or project changelog process)
3. Brief note in **README** and/or **`ai-office/`** (e.g. Definition of Done / process note / small `docs/` or `ai-office/policies` bullet)

**Mandatory process rule (same delivery):** When shipping **player-facing mechanic changes or new player-facing features**, the delivery **must** update About (`client/public/about.html` + assets as needed), bump **Last updated**, and add a **Changelog** entry — in the **same** EPIC/PR, not as a follow-up.

Suggested phrasing (English): *"Player-facing mechanic or UI changes must update `client/public/about.html` (and assets), bump Last updated, and add a Changelog entry in the same delivery."*

---

## 3. Stories

### Story A — i18n module + language switcher

**As a** player **I want** to switch the UI between Russian and English **so that** I can play in my language and keep that choice across visits.

**Acceptance criteria:**

- [ ] Visible `EN|RU` language switcher on lobby
- [ ] RU and EN cover main menus/buttons/panels (~190–200 strings via locales)
- [ ] Choice survives reload (`cubewars.locale`)
- [ ] Default follows browser `ru*` when no saved choice
- [ ] Map picker shows `displayNameRu` when locale is `ru`
- [ ] Protocol codes remain English; only displayed strings are translated

### Story B — About the game page

**As a** new player **I want** an About page with mechanics, examples, and pictures **so that** I understand how to play without external docs.

**Acceptance criteria:**

- [ ] Footer link next to Changelog / Telegram opens About
- [ ] About covers required sections with examples and images
- [ ] Page is locale-aware (RU/EN) or clearly bilingual
- [ ] "Last updated" present

### Story C — Process / docs obligation

**As a** team **I want** a written obligation to keep About current **so that** mechanics docs do not rot.

**Acceptance criteria:**

- [ ] ai-office note (and README if useful) documents: player-facing mechanic changes must update About **in the same delivery**
- [ ] Changelog entry for EPIC 52 (i18n + About)
- [ ] About page itself references staying in sync / last updated

---

## 4. Tasks

| ID | Task | Place | Completion |
|----|------|-------|------------|
| 52.1 | Add `client/src/i18n.ts` + `locales/en.ts` + `locales/ru.ts` (~190–200 keys): `t`, `getLocale`, `setLocale`, subscribe; persist `cubewars.locale`; default saved → `ru*` → `en` | `client/src/i18n.ts`, `client/src/locales/` | Module typechecks |
| 52.2 | Lobby `EN\|RU` switcher; `data-i18n` on static HTML; wire modeSelect + auth + footer (About beside Changelog/Telegram) | `client/index.html`, `modeSelect.ts`, `accountAuth.ts` | Switcher visible; strings flip without hard reload |
| 52.3 | `t()` in inventory, auction, trade + status/error player strings | those modules | Main panel chrome + buttons localized |
| 52.4 | `t()` / `data-i18n` for pause/ESC + practical HUD labels; map picker uses `displayNameRu` when locale=`ru` | pause, HUD, modeSelect map list | Labels + map names switch with locale |
| 52.5 | `about.html` (changelog chrome) + `client/public/about/` images; locale-aware; Last updated | `client/public/about.html`, assets | Page loads; sections + images present |
| 52.6 | ai-office process note (same-delivery About update); README if needed; changelog entry | `ai-office/…`, README, changelog | Docs committed |
| 52.7 | Typecheck + client build; Playwright evidence (lobby EN/RU, About) under `qa-artifacts/epic-52/` | scripts / QA | Green build; screenshots exist |
| 52.8 | Programmer handoff + PR to `master` | docs/tasks + gh | Handoff filed; PR open — **do not merge/deploy** |

---

## 5. Scope / out of scope

**In scope (client-displayed):**

- Lobby / auth, mode select, map picker labels, inventory, auction, trade, pause/ESC, HUD labels where practical, console chrome if any player-visible labels, error/status strings shown to players

**Out of scope:**

- Translating server logs, protocol field names, or machine error **codes**
- Adding more locales beyond `en`/`ru`
- Full translation of every debug string / developer console cheat docs
- Server or shared gameplay logic changes
- React/i18next or other UI frameworks

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Missed hardcoded strings | Prefer `data-i18n` keys + central apply; grep for obvious English UI literals in touched modules |
| About content drifts | Process obligation + Last updated + changelog |
| Large dictionaries | Keep flat key namespace (`lobby.play`, `pause.resume`, …); no framework |
| Image licensing / size | Prefer project screenshots; keep assets reasonable |

---

## 7. Definition of Done

- All Story A/B/C acceptance criteria checked
- `npm` typecheck + client build green
- Playwright evidence for switcher + About
- Tester PASS → Critic APPROVED (or Judge ALL_CLOSED) → Team Lead merge approve
- Deploy to https://cubewars.ru/ after merge (standing ops)

---

## Sign-off

- **Specification (author):** Team Lead (Tusya) — 2026-08-27  
- **Approval (Team Lead):** Approved for implementation  
- **Assignee:** Programmer (Pusya)
