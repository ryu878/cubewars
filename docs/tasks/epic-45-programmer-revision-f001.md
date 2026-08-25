# EPIC 45 — Revision task (Critic F-001 only)

Team Lead → Programmer. Fix **only** finding **F-001** from `docs/tasks/epic-45-critic-review.md`.

## F-001 (required)

Stale dual-bind profile race: `lobby_bind_nickname` sets `lobbyEconomyPool` sync then async-pushes `economy_profile` with no generation/cancellation. Overlapping binds can deliver the wrong pool’s profile while mutations use the newer `lobbyEconomyPool` → apparent pool bleed / wrong-pool discard.

**Fix:** On server lobby bind path, ignore stale in-flight profile pushes after a newer successful bind (per-connection bind generation in the async closure; skip stale `economy_profile` / bind-ok). Optional client harden: ignore `economy_profile` whose pool ≠ last lobby request. Do **not** trust client pool for mutations — keep server `lobbyEconomyPool`.

**Prove closed:** Regression that fires sandbox bind then immediate deathmatch bind and asserts no sandbox `economy_profile` after the deathmatch profile (and/or equivalent). Re-run `npm run regression:lobby-inventory`.

## Out of scope

N-001..N-005; lobby gold hint copy; auction list/bid expansion; account-gating bind.

## After fix

Update handoff `docs/tasks/epic-45-programmer-handoff-f001.md` (or extend handoff) for Tester re-verify. Commit on same branch `feature/epic-45-dual-lobby-inventory-auction`.
