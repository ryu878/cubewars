# EPIC 2: Player Movement & Multiplayer Sync

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Player Movement & Multiplayer Sync |
| **System goal** | Turn the EPIC 1 skeleton into an actual multiplayer experience: a real first-person camera, WASD movement + jump, and every connected player sees every other connected player move in real time. |
| **Business/gameplay problem** | Right now the "player" is a static, camera-orbited placeholder and there is no concept of more than one player. Nothing else (shooting, map, match flow) makes sense until movement + sync exist. |
| **Architectural role** | client (input, first-person camera, prediction/render of remote players) + game server (authoritative position validation, per-tick broadcast) + shared protocol (input/state message types) |
| **Main components** | `client/` (replace OrbitControls demo with FPS controls + remote player rendering), `server/` (player registry, tick loop, broadcast), `shared/` (new protocol messages) |
| **Stack** | Fixed project stack, no deviation — see `ai-office/global/global-standards.mdc` |
| **Interaction with other components** | Client sends periodic input intents (move direction + look yaw/pitch) over the existing WebSocket; server is the sole authority on resulting position and broadcasts the full player list to all clients at a fixed tick rate. |

## 2. Story 2.1 — First-person camera & input

**As a** player **I want** mouse-look + WASD + jump **so that** I control my character like a normal FPS, not an orbiting spectator camera.

- **Outputs:** pointer-lock mouse-look (yaw/pitch), WASD movement relative to look direction, space-bar jump with gravity, replacing the current `OrbitControls` demo camera.
- **Constraints:** movement/look happens locally for responsiveness (client-side prediction is fine for feel), but the **position the server accepts and broadcasts is authoritative** — this client-predicted position is not itself gameplay truth (`ai-office/global/security-baseline.mdc`).
- **Acceptance criteria:**
  - [ ] Clicking the canvas locks the pointer; mouse movement looks around (yaw + pitch, pitch clamped so you can't flip over)
  - [ ] WASD moves relative to look direction; Space jumps (rises then falls back to ground level under gravity)
  - [ ] Movement feels reasonably smooth (no obvious per-frame stutter) — Tester/Critic judge this from a screen recording or before/after screenshots plus a written description of what was observed, per `ai-office/checklists/qa-checklist.md`

## 3. Story 2.2 — Server-authoritative movement

**As a** game server **I want** to receive input intents and compute the resulting player position myself **so that** no client can teleport, speed-hack, or otherwise report a false position.

- **Outputs:** a `PlayerInput` message type (`shared/`) the client sends on a fixed interval (e.g. ~30–60Hz or on every input-affecting frame, Programmer's call, document it); server applies movement with a clamped max speed and simple ground/gravity handling, keyed per connection.
- **Acceptance criteria:**
  - [ ] Server rejects/clamps an out-of-range input (e.g. absurd speed or malformed message) instead of trusting it — see `ai-office/global/security-baseline.mdc`
  - [ ] Server is the source of the position that gets broadcast — the client's own predicted position is never sent to other players directly

## 4. Story 2.3 — See other players move

**As a** player **I want** to see every other connected player's avatar move in real time **so that** this is actually a multiplayer game.

- **Outputs:** a `WorldState` broadcast message type (`shared/`) — server sends the full list of `{playerId, position, yaw}` to all connected clients on a fixed tick (document the rate); client renders one capsule avatar per other connected player (reusing the placeholder capsule look from EPIC 1) and updates its position/rotation from the broadcast; client's own avatar is not rendered for itself (first-person).
- **Acceptance criteria:**
  - [ ] Opening the client in two browser contexts (e.g. two Playwright pages, or two browser windows) shows each player's movement reflected in the other's view
  - [ ] A player that disconnects has their avatar removed from other clients' view (reuse the existing `close` handling on the server, extend the broadcast/removal logic)

## 5. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: input + world-state protocol types | `PlayerInput`, `PlayerState`, `WorldStateMessage` exported | `shared/src/index.ts` | importable from client & server, typechecks |
| 2 | Server: player registry + tick loop | connect → register player with a spawn position; disconnect → remove; fixed-rate broadcast loop | `server/src/` | two independent WS clients both receive world-state updates including each other |
| 3 | Server: input handling + authoritative movement | apply clamped movement per input message, update registry | `server/src/` | out-of-range input does not move the player further than the speed clamp allows |
| 4 | Client: pointer-lock FPS controls | replace `OrbitControls` usage, WASD + jump + mouse-look | `client/src/` | manual/Playwright check: pointer lock engages on click, WASD changes position, Space jumps |
| 5 | Client: send input, render remote players | input sent to server on a fixed interval; remote players rendered/updated from `WorldStateMessage`, removed on disconnect | `client/src/` | two-client Playwright check shows mutual visibility of movement |
| 6 | Update README / EPIC docs | run/verify instructions reflect the new controls | repo root | Tester can follow README from a clean checkout |

## 6. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Single player: pointer-lock, mouse-look, WASD, jump all work and feel reasonable
- [ ] Two (or more) simultaneous clients see each other's avatars move in real time
- [ ] Server is authoritative: a deliberately malformed/out-of-range input does not translate into an out-of-range position server-side
- [ ] Disconnecting a client removes its avatar from other clients
- [ ] No TypeScript build errors; `npm run build` and `npm run typecheck` still pass
- [ ] Tester's Gameplay & feel section filled with screenshot evidence for **movement** specifically (per `ai-office/checklists/qa-checklist.md`), ideally showing two-client mutual visibility
- [ ] No secrets committed; env config unchanged unless newly introduced and documented

## 7. Risks

- Headless multi-client testing (two Playwright pages/contexts against one server instance) is more involved than EPIC 1's single-page smoke test — Tester should reuse/extend `scripts/qa-screenshot.mjs` rather than inventing an unrelated approach.
- Pointer Lock API can behave oddly in headless/automated browsers — if Playwright can't reliably trigger real pointer lock, Tester should document the fallback verification approach used (e.g. programmatically driving the same input path the mouse would) rather than silently skipping this Story's acceptance criteria.
- No map/walls exist yet (EPIC 3) — movement in this EPIC is on the open flat ground from EPIC 1 only; don't scope-creep into collision geometry here.
- Broadcast tick rate: too high wastes bandwidth/CPU for no visible benefit locally, too low looks choppy — Programmer should pick something reasonable (e.g. 20 Hz) and document the choice; this is a tuning detail, not a stack deviation.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
