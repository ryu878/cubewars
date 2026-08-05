# EPIC 12: Jumpable Crates (Climbable Cover)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Jumpable Crates (Climbable Cover) |
| **System goal** | The crates scattered around the arena (Site A/B cover boxes, mid-lane cover boxes) become climbable platforms: a player can jump up onto a crate's top surface and stand/walk on it, not just collide with it as a full-height wall-like obstacle. |
| **Business/gameplay problem** | Direct user feedback (Russian): "на небольшие выступы можно было запрыгивать, там которые на карте стоят такие тумбы" — "make it so you can jump onto the small ledges/pedestals on the map, the crate-like things standing there." |
| **Architectural role** | shared (new height-aware collision helpers + jump tuning, single source for client+server, same discipline as EPIC 11) + server (authoritative vertical/horizontal collision now height-aware) + client (local prediction mirrors the identical logic) |
| **Main components** | `shared/`, `server/`, `client/`, `docs/` |
| **Stack** | Fixed project stack, no deviation — still hand-rolled AABB collision, no physics engine, no new mantle/vault input. This is a math change to existing collision resolution (which axis/height a box blocks on) plus one tuning constant, not a new system. |
| **Interaction with other components** | Directly reverses the deliberate EPIC 3 simplification documented in `docs/backlog.md` ("crates are full-height blocking obstacles, not climbable ... max jump height is well under crate height anyway") and in the doc comment at the top of `shared/src/collision.ts`. Touches `MOVEMENT.jumpSpeed` (`shared/src/index.ts`), adds new helpers next to `resolveHorizontalCollisions`/`resolveSteppedMovement` (`shared/src/collision.ts`), and changes the vertical/horizontal collision call sites in both `server/src/playerRegistry.ts` `stepPlayer()` (authoritative) and `client/src/fpsController.ts` `update()` (local prediction) — the same two call sites EPIC 11 Story 11.1 already unified onto one shared helper. `ARENA_GEOMETRY` itself (`shared/src/mapData.ts`) is **not** modified — same crates, same positions/sizes, only how collision treats their height changes. |

---

## 2. Design decision: jump height vs. crate height (fixed by Team Lead)

- Current physics: `jumpSpeed = 6`, `gravity = 18` → ballistic apex `= jumpSpeed² / (2·gravity) = 36/36 = 1.0m`. `CRATE_HEIGHT = 1.2` (`shared/src/mapData.ts`). **A player literally cannot reach crate-top height today** — this is *why* EPIC 3 accepted crates as non-climbable in the first place (see `docs/backlog.md`).
- Chosen fix: **raise `MOVEMENT.jumpSpeed` modestly**, not a new mantle/auto-climb mechanic and not a lowered `CRATE_HEIGHT`. Rationale: simplest, most predictable option; keeps the existing "no physics engine, hand-rolled ballistic jump" model completely unchanged in kind, only tuned in magnitude; a mantle mechanic would be new system complexity for no real benefit here since a modest ballistic apex increase is enough.
- **New `MOVEMENT.jumpSpeed = 6 * 1.25 = 7.5`** — expressed as the lineage (`6 * 1.25`), not a bare `7.5` literal, matching this project's established style for tuned constants (`MOVEMENT.maxSpeed`, `BUNNY_HOP` fields). New apex `= 7.5² / (2·18) = 56.25/36 = 1.5625m` — clears `CRATE_HEIGHT` (1.2m) by **~0.36m (≈30%)**, a comfortable, deliberately-not-razor-thin margin so mounting a crate doesn't require frame-perfect timing.
- **Do not** change `gravity` or `BUNNY_HOP` fields as a side effect. Bunny hop's `verticalBoostFraction` (0.4) automatically scales with the new `jumpSpeed` (kick becomes `0.4 * 7.5 = 3.0` instead of `2.4`) — this is an acceptable, expected consequence of tuning the one shared constant it reads, not a separate change to make.
- New total air-time (jump-to-landing, flat ground) increases from ~0.667s to ~0.833s (~25% longer hang time) — expected and desirable here, since a longer hang time is part of what makes mounting a 1.2m-tall platform from a horizontal approach actually feel reachable, not just barely apex-clearing. Not a balance concern significant enough to need separate sign-off.
- Confirm no other jump-height assumption breaks: apex 1.5625m stays well under `WALL_HEIGHT = 4`, so walls remain completely unreachable to stand on — this EPIC only makes **crates** (`kind: "crate"`) climbable, not walls.

---

## 3. Story 12.1 — Height-aware horizontal collision (shared)

**As a** developer **I want** `ARENA_GEOMETRY` boxes to only block horizontal movement when the player's feet are below that box's top surface **so that** a crate stops blocking you sideways once you're standing above its height, while still blocking normally at ground level.

- **Problem today:** `resolveHorizontalCollisions`/`resolveSteppedMovement` (`shared/src/collision.ts`) are explicitly Y-agnostic — every box, wall or crate, blocks at any height (documented in the file's top-of-file comment and `resolveHorizontalCollisions`'s own doc comment, both of which explicitly say crates are "full-height blocking... not climbable" — **this EPIC reverses that documented design choice and both comments must be updated accordingly, not left stale**).
- **Fix:** add a new exported helper in `shared/src/collision.ts`, next to the existing helpers:
  ```ts
  export function boxesBlockingAt(feetY: number, boxes: readonly MapBox[] = ARENA_GEOMETRY): MapBox[]
  ```
  A box blocks horizontal movement at a given feet height `feetY` if: `kind === "wall"` (walls always block — unreachable regardless of jump height, see Section 2) **or** `feetY < boxBounds(box).maxY` (the player's feet are strictly below that crate's top surface). A crate at `feetY >= boxBounds(box).maxY` (standing on it or higher) is excluded — it does not block horizontal movement at that height.
- **Callers** (server `stepPlayer()`, client `fpsController.update()`) must pass the **filtered** result of `boxesBlockingAt(<player's feet Y at the start of this tick, i.e. `position.y` before this tick's vertical integration>)` as the `boxes` argument to `resolveSteppedMovement(...)`, instead of relying on its `ARENA_GEOMETRY` default. This is a pure call-site change — `resolveHorizontalCollisions`/`resolveSteppedMovement`'s own signatures do not need to change, since `boxes` is already an overridable parameter (added in EPIC 8/11) for exactly this kind of use.
- Update the stale doc comments (top-of-file in `shared/src/collision.ts` and `resolveHorizontalCollisions`'s own doc comment) that currently assert crates are always full-height/non-climbable — replace with an accurate description of the new height-aware behavior and a pointer to `boxesBlockingAt`/EPIC 12.
- **Acceptance criteria:**
  - [ ] `boxesBlockingAt(feetY)` returns all walls unconditionally, and only the crates whose top is strictly above `feetY`.
  - [ ] At ground level (`feetY = 0`), the returned box list is identical to `ARENA_GEOMETRY` (no behavior change for the common case — approaching a crate at ground level still blocks exactly as before EPIC 12).
  - [ ] At `feetY >= CRATE_HEIGHT` (standing on/above a crate), that specific crate is excluded from the blocking list while every wall and every *other* (not-yet-mounted) crate remains blocking.
  - [ ] Stale "crates are full-height / not climbable" doc comments in `shared/src/collision.ts` are corrected, not left contradicting the new behavior.

---

## 4. Story 12.2 — Standing on crate tops (vertical support, shared + server + client)

**As a** player **I want** to land on top of a crate after jumping onto it, and fall back down when I walk off the edge **so that** crates function as real elevated cover/platforms, not just taller ground.

- **New shared helper**, `shared/src/collision.ts`:
  ```ts
  export function crateTopHeightAt(x: number, z: number, boxes: readonly MapBox[] = ARENA_GEOMETRY, radius: number = PLAYER_COLLISION_RADIUS): number
  ```
  Returns the **highest** crate top surface (`boxBounds(box).maxY`) among every `kind: "crate"` box in `boxes` whose XZ footprint, **expanded by `radius`** (same "expand the box's true bounds by the player's collision radius" pattern `resolveHorizontalCollisions` already uses), contains `(x, z)`. Returns `0` if `(x, z)` is not over any crate's (radius-expanded) footprint. This function must **not** consider walls (they are never standable, per Section 2) and must **not** import `MOVEMENT` (avoid the circular-import issue already documented for `MAX_SINGLE_CALL_RESOLUTION_DISTANCE`/`DEFAULT_MAX_STEP_DISTANCE` in this same file) — callers combine it with `MOVEMENT.groundY` themselves: `const groundHeight = Math.max(MOVEMENT.groundY, crateTopHeightAt(x, z));`.
  - Using the radius-expanded footprint (not the crate's raw XZ bounds) is a deliberate consistency choice: it matches how `resolveHorizontalCollisions` already treats the player as a circle of `PLAYER_COLLISION_RADIUS`, so the same "effective footprint" concept applies whether the crate is currently blocking you sideways or supporting you from below — a player whose center point is a few centimeters past the crate's raw edge, but whose body circle still overlaps the top surface, should not feel like it falls through a phantom gap.
- **Server (`server/src/playerRegistry.ts` `stepPlayer()`, authoritative)** — replace the flat `MOVEMENT.groundY` landing clamp with the computed `groundHeight` for the player's **post-horizontal-resolution** `(x, z)` this tick:
  ```ts
  const groundHeight = Math.max(MOVEMENT.groundY, crateTopHeightAt(player.position.x, player.position.z));
  // ... existing jump-trigger / gravity-integration lines, unchanged ...
  if (player.position.y <= groundHeight) {
    player.position.y = groundHeight;
    player.velocityY = 0;
    player.grounded = true;
    player.bunnyHopAvailable = true;
    player.airSpeedMultiplier = 1;
  } else {
    player.grounded = false;
  }
  ```
  **The `else { player.grounded = false; }` branch is a required, not-obvious addition** — today `grounded` is only ever set `true` (landing clamp) or `false` (jump trigger), which was safe when the ground was a single flat plane the player could never rise above without jumping. Once `groundHeight` varies spatially (0 vs `CRATE_HEIGHT`), a player standing on a crate who simply walks off its edge (no jump input) needs to become airborne (`grounded = false`) purely from leaving the support under their feet — without this branch, `grounded` would incorrectly stay `true` after walking off a ledge, letting the player trigger an ungrounded extra jump (an unintended double-jump/anti-cheat-adjacent bug) even though they are visibly falling.
- **Client (`client/src/fpsController.ts` `update()`)** — mirror the identical logic (same `boxesBlockingAt`/`crateTopHeightAt` calls, same `groundHeight` computation, same `else` branch) for local prediction, so client-predicted and server-authoritative crate-mounting/dismounting stay in agreement — same "one shared source of truth, two call sites" discipline EPIC 11 Story 11.1 established for `resolveSteppedMovement`.
- **Mounting flow this produces** (no new "mantle" input, purely a consequence of Story 12.1 + this story combined): while a player's feet are below a crate's top, that crate blocks them horizontally exactly as before (can't just walk into its side) — so they must jump. Once their feet rise above the crate's top mid-air (Story 12.1's `boxesBlockingAt` stops that specific crate from blocking), the horizontal collision no longer prevents them from drifting over the crate's footprint while airborne; as gravity pulls them back down, the first tick their descending `position.y` drops to `<= groundHeight` while still within the (radius-expanded) footprint clamps them to stand exactly on top. Landing squarely lines up with a normal running jump timed at/near a crate's edge — verify this is actually reachable in practice (not frame-perfect) as part of Tester's gameplay evidence, not just the math.
- **Dismount flow:** walking off the footprint while standing on a crate is never horizontally blocked (Story 12.1 already excludes a crate you're standing on/above from blocking), so movement off the edge is unobstructed; the very next tick's `groundHeight` recompute (now `0`, since the new `(x, z)` isn't over any crate) plus the new `else` branch above makes the player start falling immediately, landing back at `MOVEMENT.groundY` once `position.y` drops to `0` — no crates in `ARENA_GEOMETRY` currently overlap footprints or stack on each other (verified: Site A/B crates and both mid-lane crates all sit on disjoint XZ footprints), so "fall to a lower crate" is not a real case on the current map; falling always resolves straight to ground level.
- **Acceptance criteria:**
  - [ ] Running at a crate at ground level without jumping still stops the player at its side (no regression to existing "crates are cover" behavior below crate-top height).
  - [ ] A running jump timed reasonably at a crate's edge lands the player standing on top (`position.y == CRATE_HEIGHT`), both server-authoritative and client-predicted, in agreement.
  - [ ] Walking off a mounted crate's edge (no jump input) makes the player fall back to `groundY = 0`, passing through the normal gravity arc — not an instant teleport down and not a stuck/floating state.
  - [ ] A player who has just walked off a crate edge (falling, `grounded === false`) cannot trigger an extra ungrounded jump before actually landing — regression-tested explicitly, since this is the exact bug the `else` branch above exists to prevent.
  - [ ] No change to spawn logic, pickups, or any other mechanic that reads `player.position.y`/`grounded` — this story only changes what value `groundHeight` clamps to and when `grounded` flips, not any other consumer.

---

## 5. Story 12.3 — Regression evidence script

**As a** developer **I want** a committed, re-runnable script that exercises crate-mounting against the real production `ARENA_GEOMETRY` and shared collision helpers **so that** this mechanic has the same kind of deterministic, numeric evidence EPIC 8/11's collision work already established, not just a one-off manual playtest.

- New script `scripts/regression-crate-mount.ts` (style/rigor matching `scripts/regression-collision-overshoot.ts` and `scripts/regression-bot-aim-miss-rate.ts` — import the real shared helpers, run against the real `ARENA_GEOMETRY`, report actual numbers, non-zero exit code on failure so it's CI-ready later). Add an `npm run regression:crate-mount` script entry in `package.json`, matching the existing `regression:collision-overshoot` / `regression:bot-aim-miss-rate` naming convention.
- Drives a minimal tick loop using the **real** shared constants/helpers (`MOVEMENT`, `boxesBlockingAt`, `crateTopHeightAt`, `resolveSteppedMovement`, `BROADCAST_TICK_HZ`) — mirroring the same vertical/horizontal step order Story 12.2 specifies for `stepPlayer()`/`fpsController.update()` (this is inherently a second, verification-only copy of that tick math, same pattern the EPIC 8/11 regression scripts already use rather than importing the server's private `stepPlayer()` method directly).
- **Minimum coverage, against real crate ids from `ARENA_GEOMETRY`** (at least one 2×2 crate — e.g. `crate_a1` — and one 1.5×1.5 crate — e.g. `crate_mid1` — since footprint size could plausibly affect mount reliability):
  1. Ground-level approach without jumping stays blocked at the crate's (radius-expanded) side — never crosses into the footprint below crate-top height.
  2. A running-jump approach (forward velocity + a jump timed near the edge, using real `MOVEMENT` values) results in the simulated player settling at `position.y == CRATE_HEIGHT` while horizontally within the crate's footprint.
  3. Walking off the mounted crate's edge (continued forward input, no further jump) results in `position.y` returning to `0` after falling, via a smooth decreasing sequence (not a snap).
  4. Immediately after leaving support (case 3, still mid-fall), a jump-input tick does **not** apply `MOVEMENT.jumpSpeed` (i.e. `grounded` correctly reads `false` and no ungrounded jump is granted) — this is the deterministic check for the `else { grounded = false }` fix in Story 12.2.
- **Acceptance criteria:**
  - [ ] Script runs via `npx tsx scripts/regression-crate-mount.ts` (and the new `npm run` alias), reports real measured numbers (heights, tick counts) for each case, not just pass/fail assertions with no numbers shown.
  - [ ] Exits non-zero if any of the four coverage cases fails.
  - [ ] Covers at least one 2×2 and one 1.5×1.5 crate from the real `ARENA_GEOMETRY`.

---

## 6. Story 12.4 — Docs correction

**As a** developer reading `docs/backlog.md` or `shared/src/collision.ts` **I want** the "crates are not climbable" note to reflect reality **so that** the documented design record doesn't contradict the shipped behavior.

- `docs/backlog.md`: remove (or replace with a resolved/superseded note referencing EPIC 12) the line: *"Crates in the arena are full-height blocking obstacles, not climbable (from `docs/tasks/epic-03-arena-map.md`). Deliberate simplification — max jump height is well under crate height anyway, so climb logic wouldn't be meaningfully usable."* — this EPIC directly reverses that decision (both the jump-height premise, Section 2, and the "not climbable" behavior, Stories 12.1–12.2). Programmer's call on exact wording (delete outright vs. a one-line "superseded by EPIC 12" note) — either is acceptable, leaving the stale claim unedited is not.
- `README.md`: add an EPIC 12 section following the existing EPIC-list format/placement convention (see the EPIC 11/EPIC 10 entries for style) summarizing the jump-height tuning and height-aware crate collision.
- `shared/src/collision.ts`: already covered by Story 12.1's acceptance criteria (doc comment corrections) — cross-referenced here for completeness, not a separate task.
- **Acceptance criteria:**
  - [ ] `docs/backlog.md`'s stale "crates not climbable" entry no longer contradicts shipped behavior.
  - [ ] `README.md` has an EPIC 12 entry in the established style/location.

---

## 7. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: raise `MOVEMENT.jumpSpeed` to `6 * 1.25` | ballistic apex clears `CRATE_HEIGHT` with ~30% margin | `shared/src/index.ts` | apex math documented in-comment; client + server both reflect the single shared constant |
| 2 | `shared/`: `boxesBlockingAt(feetY, boxes?)` helper | height-aware horizontal blocking list | `shared/src/collision.ts` | matches `ARENA_GEOMETRY` at `feetY=0`; excludes a crate once `feetY >= its top` |
| 3 | `shared/`: `crateTopHeightAt(x, z, boxes?, radius?)` helper | radius-aware standable-surface height lookup | `shared/src/collision.ts` | returns 0 off-footprint, crate's `maxY` when within radius-expanded footprint |
| 4 | `shared/`: correct stale "crates not climbable" doc comments | doc accuracy | `shared/src/collision.ts` (top-of-file + `resolveHorizontalCollisions` doc comment) | no remaining claim that crates are always full-height/non-climbable |
| 5 | Server: `stepPlayer()` uses height-aware horizontal blocking + `crateTopHeightAt` landing clamp + `else { grounded = false }` | authoritative crate mount/dismount | `server/src/playerRegistry.ts` | mount/dismount + no-extra-jump-after-ledge-fall all verified per Story 12.2/12.3 |
| 6 | Client: `fpsController.update()` mirrors the identical logic | no client/server crate-mount mismatch | `client/src/fpsController.ts` | same behavior locally, reconciles cleanly against server position |
| 7 | New regression script `scripts/regression-crate-mount.ts` + `npm run regression:crate-mount` | committed, re-runnable, numeric evidence | `scripts/regression-crate-mount.ts`, `package.json` | 4 coverage cases from Story 12.3, non-zero exit on failure |
| 8 | Docs: `docs/backlog.md` correction + `README.md` EPIC 12 section | doc record matches shipped behavior | `docs/backlog.md`, `README.md` | per Story 12.4 acceptance criteria |

---

## 8. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] `MOVEMENT.jumpSpeed` raised so ballistic apex (1.5625m) comfortably clears `CRATE_HEIGHT` (1.2m), single shared constant, client+server consistent.
- [ ] A player can jump onto any crate in `ARENA_GEOMETRY` (verify at least one 2×2 and one 1.5×1.5 crate) via a normal running jump timed at/near the edge — not frame-perfect, not requiring an unusual technique.
- [ ] Standing on a crate feels like standing on solid ground: no jitter, no falling through, camera correctly raised by crate height (client already uses `position.y + EYE_HEIGHT` for the camera — confirm this naturally produces the raised-view effect with no separate camera fix needed).
- [ ] Walking off a mounted crate's edge falls back to ground level under normal gravity — no floating, no snap-teleport.
- [ ] A player cannot exploit crate-edge-walkoff for an extra ungrounded jump (the `grounded` state correctly reflects actual support).
- [ ] Crates still block horizontal movement normally at/below ground-level approach (no regression to existing "crates are cover" behavior for a player who never jumps).
- [ ] No regression to any other EPIC 1–11 mechanic — this EPIC touches the same shared collision/movement code nearly everything else depends on (spawn placement, pickup proximity, hitscan-vs-geometry, EPIC 11's substep movement, bunny hop), so budget a real regression pass, not a rubber-stamp. In particular: bunny hop still works and still gates correctly on `grounded`/`bunnyHopAvailable` when landing on a crate top, not just ground level.
- [ ] `docs/backlog.md`'s stale "crates not climbable" entry corrected (Story 12.4).
- [ ] `README.md` has an EPIC 12 entry.
- [ ] Committed, re-runnable regression script (`scripts/regression-crate-mount.ts`) with real measured numbers for the 4 coverage cases in Story 12.3.
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass.
- [ ] Tester's Gameplay & feel section includes: a screenshot/log sequence of a player jumping onto and standing on top of a crate (camera visibly elevated), a screenshot/log of walking off the edge and falling back down, and evidence (screenshot or server log) that ground-level approach to a crate the player has *not* jumped onto still blocks normally (no regression).

---

## 9. Risks

- **Edge-case tunneling through a thin platform in a single tick:** the vertical landing clamp (`position.y <= groundHeight`) itself has no tunneling risk regardless of fall speed (a simple threshold check catches any overshoot, same as the pre-existing flat-ground clamp always has). The theoretical residual risk is purely horizontal-vs-vertical timing: if a single tick's *horizontal* movement carries a fast-falling player from just outside a crate's footprint to just past its far side within the same tick that their `position.y` also crosses the crate's top height, the landing check could miss (player falls through to the far side at ground level instead of mounting). This is a minor feel-only edge case, not a security/exploit issue, and is an accepted, documented simplification consistent with this codebase's existing "no true 3D swept collision, hand-rolled and simple" constraint (same category of accepted residual as the "corner pop" note in `shared/src/collision.ts`) — not something this EPIC needs to fix with a full swept-collision rewrite. Tester/Critic should confirm it doesn't happen under *normal* play (a deliberate running jump at a crate), not attempt to fully rule out contrived fast-fall edge cases.
- **`grounded`-state correctness is the highest-risk single line in this EPIC** (the `else { player.grounded = false; }` addition in Story 12.2) — getting this wrong reintroduces an extra-jump exploit that didn't exist before this EPIC (the flat single-plane ground never needed it). Programmer must implement it in **both** server and client exactly as specified; Tester must explicitly verify the "walk off edge, try to jump before landing" case, not just the happy-path mount/dismount.
- Raising `jumpSpeed` by 25% is a small, contained tuning change (only this one constant), but it changes total air-time (~25% longer) and bunny-hop kick magnitude (`0.4 * jumpSpeed`) as a direct, expected, and accepted consequence — Tester should sanity-check bunny hop still feels reasonable, not dramatically overtuned, but no separate balance sign-off is required for this expected knock-on effect.
- `ARENA_GEOMETRY` itself is unchanged (no new crates, no resized/repositioned crates) — this EPIC is purely a collision-behavior change, so map-layout risk (unreachable spots, blocked lanes) is not in scope.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
