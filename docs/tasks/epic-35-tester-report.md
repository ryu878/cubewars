# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 35 — Split Economy — Deathmatch vs Sandbox Pools (AC §8; tasks 35.1–35.3, 35.5–35.7; not 35.4) |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-35-programmer-handoff.md` @ `2371da6` / feature `708af28`; QA on branch tip `bdaa7d8` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node via nvm v24.18.1 / npm 11.16.0; Redis `PONG` on `:6379` (host already bound; compose recreate skipped); Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-35-split-economy-deathmatch-sandbox` @ `bdaa7d87c9d506842b3b5201ce66383fefbfb818`

## Check results

Checklist sections applied: **Universal**, **Build and run**, **Backend / game server**, **Client**, **Gameplay & feel** (UI/pool labeling + light move/look smoke). Real-time reconnect/rate-limit N/A (unchanged). Docs verified.

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client typecheck clean; server `tsc` + client Vite production build OK

### Run

- Command: `PORT=7777 npm run dev --workspace=server` + `npm run dev --workspace=client -- --port 5185 --strictPort --host 127.0.0.1`
- Result: OK — WS `listening on ws://localhost:7777`; Vite `http://127.0.0.1:5185/` HTTP 200; startup logged legacy→deathmatch migrations then leaderboard hydrate

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Isolation invariant (`regression:split-economy`) | Sandbox gold/eggs invisible to deathmatch reads; sandbox mutate does not change DM; sandbox bot kill mints sandbox only | **PASS** — DM gold 100 / SB 50+egg; SB +7 leaves DM at 100; bot kill mint `[scope=sandbox]`; public non-human victim zero |
| Migration (`regression:split-economy`) | Legacy unscoped key → deathmatch on first read, gold preserved | **PASS** — log `migrated legacy profile -> deathmatch for legacyplayer`; gold 777 retained |
| Deathmatch EPIC 32 (`regression:bot-kill-no-reward`) | Public/non-human → zero; human kill → deathmatch gold | **PASS** — `no reward … [scope=deathmatch]`; human kill `+397 … [scope=deathmatch]` |
| Sandbox bot kills → sandbox only | Bots-mode bot kill mints sandbox gold/items; not deathmatch | **PASS** — `+30 … [scope=sandbox]` + egg/stim drops; paired with split-economy isolation asserts |
| Economy suite defaults (deathmatch) | `economy-gold/pets/gems-amulets/persistence/inventory` still PASS | **PASS** all five |
| Leaderboard gating not re-done here | EPIC 37 owns `onKillRecorded` public-only gate; EPIC 35 must not conflict | Confirmed in `match.ts`: `onKillRecorded` only under `mode === "public"` (EPIC 37); no duplicate EPIC 35.4 work |
| UI pool labels (Playwright) | Mode-select Deathmatch/Sandbox labels; inventory badge matches mode | **PASS** — see evidence; console errors `0` |
| Docs | README + TZ document split / anti-farm | **PASS** — README EPIC 35 block; TZ §3.0 + drop-victim table |

### Config and secrets

- `config.vars.example` / README up to date: yes (no new env vars; README behavior updated)
- No secrets in diff: yes (feature diff `708af28` vs `master`: store/match/client/shared/scripts/docs only)

### Documentation

- README / docs updated: yes — `README.md`, `docs/product/emerald-wasteland-economy-tz-v2.1.md`

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — `economyScope()` from `match.mode` only; grants/profile mutations take server `scope`; client renders `economyPool` from `economy_profile` and cannot select pool

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-35/`
  - `01-mode-select-labels.png` — Quick Join — Deathmatch / vs Bots — Sandbox / Endless — Sandbox + pool hint + isolation copy
  - `02-bots-match-ingame.png` / `04-public-match-ingame.png` — joined bots vs public, HUD visible
  - `03-inventory-sandbox-badge.png` — `Pool: Sandbox (bots / endless — separate from Deathmatch)`
  - `05-inventory-deathmatch-badge.png` — `Pool: Deathmatch (competitive)`
  - `smoke-summary.json`, `qa-smoke.mjs`, server/client logs
- Movement: OK — WASD smoke in bots + public after join
- Jump: N/A — not in EPIC 35 scope; not exercised beyond existing HUD
- Shoot / hit registration: N/A for visual feel — kill-reward routing covered by regressions (server-side), not live PvP in this smoke
- Camera / controls feel: OK — pointer look / canvas click usable in smoke
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — arena, bots, HUD, inventory overlay render
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky arena + bot avatar visible in bots match

### Notes (non-blocking)

- `npm run regression:economy-redis-safety` still fails locally with missing `better-sqlite3` native bindings (pre-existing tooling; import path not required for EPIC 35 AC). **Not a FAIL** for this epic.
- Live Redis on QA start showed many `[economy] migrated legacy profile -> deathmatch for …` lines — consistent with idempotent migration behavior.

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: AC §8 isolation + migration + sandbox-only bot rewards + deathmatch EPIC 32 behavior (regressions), UI pool labels (Playwright evidence), docs, typecheck/build, economy suite; leaderboard gating left to EPIC 37; redis-safety/sqlite noted only.
