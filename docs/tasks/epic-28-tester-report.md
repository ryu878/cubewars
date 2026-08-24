# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-24 |
| Task / Story / EPIC | EPIC 28 — Lobby Emerald Lore (`docs/tasks/epic-28-lobby-emerald-lore.md`) |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-28-programmer-handoff.md`; implementation `7e56b48`; branch tip verified `926f9e8` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (host); client via Vite `http://127.0.0.1:5175` (dedicated port for this QA run)
- Branch / commit: `task/epic-28-lobby-emerald-lore` @ `926f9e8ce84a9a91979a16e6a28b590b91163902`

## Check results

Checklist sections applied: **Universal**, **Build and run**, **Client (web/game client)**, **Gameplay & feel** (lobby/visual path only — movement/jump/shoot N/A), **Docs**. Backend / real-time / multiplayer: **N/A** (client HTML/CSS only; no server/protocol changes).

### Build

- Command: `npm run typecheck` ; `npm run build --workspace=client`
- Result: OK — typecheck (shared/server/client) exit 0; client Vite production build exit 0

### Run

- Command: `npm run dev --workspace=client -- --port 5175 --strictPort` + `node scripts/qa-epic28-tester-playwright.mjs http://127.0.0.1:5175 qa-artifacts/epic-28`
- Result: OK — mode-select loads with lore; Playwright checks ALL PASS; no console errors on lobby path

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Desktop (~1280×800) lore visible | Title **Изумрудная Пустошь** + story beats (2157 portal, Pets, gold/eggs/gems/amulets, survive/leaderboard) beside join card | PASS — lore column left (`x≈172`), card right (`x≈572`); all required snippets present |
| Desktop CTAs usable | Nickname + Quick Join / vs Bots / Endless hittable, not covered by lore | PASS — `elementFromPoint` hits self for nickname + all three mode buttons; nickname fill `QaLore` OK |
| Narrow (~375×812) lore | Lore above card in short scrollable block (`max-height` + overflow) | PASS — lore `order:-1` above card; `maxHeight≈227px`, `overflowY=auto`; scrolled evidence `03-…png` shows remaining beats |
| Narrow CTAs usable | Nickname + mode buttons not covered after layout / after lore scroll | PASS — hit-tests OK before and after `scrollTop=80` |
| No server/protocol churn | Diff vs EPIC 27 base is client/docs only | PASS — changed: `client/index.html`, `README.md`, `docs/tasks/epic-28-*.md` only |
| Story beats vs AC | What / why / purpose readable | PASS — 2157 portal → Emerald Wasteland; symbiotic Pets; resource fight; survive/strengthen/rank |

### Config and secrets

- `config.vars.example` / README up to date: yes (no new env vars; README Current-status note for EPIC 28)
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — README Current status + EPIC/handoff docs on branch

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: N/A — decorative lobby copy only; no gameplay state / protocol changes

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-28/01-lobby-desktop-1280.png`
  - `qa-artifacts/epic-28/02-lobby-narrow-375.png`
  - `qa-artifacts/epic-28/03-lobby-narrow-375-lore-scrolled.png`
  - Runner: `scripts/qa-epic28-tester-playwright.mjs`
- Movement: N/A — lobby overlay only; in-match movement not in scope
- Jump: N/A
- Shoot / hit registration: N/A
- Camera / controls feel: N/A
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — dark lobby palette, readable secondary green/gray lore, translucent join card primary; no black screen or broken chrome in captures
- Matches intended "Roblox-like" look (colorful, readable, low-poly): N/A for 3D scene (lobby UI); lore matches existing dark lobby aesthetic without purple-glow / emoji clutter

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: Emerald Wasteland Russian lore on `#modeSelect` with all story beats; desktop side column + narrow scrollable stack; nickname/mode CTAs remain hittable; client typecheck/build green; no server/protocol diffs; screenshots under `qa-artifacts/epic-28/`.
