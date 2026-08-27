# EPIC 57 — Hold-to-fire all weapons, crosshair cooldown ring, rarer repair kits, sandbox bot shards

| Field | Value |
|-------|-------|
| **EPIC ID** | 57 |
| **Name** | Hold-fire all weapons; cooldown ring + no fake juice; repairKit 0.002; sandbox bot amulet shards |
| **Status** | Assigned |
| **Branch** | `feature/epic-57-hold-fire-cooldown-ring-drops` |
| **Base** | `master` (after EPIC 56 merge `bd49e74`) |
| **Specification (author)** | Team Lead (Tusya) |
| **Approval (Team Lead)** | Tusya — 2026-08-27 |
| **Assignee** | Programmer (Pusya) |

---

## 1. EPIC

### System goal

1. **Hold-to-fire:** While LMB is held, every weapon keeps firing at that weapon’s `WEAPON_STATS[w].cooldownMs` (not pistol-only).
2. **Cooldown ring + honest juice:** Crosshair shows a recovering cooldown ring; do not send `fire` or play muzzle/viewmodel/gunshot when the client knows the shot cannot happen.
3. **Repair kits rarer:** `DROP_CHANCE.repairKit` **0.1 → 0.002** (~50× rarer).
4. **Sandbox bot shards:** Killing a bot that has combat `hasAmulet` can grant a **shard** (once per bot identity per match per killer), without inventing Redis amulet item copies from bots.
5. **Drop audit:** Re-document egg/gem/amulet/repair/stim/shard gates for sandbox vs deathmatch; fix shard killer-amulet gate if it wrongly blocks shards.

### Business / gameplay problem

- Only pistol auto-fires on hold; rifle/GL feel broken vs intended cadence.
- Fire juice plays even when dry / on cooldown / spawn-protected / dead — misleading.
- Repair kits drop too often (10%); should feel unique (~0.2%).
- Sandbox bots show amulets (EPIC 31) but never drop shards because victim Redis context is human-only and `VictimDropContext` is omitted for bots.

### Architectural role

- **Client** — input hold-fire, local cooldown gate, crosshair ring UI, juice gating
- **Shared** — `DROP_CHANCE.repairKit`, `shouldGrantShard` semantics
- **Server** — `grantKillGold` / `resolveKillDrops` bot shard path; once-per-victim tracking for bots
- **Docs** — About EN+RU + changelog (player-facing-docs)

### Stack (fixed)

Three.js/TS client + Vite; Node.js/TS + `ws` server; `shared/` protocol. No new frameworks. Server remains authoritative for hits, ammo, and economy grants; client gates are predictive/cosmetic only.

### Explore findings (fold-in)

| Area | Finding |
|------|---------|
| Hold fire | `FpsController` already supports hold; `main.ts` gates `shouldAutoFire` to **pistol only** and hardcodes `WEAPON_STATS.pistol.cooldownMs`. |
| Fake juice | `onFire` always plays muzzle/viewmodel/sound then sends `fire`. Gate juice+send on: not spawn-protected, has ammo (or infinite), local cooldown elapsed, alive. |
| Repair | `DROP_CHANCE.repairKit = 0.1` → `0.002`. |
| Bot shards root cause | In `match.ts` `grantKillGold`: victim amulet context (`alreadyGrantedShard` + nickname) only when `victimIsHuman`. Store requires Redis `victimDoc.amulets.length > 0`. Bots have `PlayerRecord.hasAmulet` but no Redis amulet rows → shard never grants. |
| Shard gate | Store / `shouldGrantShard` also require `killerAmulets < ECONOMY_CAPS.amulets` — odd for **shards** (that gate belongs on **amulet item copy**). Fix: shards gate on victim has amulet + once-per-victim + `killerShards < ECONOMY_CAPS.shards` only. |

---

## 2. Stories

### Story 57.1 — Hold-to-fire for all weapons

**As a** player **I want** hold-LMB to keep firing my current weapon at its cooldown **so that** rifle/GL match pistol feel.

**AC:**

- [ ] `shouldAutoFire` true for every equipped weapon (while pointer-locked / alive / not otherwise blocked by existing controller rules).
- [ ] `getAutoFireIntervalMs` returns `WEAPON_STATS[currentWeapon].cooldownMs`.
- [ ] Server cooldown still authoritative (client interval is UX only).

### Story 57.2 — Crosshair cooldown ring + no fake fire juice

**As a** player **I want** to see cooldown recovery around the crosshair and no fake muzzle/recoil/sound when I cannot fire **so that** feedback matches reality.

**Design:**

- Circle around `#crosshair`: **full / transparent stroke = ready**; incomplete arc/ring = recovering.
- Prefer client last-fire timestamp gated by current weapon `cooldownMs`.
- Sync dry-ammo with loadout (`WEAPON_STATS[w].infiniteAmmo` OR `ammo > 0`).
- Also suppress when spawn-protected, dead, or local cooldown not elapsed.
- When suppressed: **no** `connection.send({ type: "fire" })`, **no** muzzle flash, **no** viewmodel recoil, **no** local gunshot.

**AC:**

- [ ] Ring visible and fills with cooldown.
- [ ] Dry / cooldown / spawn-protect / dead → no juice, no outbound fire.
- [ ] Ready shot still sends fire + juice as today.
- [ ] Playwright evidence of ring (ready vs recovering) under `qa-artifacts/epic-57/`.

### Story 57.3 — Repair kit drop chance 0.002

**As a** player **I want** repair kits to be rare **so that** finding one feels special.

**AC:**

- [ ] `DROP_CHANCE.repairKit === 0.002` in `shared/src/economy.ts`.
- [ ] Regressions / constants that assert `0.1` updated.
- [ ] About mentions updated if repair-kit frequency is described; changelog entry.

### Story 57.4 — Sandbox bot amulet → shard

**As a** sandbox player **I want** shards from bots that wear amulets **so that** visible bot amulets match loot.

**Rules (authoritative):**

1. **Deathmatch:** unchanged — bot victims grant **no** economy reward (EPIC 32 early return).
2. **Sandbox bot victim with `player.hasAmulet === true`:** eligible for **shard** grant (100% once per bot identity key per killer per match), same once-consumed / overflow→gold substitute behavior as humans (EPIC 26).
3. **Do not** invent Redis amulet **item copies** from bots (no `grantAmulet` from bot victims). Gem copy still requires human Redis victim context.
4. Track `matchShardGrants` for bots using a stable bot key (e.g. `bot:${victimId}` or nickname string already on `PlayerRecord`) — **do not** `getOrCreateProfile` for bot nicknames.
5. **Human victim path** must still grant shards from Redis amulets; regression required.
6. **Shard eligibility gate fix:** remove `killerAmulets < ECONOMY_CAPS.amulets` from shard path (shared helper + store). Keep that gate on **amulet item** drops only. Shard path uses `victimHasAmulet && !alreadyGranted && killerShards < ECONOMY_CAPS.shards`.

**Suggested shape:**

```ts
// VictimDropContext — extend; keep human nickname for inventory copy
{
  nickname?: string;           // human only — Redis gem/amulet copy
  alreadyGrantedShard: boolean;
  victimHasAmulet: boolean;    // humans: Redis amulets.length > 0; bots: PlayerRecord.hasAmulet
}
```

Match must pass bot context when `scope === "sandbox" && !victimIsHuman && victimPlayer`.

**AC:**

- [ ] Sandbox kill of amulet-bot can grant shard (forced / regression).
- [ ] Sandbox kill of non-amulet bot does not grant shard from amulet path.
- [ ] Deathmatch bot kill still no reward.
- [ ] Human-with-amulet shard path still works; once-per-victim still works.
- [ ] Killer at amulet **cap** can still receive shards (if under shard cap).
- [ ] No bot Redis economy profile creation.

### Story 57.5 — Drop audit + player-facing docs

Document expected rates/gates in programmer handoff:

| Drop | Chance / rule | Sandbox human | Sandbox bot | Deathmatch human | Deathmatch bot |
|------|---------------|---------------|-------------|------------------|----------------|
| Gold | GOLD_DROP_MIN–MAX | yes | yes | yes | **no** |
| Egg | 0.15 + caps | yes | yes | yes | no |
| Stim | 0.08 + soft cap | yes | yes | yes | no |
| Repair kit | **0.002** + soft cap | yes | yes | yes | no |
| Gem | 0.2 + victim equipped gem copy | yes (Redis) | **no** (no Redis gems) | yes | no |
| Amulet item | 0.02 + victim has amulet copy | yes (Redis) | **no** (do not invent) | yes | no |
| Shard | 100% once/victim if victimHasAmulet + shard cap | yes (Redis) | **yes** (`hasAmulet`) | yes | no |

**AC:**

- [ ] Table in handoff matches implementation.
- [ ] About EN+RU + `changelog.json` + Last updated per `ai-office/policies/player-facing-docs.md`.

---

## 3. Tasks

| # | Task | Place | Done when |
|---|------|-------|-----------|
| 57.1.1 | Extend hold-fire to all weapons; interval from current weapon cooldown | `client/src/main.ts`, `fpsController.ts` if needed | AC Story 57.1 |
| 57.2.1 | Local fire-ready predicate (cooldown, ammo, spawn protect, alive) | `client/src/main.ts` | No fake juice / no send when not ready |
| 57.2.2 | Crosshair cooldown ring UI | `client/index.html`, `combatHud.ts` (or small helper) | Visible fill; ready = full/transparent |
| 57.3.1 | `DROP_CHANCE.repairKit = 0.002` + regressions | `shared/src/economy.ts`, scripts | Constant + tests |
| 57.4.1 | Extend `VictimDropContext` + store shard path for combat `victimHasAmulet` without Redis copy | `server/src/economy/store.ts`, shared helper | Bot shards without inventing amulets |
| 57.4.2 | Pass bot `hasAmulet` + once-per-bot shard tracking in `grantKillGold` | `server/src/match.ts` | Sandbox bot shards; no bot profiles |
| 57.4.3 | Fix `shouldGrantShard` / store: drop killer-amulet-count gate for shards | `shared/src/economy.ts`, store | Cap killers still get shards |
| 57.5.1 | Regressions: bot shard sandbox; DM bot no reward; human shard; repairKit 0.002; hold-fire/cooldown if practical | `scripts/` | PASS |
| 57.5.2 | About + changelog; handoff table; Playwright evidence | About, changelog, `qa-artifacts/epic-57/` | Docs + screenshots |
| 57.5.3 | Typecheck/build; open PR; handoff | branch | PR ready for Tester |

---

## 4. Risks

| Risk | Mitigation |
|------|------------|
| Client cooldown desync vs server | Server still rejects early fire; client only suppresses juice/spam |
| Bot nickname collision in shard map | Prefer `bot:${victimId}` keys; never Redis profile for bots |
| Accidental amulet copy from bots | Explicit: shard-only for bot victims; no `grantAmulet` without Redis source |
| repairKit regressions asserting 0.1 | Grep and update |

---

## 5. Out of scope

- Changing other `DROP_CHANCE` values (egg/gem/amulet/stim).
- Granting gem/amulet **item copies** from bots.
- New UI frameworks; network protocol changes beyond existing `fire` / economy messages.
- Reworking deathmatch bot-no-reward policy.

---

## 6. Delivery

- Branch from `master`; one PR; do **not** merge/deploy (Team Lead).
- Ignore unrelated dirty parent files (favicons, `docs/ops/mail.md`, other worktrees).
- Environment: `export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`.
- Full chain: Programmer → Tester → Critic → (Judge if needed) → TL merge → `./scripts/deploy-production.sh` → https://cubewars.ru/
