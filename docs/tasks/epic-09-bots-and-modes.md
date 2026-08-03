# EPIC 9: Bots & Match Modes

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Bots & Match Modes |
| **System goal** | Let a player choose, before joining, between two modes: **vs Bots** (a private match against 2 AI-controlled bots) and **Multiplayer** (the existing shared world — if no one else is connected, you simply wait/practice alone, exactly today's behavior). This requires the server to support multiple concurrent match instances instead of one global world. |
| **Business/gameplay problem** | The game currently has exactly one shared world. The user wants a way to play solo against bots, and an explicit "waiting for other players" experience distinct from that. |
| **Architectural role** | This is the largest architectural change since EPIC 1: the server's single global `PlayerRegistry` + broadcast loop becomes N independent match instances, each with its own registry/tick/pickup-spawner state. Client gains a pre-join mode-selection screen. |
| **Main components** | `server/` (match/room management — new), `shared/` (join/mode protocol), `client/` (mode-select UI) |
| **Stack** | Fixed project stack. No matchmaking service, no persistence — matches are ephemeral, in-memory, created on demand. |
| **Interaction with other components** | Depends on **every previous EPIC being merged first** (2-8) — this EPIC generalizes the single-instance systems (movement, collision, combat, weapons, pickups, health/armor, kill feed, scoreboard) that all currently assume one global world, into something instantiable per match. This is a refactor of existing code, not a rewrite — reuse the existing `PlayerRegistry`/pickup-spawner/tick-loop logic, parameterized per match, rather than duplicating it. |

## 2. Architecture (fixed by Team Lead — read before starting)

- **Match**: a self-contained instance of {`PlayerRegistry` (or its post-refactor equivalent), pickup spawner state, tick loop, connected sockets}. Every currently-global piece of server state (the single `PlayerRegistry`, the single pickup-spawner, the single 20Hz `setInterval` tick) becomes owned by a `Match` object; the server holds a `Map<matchId, Match>` instead of these as bare module-level variables.
- **Two match kinds**:
  - **`public`**: exactly one persistent instance, created at server startup, id fixed (e.g. `"public"`). This is today's world — always exists, whether 0, 1, or many players are in it. Choosing "Multiplayer" joins this instance. If you're the only one in it, you're just walking around alone (today's behavior, unchanged) — this **is** the "waiting for players" mode, not a separate thing to build.
  - **`bots:<connectionId>`**: created on demand when a player chooses "vs Bots", contains exactly that one human player + 2 bot-controlled players, torn down (all state freed) when the human disconnects. Not visible to or joinable by any other client.
- **Join flow**: on WS connect, the server sends `welcome` as today, but does **not** spawn the player into any match yet. The client shows a mode-select screen; once the player picks a mode, the client sends a `join` message (`{type:"join", mode:"public"|"bots"}`); only then does the server spawn the player into the corresponding match (creating a fresh `bots:*` match if needed) and start sending that match's `world_state`/`scoreboard`/etc. broadcasts to that connection. Reconnecting/refreshing re-shows the mode-select screen (no session persistence needed — out of scope).
- **All existing message types** (`input`, `fire`, `switch_weapon`, etc.) are now scoped to "whichever match this connection is currently in" — a connection's messages must only affect its own match's state, never another match's.

## 3. Bot AI (fixed by Team Lead — keep this simple, no pathfinding library)

Bots are regular entries in a match's `PlayerRegistry` (same health/armor/weapon/death/respawn state machine as a human player — pistol only, see below) driven by a simple per-tick AI update instead of client input:

- **State machine**: `SEEKING` (no visible target) ↔ `ENGAGING` (a live human or other bot is within some detection range, e.g. 45 units, AND has clear line-of-sight per the same wall-raycast check `server/src/combat.ts` already uses for hitscan).
- **`SEEKING`**: move toward a waypoint chosen from the arena's existing spawn-point list (`shared/src/mapData.ts` `SPAWN_POINTS` — reuse, don't invent a second waypoint list), picking a new random waypoint when close to the current one or after a timeout; this gives bots patrol-like movement across both sites/mid/tunnel without needing real pathfinding, since spawn points are already spread across the walkable area.
- **`ENGAGING`**: face the target (interpolate yaw toward it, matching the same yaw-clamp/validation discipline as player input), stop advancing (or slowly close distance — Programmer's call, document it), and fire at the target's weapon-appropriate cooldown once aimed (a bot uses the pistol only — do not implement bot weapon/health/armor pickup behavior, keep bot capability intentionally simpler than a human player's, note this as a deliberate scope cut).
- **Movement application**: bots go through the **same** server-authoritative `stepPlayer()`/collision/speed-clamp path as human players (including EPIC 8's new speed constant, but bots do not use bunny hop — keep bot movement simple, ground-based only) — a bot is not a special-cased exception to physics, it's a `PlayerRecord` whose "input" is computed by AI instead of read from a socket.
- **Bots appear in `world_state`, kill feed, and scoreboard exactly like human players** (a human can kill a bot for a kill-feed entry and a scoreboard point, and vice versa — a bot "killing" the human should also show correctly). Use a readable bot label (e.g. "Bot 1"/"Bot 2") instead of a random UUID prefix, since there's no human player to have picked a name.

## 4. Story 9.1 — Match/room refactor (no new gameplay yet, but must not regress any existing gameplay)

**As a** developer **I want** the server's global state converted into per-match instances **so that** bots mode and multiplayer mode can coexist without interfering.

- **Acceptance criteria:**
  - [ ] The existing `public` match behaves identically to today's single-world game for anyone who picks "Multiplayer" — this is the regression-risk story, budget real verification time here
  - [ ] Two connections in different matches (one `public`, one `bots:*`) never see each other's `world_state`/kill feed/scoreboard, and one connection's `input`/`fire` never affects the other match

## 5. Story 9.2 — Mode-select screen

**As a** player **I want** to choose "vs Bots" or "Multiplayer" before playing **so that** I get the experience I asked for.

- **Outputs:** a simple pre-game overlay (two buttons, plain HTML/CSS like the rest of the HUD — no new UI framework) shown before pointer-lock is even available; picking a mode sends the `join` message and then proceeds into the game exactly as today (click-to-lock, etc.).
- **Acceptance criteria:**
  - [ ] Both buttons work and lead to the correct match kind
  - [ ] The player cannot send `input`/`fire`/`switch_weapon` before joining a mode (server ignores/rejects gameplay messages from a connection that hasn't joined a match yet — same "reject what shouldn't be trusted" discipline as everything else)

## 6. Story 9.3 — Bots play

**As a** player in "vs Bots" mode **I want** 2 bots that move, aim, shoot, take damage, die, and respawn **so that** I have someone to fight when alone.

- **Acceptance criteria:**
  - [ ] Exactly 2 bots spawn in a fresh `bots:*` match, at valid spawn points
  - [ ] A bot without a visible target patrols between waypoints; a bot with a visible human target turns to face and fires at the established pistol cooldown/damage
  - [ ] A bot can be killed by the human (server-confirmed hit, health/armor/death/respawn identical to a human player's state machine) and shows up correctly in kill feed/scoreboard
  - [ ] A bot can kill the human player (this should feel fair, not oppressive — a lone pistol-only bot at normal human damage/cooldown is intentionally not hard to fight, per "keep this simple")

## 7. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: `join` message type, mode enum | typed protocol addition | `shared/src/` | typechecks |
| 2 | Server: `Match` abstraction wrapping existing registry/spawner/tick-loop state | refactor, not rewrite | `server/src/` | `public` match behavior unchanged, verified by full regression pass |
| 3 | Server: match manager (`Map<matchId, Match>`), connection→match routing, join handling | new module | `server/src/` | two matches verified isolated |
| 4 | Server: bot AI state machine + spawn/despawn with match lifecycle | reuses `PlayerRecord`/`stepPlayer()` | `server/src/` | bots patrol/engage/fire/die/respawn correctly |
| 5 | Client: mode-select screen, `join` message send | new pre-game UI | `client/src/` | both modes reachable and functional |

## 8. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] `public` (Multiplayer) mode behaves identically to the pre-EPIC-9 game — this is the top regression risk of the whole feature set, treat it as such
- [ ] `bots:*` matches are private, isolated, created/destroyed correctly with connection lifecycle
- [ ] 2 bots exhibit patrol/engage/fire/die/respawn behavior, appear correctly in all broadcasts
- [ ] Gameplay messages are rejected before a connection has joined a match
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes: mode-select screen, a bots match with visible bot avatars, a bot engaging/firing, a bot death/respawn, and evidence that a second simultaneous `public`-mode client is unaffected by a concurrent `bots:*` match

## 9. Risks

- **This is the highest-risk EPIC in the whole project so far** — it touches the server's core state-ownership model, not just an additive feature. Expect this to need more than one Critic round; do not rush the regression verification on the `public` match path.
- Bot AI is intentionally minimal (patrol/engage/fire with the pistol only, no weapon/health/armor pickups, no advanced tactics, no bunny hop) — document this as a deliberate scope cut, not a bug, if the user later wants smarter bots that's a follow-up.
- Depends on EPICs 6, 7, and 8 all being merged first, since bots need to coexist correctly with the weapon/pickup/health/armor/movement systems those introduce (e.g. do bots interact with pickups at all? **Decision: no** — bots stay pistol-only and ignore all pickups entirely, keeping this EPIC's scope bounded; note this explicitly so Critic doesn't treat "bots don't pick up weapons/health/armor" as a missed requirement).

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
