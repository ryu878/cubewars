# Critic review (Krisya) → Team Lead — EPIC 4, final pass after Infosec fix

## Meta

- Diff: `git diff 4eaca42..d67840b -- server/src/index.ts` (isolated F1 fix), full round `git diff 83e63b5..d67840b`
- Tester PASS: `docs/tasks/epic-04-tester-reverify-infosec-f1.md`

## Verdict

**APPROVED** — F1 fix correctly implemented, independently reproduced (2MiB frame closed 1009 at the `ws` framing layer, before app handler, clean cleanup on close), scoped exactly to the Infosec finding, no regression to anything previously verified (confirmed via diff, not asserted — no client/combat/registry/map files touched).

## Checklist

All relevant items PASS. Key confirmations:
- **#4 Security baseline**: closes exactly the gap Infosec flagged — oversized frames rejected at the `ws` framing layer now, before any app code.
- **#12 Regression risk**: `git diff 83e63b5..d67840b` touches no client code, no combat.ts, no playerRegistry.ts, no map/collision, no HUD — confirmed empirically too via Tester's flood-guard regression check.
- Gameplay/visual/controls items correctly N/A — transport-layer fix only, no player-visible change.

## Judgment on Infosec F2/F3/F4 (independently reviewed, not deferred)

- **F2** (heartbeat/connection-leak): agree non-blocking — availability/hygiene issue, not a PvP-integrity exploit (a ghost player can't be manipulated for advantage). Correctly rated medium not high.
- **F3** (O(n²) hitscan / no connection cap): agree non-blocking — invisible at current scale, a scale-driven decision to make deliberately later, not force now.
- **F4** (health broadcast to all): agree non-blocking — consistent with the pre-existing position-broadcast pattern since EPIC 1/3; `pitch`/aim direction correctly NOT broadcast, so the asymmetry is intentional. Plausible accepted arcade-FFA trade-off.

## Notes

- Recommended a persistent backlog doc for F2/F3 (created — see `docs/backlog.md`) so they aren't lost once this EPIC merges.
- Recommended explicitly documenting F4 as an intentional design choice (added to `docs/backlog.md`'s design-decisions section).
