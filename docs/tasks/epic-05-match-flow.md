# EPIC 5: Match Flow Polish

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Match Flow Polish |
| **System goal** | Take the now-functional shoot-and-die loop (EPICs 2-4) and make it read as an actual ongoing match: a kill feed / basic scoreboard, sane multi-player spawn distribution across the arena's spawn points, and a clean "playable multiplayer browser shooter" first-run experience (e.g. a simple name/join step is optional — anonymous is fine, don't over-scope). |
| **Business/gameplay problem** | Right now kills happen but nothing tells players who's winning or that a kill even happened beyond the hit-marker/health-bar feedback from EPIC 4 — this is the last mile between "the mechanics work" and "this reads as a game." |
| **Architectural role** | client (kill feed/scoreboard UI) + server (kill/score tracking, spawn distribution) + shared (score/kill-feed message types) |
| **Main components** | `client/`, `server/`, `shared/` |
| **Stack** | Fixed project stack — see `ai-office/global/global-standards.mdc` |
| **Interaction with other components** | Builds directly on EPIC 4's death/respawn events (a kill is just a death event with an attacker) and EPIC 3's spawn points (now need multiple, spread out, not clustering players together). |

## 2. Story 5.1 — Kill feed

**As a** player **I want** to see who killed whom **so that** deaths feel legible, not just a silent respawn.

- **Outputs:** server emits a `KillEvent` (attacker id, victim id) on death (reuse EPIC 4's death logic — this is additive, not a new health/death system); client shows a small transient kill-feed line ("PlayerA killed PlayerB") for all connected clients, not just the two involved.
- **Acceptance criteria:**
  - [ ] A kill produces a visible feed entry on every connected client, not just attacker/victim
  - [ ] Entries fade/expire after a few seconds rather than accumulating forever

## 3. Story 5.2 — Basic scoreboard

**As a** player **I want** to see who's ahead **so that** there's a sense of match progress.

- **Outputs:** server tracks a kill count per player (in-memory, resets on server restart — no persistence needed for this scope); client shows a simple always-or-toggle-visible list of connected players and their kill counts.
- **Acceptance criteria:**
  - [ ] Kill counts visible and update live as kills happen
  - [ ] A newly-joined player appears in the list at 0 kills; a disconnected player is removed

## 4. Story 5.3 — Spawn distribution

**As a** player **I want** to spawn somewhere sensible, not stacked on top of other players **so that** matches don't start with a spawn-kill pile-up.

- **Outputs:** extend EPIC 3's spawn point(s) to multiple spread-out locations across the arena (both sites + mid, roughly); server picks a spawn point that isn't currently occupied by (or very close to) another player when possible.
- **Acceptance criteria:**
  - [ ] At least 4-6 distinct spawn points across the arena
  - [ ] With 2+ players connected, spawns/respawns don't repeatedly land players on top of each other (a simple "prefer the spawn point farthest from other players" or "avoid points within N meters of any player" heuristic is enough, no need for anything elaborate)

## 5. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: kill-feed/score message types | `KillEvent`, score-list message | `shared/src/` | typechecks, imported both sides |
| 2 | Server: kill tracking + broadcast | per-player kill count, broadcast on kill | `server/src/` | two-client test shows both see the kill feed entry and updated score |
| 3 | Client: kill feed UI | transient feed entries | `client/src/` | visible, expires after a few seconds |
| 4 | Client: scoreboard UI | live-updating player/kill list | `client/src/` | updates on kill, join, leave |
| 5 | Multiple spawn points + distribution heuristic | 4-6 points, avoid-clustering logic | `shared/`/`server/src/` | manual/scripted multi-player spawn check shows spread, not stacking |

## 6. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Kills produce a kill-feed entry visible to all clients, expiring after a few seconds
- [ ] Scoreboard shows live kill counts, updates on join/leave/kill
- [ ] 4-6 spawn points, with basic anti-clustering so multiple players don't spawn stacked
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes screenshots of a kill feed entry appearing, the scoreboard with 2+ players, and evidence of spread-out spawns across a few respawns
- [ ] EPICs 1-4 acceptance criteria still hold (movement, map collision, shooting, health/death/respawn) — this EPIC must not regress them

## 7. Risks

- This is the last planned EPIC for the "playable multiplayer browser shooter" milestone the user asked for — after this, the game should be genuinely playable end-to-end (join, move, fight on the arena, see kills/score, respawn) even if visually/content-wise minimal. Don't gold-plate; a simple, working version of each Story beats a fancy half-finished one.
- Depends on EPICs 3 and 4 being merged into `main` first.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
