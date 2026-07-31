# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 3 — The Arena (`docs/tasks/epic-03-arena-map.md`)
- Diff / PR reference: `git diff b9561d8..feature/arena-map` (code `62867d7`, report `cec2023`)
- Tester PASS report reference: `docs/tasks/epic-03-tester-report.md`
- Iteration: 1
- Reviewer: Krisya

## Package gates

All PASS: diff reviewable, Tester report matches commit, every AC traceable, scope matches (no new deps, `git diff -- '*package.json'` empty), 14 gameplay screenshots present and opened directly.

## Verdict

**APPROVED** — shared collision/map data genuinely single-sourced (imports verified directly, not just trusted); server authority holds; typecheck re-run clean; gameplay evidence confirms a real, walkable, wall-blocking de_dust-style arena. Both items flagged for independent judgment resolved as non-blocking.

## Checklist

All 16 items PASS (or correctly N/A: #6 logging — no new game-state transition; #13 shoot — correctly deferred to EPIC 4). Full detail in the agent's own output; key points:

- **#2 Server authority**: `server/src/playerRegistry.ts` `stepPlayer()` computes from server-tracked intent/yaw, clamps, then resolves against shared `ARENA_GEOMETRY` — authoritative regardless of client claims.
- **#9 Scope discipline**: diff limited to `shared/*`, `client/main.ts`+`fpsController.ts`, `server/playerRegistry.ts`, README, docs — matches spec exactly.
- **#14 Visual direction**: distinct low-poly geometry, sandstone/crate/ground material separation, no default-grey look, no visual bugs.

## Findings

None blocking.

### F-NB-1 (carried from Tester) — does not block

Confirmed via direct code read: the corner-pop is a standard limitation of iterative single-axis-MTV AABB resolution at concave corners, not a client-exploitable bypass (speed clamp still runs before collision resolution; server's own math is imprecise by ~8cm at a specific corner, not trusting anything from the client). Tester's farmed 25-cycle test ruling out a sustained exploit is the right test and the numbers hold. No AC requires strict per-tick bounding. Backlog suggestion only: clamp resolved displacement to pre-resolution proposed + epsilon, next time collision code is touched.

### Camera-at-origin pre-lock quirk — confirmed pre-existing, not a regression

Diffed `fpsController.ts` between EPIC 2 baseline and this branch: the pre-lock early-return branch is byte-identical; camera position is only ever set inside the locked branch. Confirmed the same quirk in EPIC 2's own screenshot evidence (less visually confusing there since EPIC 1/2's map was an open field; EPIC 3's mid-lane wall now sits close to world origin, making it look more broken than it mechanically is). Tester's substitution of raw-WS verification for the two-client visual check was correct, not a coverage gap.

## Notes (non-blocking)

- Tighten `resolveHorizontalCollisions()` displacement clamping — backlog, not urgent.
- **Priority suggestion for EPIC 4**: initialize `camera.position` to spawn (or hide canvas until first lock) — EPIC 4 will need clean two-client screenshots for hit-registration evidence, and this quirk actively works against that now that the arena places geometry close to world origin.
- Visual palette is intentionally desert-monochrome (spec-sanctioned) — worth a later accent-color polish pass, not blocking.
- A couple of the 14 screenshots are near-edge-on into a wall (low evidentiary value) but the other 11 more than cover the "multiple vantage points" requirement — doesn't affect verdict, just a framing tip for next time.
