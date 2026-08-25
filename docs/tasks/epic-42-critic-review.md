# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 42 — Lobby Telegram Label + Pre-Match Inventory (Stories 42.1 + 42.2)
- Diff / PR reference: branch `task/epic-42-lobby-telegram-inventory` @ `ca19b2b8bac7f11decfeb4188f2a5cd58940c7c2` (feat `e9d7d72`); compare `master...HEAD` (15 files, +1039/−242)
- Tester PASS report reference: `docs/tasks/epic-42-tester-report.md` (commit match `ca19b2b…`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` at `ca19b2b` — client/server/shared/scripts/README |
| Tester PASS report matches this commit | PASS | `docs/tasks/epic-42-tester-report.md` Meta branch/commit = `ca19b2b8bac7f11decfeb4188f2a5cd58940c7c2`; Status **PASS** |
| Every acceptance criterion traceable to a change or explicit note | PASS | Telegram copy `client/index.html`; Inventory btn + overlay wire; `lobby_bind_nickname` + Deathmatch mutate path `server/src/index.ts`; hotkey gate unchanged `uiInput.ts`; drop/trade/ground `match_required`; README Current status; typecheck/build/regression cited by Tester |
| Scope matches the task (no unexplained extra changes) | PASS | Spec-aligned: shared `applyInventoryEconomyAction` / `toEconomyProfileMessage` extract; optional lobby avatar persist (spec §3.2.4 allowed); regression script; no unrelated features |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-42/01*.png`–`06*.png` + `smoke-summary.json` (`ok: true`) |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Diff implements exact Telegram label/href (`client/index.html`), reuses `#inventoryOverlay` via lobby `setOpen(true)` (`main.ts`), and server-binds Deathmatch-only economy with match-only drop/trade/ground rejects (`server/src/index.ts` lobby_bind + `applyInventoryEconomyAction(..., "deathmatch")`); screenshots/`smoke-summary.json` corroborate Tester PASS.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | Telegram text/href exact (`client/index.html` lobby-telegram anchor); `#lobbyInventoryBtn` → `ModeSelect.requestInventory` → `lobby_bind_nickname` + `inventoryOverlay.setOpen(true)` (`modeSelect.ts`, `main.ts`); empty-profile copy updated (`inventoryOverlay.ts`); invalid nick UX in `02-invalid-nickname-error.png` / smoke `invalidNickname.error` |
| 2 | Server authority for gameplay-relevant state | PASS | — | `normalizeNickname` + `nicknameReady` without match join (`server/src/index.ts` `lobby_bind_nickname`); mutations only via `applyInventoryEconomyAction(..., "deathmatch")`; drop/trade/ground → `match_required`; bag only from `economy_profile` (`main.ts` `onEconomyProfile`) |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Plain HTML/CSS/TS + `ws` + shared protocol; no new UI framework/deps (`package.json` only adds `regression:lobby-inventory` script) |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets in diff; Telegram `rel="noopener noreferrer"`; nickname normalize reused; economy still nickname-keyed (same trust model as join/auction per spec) |
| 5 | Error handling | PASS | — | Invalid nick → `economy_action_result` `lobby_bind`/`nickname_invalid`; bind profile failure logged + `not_found`; lobby mutate failure → result + warn log (`server/src/index.ts`) |
| 6 | Logging / observability | PASS | — | `[lobby] nickname bound…`; `[economy] … [lobby/deathmatch]`; confirmed in `playwright-console.log` line for L428ub2 bind |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | note | Regression covers invalid bind, Deathmatch profile without `join_accepted`, drop/trade `match_required` (`scripts/regression-lobby-inventory.ts`); Playwright covers Telegram, auth gate, hotkey-I, in-match I/P, move/jump. **Gap (non-blocking):** no seeded successful lobby equip/move round-trip — mitigated by shared helper with match path |
| 8 | Readability / maintainability | PASS | — | Inventory switch extracted to `server/src/economy/inventoryActions.ts`; profile DTO to `profileMessage.ts`; `parseLobbyInventoryIntent` documented at top of `server/src/index.ts` |
| 9 | Scope discipline | PASS | — | Diff limited to EPIC 42 surfaces + helper extract from `match.ts`; docs/handoff/spec on branch |
| 10 | Config / docs updated | PASS | — | README Current status EPIC 42 paragraph; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | — | No leftover debug; intentional empty-branch elsewhere N/A |
| 12 | Regression risk considered | PASS | — | In-match I/P preserved (`05-inmatch-inventory-I.png`, smoke `openedByI`); bots Sandbox pool still shown after join (distinct from lobby Deathmatch in `03`); `uiInput.shouldIgnoreGameHotkey` unchanged |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `06-inmatch-gameplay.png` + smoke `gameplay.moved` / y lift after W+Space; shoot N/A to AC |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Lobby + arena bricks/figures readable in `01`/`05`/`06`; inventory overlay intact in `03`/`05` |
| 15 | Controls & feel usable | PASS | — | Lobby Inventory button obvious under gold (`01`); I ignored while typing (`04`, nick `iiii`); pointer lock + I/P in-match (`05`/`smoke-summary`) |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | Pre-match inventory goal met: same overlay opens from lobby with Deathmatch profile without join (`03`, `joinCount: 0`) — usable for the stated problem |

## Findings (actionable)

_None (no critical/major/minor blocking findings)._

## Revision task (if REVISE)

- Finding IDs to fix: N/A
- Out of scope for this revision: N/A
- Re-verify required: no

## Notes (non-blocking)

- **N-001 (coverage):** Prefer extending `npm run regression:lobby-inventory` with a seeded Deathmatch item + one lobby `economy_equip_pet` / `economy_move_item` success assertion so the mutate path is exercised beyond rejects. Not required to merge — shared `applyInventoryEconomyAction` already backs match + lobby.
- **N-002 (auth model):** `lobby_bind_nickname` is not account-gated server-side; client disables Inventory until sign-in. Matches existing nickname-keyed economy / join trust model called out in the spec — do not treat as a silent auth upgrade.
- **N-003:** Lobby avatar color persist via Redis (`avatar_set_color` when `!match && nicknameReady`) is an allowed optional path from the spec; pets/items remain the required AC and are covered by the Deathmatch inventory path.
