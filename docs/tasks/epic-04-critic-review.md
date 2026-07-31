# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 4 — Shooting & Combat (`docs/tasks/epic-04-shooting-combat.md`)
- Diff / PR reference: `git diff 5ee9ba5..feature/shooting-combat` (full EPIC diff: `5f98bd1` impl + `28a2949` Tester-round-1 F-001 fix + `b33ecae` re-verify)
- Tester PASS report reference: `docs/tasks/epic-04-tester-report-round2.md` (preceded by round1 FAIL)
- Iteration: 1 (first Critic pass)
- Reviewer: Krisya

## Package gates

All PASS: diff reviewable (+1066/-58), Tester report matches commit, every AC traceable, scope confined to EPIC-4-relevant files, gameplay evidence present (12 screenshots across two dirs, opened directly).

## Verdict

**REVISE** — the round-1 F-001 fix closed the debounce bypass for `fire` messages specifically, but the same root defect remains open for four other message shapes sharing the same handler: binary, oversized, non-JSON, and unknown-type/malformed-`input` payloads. None of these update the shared flood-debounce timestamp, so they bypass the 15ms floor entirely and log per-message at unbounded rate — empirically reproduced (185,800 unknown-type msgs/sec → 185,800 log lines, zero flood-guard hits; same pattern for non-JSON and malformed-input). The diff's own new comment overstates coverage ("reject ANY client message... single shared per-connection floor across all message types").

## Checklist

16 items reviewed; only #4/#6/#7 fail (all the same underlying finding). Notable confirmations:

- **#2 Server authority**: confirmed directly — `FireEvent` carries only `{type:"fire"}`, hit resolution built entirely from server-tracked position/yaw/pitch.
- **Dead-player freeze**: genuinely server-side (`playerRegistry.ts` `fire()` returns early if `!shooter.alive`; `stepPlayer()` returns immediately if `!player.alive`).
- **Map-data discipline maintained**: hit-vs-wall detection reuses shared `ARENA_GEOMETRY`/`boxBounds()` from EPIC 3, no duplicated copy.
- **Raycast math**: slab-method AABB intersection traced manually, correct (closer-wall-occludes-farther-player case verified).

## Findings

### F-001 (critical)

Same root cause as the round-1 finding, uncovered message shapes: binary, oversized, non-JSON, unknown-type/malformed-`input`. All bypass the debounce and log unbounded/per-message. Required fix: update the shared debounce timestamp on receipt of *any* message that passes binary/size checks (before JSON parse/type dispatch), not only on accepted `fire`/`input`; apply the existing aggregate-logging pattern to these four drop paths too.

Re-verify: flood each of the 4 message shapes at max client rate for 1s+, confirm O(1) log lines per ~5s interval not O(message count); light regression (clear-LOS hit, wall-block, DPS cap, death/respawn, normal-play silence).

## Revision task

- Finding IDs: F-001 only
- Out of scope: client code, combat/collision math, health/death/respawn logic — `server/src/index.ts` message-dispatch scoping only
- Re-verify required: yes, then **Judge** closes (not Critic)

## Notes (non-blocking) — including a flag for Infosec

- **For Infosec's specific attention** (Team Lead is routing this EPIC through Infosec regardless of this verdict): the F-001 pattern is DoS-adjacent — Node's synchronous `console.warn`/stdout writes at the reproduced volumes (100k+/sec) could plausibly stall the single-threaded event loop long enough to delay the 20Hz tick for *all* players, not just the offending connection. Worth Infosec assessing whether a per-connection hard rate-limit/kick (not just debounce-and-drop) is warranted, and whether this synchronous-logging-under-flood pattern exists elsewhere in the server.
- All of round 1's server-authority spoofing tests independently re-checked by reading the actual types/dispatch code — confirmed structurally impossible for a client to supply anything beyond `{type:"fire"}`.
