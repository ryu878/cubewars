# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Task / Story / EPIC | EPIC 15 — Fire/Input Debounce Cross-Type Interference Fix (`docs/tasks/epic-15-fire-input-debounce-fix.md`), Stories 15.1/15.2/15.3 |
| Handoff from Pusya (link/commit) | `feature/fix-fire-input-debounce` @ `13825ba` (4 commits over base `e632675`: `b0ee0d0` Story 15.1, `44aff5e` Story 15.2, `13825ba` Story 15.3) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no — first Tester pass on this EPIC |

## Environment

- OS: Linux 5.15.0-139-generic; Node via repo's own toolchain (`tsx`, `vite`)
- Branch / commit: `feature/fix-fire-input-debounce` @ `13825ba` (working tree clean throughout, confirmed via `git status` before/after all measurements)

## Check results

### Build

- Command: `npm run typecheck` (workspace-wide: shared, server, client) and `npm run build` (server + client)
- Result: OK — both clean, zero errors/warnings beyond the pre-existing unrelated >500kB chunk-size notice.

### Run

- Command: `npm run dev` (server on :7777, client on :5175); regression script self-spawns its own server subprocess on :7778
- Result: OK — server starts cleanly, client loads, WS connects.

### Diff/scope verification

`git diff e632675..HEAD --stat` touches exactly `README.md`, `package.json`, `scripts/regression-fire-input-drop-rate.mjs`, `server/src/index.ts` — matches the spec's declared scope exactly. No game/simulation logic file touched (`playerRegistry.ts`, `combat.ts`, `match.ts` untouched). `git diff e632675..HEAD -- package.json server/package.json client/package.json shared/package.json` shows only a new npm script alias (`regression:fire-input-drop-rate`) — no new dependency. Read the full `server/src/index.ts` diff line-by-line: matches Section 2.4's required implementation shape exactly (`FLOOD_WINDOW_MS=1000`, `MAX_MESSAGES_PER_WINDOW=100`, true sliding window with `.shift()`-pruning, pre-parse placement preserved, `messageTimestamps` cleared on `close`, `floodDropTracker` wording updated). Confirmed `lastFireAcceptedAt`/per-weapon cooldown gate (lines 278-297) and `maxPayload` (line 67, Infosec F1) are byte-for-byte untouched.

### Secrets/config

- No secrets in diff (grepped for api-key/secret/password/token/PEM patterns — none found).
- No new env vars, no config file changes.

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| `npm run typecheck` | clean | OK, clean |
| `npm run build` | clean | OK, clean |
| Independent run of `npm run regression:fire-input-drop-rate` (fixed code, 3 runs) | control ~0%, real-arch ~0%, true-flood bounded + O(1) logs | control 0.0% (3/3 runs), real-architecture 0.0% (3/3 runs), true-flood `input`/`unknown-type` bounded (dropped 8861-9281 of ~12000-12600 sent), 2 aggregate log lines each (O(1), not O(message count)) |
| "Before" baseline via git worktree @ `8cbe78e` (pre-fix code, same script, same methodology, port 7779) | ~39-56% drop rate on real-architecture case, reproducing Critic's original finding | 4 runs: **44.7%, 29.7%, 42.1%, 34.2%** (avg ~37.7%). Control case 0.0% in all 4 runs (harness itself sound). See note below on variance. |
| Fire-only flood (never sends `input`) — round-1-era EPIC-4 gap re-check | cap still engages, bounded | PASS — sent 12,100, dropped 8,824 (flood-guard), 2 aggregate log lines |
| Binary message flood — round-2-era gap re-check | bounded, O(1) logging | PASS — sent 12,520, flood-guard-dropped 9,181 (2 lines) + binary-tracker-dropped 501 (2 lines) |
| Oversized message flood — round-2-era gap / Infosec F1 re-check | rejected before app code sees it | PASS — socket closed by `ws` itself with code 1009 (`maxPayload` framing rejection) after 1 send attempt, confirming Infosec F1's fix is intact |
| Non-JSON message flood — round-2-era gap re-check | bounded, O(1) logging | PASS — sent 12,460, flood-guard-dropped 9,143 (2 lines) + non-JSON-tracker-dropped 501 (2 lines) |
| Live browser playtest (bots match): join, move (WASD), jump, single shot, 10-click rapid-fire burst (50ms apart, pistol cooldown 300ms), switch_weapon attempt | normal play never hits flood guard; cooldown gate still throttles rapid clicking | PASS — 0 flood-guard log lines across the entire session; exactly 1 `fire rate limit` log line during the rapid-fire burst (aggregate-throttled, consistent with several drops beyond the first), confirming the per-weapon cooldown gate is intact and not bypassed by the new, more permissive window cap; HUD/health/armor/weapon state all update correctly; no console errors |

**Note on "before" baseline variance**: my 4 runs (29.7%-44.7%, avg 37.7%) sit slightly below Critic's originally-documented 39.2-56.0% range on the low end of one run (29.7%), but this is exactly the kind of live-timing variance the spec's own Risk section anticipates ("live-network timing measurements have inherent variance... Story 15.2 requires the baseline fall in the same broad range, not an exact match"). Sample size per run is small (~37-38 fire attempts over 15s), so single-run variance is expected. All 4 runs are unambiguously non-trivial, well above noise, consistent in order of magnitude with the theoretical ~45% prediction (15/33), and — critically — the "after" comparison (0.0% in 3/3 runs) is the actual claim being proven and is unambiguous. I consider this baseline reproduction successful.

### Config and secrets

- `config.vars.example` / README up to date: yes — README EPIC 15 section added with Programmer's self-check numbers (0%/0%, bounded flood).
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — EPIC 15 section present, consistent style with EPIC 13/14 entries, no drift found against actual measured behavior.

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — this change is purely a transport-layer accept/reject gate; no client-supplied value is trusted anywhere in the diff (confirmed by reading the full diff — the only new state is server-local timestamps).

### Gameplay & feel

- Screenshot/evidence path(s): `qa-artifacts/epic-15/gameplay/01-joined-bots.png` through `06-after-switch-weapon-attempt.png` (all opened and visually inspected)
- Movement: OK — WASD movement confirmed, HUD renders normally, no regression.
- Jump: OK — space triggers jump, no getting stuck.
- Shoot / hit registration: OK — ammo/HUD track correctly; fire-cooldown gate independently confirmed intact via server log (1 `fire rate limit` drop during a 10-click/50ms-interval burst against pistol's 300ms cooldown).
- Camera / controls feel: OK — pointer lock engages, no jank observed.
- Visual sanity: OK — no black screen, no missing textures, blocky/colorful arena renders as expected; this is a backend-only diff so no visual code was touched, consistent with observed unchanged visuals.
- Matches intended "Roblox-like" look: yes — unchanged from prior EPICs, as expected (no client change).
- No new regressions to movement/jump/shoot: none observed.

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`).

Briefly verified:
1. `npm run typecheck`/`npm run build` clean; diff scope matches spec exactly (`server/src/index.ts`, `scripts/`, `package.json`, `README.md` only); no new dependency; no secrets.
2. Independently re-ran `npm run regression:fire-input-drop-rate` against the fixed code 3 times: 0.0% drop on control and real-architecture cases every time; true-flood (`input`, `unknown-type`) bounded with O(1) (2-line) aggregate logging.
3. Independently reproduced the "before" baseline via a git worktree at pre-fix commit `8cbe78e` (Programmer did not do this — it was this Tester's own responsibility per Story 15.2): 4 runs, 29.7%-44.7% (avg 37.7%), confirming the defect's real magnitude on this exact codebase, in the same order of magnitude as Critic's originally-measured 39.2-56.0% range, with the harness's own control case at 0.0% proving the harness sound both before and after.
4. Explicitly re-exercised (not just read) both EPIC-4 Critic REVISE-round gaps against the fixed code, with my own ad-hoc scripts covering shapes the Programmer's script didn't (fire-only flood, binary flood, oversized flood, non-JSON flood) in addition to the Programmer's own `input`/`unknown-type` coverage: all four remain closed, all bounded, all O(1)-logged; oversized payloads correctly rejected at the `ws` framing layer (Infosec F1 untouched).
5. Live browser playtest (Playwright, bots match): join/move/jump/fire/switch_weapon all work end-to-end; 0 flood-guard hits under normal play; per-weapon fire-cooldown gate confirmed still throttling rapid clicking via server log, not bypassed by the new window cap.
6. `git status` clean on the feature branch throughout (worktree used for the pre-fix baseline was removed after use; no stray uncommitted changes).

No FAIL conditions found. Recommend proceeding to Critic, and per the EPIC's mandatory pipeline, Critic → **Infosec** (required given this file's two-round EPIC-4 Critic history + the EPIC-4 Infosec F1 finding on this exact code) → Judge only on genuine REVISE → Team Lead final checks → merge.
