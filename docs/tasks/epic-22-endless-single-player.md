# EPIC 22 — Endless Single Player

## User Request

Russian source:

> Добавь еще режим Endless Single Player. Сервер должен генерить бесконечный лабиринт, в нем должно появлятся оружие, патроны, жизнь и боты. А задняя стена должна двигаться на тебя, ну типо туман, и он убивает медленно, т.е. обязательно надо бежать вперед. Для этого режима тоже нужен отдельный лидербоард, сколько ботов убито и сколько километров прошел игрок.

## Scope Delivered

- Added `endless` as a third join mode.
- Endless matches are private one-human matches with ids shaped as `endless:<connectionId>`.
- Server owns endless maze generation through `server/src/endlessWorld.ts`.
- The endless maze grows in forward chunks along negative Z, with side walls, gates, crates, pickups, and bot spawn points.
- The server broadcasts `map_state`; the client renders that geometry and uses it for local collision prediction.
- The server broadcasts `endless_state` with fog position, traveled meters, and bot kills.
- A translucent fog wall moves from behind the player and applies server-side damage over time while the player is caught in it.
- Endless has a separate top-20 leaderboard keyed by normalized nickname:
  - sort by bot kills descending
  - then distance kilometers descending
  - then nickname ascending

## Notes

- Distance is measured as the furthest forward progress from spawn (`max(0, -z)`) and displayed in kilometers.
- Leaderboard data is in-memory, like the existing nickname leaderboard. It resets on server restart.
- This is the first playable slice of endless mode. Maze generation is deterministic by chunk index pattern rather than persisted world storage.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run regression:endless`
- `npm run regression:lobby-nicknames`
- `npm run regression:leaderboard`
