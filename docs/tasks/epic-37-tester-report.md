# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 37 — Competitive Leaderboard Excludes "vs Bots" Kills |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-37-programmer-handoff.md` / feature `226f8dd` / branch tip `080f48f` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (host Node via nvm v24.18.1 / npm 11.16.0); Redis available (`PONG`); Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-37-leaderboard-excludes-bots-mode` @ `080f48f399f85459c102762cf7142be6ac133511`

## Checklist sections applied

- Universal (AC, secrets, docs)
- Build and run
- Backend / game server (server-side career LB gating; no new env vars)
- Real-time / multiplayer: N/A for reconnect/rate limits (no new client-triggered action)
- Gameplay & feel: exercised only as needed for live AC 37.4 (vs Bots kill path); change itself is LB-stats gating, not movement/visual redesign

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client typecheck PASS; server `tsc` PASS; client Vite production build PASS

### Run

- Command: `npm run regression:leaderboard && npm run regression:leaderboard-excludes-bots`
- Result: OK — `[leaderboard] PASS`; `[leaderboard-excludes-bots] PASS`
- Live: `node qa-artifacts/epic-37/qa-epic37-tester-live.mjs` (dedicated server `:7781` / client `:5197`) — PASS

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Diff scope | `match.ts` + optional regression/cleanup; no protocol/client | Confirmed: `server/src/match.ts`, `scripts/regression-leaderboard-excludes-bots.ts`, `package.json`, `docs/tasks/epic-37-programmer-handoff.md` only |
| Gate in `match.ts` | `onKillRecorded` only when `mode === "public"`; endless branch untouched | Confirmed: `else if (this.mode === "public")` around career record; endless `endlessBotKills` / `removeBot` path unchanged |
| Regression bots mode | kill does **not** call `onKillRecorded` | PASS (`recorded.length === 0`) |
| Regression public mode | human-vs-human kill still calls `onKillRecorded` with nicknames | PASS (`[["KillerPublic","VictimPublic"]]`) |
| Regression endless | no career `onKillRecorded`; `endlessBotKills` +1; bot removed | PASS |
| Existing `regression:leaderboard` | still PASS | PASS |
| Live vs Bots kill (37.4) | career LB unchanged for human; no new `"Bot N"` row from this kill | PASS — killer `Epic37Qannz3f4` eliminated `Bot 2`; `leaderboard-before.json` === `leaderboard-after.json` (10 entries); fresh nick not on board; pre-existing `"Bot 1"`/`"Bot 2"` pollution unchanged (out of scope per EPIC §4) |
| Optional purge script (37.2) | optional; skip OK if not cheap | Skipped by Pusya (no store purge API) — accepted; not an AC failure |

### Config and secrets

- `config.vars.example` / README up to date: N/A — no new env vars or setup changes
- No secrets in diff: yes

### Documentation

- README / docs updated: yes for task docs (`docs/tasks/epic-37-*.md`); README unchanged (behavior nuance is EPIC-scoped; no new run instructions)

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — career K/D still only via server `onKillRecorded` → `MatchManager.recordKill` → `EconomyStore.incrementCareerKillDeath`; this change only narrows which modes invoke that path. Client never writes career stats.

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-37/01-lobby-before-bots.png`
  - `qa-artifacts/epic-37/02-bots-match-joined.png`
  - `qa-artifacts/epic-37/03-after-bot-kill.png`
  - `qa-artifacts/epic-37/leaderboard-before.json` / `leaderboard-after.json` / `results.json` / `server-log.txt` / `ws-messages.json`
  - Runner: `qa-artifacts/epic-37/qa-epic37-tester-live.mjs` (local/gitignored artifacts dir)
- Movement: OK — live script drove WASD approach toward bot via real client WS `input`
- Jump: N/A — not required for this AC
- Shoot / hit registration: OK — server-confirmed kill feed `"You eliminated Bot 2"`; WS `kill` with `attackerId` = self, `victimNickname` = `Bot 2`
- Camera / controls feel: OK for verification path (aim via yaw/pitch on real WS); no new control changes in this EPIC
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — lobby + in-match HUD/kill feed readable in screenshots
- Matches intended "Roblox-like" look (colorful, readable, low-poly): N/A for delta — no visual/art change; scene/HUD consistent with existing build

## On FAIL: reproduction

N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified: typecheck/build green; existing `regression:leaderboard` PASS; new `regression:leaderboard-excludes-bots` PASS (bots excluded, public still records, endless progress/removal unchanged); live vs-Bots kill left career leaderboard byte-identical before/after under `qa-artifacts/epic-37/`; diff confined to server gate + regression + package script + handoff docs. Historical `"Bot N"` leaderboard pollution remains (explicitly out of scope). Optional purge script not shipped — acceptable per EPIC §4 / task 37.2 optional.
