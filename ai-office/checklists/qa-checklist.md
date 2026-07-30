# QA checklist (Tester)

Run on **every** handoff from the Programmer before handing to Critic.

**Check scope** comes from the **specification (Acceptance Criteria)** and **delivery type** (backend/game-server, client, shared/protocol, docs-only, etc.). Not every item below is required for every task — mark **only what applies** and state in the report what was checked.

---

## Universal

- [ ] **Acceptance Criteria** from the specification verified item by item.
- [ ] No secrets in the repository.
- [ ] README / docs updated when behavior or setup changed (if the task changed behavior or how to run).

---

## Build and run (if applicable)

- [ ] **Build:** build step completed successfully (`docker compose build`, client build, package install, etc. — **as stated in the spec**).
- [ ] **Run:** run step completed successfully (service starts, client loads, script finishes — **as stated in the spec**); no unjustified crash on start.

If the task has **no** build/runtime (e.g. markdown only, config-only change) — these items **do not apply**; write "N/A" in the report with a brief reason.

---

## Platform checks

Mark the sections that apply to the task.

### Backend / game server

- [ ] Dependencies and run per README / package manifest / spec; smoke the main path (API, WebSocket connect + basic message round trip).
- [ ] New environment variables documented in README and/or `config.vars.example`.
- [ ] Important actions are logged; no "silent" failures without reason (if the spec expects logging).
- [ ] Server does not trust unvalidated client input for gameplay-relevant state (if applicable to the task).

### Client (web/game client)

- [ ] Build/dev server per README; client loads; key scenario from the specification works.
- [ ] No console errors on the main path exercised by the task.

### Real-time / multiplayer

- [ ] Reconnect/disconnect behavior matches spec (if the task touches connection lifecycle).
- [ ] Basic rate/abuse guard present if the task adds a new client-triggered server action (if applicable).

### Docs / config only without a service

- [ ] Changes aligned with the spec; links and paths correct; no secret leakage in text.
- [ ] If config changed — consistency with the rest of the repo and instructions (README) checked.

---

## Gameplay & feel (mandatory whenever the task touches player-facing mechanics or visuals)

Written claims ("works fine") are not sufficient here — capture **screenshots** (Playwright, saved under `qa-artifacts/<task-id>/`) or describe **exact** observed behavior step by step. Critic will look at this evidence directly.

- [ ] **Movement** — player can move; direction/speed feels like the spec intends (not a written guess — actually moved the character).
- [ ] **Jump** (if in scope or already existing in the build) — character jumps, leaves the ground, lands correctly; no getting stuck.
- [ ] **Shoot / aim** (if in scope or already existing in the build) — weapon fires, projectile/raycast travels, hits register against a target (server confirms the hit, not just a client-side visual effect).
- [ ] **Camera / controls** — usable without obvious jank, inversion bugs, or getting stuck looking the wrong way.
- [ ] **Visual sanity** — no black screen, missing textures/models, obviously broken lighting, or severe z-fighting in the captured screenshots; scene resembles the intended blocky/low-poly, colorful "Roblox-like" direction, not an unstyled default Three.js scene.
- [ ] **No new regressions** to previously-working mechanics (movement/jump/shoot) caused by this change, if the task could plausibly affect them.

If the task is genuinely unrelated to gameplay/visuals (e.g. a backend-only refactor with no player-visible effect, docs-only), mark this section **N/A** with a one-line reason.

---

## Report

- [ ] `ai-office/templates/tester-report-template.md` filled (PASS or FAIL); report states **which checklist sections** applied and what exactly was verified.
