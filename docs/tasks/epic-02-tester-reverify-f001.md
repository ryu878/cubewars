# Tester scoped re-verify — EPIC 2, F-001 fix (commit `9bc1d92`)

Scope: F-001 only (silent flood-guard drop, no logging) + light regression, per Critic REVISE at `docs/tasks/epic-02-critic-review.md`.

## F-001: literal criteria — CLOSED, with a caveat

Reproduced with a raw `ws` client:

- **6s @ ~2ms interval, 2876 messages sent:** 2 log lines total (not one per drop), first immediate, second ~5s later.
- **12s @ ~2ms interval, 5804 messages sent:** 3 log lines (`dropped 1`, `dropped 6`, `dropped 4`), spaced ~5s apart.
- **4s @ 33ms (~30Hz normal rate), 120 messages:** zero flood-guard log lines — confirms no noise under normal play.
- **6× connect/flood(800ms)/disconnect cycles:** no crash, no exception, clean cleanup each time.

Critic's explicit acceptance bar ("confirm at least one log line appears; confirm normal ~30Hz play produces no extra log spam") is met.

**Caveat:** reported drop *counts* significantly undercount real volume during a sustained flood. In the 12s test, ~5000+ of 5804 messages were almost certainly dropped, yet the log only ever reports totals of `1`, `6`, `4`. Root cause: `floodDropCounts.delete(playerId)` fires on **every** accepted input, not just at the start of a new flood episode — and the time-based guard still lets ~1-in-8 messages through periodically even mid-flood, so the accumulator gets wiped roughly every 15ms and never builds up before the 5s log checkpoint. The literal "must not be silent" requirement is met; the "summarizing N inputs dropped" accuracy Critic's required-fix text asked for is not.

## Light regression — PASS

- `npm run typecheck` / `npm run build`: clean.
- Server + client start cleanly.
- Movement pipeline sanity: 30Hz input for 2s → server-broadcast position advances correctly (z: -3.01 → -13.76).
- Only `server/src/index.ts` touched (`git show --stat 9bc1d92`), matching the scope constraint.

## Handoff

F-001's literal re-verify criteria: closed. New caveat (drop-count undercounting) flagged for Critic/Judge — not itself part of F-001's original wording, but bears on whether the required fix was implemented as specified. Light regression: PASS.
