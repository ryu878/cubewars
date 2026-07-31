# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-07-31 |
| Task / Story / EPIC | EPIC 2 — Player Movement & Multiplayer Sync (`docs/tasks/epic-02-movement-and-sync.md`) |
| Handoff from Pusya (link/commit) | Branch `feature/movement-and-sync` @ `2e56620` (first pass, not a revision round) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15, Node 24.18.1 (via nvm), npm 11.16.0. No Docker involved.
- Branch / commit: `feature/movement-and-sync` @ `2e56620`

## Check results

### Build

- Command: `npm run typecheck` then `npm run build` (root, all three workspaces)
- Result: OK — both clean, no errors/warnings.

### Run

- Command: `npm run dev` (root) — server on `ws://localhost:7777`, client on Vite (fell back to 5174, 5173 occupied by an unrelated local tunnel)
- Result: OK — server logged `listening on ws://localhost:7777` / `tick rate: 20Hz (50ms)`; client reached `connected` state.

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Single-client pointer lock | Click canvas → pointer lock engages, hint hidden | OK |
| Single-client WASD | Holding W ~1.5s moves ≈ maxSpeed×time | OK — 7.5m in 1.5s = exactly 5 m/s (maxSpeed), server-authoritative |
| Single-client jump | Rise, peak, fall, land | OK — full arc observed via sampled Y (0 → 0.84 peak → 0) |
| Single-client mouse-look | Yaw changes, pitch clamped | OK, via a documented fallback (Playwright's native pointer-lock mouse simulation is unreliable headless — a known artifact, not an app bug; dispatched synthetic `mousemove` with explicit `movementX/Y` instead, confirmed correct via server-echoed yaw + visual rotation) |
| Two-client mutual visibility | P1 moves → P2's view of P1 shifts | OK — 8.5m shift observed in P2's `world_state` view of P1; screenshots confirm |
| Two-client disconnect removal | P1 disconnects → avatar removed from P2 | OK — confirmed via raw WS and Playwright two-context test |
| No self-avatar rendered | Own avatar never shown to self | OK — code + screenshots consistent |
| Server-authority: normal input | Displacement bounded by maxSpeed×elapsed | OK — 5.75m/1.2s, within 6.91m bound |
| Server-authority: absurd input (moveForward: 99999) | Clamped, no teleport | OK — 1.5m/300ms, consistent with clamp-to-[-1,1] |
| Server-authority: flood (2ms interval) | Bounded by speed clamp regardless of send rate | OK — 479 msgs/1.2s → 6.0m displacement, within 6.92m bound |
| Server-authority: malformed JSON | Dropped, logged, socket stays open | OK |
| Server-authority: wrong-shape input | Dropped, logged, socket stays open | OK |
| Server-authority: oversized payload (2077B) | Dropped, logged, socket stays open | OK |
| Server crash/stability | No crash across all abuse | OK — full server log reviewed, zero uncaught exceptions |

**Non-blocking note for Critic:** the flood guard (`server/src/index.ts`) silently drops sub-15ms messages with **no log line** (unlike malformed/oversized/out-of-range drops, which are all logged). The speed-clamp bound holds regardless (not exploitable), but this is a minor gap against `security-baseline.mdc`'s "log anomalous input patterns" guidance — a real flood attack currently leaves zero log trace. Does not block PASS (no AC requires it), flagged for Critic.

### Config and secrets

- `config.vars.example` / README up to date: yes — no new env vars this EPIC.
- No secrets in diff: yes.

### Documentation

- README / docs updated: yes — new "Controls" section, status updated.

### Server authority

- Server validates/computes the relevant state, not the client: **yes** — verified independently via raw WebSocket clients bypassing the UI entirely.

### Gameplay & feel

- Screenshot/evidence path(s): `qa-artifacts/epic-02/01-single-initial.png` … `08-single-mouselook-fallback-verification.png` (8 screenshots)
- Movement: OK — WASD displacement measured at exactly maxSpeed.
- Jump: OK — clean rise/peak/fall/land cycle.
- Shoot / hit registration: N/A — not in EPIC 2 scope.
- Camera / controls feel: OK — pointer lock instant, mouse-look math verified correct, no console errors.
- Visual sanity: OK — no glitches across all 8 screenshots.
- Matches "Roblox-like" look: yes — unchanged styling from EPIC 1.

## On FAIL: reproduction

N/A — PASS.

## Outcome

- **PASS:** ready for Critic review. Independently verified: build/typecheck clean; single-client pointer lock/WASD/jump/mouse-look (via documented fallback for a headless-Playwright limitation, not an app bug) all confirmed against server-authoritative state, not visual impression; two-client mutual visibility and disconnect-removal confirmed both via raw WS and Playwright; server-authority/anti-cheat independently reproduced (normal/absurd/flood input all bounded by speed clamp, malformed/oversized/wrong-shape input dropped and logged except pure-rate floods — see non-blocking note); server log reviewed end-to-end, no crashes; no secrets; docs accurate.
