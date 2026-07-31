# EPIC 4: Shooting & Combat

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Shooting & Combat |
| **System goal** | Make this an actual shooter: players can fire at each other, hits are validated server-side against the arena's collision geometry, health/death/respawn work, and there's a minimal HUD (crosshair, health, ammo). |
| **Business/gameplay problem** | The game currently has movement and a map but no combat — the core verb of a "browser shooter" is still missing. |
| **Architectural role** | client (aim/fire input, muzzle/hit visual feedback, HUD) + server (authoritative hitscan raycast against players + map geometry, health, death, respawn) + shared protocol (fire/hit/health/respawn messages) |
| **Main components** | `client/`, `server/`, `shared/` |
| **Stack** | Fixed project stack — server-side raycast/AABB hit detection, no physics engine (`ai-office/global/global-standards.mdc`) |
| **Interaction with other components** | Depends on EPIC 2 (player positions) and EPIC 3 (map geometry, so shots can be blocked by walls) — both must already be in `main` before this starts. |

## 2. Story 4.1 — Fire input & hitscan

**As a** player **I want** to click to shoot in the direction I'm aiming **so that** I can fight other players.

- **Outputs:** click-to-fire (pointer already locked from EPIC 2); client sends a `FireEvent` (origin + direction, or just relies on server knowing the shooter's current authoritative position/yaw/pitch — Programmer's call, document it) to the server; server performs the actual hitscan raycast against **both** the map geometry (EPIC 3) and other players' hitboxes (simple capsule/AABB approximation is fine), and decides the outcome — this is the one place a physics-engine-style raycast helper is allowed to be hand-rolled, not delegated to Rapier (out of stack scope for this).
- **Acceptance criteria:**
  - [ ] Firing at a wall/crate does not hit a player standing behind it (map geometry blocks the raycast)
  - [ ] Firing at another player's position (line of sight clear) registers a hit server-side
  - [ ] Client never unilaterally declares "I hit someone" — only a server-confirmed hit results in damage (`ai-office/global/security-baseline.mdc`)

## 3. Story 4.2 — Health, death, respawn

**As a** player **I want** to take damage, die, and respawn **so that** combat has real stakes and the match keeps going.

- **Outputs:** server tracks per-player health, decremented on confirmed hits; on health ≤ 0, player "dies" (removed from active play briefly, avatar hidden/ragdoll-less is fine — keep simple), respawns after a short delay at a spawn point (reuse EPIC 3 spawn points, pick one at random if there are multiple) with full health.
- **Acceptance criteria:**
  - [ ] A player reduced to 0 health stops being able to move/shoot until respawn
  - [ ] Respawn restores full health and a valid in-arena position
  - [ ] Other clients see the death (avatar disappears/changes state) and the respawn (avatar reappears at the new position)

## 4. Story 4.3 — Minimal combat HUD & feedback

**As a** player **I want** a crosshair, a health readout, and visual/audio-optional feedback on hits **so that** combat is legible, not just numbers changing silently.

- **Outputs:** a simple crosshair overlay (client-only, no server involvement), an on-screen health value, a lightweight hit-marker/muzzle-flash visual cue when you land or take a hit (keep it simple — a brief color flash or a small sprite is enough, no need for particle systems).
- **Acceptance criteria:**
  - [ ] Crosshair is visible and centered at all times during play
  - [ ] Current health is visible on screen and updates when damaged
  - [ ] Some visible feedback occurs on a successful hit (attacker side) and on taking damage (victim side)

## 5. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: combat protocol types | `FireEvent`, `HitEvent`/health-update message, death/respawn message | `shared/src/` | typechecks, imported by both sides |
| 2 | Server: hitscan raycast vs. map + players | server resolves a fire event to hit/no-hit, applies damage | `server/src/` | wall-blocks-shot and clear-line-of-sight-hits both verified |
| 3 | Server: health/death/respawn state machine | per-player health, death state, respawn timer/logic | `server/src/` | dying and respawning both observable via broadcast state |
| 4 | Client: fire input + feedback | click-to-fire, muzzle/hit visual cue | `client/src/` | firing visibly does something even before server confirms (juice), reconciled with server outcome |
| 5 | Client: HUD (crosshair + health) | on-screen overlay | `client/src/` | visible in every screenshot taken during play |
| 6 | Client: render other players' death/respawn state | remote avatars hide on death, reappear on respawn | `client/src/` | two-client test shows this |
| 7 | Client: initialize camera at spawn before first pointer-lock | camera position is set to the player's actual spawn position immediately (not left at world origin) even before the canvas is clicked/locked | `client/src/fpsController.ts` | pre-lock and post-lock camera position are both sensible; carried over from EPIC 3 Critic's note (`docs/tasks/epic-03-critic-review.md`) — small, do first since it'll make this EPIC's own two-client hit-registration screenshots meaningful instead of showing world-origin geometry |

## 6. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Two players can shoot each other; hits are server-confirmed, not client-asserted
- [ ] Map geometry blocks shots (no shooting through walls)
- [ ] Health decreases on hit, death occurs at 0, respawn restores health and position
- [ ] Crosshair + health HUD always visible during play
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes screenshots proving: a landed hit (with feedback visible), a wall-blocked shot not registering, a death/respawn cycle

## 7. Risks

- Server-side hitboxes are a simplification (capsule/AABB, not the client's exact rendered mesh) — acceptable, document the approximation used.
- This is the most security-sensitive EPIC so far (real player-vs-player consequences) — expect Critic to weight `ai-office/global/security-baseline.mdc` compliance heavily. Team Lead will route an Infosec pass on this EPIC as standard practice (not only if Critic flags concerns), given it's the first PvP-consequential system in the game.
- Depends on EPICs 2 and 3 being merged into `main` first — do not start this EPIC's branch before that.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
