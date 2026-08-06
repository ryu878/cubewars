# EPIC 20: Lobby, Nicknames, and 4-Player Public Matches

## 1. EPIC

| Field | Value |
|---|---|
| **Name** | Lobby, Nicknames, and 4-Player Public Matches |
| **System goal** | Add a simple lobby flow with player nicknames and cap public matches at 4 human players per map. |
| **Business/gameplay problem** | A single unlimited public match does not scale cleanly for the current arena size, and UUID-style player labels are not readable for players. |
| **Main components** | `shared/` protocol, `server/src/index.ts`, `server/src/matchManager.ts`, `server/src/match.ts`, `server/src/playerRegistry.ts`, `client/index.html`, `client/src/modeSelect.ts`, `client/src/main.ts`, QA/regression scripts. |
| **Stack** | Fixed stack unchanged. No new dependency. |

## 2. Design

- Public matches have a hard cap of `4` human players.
- Quick Join finds the first public match with room, or creates a new public match if all are full.
- The lobby lists public matches as `Game N · players/4`.
- A player chooses a nickname before joining.
- Nicknames are validated server-side and client-side using the same shared helper.
- Duplicate nicknames are rejected only inside the selected/assigned match.
- Nicknames are not stored on the server after disconnect and are not reserved globally.
- The browser remembers the last nickname in `localStorage` for convenience only.

## 3. Acceptance Criteria

- [x] The public match capacity is 4 human players.
- [x] A fifth Quick Join player is placed into a new public match.
- [x] The lobby shows the current public games and occupancy.
- [x] Joining a selected match with a duplicate nickname is rejected.
- [x] The same nickname can be used in a different public match.
- [x] Scoreboard and kill feed display nicknames.
- [x] Gameplay messages before successful join remain rejected.

## 4. Verification

- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run regression:lobby-nicknames` — PASS

## Sign-off

- **Specification (author):** Team Lead (Tusya), 2026-08-06
- **Approval (Team Lead):** Team Lead (Tusya), 2026-08-06
- **Assignee:** Programmer (Pusya)
