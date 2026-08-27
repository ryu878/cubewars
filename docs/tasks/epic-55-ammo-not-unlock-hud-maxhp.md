# EPIC 55 — Ammo does not unlock weapons; HUD `current/max` HP & armor; preserve boosted maxHealth

| Field | Value |
|-------|-------|
| **EPIC ID** | 55 |
| **Name** | Ammo pickup ≠ weapon unlock; authoritative HUD current/max; maxHealth mid-life integrity |
| **Status** | Assigned |
| **Branch** | `feature/epic-55-ammo-not-unlock-hud-maxhp` |
| **Base** | `master` (after EPIC 54 merge) |
| **Specification (author)** | Team Lead (Tusya) |
| **Approval (Team Lead)** | Tusya — 2026-08-27 |
| **Assignee** | Programmer (Pusya) |

---

## 1. EPIC

### System goal

Fix two player-facing correctness issues:

1. **Ammo crates must not grant ownership** of a weapon the player has not unlocked via a **weapon** pickup.
2. **HUD health/armor** must show server-authoritative **`current/max`** (e.g. `85/245`, `22/100`), and **pet-boosted `maxHealth` must remain effective for the whole life** — including after damage and medkit healing above baseline 100.

### Business / gameplay problem

- Today, picking up **ammo** for an unowned weapon also **adds that weapon to `ownedWeapons`** and often **auto-equips** it. Players can effectively unlock rifles/GLs from ammo crates alone, defeating weapon-pickup scarcity.
- HUD shows a single HP/armor number. With cat (and gems) boosting max HP, players cannot see the boosted ceiling. Separately, players report that after damage below 100 they **cannot heal above 100** even though respawn correctly starts at the boosted max (e.g. 245) — this must be investigated and fixed for real if a server-side clamp/reset exists; HUD must not invent max from client pet ratings.

### Architectural role

- **Game server** (authoritative pickup/loadout/health) — `server/src/playerRegistry.ts` and broadcast path
- **Shared protocol** — `PlayerState`, pickup docs in `shared/`
- **Client HUD / i18n** — `client/src/combatHud.ts`, `client/src/main.ts`, HUD markup / strings
- **Player-facing docs** — About + changelog when mechanics change (`ai-office/policies/player-facing-docs.md`)

### Stack (fixed)

Three.js/TS client + Vite; Node.js/TS + `ws` server; `shared/` protocol. No new frameworks.

### Main components

| Component | Change |
|-----------|--------|
| `PlayerRegistry.applyPickup()` | Split `"weapon"` vs `"ammo"` branches |
| `PlayerState` (+ `toWorldState`) | Broadcast `maxHealth`; armor max via broadcast field and/or documented `COMBAT.maxArmor` |
| `combatHud` / `main.ts` | `setHealth(current, max)` / `setArmor(current, max)` → `current/max` |
| Regressions | Update `weapon-autoswitch` + add ammo-ownership / maxHealth heal cases |
| About / changelog | Player-facing ammo rule + HUD current/max note |

### Interaction

- Server remains sole authority for ownership, ammo, health, maxHealth, armor.
- Client renders HUD from `PlayerState` only — **do not** derive max HP from local pet ratings.

---

## 2. Stories

### Story 55.1 — Ammo stockpile without unlock

**As a** player  
**I want** ammo crates to refill or stockpile ammo for a weapon **without** unlocking that weapon  
**So that** I only gain ownership (and E-cycle / equip rights) from **weapon** pickups.

**Correct rules (authoritative):**

| Pickup | Not owned | Already owned |
|--------|-----------|---------------|
| **`ammo`** | Allow pickup if ammo &lt; `maxAmmo`; write `player.ammo[weapon]`; **do not** `ownedWeapons.add`; **do not** auto-equip | Existing EPIC 13 rule: refill ammo; auto-equip if higher tier than current **and** now has ammo (or infinite) |
| **`weapon`** | Unlock (`ownedWeapons.add`) + add `ammoPerPickup` (cap `maxAmmo`); auto-equip if higher tier + usable ammo (existing) | Refill ammo + same auto-equip rule as today |
| **Later `weapon` after ammo stockpile** | Own weapon; keep/use stockpiled ammo; add this pickup’s ammo; **cap at `maxAmmo`** | — |

**Root cause (known):** `applyPickup()` currently does `player.ownedWeapons.add(weapon)` for **both** `"weapon"` and `"ammo"` (~line 939). Split the branches.

**Also update** comments in `shared/src/pickups.ts` (`PickupSpawnPoint.weapon`) that claim weapon and ammo apply the **identical** effect — they no longer do.

### Story 55.2 — HUD `current/max` + maxHealth integrity

**As a** player with pet-boosted HP  
**I want** the HUD to show `current/max` from the server, and medkits to heal up to my real max for this life  
**So that** boosted ceilings stay obvious and usable after taking damage.

**Requirements:**

1. **Investigate** any path that resets `player.maxHealth` to `COMBAT.maxHealth` (100) mid-life, or caps heals at 100:
   - Health branch in `applyPickup` already uses `player.maxHealth` in code; verify comments and **all** heal/damage/clamp paths.
   - Check `applyPetRatings`, respawn, economy re-apply, any `Math.min(..., COMBAT.maxHealth)` on current health incorrectly used as a heal ceiling.
   - Fix any real bug found; document root cause in Programmer handoff.
2. **Broadcast** `maxHealth` on `PlayerState` (server → clients every world tick via `toWorldState()`).
3. **Armor max:** either broadcast `maxArmor` on `PlayerState`, or document that HUD uses shared `COMBAT.maxArmor` (currently 100; dog armor is flat absorbed into current armor, not a raised max). Prefer broadcasting `maxArmor` if it keeps HUD fully server-driven with one pattern; otherwise `COMBAT.maxArmor` is acceptable if unchanged by pets (EPIC 51: dog raises **current** armor baseline, not max).
4. **HUD:** `setHealth(current, max)` → display like `85/245`; armor → `22/100` (or `current/maxArmor`). Low-health styling may continue to key off **current**.
5. **Do not** invent max client-side from pet ratings / inventory overlay.
6. **i18n:** update if label copy changes (value format `N/M` may need no new keys if labels stay “HP” / “ARMOR”).
7. **About + changelog** if player-facing (ammo rule + HUD current/max and/or heal-to-boosted-max clarification).

---

## 3. Tasks

| # | Task | Place | Completion criterion |
|---|------|-------|----------------------|
| 1 | Split `applyPickup` weapon vs ammo: ammo never adds ownership / never auto-equips unless already owned (EPIC 13 refill rule only when owned) | `server/src/playerRegistry.ts` | Unit/regression proves unowned ammo stockpile; owned refill still auto-equips |
| 2 | Update `shared/src/pickups.ts` docs; fix stale `applyPickup` JSDoc (health cap comment still says `COMBAT.maxHealth`) | `shared/`, `playerRegistry` comments | Comments match behavior |
| 3 | Add `maxHealth` (and armor max as decided) to `PlayerState`; emit from `toWorldState()` | `shared/src/index.ts`, `playerRegistry.ts` | Wire field present; server-authoritative |
| 4 | Fix any mid-life maxHealth / heal-cap bug found | server | Medkit heals above 100 when `maxHealth` &gt; 100 after damage |
| 5 | HUD `setHealth`/`setArmor` current/max; wire from `main.ts` world_state | `combatHud.ts`, `main.ts`, `index.html` if needed | Display `current/max` |
| 6 | i18n / About / changelog per player-facing-docs | `about.html`, `changelog.json`, locale strings | Docs updated same PR |
| 7 | Regressions: extend `regression-weapon-autoswitch` (or new script) for ammo-no-unlock + stockpile-then-weapon; add maxHealth heal regression | `scripts/` | Scripts exit 0 |
| 8 | Playwright evidence for Tester | `scripts/`, `qa-artifacts/epic-55/` | Screenshots/logs of HUD + pickup behavior where feasible |
| 9 | Branch, PR, programmer handoff — **do not merge/deploy** | git / `docs/tasks/` | Handoff ready for Tester |

---

## 4. Acceptance criteria

- [ ] Ammo crate for **unowned** rifle: ammo increases; rifle **not** in `ownedWeapons`; **cannot** equip via E until a **weapon** pickup.
- [ ] Ammo crate for **owned** empty higher-tier weapon: still auto-equips per EPIC 13 (no regression).
- [ ] Weapon pickup after ammo stockpile: owns weapon; ammo is stockpile (+ pickup) capped at `maxAmmo`; auto-equip if higher tier + usable.
- [ ] HUD shows `current/max` for HP and armor from server fields (not client-invented pet math).
- [ ] Boosted `maxHealth` survives damage; medkits can heal **above 100** up to `player.maxHealth`.
- [ ] Regressions green; Playwright evidence under `qa-artifacts/epic-55/`.
- [ ] About + changelog updated for player-facing ammo + HUD (and heal/max note if applicable).
- [ ] Tester PASS → Critic APPROVED (or Judge ALL_CLOSED) → TL merge → deploy https://cubewars.ru/

---

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Bots / AI assume ammo unlocks weapons | Grep bot pickup logic; adjust if they skip ammo when unowned |
| Auto-equip regressions | Keep EPIC 13 owned-refill cases; add unowned negative cases |
| Protocol clients missing new fields | Additive optional fields with sensible client fallback only for **display** of max (prefer require server field once shipped) |
| Revealing maxHealth to all clients | Acceptable (same public combat readability as current health); not private economy |

---

## 6. Out of scope

- Changing pet rating formulas or armor max from dog (still `COMBAT.maxArmor`)
- Redesigning pickup spawn layout / respawn timers
- Client-predicted health

---

## 7. Definition of Done

Per `ai-office/global/global-standards.mdc`: implementation on feature branch, regressions, player-facing docs in same PR, Tester PASS, Critic APPROVED (or Judge ALL_CLOSED), Team Lead merge approve, deploy from `master`, smoke on production URL.
