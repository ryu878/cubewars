# Infosec Findings — Isya → Team Lead

## Meta

- Scope: `feature/shooting-combat` @ `83e63b5`, EPIC 4 full diff
- Trigger: Team Lead assignment (proactive, first PvP-consequential system)

## Summary

Core trust-boundary design is solid: identity cannot be spoofed (playerId is server-generated per connection, never read from messages), aim/position never client-supplied, pitch clamped server-side, no TOCTOU window (synchronous per-message resolution), no double-kill/negative-health races. F-001's flood-guard fix correctly bounds per-connection message *rate*.

**Release blockers: yes — one (F1).**

## Findings

| Severity | Area | Description | Recommendation |
|---|---|---|---|
| **high** | Transport `maxPayload` (`server/src/index.ts`) | `WebSocketServer` doesn't set `maxPayload` — `ws@8.18`'s own default is 100 MiB, so the library fully buffers any frame up to 100MiB into memory *before* the app's 1024-byte check ever runs. The app-level check only rejects after the expensive buffering already happened. A real memory/GC-pressure DoS vector in exactly the class two prior review rounds were scrutinizing — missed because those rounds focused on message *rate*, not the `maxPayload` framing option. | Pass `maxPayload` explicitly to `WebSocketServer` options so `ws` itself rejects oversized frames (closes with code 1009) before app code ever sees them. Also switch the size check from `raw.length` (UTF-16 code units) to `Buffer.byteLength(raw)` for accuracy. |
| medium | No heartbeat / connection-leak (`server/src/index.ts`) | No ping/pong heartbeat — cleanup only runs on clean `close`. A connection that dies uncleanly (dropped wifi, killed process, black-holed NAT) never fires `close`: Maps leak indefinitely, and the player is never removed from `PlayerRegistry` — stays in every broadcast, blocks hitscan, and can be "killed" forever with nobody controlling it (permanent ghost, auto-respawning). | Standard `ws` ping/pong pattern with `terminate()` on missed pong. Not blocking this merge — track as follow-up. |
| medium | Aggregate/connection-count scaling (answers "does per-connection debounce bound aggregate work") | Per-connection debounce doesn't bound connection *count*, no max-connections cap. `performHitscan` is O(n) per fire, so aggregate fire-processing is O(n²) in concurrent firing players. The "~177k msgs/sec no tick-stall" test exercised the cheap rejection path (few connections), not many legitimately-accepted connections doing real work. Invisible at 2-player test scale, unverified at higher counts. | Not urgent for current scope. Add a max-connections cap eventually; record O(n²) scaling as a conscious trade-off note for whoever revisits target player counts. |
| low/info | Health broadcast to all (`WorldStateMessage`) | `health` (new in EPIC 4) rides the same always-visible-to-everyone channel as `position` (pre-existing since EPIC 1/3) — a modified client reading the WS feed directly gets persistent map-wide "health ESP." Plausibly acceptable arcade-FFA trade-off. `pitch`/aim direction correctly NOT broadcast (that part is clean). | No action required to unblock. Explicitly decide/document whether this is an accepted design choice, revisit with per-recipient LOS-gating if competitive integrity becomes a priority later. |
| info (verified clean) | Identity spoofing / replay / TOCTOU | Independently re-verified, not just taken on Critic/Tester's word: playerId never read from message content (can't fire as another player); FireEvent carries no shooter-supplied position/aim; synchronous per-message resolution = no TOCTOU; `Math.max(0,...)` health clamp + alive-check together prevent double-kill/negative-health races; replaying a fire message isn't a distinct exploit (each is independently cooldown-gated from current state). | No action needed. |

## Residual risks

- F1 recommended as release blocker (undercuts the already-twice-reviewed DoS mitigation story; single-line fix, meaningful benefit).
- F2/F3 accepted as residual risk for this merge — availability/scale concerns, not combat-integrity regressions, tracked as follow-up.
- F4 accepted as documented design trade-off for this game type.

## Code / infrastructure changes

Required: yes, for F1 only — trivial. Routes through Team Lead → Programmer → Tester → Critic (fresh pass on this small change, not Judge — this is a new Infosec finding, not a reopened Critic finding).
