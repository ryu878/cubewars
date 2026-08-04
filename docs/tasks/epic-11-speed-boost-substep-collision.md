# EPIC 11: Movement Speed Boost & Substep Collision Safety

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Movement Speed Boost & Substep Collision Safety |
| **System goal** | Make base movement 2x faster than its current (post-EPIC-8) value — user reported the game feels too slow ("like a turtle"), asked for 3x then 5x, then settled on **2x to start** (explicit correction mid-task — this spec reflects the final number, not the earlier ones). At higher speeds, naively scaling the existing single-step-per-tick collision resolution could let a player's per-tick displacement exceed wall thickness, causing tunneling through walls — at 2x the margin is more comfortable than at 5x, but the substep fix (Story 11.1) is still shipped in this EPIC as good defensive engineering now that movement speed is clearly going to keep increasing over time, not a one-off reaction to a single number. |
| **Business/gameplay problem** | Direct user feedback: current speed (6.65 m/s, from EPIC 8) still feels too slow. |
| **Architectural role** | shared (movement constant + new substep-collision helper, single source for client+server) + server (authoritative movement now steps through the helper) + client (local prediction uses the identical helper, so no client/server feel mismatch) |
| **Main components** | `shared/`, `server/`, `client/` |
| **Stack** | Fixed project stack, no deviation — still hand-rolled AABB collision, no physics engine. Substepping is a math change to existing collision resolution, not a new system. |
| **Interaction with other components** | Directly touches `MOVEMENT.maxSpeed` (`shared/src/index.ts`) and `resolveHorizontalCollisions` (`shared/src/collision.ts`, established EPIC 3, tightened in EPIC 8 for the corner-pop issue tracked in `docs/backlog.md`) — both the server's `stepPlayer()` (`server/src/playerRegistry.ts`) and the client's local prediction (`client/src/fpsController.ts`) call into collision resolution and must both switch to the new substep helper so client-predicted and server-authoritative movement stay visually consistent (no new rubber-banding). Bunny hop (EPIC 8) stacks its own 1.3x multiplier on top of whatever `maxSpeed` is — this EPIC does not change that multiplier, only the base it multiplies. |

## 2. Speed calculation (fixed by Team Lead)

- Current effective base speed (post-EPIC-8): `5 (EPIC 2 original) × 1.33 (EPIC 8) = 6.65 m/s`.
- User's final ask (after an initial 3x, then 5x, then an explicit correction mid-task): **2x the current game, to start** — this is the number to implement.
- **New `MOVEMENT.maxSpeed` = `6.65 × 2 = 13.3 m/s`.** Express this in code as the full lineage (`5 * 1.33 * 2`), not a bare `13.3` literal, so the history is visible to a future reader (matches the existing style — EPIC 8 already did this for its own multiplier).
- Bunny hop's existing 1.3x boost multiplier (`BUNNY_HOP.speedMultiplier`, unchanged) now applies on top of this new base: a boosted hop reaches `13.3 × 1.3 ≈ 17.3 m/s`. This is the actual top-end speed that has to stay collision-safe (see Section 3), not just the unboosted 13.3.
- **Do not** change jump height/gravity/bunny-hop-boost-fraction as a side effect — this EPIC is base-speed only, per the same discipline EPIC 8 followed for its own speed change.

## 3. Story 11.1 — Substep collision resolution (do this first — the speed change depends on it being safe)

**As a** developer **I want** per-tick movement resolved in several smaller sub-steps instead of one big jump **so that** a fast-moving player can never cross a 1-unit-thick wall in a single tick without collision catching it.

- **The problem, concretely:** at the new top speed (~17.3 m/s boosted) and the existing 20Hz tick (`dt = 0.05s`), a single unresolved step covers `17.3 × 0.05 ≈ 0.865` units — close to a wall's thickness (`shared/src/mapData.ts`'s walls are 1 unit thick), and this margin will only get tighter if speed increases again in a future EPIC (which, given the trend of this conversation, seems likely). The current `resolveHorizontalCollisions` (tightened in EPIC 8 for corner-pop, see `docs/backlog.md`) has not been stress-tested at a proposed displacement this close to wall thickness; sub-stepping now is a proactive safety margin, not a reaction to an already-broken case at 2x specifically.
- **Fix:** add a new shared helper (suggest `resolveSteppedMovement(startX, startZ, deltaX, deltaZ, radius, boxes, maxStepDistance)` in `shared/src/collision.ts`, next to the existing `resolveHorizontalCollisions`) that:
  1. Computes the proposed total displacement distance for this tick.
  2. Splits it into `Math.ceil(totalDistance / maxStepDistance)` equal sub-steps (minimum 1 — normal walking speed shouldn't pay for extra sub-steps it doesn't need).
  3. Applies `resolveHorizontalCollisions` once per sub-step, feeding each sub-step's *result* as the start point of the next, so a stop mid-way through the tick (hitting a wall on sub-step 3 of 6, say) correctly halts the rest of that tick's movement rather than teleporting past it.
  4. Use `maxStepDistance` small enough to keep a comfortable safety margin under 1 unit — Team Lead suggests **0.4** (matches the player's own collision radius, `PLAYER_COLLISION_RADIUS`) as a reasonable, round starting point; Programmer may tune slightly if there's a good reason, document it if so.
- **Both** `server/src/playerRegistry.ts`'s `stepPlayer()` (authoritative) **and** `client/src/fpsController.ts`'s local prediction must call this **same** helper — this is the same "one shared source of truth" discipline as `MOVEMENT`/`ARENA_GEOMETRY` elsewhere in the codebase, not a suggestion to reimplement it twice.
- **Acceptance criteria:**
  - [ ] At the new top speed (unboosted 13.3 m/s and boosted ~17.3 m/s), running straight at any wall stops the player at the wall — verified by a scripted test that pushes at max speed for several ticks and checks the resolved position never crosses to the wall's far side
  - [ ] Normal, unboosted walking at the new base speed still feels/behaves correctly (no jitter or stutter introduced by sub-stepping at lower speeds — sub-stepping should be transparent when only 1 sub-step is actually needed)
  - [ ] Client-predicted and server-authoritative positions stay in agreement (no new, larger-than-before rubber-banding) — both use the identical helper

## 4. Story 11.2 — Apply the new speed

**As a** player **I want** to move 2x faster than the current game **so that** traversing the (now fairly large, weapon/pickup-populated) arena feels faster, not sluggish — a first step, more later if it's still not enough.

- **Outputs:** `MOVEMENT.maxSpeed` updated per Section 2's calculation, in the single shared location.
- **Acceptance criteria:**
  - [ ] Server-broadcast displacement for a straight-line hold matches ~13.3 m/s (not 6.65), verified the same way every prior speed change in this project has been verified (exact per-tick math + measured displacement)
  - [ ] Bunny hop boost reaches the new expected ~17.3 m/s top speed
  - [ ] Client and server agree (single shared constant, no duplicated literal)

## 5. Story 11.3 — HUD relayout: bigger, bolder health/armor, moved next to the weapon readout

**As a** player **I want** health and armor shown as large, bold numbers next to my weapon readout at the bottom of the screen, instead of small text in the top corner **so that** my vital stats are easy to read at a glance during combat (user's explicit follow-up ask, mid-EPIC).

- Health and armor already exist and are already server-driven/always-current (`client/src/combatHud.ts` `setHealth()`/`setArmor()`, unchanged EPIC 4/7 logic) — this is a **CSS/layout-only change**, not new data plumbing.
- **Outputs:** move `#healthHud` and `#armorHud` (`client/index.html`) from their current top-right stacked position down to the bottom of the screen, flanking `#weaponHud` (which already sits bottom-center) — health on one side, armor on the other (Programmer's call on left-vs-right, health-left/armor-right is a reasonable default). Significantly increase font size and weight (large, bold digits — this is explicitly about at-a-glance readability, not a subtle tweak) while keeping the existing dark rounded-badge visual style consistent with the rest of the HUD.
- **Acceptance criteria:**
  - [ ] Health and armor numbers are positioned at the bottom of the screen, one on each side of the weapon/ammo readout
  - [ ] Font size/weight is noticeably larger and bolder than the current top-corner treatment — readable at a glance, not squinted at
  - [ ] No functional change — values still update live exactly as before (server-driven every `world_state` tick), this task only moves/restyles existing elements

## 6. Story 11.4 — Bot aim inaccuracy

**As a** player fighting bots **I want** bots to sometimes miss **so that** combat doesn't feel like fighting an aimbot (user's explicit follow-up ask, mid-EPIC: "it feels like they just never miss").

- **Root cause:** `server/src/botAI.ts`'s `ENGAGING` state (EPIC 9) turns the bot to face the target within `AIM_TOLERANCE_RAD` and fires once aimed — with no randomness, a bot that's "aimed" per that tolerance currently lands a hit essentially every time it has line-of-sight and is off cooldown, which reads as inhumanly precise.
- **Fix:** apply a small random angular jitter to the bot's yaw/pitch specifically at the moment it fires (not to the smooth turn-to-face behavior that drives `ENGAGING`'s visual facing — the bot should still visibly track the target normally, just not land a laser-perfect shot every time). Suggested magnitude: a uniform random offset of roughly **±0.05 radians (~±3°)** applied independently to yaw and pitch right before calling `fire()` for that bot's shot — small enough that close-range shots still mostly land (a bot shouldn't feel incompetent up close), large enough that shots at typical mid/long engagement ranges across the arena miss a meaningful fraction of the time, given the player hitbox radius (~0.5) shrinks the angular hit-tolerance as range increases. Programmer may tune the exact value if a quick playtest shows it's clearly too easy or too hard, document the final number and rough reasoning either way.
- **Acceptance criteria:**
  - [ ] Bots demonstrably miss some shots at realistic engagement range (not literally every shot lands) — verified statistically (e.g. fire N times at a fixed-distance stationary target from a fixed bot position, confirm a real miss rate, not just "it compiles")
  - [ ] Bots still hit reasonably often at close range — this is a fairness/feel tweak, not "make bots incompetent"
  - [ ] This is a bot-only change — human player accuracy/hitscan resolution (`server/src/combat.ts`) is completely untouched; jitter is applied only inside `botAI.ts`'s own fire-triggering logic

## 7. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: `resolveSteppedMovement()` helper | sub-step collision resolution, reusable | `shared/src/collision.ts` | unit-level correctness verified against a straight-on wall approach at max speed |
| 2 | Server: `stepPlayer()` uses the new helper | authoritative movement no longer single-step at high speed | `server/src/playerRegistry.ts` | wall never crossed at new max/boosted speed |
| 3 | Client: local prediction uses the same helper | no new client/server mismatch | `client/src/fpsController.ts` | feels responsive, reconciles cleanly |
| 4 | Update `MOVEMENT.maxSpeed` | 13.3 (`5 * 1.33 * 2`), single shared location | `shared/src/index.ts` | client + server both reflect it |
| 5 | Extend `scripts/regression-collision-overshoot.ts` with the new speed(s) | existing EPIC 8 regression script now also covers 13.3 / ~17.3 m/s | `scripts/regression-collision-overshoot.ts` | committed, re-runnable, real numbers reported (not just asserted safe) |
| 6 | Client: relayout + restyle health/armor HUD elements | moved to bottom, flanking weapon readout, large/bold | `client/index.html` | matches Story 11.3 acceptance criteria |
| 7 | Server: bot fire-aim jitter | `botAI.ts` applies random yaw/pitch offset at fire time | `server/src/botAI.ts` | statistically-verified miss rate at range, human hitscan untouched |

## 8. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Base speed is exactly 2x the pre-EPIC-11 value (13.3 m/s), applied consistently client+server via one shared constant
- [ ] A player cannot tunnel through any wall at the new base speed or the new boosted bunny-hop speed — verified by an extended, committed version of the existing collision-overshoot regression script, with real numbers, not an assertion
- [ ] Health and armor readouts relocated to the bottom of the screen, flanking the weapon readout, in large bold text (Story 11.3)
- [ ] Bots demonstrably miss shots at range, statistically verified, human accuracy/hitscan untouched (Story 11.4)
- [ ] No regression to any other EPIC 1-10 mechanic — this EPIC touches shared movement/collision code that nearly everything else depends on indirectly (spawn placement, pickup proximity, hitscan-vs-geometry), so budget a real regression pass, not a rubber-stamp
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes: a measured-displacement screenshot/log at the new speed, specific wall-collision-at-max-speed evidence (both straight-on and, given EPIC 8's known corner-pop residual, a corner approach at the new speed too), a screenshot of the relocated/enlarged HUD, and evidence of bots missing shots (e.g. a server log excerpt showing consecutive bot fire attempts with mixed hit/miss outcomes)

## 9. Risks

- A 2x speed jump is comfortably within the margin the existing (EPIC 8-tightened) collision resolution already handles reasonably at similar magnitudes, but Story 11.1's substep fix ships anyway in this EPIC since speed is clearly trending upward over successive user requests and it's better to have the safety margin in place now than to patch it reactively again next time.
- EPIC 8's accepted residual "corner pop" limitation (`docs/backlog.md`) was characterized as bounded and self-limiting *at the EPIC 8 speed range* (~5-8.65 m/s) — Critic/Tester should re-check it's still bounded at the new ~13.3-17.3 m/s range (expected to be easy given the margin involved, but verify, don't assume).
- Server tick rate (20Hz) is unchanged by this EPIC — sub-stepping happens *within* a tick's movement resolution, it does not increase the broadcast rate or add new server load beyond a few extra (cheap) collision checks per tick per player.
- Bot aim jitter (Story 11.4) is a feel/fairness tweak with a Team-Lead-suggested but Programmer-tunable magnitude — don't over-index on the exact `0.05` rad figure if a quick playtest clearly shows it needs adjusting, just document whatever final value is used and why.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
