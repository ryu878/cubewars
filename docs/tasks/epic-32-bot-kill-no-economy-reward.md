# EPIC 32: Bot Kills Grant No Economy Reward (Gold or Items)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).
User decision (explicit, verbatim Russian, translated): "Then don't let gold drop from bots either, or the economy will collapse." This reverses the prior "bots are gold-only for items" design: bot-victim kills must now grant **nothing** — no gold, no items. Only a **human-victim** kill feeds the economy.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Bot Kills Grant No Economy Reward (Gold or Items) |
| **System goal** | `grantKillGold()` in `server/src/match.ts` currently mints gold to any human killer unconditionally (before the `victimIsHuman` check, which today only gates *item* drops). Change it so the entire reward — gold **and** items — is gated on `victimIsHuman`. Killing a bot must yield zero economy reward of any kind. |
| **Business/gameplay problem** | Bots respawn indefinitely with no risk to the killer (no death penalty, no gear loss) — unconditional gold-per-bot-kill is effectively an infinite, riskless gold faucet in "vs Bots"/"endless" modes, which the user identified as economy-breaking. |
| **Architectural role** | server (authoritative economy/combat resolution) — no client or protocol changes. |
| **Main components** | `server/src/match.ts` (`grantKillGold`), regression scripts, docs/README |
| **Stack** | Fixed project stack (Node/TS server). No new dependency. |
| **Interaction with other components** | This is the **same** `victimIsHuman` check that already gates item drops (`server/src/match.ts` ~line 531) — this task widens its scope to also gate the gold mint that currently happens unconditionally just above it (~line 516-528), rather than introducing a second/parallel condition. Human-vs-human kills (public matches, or a human killing another human in any mode) are **completely unaffected** — this only changes the bot-as-victim case. `EPIC 31` (bot equipment loadouts, running in parallel on a separate branch) must **not** be touched by or hooked into this change, and vice versa — EPIC 31 only changes what stats a bot *has*, never the kill-reward path; this task only changes the kill-reward path, never bot stats/AI. If both branches land, whichever merges second must rebase cleanly since both touch `server/src/match.ts`, in different, non-overlapping functions. |

## 2. Current state (confirmed by Team Lead reading code — re-verify before implementing)

`server/src/match.ts`, `grantKillGold(shooterId, victimId)` (~line 507-592):

```ts
private async grantKillGold(shooterId: string, victimId: string): Promise<void> {
  const economy = this.options.economy;
  if (!economy) return;
  if (shooterId === "fog" || shooterId === victimId) return;
  if (!this.sockets.has(shooterId)) return;
  if (this.botAI?.isBot(shooterId)) return;

  const killer = this.registry.getPlayer(shooterId);
  if (!killer) return;

  const primaryGained = randomInt(GOLD_DROP_MIN, GOLD_DROP_MAX + 1);
  await economy.addGold(killer.nickname, primaryGained);   // <-- unconditional today
  console.log(`[economy] gold minted: ...`);

  // Item drops: human victims only (bots remain gold-only for items).
  const victimIsHuman = this.sockets.has(victimId) && !this.botAI?.isBot(victimId);
  ...
  const drops = await economy.resolveKillDrops(killer.nickname, victimIsHuman, ...);
  ...
  const totalGained = primaryGained + drops.substitutedGold;
  this.sendEconomyGoldUpdate(shooterId, profile.gold, totalGained);
  ...
}
```

The `victimIsHuman` gate already exists and already correctly identifies "was the thing I killed a bot or a human" — today it's applied only to `resolveKillDrops()` (items), not to the `economy.addGold()` call above it. That asymmetry is exactly the bug to fix.

## 3. Design

- Move the `victimIsHuman` computation to the top of `grantKillGold()` (before the gold mint), and gate the **entire reward path** — `economy.addGold()`, `resolveKillDrops()`, the `economy_gold_update` send, and the associated `[economy] gold minted` / `kill item drops` log lines — on `victimIsHuman`.
- When `victimIsHuman` is false (bot victim): `grantKillGold()` returns early after that check, doing nothing — no `addGold`, no `resolveKillDrops`, no `sendEconomyGoldUpdate`, no profile fetch/send. Log a clear one-line message instead so this is observably a deliberate no-op, not a silent swallow (global-standards.mdc "no silent failures" — e.g. `[economy] kill vs bot victim -> no reward (${shooterId} -> ${victimId})` at most once is fine, does not need to be spammy for every bot kill; your call on log verbosity, but it must be visible in the log, not silent).
- Human-vs-human kill path (the `victimIsHuman === true` branch) must produce **byte-for-byte the same behavior** as before this change — gold amount range, item drop resolution, shard-opportunity tracking, `economy_gold_update`/`economy_profile` sends, and log lines all unchanged. This is a **gating** change, not a rewrite of the reward logic itself.
- Do **not** touch `this.botAI?.isBot(shooterId)` early-return (bot-as-shooter already correctly grants nothing — that part is out of scope, already correct, do not touch).
- Do **not** touch `applyHumanDeathEconomyPenalties()` (death penalties on a human victim) — unrelated to this change, already correctly scoped to human victims only.
- Update the doc comment above `grantKillGold()` (currently says "and on human victims only roll egg/stim/gem/shard/amulet/repair drops" as if gold is unconditional) to reflect the new behavior: gold AND items both require a human victim.

## 4. Docs/README updates required

- `README.md` "Current status" (or wherever EPIC 23-26 economy behavior is currently described) — any language saying bots are "gold-only for items" or similar is now **wrong** and must be corrected to: bot-victim kills grant nothing (no gold, no items); only human-vs-human kills feed the economy.
- `docs/tasks/epic-23-economy-persistence-foundation.md`, `docs/tasks/epic-24-programmer-handoff.md`, `docs/tasks/epic-25-gems-amulets-shards.md` each contain the old "bots gold-only for items" framing — add a short note pointing to this EPIC as the superseding behavior (do not rewrite history, just annotate, same pattern already used elsewhere in this repo for superseded balance numbers, e.g. EPIC 10's damage-rebalance note in `epic-06-weapons-ammo.md`).

## 5. Tasks

| # | Task | Place |
|---|------|-------|
| 32.1 | Gate the entire `grantKillGold()` reward path (gold + items) on `victimIsHuman`, computed before the mint | `server/src/match.ts` |
| 32.2 | Update `grantKillGold()`'s doc comment | `server/src/match.ts` |
| 32.3 | Extend/add regression coverage: human kills bot -> zero gold, zero items, zero economy messages sent; human kills human -> unchanged (gold + possible items, as before) | `scripts/regression-economy-gold.ts` and/or a new bot-kill-specific regression script |
| 32.4 | Update README "Current status" + annotate EPIC 23/24/25 docs per Section 4 above | `README.md`, `docs/tasks/epic-23-*.md`, `epic-24-programmer-handoff.md`, `epic-25-*.md` |
| 32.5 | Live verification: run an actual "vs Bots" match, human kills a bot, confirm server logs show no gold-minted line and the client HUD gold display does not change; then human kills a human (if feasible in this setup) or otherwise confirm via regression that the human-victim path is unchanged | `qa-artifacts/epic-32/` |

**Branch:** `task/epic-32-bot-kill-no-economy-reward`
**Base:** `master` (tip at task start: `b31239d`)

## 6. Acceptance criteria

- [ ] `npm run typecheck` / `build` (server workspace, and full monorepo build) PASS
- [ ] Killing a bot (any match mode) grants **zero gold and zero items** to the human killer — verified live: join "vs Bots", kill a bot, confirm (a) server log shows no `[economy] gold minted` line for that kill, (b) client gold HUD value is unchanged before/after the kill (screenshot or explicit before/after read-out)
- [ ] Killing a human victim is **completely unchanged**: gold in `[GOLD_DROP_MIN, GOLD_DROP_MAX]` minted, item drop resolution unchanged, existing regression (`regression:economy-gold` and any other economy regression touching kill rewards) still PASS
- [ ] New/extended regression explicitly asserts the bot-victim-zero-reward case (not just the existing human-victim case)
- [ ] `server/src/match.ts` diff confined to `grantKillGold()` (+ its doc comment) — no changes to bot AI, bot stats, protocol, or client
- [ ] README "Current status" and the three EPIC 23/24/25 docs no longer claim bots are "gold-only for items" — updated per Section 4
- [ ] No secrets, no unrelated file changes
- [ ] EPIC 31 (bot loadouts, parallel branch) unaffected by this change and does not affect this change — confirm by checking your diff touches none of `server/src/botAI.ts`, `client/src/remotePlayers.ts`, or `PlayerState` in `shared/src/index.ts`

## 7. Risks

- Merge order with EPIC 31: both branches touch `server/src/match.ts`, in different functions (`grantKillGold` here vs. wherever EPIC 31 populates `PlayerState.equippedPetTypes`/`hasAmulet` in the world-state broadcast). Low collision risk, but whichever PR merges second should rebase onto the first before Tester re-verifies, per normal practice — flag to Team Lead if a conflict actually appears, do not silently resolve a substantive conflict yourself without noting it in the handoff.
- This is a real gameplay/economy-balance change (removes bot-kill gold entirely) — confirm the live verification is unambiguous (an actual before/after gold reading), since this is exactly the kind of claim Critic/Tester will want hard evidence for, not a description.

## 8. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-24
- **Assignee:** Programmer (Pusya)
