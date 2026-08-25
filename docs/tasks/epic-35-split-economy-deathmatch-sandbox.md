# EPIC 35: Split Economy — Deathmatch vs. Sandbox Pools

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).
**STATUS: CONFIRMED by user, cleared for implementation.** User's exact confirmation (Russian): "Два независимых как первый вариант, только без крипты вообще" ("two independent [pools] like the first option, just without crypto at all" — read as "без чита", i.e. "without cheating," a near-certain autocorrect/typo for "без крипты"; nothing in this thread or the codebase has ever involved cryptocurrency/blockchain, and "two independent pools, no cheating" is the only reading consistent with the entire conversation's anti-cheat framing. Team Lead's assessment concurs with this reading. **No cryptocurrency/blockchain functionality is in scope anywhere in this EPIC** — if that reading turns out to be wrong, stop and flag back to Team Lead before building anything crypto-related, do not improvise).

User's words ("Part A"), Russian, translated:
1. "Deathmatch mode is a separate economy — gold, pets, characteristics. And the modes against bots (vs bots and endless) are separate. So they don't mix and so people can't cheat."
2. (Separately) "In Deathmatch, same as in the bot modes, everything should drop the same way. Bots should also be randomly colored, have random pets, some amulets etc. Basically, for us these modes are just test modes."

## 0. Reconciling interpretation (provisional — confirm before implementing)

Read literally, statement 2 sounds like it reverses EPIC 32 (bot-victim kills grant zero economy reward), which was shipped specifically to stop bots from being an infinite riskless gold/item faucet against the real economy. The reconciling reading — proposed by Team Lead's coordinator, not yet corrected by the user — is:

- There are **two fully independent economy pools per account/nickname**: a **Deathmatch** pool (the real, competitive economy — gold, pets, gems, amulets, shards, everything from EPIC 23-29) and a **Sandbox** pool (scoped to `bots:*`/`endless:*` matches only).
- **Deathmatch pool:** fed **only** by confirmed human-vs-human kills in a `public`-mode match ("Deathmatch" is the user's name for what the codebase currently calls `public` mode / the "Quick Join" mode-select button — confirmed by reading `client/index.html`'s mode-select markup and `client/src/main.ts`'s "Multiplayer" comment; there is no separate "Deathmatch" match type today, `public` **is** it). Nothing earned anywhere else can ever enter this pool. This is EPIC 32's actual invariant, preserved.
- **Sandbox pool:** fed by kills inside `bots:*`/`endless:*` matches — **including bot-victim kills**, which is the part that looks like an EPIC 32 reversal but isn't, because it's now writing into a pool that **can never feed back into Deathmatch**. Farming the sandbox pool is harmless by construction — it matches the user's own framing that these modes are "just test modes." Bots in this scope also get: (a) EPIC 31's existing random pet/amulet loadouts (already shipped, unchanged), (b) EPIC 36's random color (if that lands), (c) kills against/by them now grant gold/items again, but exclusively into the sandbox pool.

**If this interpretation is wrong** (e.g. the user actually does want bot-kill farming re-enabled against the *same* real economy, full reversal of EPIC 32, no isolation) — do not implement Section 3 as written; come back to Team Lead for a re-spec. Team Lead's assessment: the isolated-pool reading is very likely correct given the user's own "не читили" (anti-cheat) framing directly contradicts a literal full reversal, but this is the user's product call, not Team Lead's or Programmer's to assume silently.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Split Economy — Deathmatch vs. Sandbox Pools |
| **System goal** | Two fully isolated economy states per player: a competitive "Deathmatch" pool fed only by real PvP, and a "Sandbox" pool scoped to bots/endless matches with full drop mechanics re-enabled, that can never cross-contaminate. |
| **Business/gameplay problem** | Preserve the integrity of the competitive economy (the exact reason EPIC 32 exists) while still letting bots/endless feel rewarding and "test-mode" playable, per explicit user request. |
| **Architectural role** | server (economy keying/scoping, kill-reward routing, leaderboard scoping — see Section 4 finding) + client (UI must make it unambiguous which pool is in view) |
| **Main components** | `server/src/economy/store.ts`, `server/src/match.ts` (`grantKillGold`), `server/src/matchManager.ts` (`recordKill`), `client/src/inventoryOverlay.ts`, `client/src/modeSelect.ts` |
| **Stack** | Fixed project stack. Reuses the existing `EconomyStore`/Redis machinery — this is a **keying/scoping** change, not a new persistence technology. |
| **Interaction with other components** | Builds directly on EPIC 32 (bot-kill reward gating) and EPIC 31 (bot loadouts, unaffected). Explicitly **does not** touch EPIC 33's avatar-color persistence (separate module by design, see EPIC 33 Section 4) or EPIC 34's account/session work (Section 5 below notes this as a future keying option, not a dependency). |

## 2. Data model recommendation (Team Lead's call on "cleanest," per the coordinator's ask — confirm/override during review)

Add a `scope: "deathmatch" | "sandbox"` dimension to profile keying, reusing 100% of the existing `EconomyStore`/`EconomyDocument` schema and business logic (grant, hatch, equip, socket, craft, discard, move — all of EPIC 23-29's already-reviewed code) — just parameterize the Redis key by scope instead of duplicating any economy logic:

```
${keyPrefix}:economy:v1:${scope}:${nicknameKey}
```

i.e., **two independent `EconomyDocument`s per nickname**, one per scope. `scope` is derived **server-side only**, from `match.mode` (`public` → `"deathmatch"`; `bots`/`endless` → `"sandbox"`) — never client-supplied, so a client cannot claim to be in one scope while actually playing in the other. Every existing economy method (`getOrCreateProfile`, `addGold`, `resolveKillDrops`, hatch/equip/socket/craft/discard/move, etc.) gains a `scope` parameter threaded through to the key-building step — a mechanical, low-risk change if done as a pure key-namespace parameterization rather than a logic rewrite.

**Migration:** existing single-pool profiles (everyone's current data) become the **Deathmatch** pool as-is (it's the "real" economy that already existed) — a one-time, idempotent migration step maps old keys (`${keyPrefix}:economy:v1:${nicknameKey}`) to the new `${keyPrefix}:economy:v1:deathmatch:${nicknameKey}` keys on first read if the new key doesn't exist yet (same "auto-pack once on load" precedent as EPIC 29's slot-anchor migration). Sandbox pools start empty for everyone — no backfill, there's no prior sandbox-scoped data to migrate from.

## 3. Kill-reward routing (redesign of `grantKillGold()`, building on EPIC 32)

- Compute `scope` from `this.mode` at the top of `grantKillGold()`.
- **`scope === "deathmatch"`:** keep EPIC 32's exact behavior — gate the entire reward (gold + items) on `victimIsHuman`; bot victims (which shouldn't exist in `public` matches anyway) still grant nothing. Writes into the `deathmatch` pool.
- **`scope === "sandbox"`:** grant the reward (gold + items) regardless of whether the victim is a bot or a human — this is the re-enabled "everything drops the same way" behavior the user asked for, but it writes into the `sandbox` pool exclusively. Self-kills/fog deaths remain excluded (unrelated to the human/bot distinction, no change there).
- This is **not** a revert of EPIC 32's code — it's EPIC 32's `victimIsHuman` gate staying exactly as-is for the `deathmatch` branch, with a new `sandbox` branch added alongside it that behaves differently because it targets a completely different, isolated pool.

## 4. Finding: the real PvP leaderboard is *already* polluted by bots-mode kills — SPLIT OUT, do NOT duplicate here

`server/src/match.ts`'s kill-resolution code only excludes `mode === "endless"` from feeding the competitive K/D leaderboard, not `mode === "bots"` too — this was discovered during this EPIC's research but has since been **split out into its own EPIC 37** (`docs/tasks/epic-37-leaderboard-excludes-bots-mode.md`), assigned separately since it doesn't depend on this EPIC's pool-split data model. **Do not re-fix this in EPIC 35** — if EPIC 37 has already merged by the time you implement this EPIC, its fix (gating `onKillRecorded` on `mode === "public"`) will already be in `master`/your branch base; if not yet merged, leave the leaderboard gating alone here entirely and let EPIC 37 handle it on its own branch, to avoid two branches touching the same line and conflicting. Task 35.4 below is removed accordingly — do not implement it.

## 5. Client: making the pool unambiguous

- Mode-select screen: label which economy each button feeds (e.g. "Quick Join — Deathmatch" vs. "vs Bots / Endless — Sandbox (separate)").
- Inventory overlay (`I`): must show which pool is currently in view. Default to the Deathmatch pool when not in a match (it's the "primary"/persistent one); while actually inside a `bots:*`/`endless:*` match, show the Sandbox pool. Programmer's call on exact UI treatment (a visible label/badge is the hard requirement; a toggle to preview the other pool while not in a match is a nice-to-have, not required).

## 6. Explicitly out of scope for this EPIC

- Any change to `EPIC 34`'s account/session system, or migrating pool keying from nickname to `accountId` — nickname-keyed dual pools are sufficient to satisfy the stated goal (isolating sandbox farming from the competitive economy); re-keying to `accountId` is a valid **future** option once EPIC 34 lands, not a prerequisite for this EPIC.
- Avatar color persistence (EPIC 33) — confirmed untouched, separate module.
- Any UI/economy work beyond what's needed to make the two pools function and be visibly distinguishable.

## 7. Tasks

| # | Task | Place |
|---|------|-------|
| 35.1 | Thread `scope` through `EconomyStore` key-building + all profile methods | `server/src/economy/store.ts` |
| 35.2 | Migration: old single-pool keys → `deathmatch`-scoped keys on first read | `server/src/economy/store.ts` |
| 35.3 | `grantKillGold()` scope-aware reward routing | `server/src/match.ts` |
| 35.4 | ~~Gate `onKillRecorded` on scope~~ — REMOVED, handled by EPIC 37 separately, do not duplicate | n/a |
| 35.5 | Client: pool labeling on mode-select + inventory overlay | `client/src/modeSelect.ts`, `client/src/inventoryOverlay.ts` |
| 35.6 | README + `docs/product/emerald-wasteland-economy-tz-v2.1.md`: document the split plainly (what/why, anti-farm rationale) | `README.md`, `docs/product/emerald-wasteland-economy-tz-v2.1.md` |
| 35.7 | Regression: sandbox gold/items never appear in a deathmatch profile read and vice versa; migration preserves existing profile data as the deathmatch pool | `scripts/` |

**Branch:** `task/epic-35-split-economy-deathmatch-sandbox`
**Base:** `master` (tip as of this spec: `d1738e2`)

## 8. Acceptance criteria (for when implementation proceeds)

- [ ] No code path can read a sandbox-pool value and spend/apply it in a deathmatch-scoped action, or vice versa — this is the one invariant that must be airtight, needs explicit regression coverage, not just a code read
- [ ] Existing player profile data survives the migration intact as the deathmatch pool
- [ ] Sandbox-mode bot kills (and bot-victim kills) grant gold/items into the sandbox pool only
- [ ] Deathmatch-mode kills behave exactly as EPIC 32 left them, into the deathmatch pool
- [ ] Leaderboard gating is EPIC 37's responsibility, not re-implemented or conflicted with here
- [ ] UI makes the active pool unambiguous
- [ ] Docs updated per Section 6

## 9. Risks

- This is the highest-risk item in this batch of work — it touches the money/inventory system's core keying, and getting the isolation invariant wrong would either silently lose player data (bad migration) or reopen the exact farming hole EPIC 32 closed (bad scope routing). Recommend an Infosec/Critic pass with extra scrutiny on the isolation invariant specifically.

## 10. Sign-off

- **Author:** Team Lead (Tusya), 2026-08-25
- **Approval:** User confirmed via coordinator, 2026-08-25 ("Два независимых как первый вариант, только без крипты вообще").
- **Assignee:** Programmer (Pusya)
