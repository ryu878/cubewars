# EPIC 31: Randomized Bot Equipment Loadouts

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).
User ask: bots in "vs Bots" (and endless) matches should spawn with randomized pet/amulet loadouts — some with no pet, some with one pet, some with an amulet (enabling pet slot 2 at 40% contribution, per EPIC 25 rules), some with an amulet + 2 pets — and this should affect bot combat stats the same way it affects a human's (max HP / %DR / move speed / weapon damage, EPIC 24-25's rating system), plus a visual tell on the bot's avatar.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Randomized Bot Equipment Loadouts |
| **System goal** | Give each bot (in "bots" and "endless" match modes) a randomized, in-memory pet/amulet loadout at spawn, apply the exact same combat-modifier math humans get from equipped pets/amulets (EPIC 24-25), and show a lightweight visual tell on the bot's avatar so a player can see "this bot has a pet/amulet" the way EPIC 17 avatars already show held weapons. |
| **Business/gameplay problem** | Bots today are pure movement/aim AI with **zero economy integration** (confirmed: `server/src/botAI.ts` has no nickname-keyed profile, no `petRatings` beyond the registry default `emptyRatings()` every player starts with) — every bot fight is against a mechanically-identical, unequipped opponent regardless of what gear a human player has. This makes bot difficulty flat and misses a chance to preview the pet/amulet system in PvE. |
| **Architectural role** | server (bot spawn logic, combat-modifier application) + shared (reuse existing pure rating-aggregation function) + client (avatar visual tell) + protocol (`PlayerState` broadcast extension) |
| **Main components** | `server/src/botAI.ts`, `server/src/playerRegistry.ts`, `server/src/match.ts`, `shared/src/index.ts` (`PlayerState`), `shared/src/economy.ts` (reuse only, no rule changes), `client/src/remotePlayers.ts` |
| **Stack** | Fixed project stack. No Redis/persistence needed for bots — an **in-memory** loadout assigned once at bot spawn is sufficient (bots are ephemeral, scoped to one private match); do not build a persistent bot economy profile, that's out of scope and unnecessary. |
| **Interaction with other components** | Reuses `aggregateEquippedRatings()` (pure function, already exported from `shared/src/economy.ts`, currently only called from `server/src/economy/store.ts`'s `computeRatings()` for human profiles) and `PlayerRegistry.applyPetRatings(playerId, ratings)` (already the exact same entry point `applyEconomyCombatToPlayer()` uses for humans) — **no new combat-modifier math**, bots go through the identical code path humans do once a `ProfileRatings` value exists for them. Does **not** touch human pet/amulet/gem/economy logic, Redis persistence, drop tables, or death-penalty decay (`applyHumanDeathEconomyPenalties` already explicitly skips bots — that stays unchanged; a bot's loadout is fixed for its lifetime, not decayed). |

## 2. Current state (confirmed by reading code — verify still accurate before implementing)

- `server/src/botAI.ts`: `BotAI.spawnBots()`/`spawnBotAt()` create a `PlayerRecord` via `PlayerRegistry.spawn()`/`spawnAt()`. That record starts with `petRatings: emptyRatings()` (see `playerRegistry.ts` `spawn()`) and nothing ever calls `applyPetRatings()` for a bot — bots are permanently at baseline stats today.
- `PlayerRegistry.applyPetRatings(playerId, ratings: ProfileRatings)` (`server/src/playerRegistry.ts` ~line 425) is loadout-source-agnostic — it takes a plain `ProfileRatings` object and a `playerId` string, with no dependency on Redis/nickname/economy profile. This is the exact hook to reuse for bots.
- `aggregateEquippedRatings(pets: EquippedPetInput[], slot2Enabled: boolean): ProfileRatings` (`shared/src/economy.ts` ~line 145) is a **pure function** — given an array of `{ type, baseValue, equipSlot, gems? }` and a slot2-enabled flag, it returns the aggregated `ProfileRatings`. No Redis/DB access. Directly reusable for a synthetic bot loadout.
- Rating constants already fixed in `shared/src/economy.ts` `PET_COMBAT`: `SLOT1_FRACTION = 1`, `SLOT2_FRACTION = 0.4` (matches the user's "40% contribution" ask exactly — this is not a new number, it's the existing amulet-gated slot-2 rule from EPIC 25), plus `HEALTH_HP_PER_POINT`, `ARMOR_DR_PER_POINT` (capped `ARMOR_DR_CAP = 0.35`), `SPEED_PER_POINT`, `DAMAGE_PER_POINT`.
- Pet base values for a freshly-hatched human pet are randomized `1 + floor(random() * 200)` (`randomBaseValue()`, `server/src/economy/store.ts` ~line 235, currently module-private) — reuse the same 1-200 band for bot pets so a geared bot is comparable in power to a geared human, not a separate balance curve.
- `PlayerState` (`shared/src/index.ts` ~line 321) already has precedent for broadcasting a *cosmetic* equipment reveal to every client: `equippedWeapon` was added in EPIC 17 specifically so remote avatars can show the right held weapon, documented as "an intentional cosmetic information reveal, not a client-controlled gameplay input." The same precedent applies to a pet/amulet visual tell.
- `client/src/remotePlayers.ts` already renders per-player avatars (including bots — bots are regular `PlayerState` entries in `WorldStateMessage`, the client doesn't distinguish bot vs. human when rendering) and already swaps a held-weapon prop per player based on `PlayerState.equippedWeapon` (`applyWeapon()`) — the pattern to extend for a pet/amulet tell.

## 3. Design (Team Lead decisions — you may refine exact numbers/visuals, document deviations in your handoff)

### 3.1 Bot loadout archetypes (assigned once, randomly, at bot spawn — fixed for that bot's lifetime, including across its own respawns within the match)

Uniform-random pick among 4 archetypes per bot spawn:

| Archetype | Pets | Amulet | Notes |
|---|---|---|---|
| A — Bare | none | no | Baseline bot, unchanged from today's behavior |
| B — One pet | 1 pet, slot 1 (100%) | no | |
| C — Amulet + one pet in slot 2 | 1 pet, slot 2 (40%) | yes | Demonstrates the amulet-gates-slot-2 rule on its own |
| D — Amulet + two pets | 2 pets, slot 1 (100%) + slot 2 (40%) | yes | Full loadout |

- Each pet slot: random `PetType` (`dog`/`cat`/`bird`/`lion`, uniform) + random `baseValue` in `[1, 200]` (same band as human pet hatches — reuse or mirror `randomBaseValue()`; your call whether to export it from `economy/store.ts` or duplicate the one-liner in `botAI.ts` to avoid a new cross-module coupling — state the choice in the handoff).
- No gems on bot pets (gems require socketing action; out of scope — bots' rating comes purely from `baseValue * slot fraction`).
- Compute `ProfileRatings` via `aggregateEquippedRatings(pets, slot2Enabled)` (shared, unchanged) and apply via `registry.applyPetRatings(botId, ratings)` right after `registry.spawn()`/`spawnAt()` in `BotAI.spawnBots()`/`spawnBotAt()`.
- Applies in **both** `bots` and `endless` match modes (both use `BotAI` the same way) — do not special-case one mode.

### 3.2 Combat effect (reuse only, no new math)

- Max HP, %DR (before armor pickup), move speed, weapon damage multiplier — identical formulas already applied to humans (`maxHealthBonusFromRatings`, DR/speed/damage-rating math already wired into `playerRegistry.ts`'s `fire()`/movement/step paths via `player.petRatings`). A geared bot (archetype D) should be noticeably tougher/faster/harder-hitting than a bare bot (archetype A) — this is the entire point, not a side effect to suppress.
- Bots do **not** get `applyHumanDeathEconomyPenalties` (already bot-excluded) — a bot's loadout/ratings do not decay on death, matching "no persistent economy for bots" from Section 1.

### 3.3 Protocol: cosmetic visual-tell broadcast

- Extend `PlayerState` (`shared/src/index.ts`) with a minimal, read-only, cosmetic-only addition, e.g.:
  ```ts
  /** Primary species of each equipped pet, slot order [slot1, slot2] (0-2 entries) — cosmetic-only reveal, same precedent as equippedWeapon (EPIC 17). */
  equippedPetTypes: PetType[];
  /** Whether an amulet is currently equipped (enables slot 2). */
  hasAmulet: boolean;
  ```
- Server populates this for **every** `PlayerState` (human and bot alike) from whatever loadout source applies — humans: derive from the already-fetched economy profile in `applyEconomyCombatToPlayer`/`getFullProfile` (equipped pets + `slot2Enabled`); bots: from the in-memory loadout assigned in 3.1. Store on `PlayerRecord` (server-only) so `match.ts`'s per-tick `WorldStateMessage` build can read it cheaply, the same way `equippedWeapon` already is.
- This is a **read-only, server-computed reveal** — the client never sends or infers this, matching security-baseline (`ai-office/global/security-baseline.mdc`): server is authoritative, client renders.

### 3.4 Client visual tell (`client/src/remotePlayers.ts`)

- Small, cheap, low-poly addition consistent with the existing avatar-building style (primitives, flat colors) — your call on exact shape, but at minimum:
  - If `equippedPetTypes.length > 0`: a small colored orb/icon near the avatar's shoulder/backpack per equipped pet, color-coded by pet type (reuse a sensible existing color mapping or define one per `PetType` — document the choice).
  - If `hasAmulet`: a distinct small accent (e.g. a glowing ring/pendant near the neck/chest) — visually distinct from the pet orb(s) so a player can tell "has amulet" vs. "has pet" at a glance.
- Applies uniformly to any `PlayerState` with this data — humans with real equipped pets get the same visual tell "for free" as a side effect of reusing one broadcast path (not a separate human-only vs. bot-only code path). Not required to be pixel-perfect, just readable at typical engagement range.

## 4. Out of scope

- Persistent/Redis-backed bot economy profiles.
- Gems on bot pets, bot amulet durability/repair, bot inventory UI.
- Any change to human pet/amulet/gem/drop rules, kill-gold, or item-drop tables (tracked separately as a pending product decision with the user — NOT part of this EPIC regardless of that decision's outcome; do not touch `grantKillGold()`'s `victimIsHuman` gate in `server/src/match.ts`).
- Any change to bot AI targeting/movement/aim behavior itself (`BotAI.updateOne()`'s state machine is untouched — this EPIC only changes what stats a bot *has*, not how it decides to move/aim/fire).

## 5. Stories

### Story 31.1 — Bot loadout generation
As a match server I want each bot to receive a randomized, in-memory pet/amulet loadout at spawn so bot difficulty/variety matches what a human player experiences from the pet system.

### Story 31.2 — Bot combat-modifier application
As a match server I want a bot's loadout to apply the exact same combat-modifier math as a human's so bot stats are consistent with the rest of the economy system, not a parallel implementation.

### Story 31.3 — Visual tell protocol + rendering
As a player I want to see which bots (and players) have a pet/amulet equipped so I have information about who I'm fighting, consistent with how weapon identity is already visible on every avatar.

## 6. Tasks

| # | Task | Place |
|---|------|-------|
| 31.1 | Bot loadout archetype generator (4 archetypes, random pet type/baseValue in [1,200]) | `server/src/botAI.ts` |
| 31.2 | Apply loadout via `aggregateEquippedRatings()` + `registry.applyPetRatings()` at bot spawn (both `spawnBots()` and `spawnBotAt()`) | `server/src/botAI.ts` |
| 31.3 | `PlayerState.equippedPetTypes` / `hasAmulet` protocol fields | `shared/src/index.ts` |
| 31.4 | Populate these fields for humans (from existing profile fetch) and bots (from in-memory loadout) into `PlayerRecord`, broadcast in `WorldStateMessage` | `server/src/playerRegistry.ts`, `server/src/match.ts` |
| 31.5 | Avatar visual tell (pet-type orb(s) + amulet accent) | `client/src/remotePlayers.ts` |
| 31.6 | Live verification: spawn a "vs Bots" match repeatedly until each archetype is observed at least once; confirm HP/speed/damage differences are real (server logs and/or a scripted regression), confirm avatar visual tell renders — screenshot evidence | `scripts/`, `qa-artifacts/epic-31/` |

**Branch:** `task/epic-31-bot-equipment-loadouts`
**Base:** `master` (tip at task start: `b31239d`)

## 7. Acceptance criteria

- [ ] `npm run typecheck` / `build` PASS across `shared`/`server`/`client` workspaces
- [ ] Bots in a "vs Bots" match spawn with a randomized loadout matching one of the 4 documented archetypes; verified live across multiple bot spawns (not just code read) — server-side log line per bot spawn showing its assigned loadout is sufficient evidence, e.g. `[bots] Bot 1 loadout: archetype=D pets=[dog#134,lion#77] amulet=true`
- [ ] A geared bot (archetype C/D) is measurably tougher/faster/stronger than a bare bot (archetype A) — demonstrate via server logs (maxHealth / damage multiplier / DR values differ) or a short scripted check; no manual claim without evidence
- [ ] Endless mode bots also receive loadouts (not bots-mode-only)
- [ ] Client avatar shows a visual tell for an equipped pet and, separately, for an equipped amulet — screenshot evidence from a live client session
- [ ] No change to human pet/amulet/economy/drop-table behavior (regression: existing economy regression scripts still PASS)
- [ ] No change to bot AI targeting/movement decisions themselves
- [ ] Server remains authoritative: client never sends or infers loadout data, only renders what the server broadcasts

## 8. Risks

- Balance: a fully-geared bot (archetype D) could feel unfairly strong in "vs Bots" (2 bots per match) — acceptable per user's explicit ask, but flag in the handoff if playtesting suggests archetype D bots are excessively lethal; Team Lead can tune the archetype distribution in a follow-up, not a blocker for this EPIC.
- Protocol size: two new fields per `PlayerState`, broadcast every tick to every client — negligible payload growth (a short array + a boolean), consistent with `equippedWeapon`'s existing precedent.
- Must not accidentally wire bots into the Redis economy store (no `economy.getOrCreateProfile()`-style calls for bot ids) — bots have no nickname-keyed profile and must not create phantom Redis entries.

## 9. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-24
- **Assignee:** Programmer (Pusya)
