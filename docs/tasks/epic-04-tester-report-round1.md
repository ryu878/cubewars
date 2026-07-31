# Tester report (Trusya) — EPIC 4, round 1

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-07-31 |
| Task / Story / EPIC | EPIC 4 — Shooting & Combat (`docs/tasks/epic-04-shooting-combat.md`) |
| Handoff from Pusya (link/commit) | `feature/shooting-combat` @ `5f98bd1` |
| Status | **FAIL** |

## Check results (summary — everything except the failure below is clean)

- Build/typecheck: clean, no new deps.
- **Server-authority spoofing attempts (all failed to cause unauthorized damage):** forged `fire` payload fields (origin/direction/targetId/damage/forceHit — `FireEvent` structurally carries none of these), garbage yaw/pitch (999/999, correctly wrapped/clamped), self-declared hit fields, a forged raw `type:"hit"` client→server message (dropped as unknown type). Hit resolution is 100% server-computed from server-tracked position/yaw/pitch.
- **Wall-blocked shot**: confirmed via raw WS (spec's suggested coordinates) AND real Playwright browser client — no hit registers through a wall.
- **Clear-line-of-sight hit**: confirmed via raw WS AND real Playwright client — exact 25 damage, server log matches.
- **Death/respawn**: 4×25=100 dmg kills, dead player frozen (move/fire both rejected server-side, verified via raw WS and real browser client), ~3s respawn to full HP at a valid spawn, other clients see avatar disappear/reappear.
- **Fire-rate vs. DPS**: 50 messages at 20ms intervals → only 4 hits registered, 100 total damage (not 1250) — cooldown correctly caps damage output.
- **HUD/gameplay evidence**: crosshair/health always visible, hit-marker/damage-flash/death-overlay all observed live, Task 7 camera-at-spawn fix confirmed (pre-lock screenshot shows real geometry, not EPIC 3's world-origin void). 10 screenshots in `qa-artifacts/epic-04/`.

## FAIL: F-001 — fire-message flood bypasses the anti-flood debounce, unbounded per-message logging

**Root cause** (`server/src/index.ts`): the generic per-connection flood debounce (`MIN_INPUT_INTERVAL_MS=15ms`) checks `now - lastInputAcceptedAt` for every message, but `lastInputAcceptedAt` is only ever *updated* inside the `"input"` message branch — never inside the `"fire"` branch. A connection sending only `fire` messages (no `input` ever) never updates that timestamp, so the 15ms floor never actually engages for a fire-only stream.

**Reproduction:** raw WS client, `welcome` received, never sends `input`, sends `{"type":"fire"}` in a tight loop for ~1s. **Result: 169,371 messages sent, server processed effectively all of them, wrote 169,459 individual `console.warn` log lines** (one per rejected message, not aggregated) for the 300ms weapon-cooldown rejection, and **zero** flood-guard log lines — the 15ms floor never triggered.

**Impact:** does NOT let a client deal extra damage (the separate weapon cooldown correctly caps damage output, confirmed above) — this is an unbounded message-processing/log-volume (resource exhaustion / log-spam) issue, not a damage-spoofing issue. Contradicts the handoff's explicit claim ("excess fire messages dropped, logged in aggregate not per-message") and `ai-office/checklists/qa-checklist.md`'s "basic rate/abuse guard present if the task adds a new client-triggered server action."

**Suggested fix direction (not prescriptive):** update the shared "last message accepted" timestamp for any accepted message type, not just `input`, so the existing 15ms debounce covers `fire` too; and/or apply the same aggregate-logging pattern already used for the generic flood guard (drop-count + periodic summary) to the fire-cooldown-drop path instead of per-message `console.warn`.

## Outcome

**FAIL** — returned to Programmer per `ai-office/process/process-rework-loop.md` (plain QA fail, not a Critic finding — caught before reaching Critic). Once fixed, a narrow re-verify (F-001 + light regression) is expected to suffice, since everything else passed cleanly on the first try including rigorous server-authority spoofing attempts.
