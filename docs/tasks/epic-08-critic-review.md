# Critic review (Krisya) → Team Lead — EPIC 8

## Meta

- Diff: `git diff 60554ff..b31e968`
- Tester PASS: `docs/tasks/epic-08-tester-report.md`

## Verdict

**REVISE** — F-001 (major): Tester's F-NB-1 re-check claim ("proportionally better at new speeds") is contradicted by Critic's own independent reproduction against the real `resolveHorizontalCollisions()` at the real tick dt: worst-case percentage overshoot is essentially flat (~61.5%/61.5%/61.7%), and worst-case **absolute** overshoot clearly increases (0.154m→0.204m→0.267m, +73% baseline→boosted) — the opposite of what was reported, and no script was committed to back the claim. F-002 (major, routing not necessarily code): a real spec-wording deviation in the boost mechanic (zero effect if no input held during boost window, vs. spec's literal "or current velocity direction" fallback) needs a recorded Team Lead decision, not an informal Tester judgment call, per the EPIC 6 precedent.

## Checklist

14/16 PASS, 2 FAIL (both tied to F-001). Key confirmations: server authority for boost trigger/magnitude solid (edge-detected from server's own stored intent, boost constants never client-supplied); scope discipline clean (no weapon/pickup/combat files touched); README correctly updated (Tester's own "not updated" note in their report was stale text, harmless).

## Findings

### F-001 (major)

Committed regression script needed for F-NB-1 at old/new/boosted speeds against the real production collision function and real tick dt, with numbers that hold up under re-run. Given the confirmed absolute-magnitude increase, apply `docs/backlog.md`'s long-suggested tightening (clamp resolved displacement to pre-resolution proposed + epsilon) rather than re-deferring — EPIC 8 is exactly the moment this interaction is being exercised at higher speeds.

### F-002 (major, routing)

Team Lead decision (see below), not left to Tester.

## Revision task

- Finding IDs: F-001, F-002
- Out of scope: no other movement/collision changes beyond what these two require; no weapon/pickup/combat code
- Re-verify required: yes — new committed F-NB-1 script + confirmation of the TL decision + light regression on shoot/HUD/kill-feed

## Team Lead decision on F-002

Accept the as-built behavior: the bunny-hop multiplier only benefits currently-held movement input, no zero-input velocity-direction fallback. Reasoning: the game's entire horizontal movement model has been intent-driven (recomputed from input every tick, no persisted velocity) since EPIC 2 — introducing a persisted-velocity subsystem just for this one edge case would be architecturally inconsistent with the rest of the codebase for a low-value edge case (real bunny-hop play requires holding a direction anyway). **Action: update `docs/tasks/epic-08-movement-tuning.md` §2 wording to match shipped behavior** (drop the "or current velocity direction" fallback clause), not a code change.
