# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-24 |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 28 — Lobby Emerald Lore (`docs/tasks/epic-28-lobby-emerald-lore.md`) |
| Branch / commit / PR | `task/epic-28-lobby-emerald-lore` (base: `task/epic-27-redis-economy-store`); implementation `7e56b48`; checkout branch tip after push; PR not opened yet |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Added a `#modeSelect .lobby-lore` section with Russian Emerald Wasteland backstory (2157 portal failure, Pets, gold/eggs/gems/amulets, survive & lead) beside the join card on desktop.
2. Responsive CSS: on narrow viewports lore stacks above the card in a short scrollable block (`max-height` + overflow); nickname/mode CTAs remain usable and primary.
3. Brief README Current-status note for EPIC 28; committed the approved EPIC 28 spec.

## Changed files / areas

- `client/index.html` — lore markup + CSS (layout/contrast); scoped existing mode-select title/paragraph rules to `.mode-select-box`
- `README.md` — EPIC 28 lobby lore note under Current status
- `docs/tasks/epic-28-lobby-emerald-lore.md` — Team Lead–approved spec (included in branch)
- `docs/tasks/epic-28-programmer-handoff.md` — this handoff

## How to verify (steps for Trusya)

1. Start client (and server if needed for gold/lobby lists): from repo root, usual `npm run` / docker compose flow for client Vite + game server.
2. Open the mode-select / main lobby (`#modeSelect`). Confirm lore title **Изумрудная Пустошь** and body beats are readable (what / why / purpose) beside or above the card — not covering Join buttons.
3. Desktop (~1280px): lore column left/side, join card primary and clickable (nickname + Quick Join / vs Bots / Endless).
4. Narrow viewport (~375px): lore in a short scrollable block; nickname field and mode buttons still usable without being covered.
5. Capture Playwright or screenshot evidence under `qa-artifacts/epic-28/` (git-ignored).
6. Confirm no server/protocol diffs in the branch vs base for this EPIC.

## Build and run

- Build command: `npm run typecheck` && `npm run build` (PASS locally at handoff tip)
- Run command: existing client/server workspace scripts / docker compose as for lobby QA
- Expected smoke result: lobby shows Russian lore; CTAs work; client builds cleanly

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: N/A (static HTML/CSS lobby copy)
- Key success messages: N/A

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged — no gameplay state touched
- What the client is allowed to predict/render only: decorative/localized lobby lore only

## Risks / known limitations

- Lore uses system-ui; no new fonts (per out-of-scope). Contrast is secondary to CTAs but intended readable (not pure decorative gray).
- QA screenshot evidence is Tester-owned (`qa-artifacts/epic-28/`).

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
