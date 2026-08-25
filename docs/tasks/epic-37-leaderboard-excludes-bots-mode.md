# EPIC 37: Competitive Leaderboard Excludes "vs Bots" Kills

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).
Split out from EPIC 35 (split-economy) research per Team Lead's coordinator: a genuine, currently-shipped bug independent of the Deathmatch/Sandbox pool-split confirmation, so it doesn't need to wait on that decision.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Competitive Leaderboard Excludes "vs Bots" Kills |
| **System goal** | The real competitive K/D leaderboard (`server/src/matchManager.ts` `recordKill()` / `EconomyStore.incrementCareerKillDeath()`) should only be fed by `public`-mode (real PvP) kills — today it is also fed by `bots`-mode kills, which both inflates a human player's real kill count and creates bogus leaderboard entries for bot ids (e.g. `"Bot 1"`). |
| **Business/gameplay problem** | The public leaderboard is supposed to reflect real competitive standing; kills against AI opponents in a private practice match currently count toward it, and bot "players" show up on it at all. |
| **Architectural role** | server only — no protocol/client changes. |
| **Main components** | `server/src/match.ts` |
| **Stack** | Fixed project stack. No new dependency. |
| **Interaction with other components** | Independent of EPIC 35 (Deathmatch/Sandbox economy split, currently held pending user confirmation) — this fix does not require or assume any pool-split data model, it's a narrow gating fix to which match modes report to the existing single leaderboard. Also independent of EPIC 31/32 (bot loadouts / bot-kill reward gating) — this is about leaderboard *stats*, not gold/items. |

## 2. Current state (confirmed by Team Lead reading code — re-verify before implementing)

`server/src/match.ts`, inside the kill-resolution branch of the tick loop (search for `killMessage` / `onKillRecorded`, currently ~line 732-740):

```ts
if (this.mode === "endless") {
  if (this.endlessHumanId && shooterId === this.endlessHumanId && this.botAI?.isBot(event.targetId)) {
    this.endlessBotKills += 1;
    this.publishEndlessProgress();
  }
  if (this.botAI?.isBot(event.targetId)) this.botAI.removeBot(event.targetId);
} else {
  this.options.onKillRecorded?.(killMessage.attackerNickname, killMessage.victimNickname);
}
```

The `else` branch covers **any mode that isn't `"endless"`** — that's both `"public"` (correct, should feed the leaderboard) **and** `"bots"` (incorrect, currently also feeds the leaderboard). `onKillRecorded` flows to `MatchManager.recordKill()` (`server/src/matchManager.ts`), which calls `EconomyStore.incrementCareerKillDeath(attackerNickname, victimNickname)` — this increments **both** the attacker's kill count and the victim's death count, keyed by nickname. For a bots-mode kill, the "victim" nickname is the bot's own id (e.g. `"Bot 1"`), so this call currently creates/updates a real leaderboard row for a bot.

## 3. Design

- Change the `else` to an explicit `else if (this.mode === "public")` — `bots`-mode kills fall through to neither branch and record nothing to the leaderboard. `endless` behavior is completely unchanged (already correctly excluded, untouched by this diff).
- This is a **one-condition, single-file change** — do not touch anything else in the kill-resolution branch (bot removal in endless mode, death-message broadcast, gold/item economy handling — all untouched, all independent of this).

## 4. Known limitation (not fixed by this task — flag, don't silently attempt)

Existing/already-polluted leaderboard data (human kill counts inflated by past bots-mode kills, bogus `"Bot N"` entries) is **not** retroactively corrected by this fix — there's no reliable way to distinguish "was this kill against a bot or a human" after the fact from the aggregate counters alone. Team Lead's call: a one-time cleanup script to purge any `"Bot "`-prefixed nickname entries from the leaderboard store is a reasonable **optional** follow-up (cheap, unambiguous — bot ids are already a distinct, recognizable format, `"Bot 1"`, `"Bot 2"`, etc.) but do not attempt to "correct" human kill/death counts retroactively — that data is unrecoverable with confidence, so leave it as-is unless the user explicitly wants a full leaderboard reset.

## 5. Tasks

| # | Task | Place |
|---|------|-------|
| 37.1 | Gate `onKillRecorded` on `mode === "public"` only | `server/src/match.ts` |
| 37.2 | (Optional, only if cheap) one-time cleanup script to purge `"Bot "`-prefixed entries from the leaderboard store | `scripts/` |
| 37.3 | Regression: a bots-mode kill does not call `onKillRecorded`/does not touch the leaderboard; a public-mode kill still does (unchanged); endless mode unaffected | `scripts/regression-leaderboard.ts` (extend existing) or a new small script |
| 37.4 | Live verification: play a "vs Bots" match, kill a bot, confirm the public leaderboard is unchanged before/after | `qa-artifacts/epic-37/` |

**Branch:** `task/epic-37-leaderboard-excludes-bots-mode`
**Base:** `master` (tip at task start: `d1738e2`)

## 6. Acceptance criteria

- [ ] `npm run typecheck` / `build` PASS
- [ ] A "vs Bots" match kill does **not** change the public leaderboard (kill/death counts for the human, or any entry for the bot id) — server-side regression proof
- [ ] A "Quick Join" (`public`-mode) human-vs-human kill still updates the leaderboard exactly as before this change (no regression)
- [ ] Endless mode's own progress tracking (`endlessBotKills`, bot removal/respawn) is completely unchanged
- [ ] Existing `regression:leaderboard` (and any other leaderboard-adjacent regression) still PASS
- [ ] Diff confined to `server/src/match.ts` (+ optional cleanup script/regression additions) — no protocol/client changes

## 7. Risks

- Low risk — a narrow, well-understood gating fix on an already-identified branch. Main risk is scope creep into "fix historical data," explicitly out of scope per Section 4.

## 8. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25
- **Assignee:** Programmer (Pusya)
