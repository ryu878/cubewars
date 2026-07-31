# Critic review (Krisya) → Team Lead — EPIC 5

## Meta

- Diff: `git diff cbe1607..feature/match-flow` (+1225/-12)
- Tester PASS: `docs/tasks/epic-05-tester-report.md`

## Verdict

**APPROVED** — correctly implements all 3 stories with server-authoritative kill/score tracking, EPIC 4's flood-guard/maxPayload posture untouched, screenshot + independent scripted evidence substantiate claims. No blocking finding.

## Checklist

All 16 items PASS. Key confirmations:
- **#2 Server authority**: `ClientMessage` union has no `kill`/`scoreboard` variant — structurally impossible to forge, confirmed by Tester's forged-message test.
- **#4 Security baseline**: kill-feed/scoreboard DOM built via `createElement`/`textContent`, never `innerHTML` — pre-empts XSS if display names are added later.
- **#12 Regression**: EPIC 4's flood guard/fire cooldown/maxPayload logic is byte-for-byte unchanged, only additive broadcast calls inserted around the existing kill path.

## Notes (non-blocking, substantive)

- **7th-player spawn crowding**: agree with Tester this isn't a Story 5.3 AC violation (AC explicitly scoped to the stated 4-6 point pool), but flagging a real gap: no max-connection cap exists anywhere (`wss.on("connection")` accepts unlimited), so a 7th real concurrent player is reachable by ordinary popularity, not just an adversarial test — min spawn separation drops to ~1.7 units at that point, close to spawn-kill range. Recommend either (a) cap connections at 6, or (b) document the 6-player design ceiling. Not blocking.
- Scoreboard/kill-feed broadcast cost (O(n log n)/O(n²) per kill/join/leave) is a non-issue at realistic scale (~6 players, kills bounded by 300ms cooldown) — no new DoS surface, broadcasts only fire on already-rate-bounded events.
- Some screenshots taken from a wall-corner spawn angle are visually weak evidence (subtle framing) — not a defect, tip for future QA scripts to pick a more open vantage point.

## Closing assessment — end-to-end playability

Genuinely playable end-to-end for the milestone: join → move → fight (with wall-blocking) → see kills/score (live, correct for late joiners) → respawn (anti-clustered) all demonstrably work for realistic player counts (~6). Honest caveat for the closing report: unlimited connections accepted, but spawn distribution was only designed/tested for up to 6 concurrent players — degrades gracefully but noticeably beyond that. Documented in `docs/backlog.md`, not a blocker.
