# EPIC 8: Movement Tuning — Speed Increase & Bunny Hop

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Movement Tuning — Speed Increase & Bunny Hop |
| **System goal** | Increase base movement speed by 1.33x, and add a "bunny hop" mechanic: pressing Space a second time while already airborne (mid-jump) gives a boosted, farther/higher hop, once per air-time. |
| **Business/gameplay problem** | User explicitly asked for faster base movement and a double-jump-style movement tech for more dynamic traversal. |
| **Architectural role** | shared (movement constants) + server (authoritative speed/jump application) + client (input detection for the double-space, local prediction matching) |
| **Main components** | `shared/`, `server/`, `client/` |
| **Stack** | Fixed project stack, no deviation |
| **Interaction with other components** | Touches `MOVEMENT` constants in `shared/src/index.ts` (or wherever they now live after EPICs 2/3/6/7) and the server-authoritative movement integration in `server/src/playerRegistry.ts`/`stepPlayer()`, plus client prediction in `client/src/fpsController.ts`. Must not regress EPIC 3's wall/crate collision (a faster, farther-hopping player must still be blocked by geometry) or EPIC 2's anti-cheat speed-clamp discipline (the boosted bunny-hop velocity must still be a server-computed, bounded value — not something a client can request an arbitrary magnitude for). |

## 2. Balance (fixed by Team Lead)

- **Base speed**: `MOVEMENT.maxSpeed` × 1.33 (current 5 m/s → ~6.65 m/s). This is the only speed change — do not also change jump height/gravity as a side effect unless the bunny hop mechanic below requires touching those constants deliberately.
- **Bunny hop trigger**: player presses Space while `alive` and currently airborne (not grounded) and has not already used a bunny-hop boost during this specific air-time (grounded → airborne → [optional one boost] → grounded resets the flag). A second real jump-key press must be a fresh key-down event (not a held key), i.e. requires the player to actually press Space twice — once to jump, once again mid-air.
- **Boost effect**: on trigger, apply a one-time boost to the player's current velocity: horizontal speed multiplied by 1.3 in the current movement-input direction (or current horizontal velocity direction if no input is held), and vertical velocity boosted by +40% of the base `jumpSpeed` constant (stacking on top of whatever vertical velocity remains from the original jump, not replacing it — should feel like a "kick" mid-air, not a full second jump from ground height).
- **Server-authoritative**: the bunny-hop boost is computed and applied server-side, gated on the server's own tracked `grounded`/`hasUsedBunnyHop`-this-airtime state — a client cannot request an arbitrary boost magnitude or trigger multiple boosts per air-time by spamming the fire-jump input.

## 3. Story 8.1 — Base speed increase

**As a** player **I want** faster base movement **so that** traversal across the (now much larger, weapon-pickup-populated) arena feels less sluggish.

- **Acceptance criteria:**
  - [ ] Server-broadcast displacement for a straight-line WASD hold matches the new ~6.65 m/s cap (not the old 5 m/s), verified the same way EPIC 2's anti-cheat tests verified `maxSpeed`
  - [ ] Client-side prediction uses the same updated constant (no mismatch causing visible rubber-banding)

## 4. Story 8.2 — Bunny hop

**As a** player **I want** to double-tap Space mid-air for a boosted hop **so that** I have a skill-expressive movement option, not just flat WASD.

- **Acceptance criteria:**
  - [ ] Pressing Space once (grounded) jumps normally, exactly as before (no change to a normal single jump)
  - [ ] Pressing Space again while still airborne (before landing) applies the boost exactly once — visibly farther and higher than a normal jump
  - [ ] Pressing Space a third time (or holding it) while still airborne before landing does **not** apply a second boost — one per air-time, enforced server-side
  - [ ] After landing (grounded again), the next jump + mid-air second-press can trigger a boost again (the flag resets on landing)
  - [ ] A raw-WS client cannot get more than one boost per air-time no matter how many jump inputs it sends while airborne — server rejects/ignores extras

## 5. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | Update `MOVEMENT.maxSpeed` constant | ×1.33 applied in the single shared location | `shared/src/` | client + server both consume the same updated constant, no duplicated literal |
| 2 | Server: track per-player airborne/bunny-hop-used state | new fields in `PlayerRecord`, reset on landing | `server/src/playerRegistry.ts` | verified via scripted test |
| 3 | Server: apply the boost on a valid second jump input | server-computed velocity change per Section 2 | `server/src/playerRegistry.ts` | exact one-time boost verified, no stacking |
| 4 | Client: detect the second Space press, predict the boost locally | input handling + local prediction matching server formula | `client/src/fpsController.ts` | feels responsive, reconciles cleanly with server position |

## 6. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Base speed is exactly 1.33× the EPIC 2 baseline, applied consistently client+server
- [ ] Bunny hop triggers on a genuine second Space press mid-air, boosts exactly once per air-time, is server-authoritative and cannot be spammed for repeated boosts
- [ ] No regression to EPIC 3 wall/crate collision at the new speed/hop distances
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes screenshots/measurements showing the new speed and a bunny-hop boost trajectory vs. a normal jump

## 7. Risks

- Faster movement + a hop boost increases the max per-tick displacement — Tester/Critic should re-check EPIC 3's F-NB-1 (collision "corner pop", tracked in `docs/backlog.md`) isn't meaningfully worse at the new speeds; if it is, that's this EPIC's problem to address, not silently defer again.
- The "one boost per air-time" server-side gating is the security-relevant part of this EPIC (same discipline as every movement-affecting change so far) — expect Critic to specifically try to break it (e.g. rapid grounded/airborne toggling near a ledge).

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
