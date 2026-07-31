# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-07-31 |
| Task / Story / EPIC | EPIC 3 — The Arena (`docs/tasks/epic-03-arena-map.md`) |
| Handoff from Pusya (link/commit) | Branch `feature/arena-map` @ `62867d7` (first pass) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- Linux 5.15, Node 24.18.1 (nvm), npm 11.16.0, no Docker.
- Branch / commit: `feature/arena-map` @ `62867d7`

## Check results

### Build

- `npm run typecheck` / `npm run build`: both clean.

### Run

- `npm run dev`: server `ws://localhost:7777`, client on Vite fallback port. Server ran the entire session (extensive raw-WS probing + Playwright) with zero crashes.

### Smoke / scenarios (all independently verified via raw WS, not trusting Programmer's numbers)

| Step | Actual |
|------|--------|
| Single shared map data | Confirmed via grep — `ARENA_GEOMETRY`/`SPAWN_POINTS` defined once in `shared/src/mapData.ts`, imported by client (render + prediction) and server (authoritative) |
| Outer wall collision | Pushed west 4s → landed at x=-45.1 exactly, held steady |
| Divider wall collision | Pushed into west divider → clamped at x=-20.9 |
| Crate collision | Pushed into crate_a1 → clamped at x=-36.6, matches Programmer's claim |
| Mid lane traversable | Confirmed raw WS + visually (`12-vantage-mid-lane.png`) |
| Tunnel traversable | Confirmed raw WS + visually (`13-vantage-tunnel.png`) |
| Spawn points always in-site | 15 samples, all inside Site A/B, never in geometry |
| Client visual: new arena | Confirmed — sandy walls/crates/ground, not EPIC 1 look |
| Client-visual wall stop | Confirmed (`06-after-sustained-walk-wall-stop.png`) |

### Regression pass (EPIC 1/2)

Pointer lock, WASD, jump (server-side arc 0→0.855→falling, consistent with EPIC 2 baseline), mouse-look (via documented synthetic-mousemove fallback), two-client mutual visibility + position sync + disconnect removal (raw WS), flood-guard from EPIC 2's F-001 fix still logging correctly — all OK. Two-client Playwright screenshots were visually inconclusive due to a pre-existing (non-regression) camera-at-origin-before-first-lock artifact, not apparent on EPIC 1/2's smaller map; sync itself independently confirmed via raw WS instead.

### Non-blocking finding: F-NB-1 — single-tick collision "corner pop"

Specifically checked whether collision resolution running after movement integration could let net displacement exceed the speed clamp in one tick. Found one reproducible case: sliding along a wall's corner/edge where the dominant resolution axis flips (x→z or z→x) can produce a single-tick displacement of ~0.330m vs. the nominal cap of 0.25m (5 m/s × 0.05s) — a ~32% one-tick overshoot (~8cm excess).

Farmed deliberately (25 oscillation cycles across the same edge, ~9.2s): average speed over the whole run stayed ≈4.6–5.0 m/s (at/under cap), cumulative excess only ~0.1–0.14m total — not chainable into a sustained speed advantage, self-limiting. Does not defeat the anti-cheat invariant in practice (aggregate speed stays bounded); no AC requires strict per-tick bounding. **Does not block PASS** — flagged for Critic awareness (possible future tightening: clamp resolved displacement magnitude to pre-resolution proposed displacement + small epsilon).

### Config, secrets, docs

All clean/up to date. No secrets in diff.

### Server authority

Confirmed — wall/crate/divider clamping happens in `playerRegistry.ts`'s `stepPlayer()` regardless of client claims, using the same shared `resolveHorizontalCollisions()` as client prediction; client-side collision is feel-only, reconciled per EPIC 2's unchanged `reconcile()`.

### Gameplay & feel

- Screenshots: `qa-artifacts/epic-03/01-initial-arena.png` … `14-vantage-opposite-site.png` (14 total)
- Movement/jump: OK, server-confirmed.
- Shoot: N/A (EPIC 4 scope).
- Controls/feel: OK, no console errors.
- Visual sanity: OK, no black screen/missing textures/z-fighting.
- Matches de_dust-inspired look: yes — sandy ground, sandstone walls, wood crates, two sites + mid + tunnel all visually distinguishable.

## Outcome

**PASS** — ready for Critic review. One non-blocking finding (F-NB-1, small/bounded/non-exploitable) flagged for Critic awareness.
