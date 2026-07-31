# Backlog

Non-blocking follow-ups and accepted design decisions carried forward across EPICs, so they don't get lost inside a single EPIC's task docs. Team Lead triages this when scoping future EPICs.

## Follow-ups (not yet scheduled)

- **Connection heartbeat / stale-connection cleanup** (from `docs/tasks/epic-04-infosec-findings.md`, F2). No WS ping/pong exists — a connection that dies without a clean `close` (dropped wifi, killed process, black-holed NAT) never gets cleaned up: registry/tracking-map entries leak, and the player keeps appearing in broadcasts, blocks hitscan, and auto-respawns forever as an uncontrolled "ghost." Fix: standard `ws` ping/pong pattern with `terminate()` on missed pong.
- **Max-connections cap / hitscan cost at scale** (from `docs/tasks/epic-04-infosec-findings.md`, F3). No cap on concurrent connections; `performHitscan` is O(n) per fire, so aggregate fire-processing cost is O(n²) in concurrently-firing players. Invisible at current (2-player) test scale — revisit deliberately when targeting higher concurrent player counts, don't force a fix now.
- **Collision "corner pop" tightening** (from `docs/tasks/epic-03-critic-review.md`, F-NB-1). Iterative single-axis-MTV AABB resolution can produce a small (~8cm), self-limiting one-tick overshoot at concave wall corners. Not exploitable in aggregate (measured). Backlog: clamp resolved displacement to pre-resolution proposed displacement + epsilon, next time collision code is touched.
- **Camera-at-spawn visual polish**: fixed in EPIC 4 (Task 7) for the FPS controller; no further action needed, noted here only for cross-reference.

## Accepted design decisions (not bugs — document so they aren't "rediscovered" later)

- **`WorldStateMessage` broadcasts `position` and `health` for every player to every connected client**, unfiltered by distance or line-of-sight (from `docs/tasks/epic-04-infosec-findings.md`, F4). A client reading the WS feed directly (bypassing the renderer) gets persistent map-wide position/HP awareness of every opponent. `pitch` (aim direction) is correctly **not** broadcast, so exact aim-through-walls is not leaked. Accepted as a reasonable simplification for this game's current casual small-arena FFA scope. Revisit with per-recipient LOS/distance-gating if competitive integrity becomes a priority (e.g. ranked play, larger matches, anti-cheat-sensitive audience).
- **Crates in the arena are full-height blocking obstacles, not climbable** (from `docs/tasks/epic-03-arena-map.md`). Deliberate simplification — max jump height is well under crate height anyway, so climb logic wouldn't be meaningfully usable.
- **Player hitboxes are an AABB approximation** (radius 0.5, height 2.2) of the rendered capsule, not a true capsule/cylinder intersection test (from `docs/tasks/epic-04-shooting-combat.md`). Accepted per the fixed stack's "no physics engine" constraint.
