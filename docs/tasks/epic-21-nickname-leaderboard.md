# EPIC 21: Nickname Leaderboard

## 1. EPIC

| Field | Value |
|---|---|
| **Name** | Nickname Leaderboard |
| **System goal** | Show a top-20 nickname leaderboard with kills and deaths. |
| **Business/gameplay problem** | Players can choose readable nicknames, but there is no cross-match top list showing who is performing best. |
| **Main components** | `shared/` protocol, `server/src/matchManager.ts`, `server/src/match.ts`, `server/src/index.ts`, `client/index.html`, `client/src/modeSelect.ts`, QA/regression scripts. |
| **Stack** | Fixed stack unchanged. No new dependency. |

## 2. Design

- The leaderboard is in-memory for the current server process.
- Entries are keyed by normalized nickname.
- A kill increments the attacker's `kills` and the victim's `deaths`.
- The list is sorted by `kills` descending, then `deaths` ascending, then nickname.
- Only the top `20` entries are broadcast.
- Because the game has no round-win condition yet, "wins" are represented as kills.

## 3. Acceptance Criteria

- [x] Leaderboard entries include nickname, kills, and deaths.
- [x] Kills/deaths update when any player or bot kills another player.
- [x] Top players sort to the top.
- [x] The broadcast list is capped at 20 entries.
- [x] The start screen renders the leaderboard.

## 4. Verification

- `npm run typecheck` — PASS
- `npm run build` — PASS
- `npm run regression:leaderboard` — PASS

## Sign-off

- **Specification (author):** Team Lead (Tusya), 2026-08-06
- **Approval (Team Lead):** Team Lead (Tusya), 2026-08-06
- **Assignee:** Programmer (Pusya)
