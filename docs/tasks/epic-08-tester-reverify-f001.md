# Tester re-verify — EPIC 8, F-001 (commit `3f35d15`)

## Scope confirmation

Only `shared/src/collision.ts`, new `scripts/regression-collision-overshoot.ts`, `package.json` (one script entry).

## Independent regression-script run

```
baseline (pre-EPIC-8)   speed=5.000  worstOvershoot=0.0149m (6.0%)   ok
new base (EPIC 8)       speed=6.650  worstOvershoot=0.0445m (13.4%)  ok
boosted (bunny hop)     speed=8.645  worstOvershoot=0.2564m (59.3%)  ok
```

Matches Programmer's numbers to within grid/angle discretization noise.

## Flat-wall sanity (own script, pre/post file comparison)

Pre-fix and post-fix both resolve to `(0, -3.100000)`, displacement 0.0100m, identical at all 3 speeds — bit-for-bit unaffected.

## Residual boosted-speed overshoot — own exploit investigation (beyond re-running committed script)

- Confirmed the worst case at a second, independently-found in-bounds spot (crate_a1 corner), same magnitude — not an isolated fluke.
- Sustained-press/oscillation test: 200 ticks holding into the corner, average per-tick displacement stayed at/below nominal cap — the large displacement occurs on exactly one tick (initial contact), not repeated. No compounding speed advantage.
- Realistic continuous-approach sweep (corrected after catching own methodology bug): worst reachable single-tick displacement 0.6863m (58.8%), confirming it's real and reachable but a single bounded pop, not farmable.
- A natural straight-line approach into the same corner from deep in the arena settles with zero overshoot across a multi-hundred-tick approach — the script's worst case is a maximally-adversarial single-tick angle, not something normal play triggers repeatedly.

**Judgment: matches the EPIC 3 F-NB-1 "self-limiting in aggregate" precedent.** Real, bounded, single-tick, non-repeatable — not a sustained exploit. Dominant bug (square-corner approximation) demonstrably fixed for the common case (6.0%/13.4%, down from 61%+). Residual honestly documented as an inherent point-sampled-collision limit requiring swept collision to fully close (correctly out of scope). Acceptable to ship.

## Light regression

Bunny-hop/movement/jump smoke pass via Playwright: no console errors, player moves and jumps correctly.

## Outcome

**PASS.** F-001 sufficiently addressed. Ready for Judge.
