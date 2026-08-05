# EPIC 13: Weapon Auto-Switch on Empty Ammo & HUD Stat Sizing

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Weapon Auto-Switch on Empty Ammo & HUD Stat Sizing |
| **System goal** | Two independent player-facing asks, delivered together as one EPIC/branch: (A) the server automatically re-equips the best usable weapon a player owns whenever their current weapon runs dry, and automatically re-equips a just-picked-up (or just-refilled) weapon if it's strictly better than what's currently equipped — generalizing the existing "auto-equip on first unlock" rule to also cover ammo refills of an already-owned weapon; (B) the health, armor, and ammo-count numbers in the HUD become significantly larger (user asked for 5x) and are repositioned closer to the horizontal center of the screen. |
| **Business/gameplay problem** | Direct user feedback (Russian, verbatim): (A) "сделай чтоб если кончились патроны то переключался на следующее оружие по урону, ну т.е. если был гранатомет, но кончились патроны надо чтобы ружье появилось, если оно есть и есть для него патроны конечно и итп" + "и чтобы если вхял оружие круче оно тоже автоматом выбиралось" — "make it so that when ammo runs out, it switches to the next weapon by damage ... and if you pick up a cooler weapon it should also get auto-selected." (B) "сделай кол-во патронов и здоровье и броню больше шрифт в 5 раз, и ближе к центру" — "make the ammo count, health, and armor font 5x bigger, and closer to center." |
| **Architectural role** | server (authoritative weapon/loadout logic — `PlayerRegistry.fire()`/`applyPickup()`, `Match.resolveFire()`/pickup tick loop for logging) + client (HUD-only DOM/CSS restructure, no new client-trusted state — `client/index.html`, `client/src/combatHud.ts`) |
| **Main components** | `server/`, `client/`, `scripts/`, `docs/` |
| **Stack** | Fixed project stack, no deviation. Story A is pure server-authoritative game-state logic (no physics, no new message types — the client already only ever renders the server's own `LoadoutMessage`, confirmed below, so no new client-trusted field is introduced). Story B is CSS/DOM-only HUD work, no UI framework, matching the "plain HTML/CSS + TypeScript" HUD rule. |
| **Interaction with other components** | Story A touches `server/src/playerRegistry.ts` (`fire()`, `applyPickup()`, and the `FireOutcome`/`ApplyPickupResult` return types) and `server/src/match.ts` (`resolveFire()` and the per-tick pickup loop, both of which already call `sendLoadout()` after every ammo-changing event — confirmed by reading the current code, no new `sendLoadout()` call site is needed, only new log lines for observability). It does **not** touch `server/src/combat.ts` (pure hitscan geometry, has no notion of weapon type at all) and does **not** touch any client file — confirmed by reading `client/src/main.ts`'s `onLoadout` handler: the client is a pure renderer of the server's `LoadoutMessage.equippedWeapon`/`ammo`, it never predicts or locally decides the equipped weapon. Story B touches `client/index.html` (HUD markup/CSS) and `client/src/combatHud.ts` (`setHealth()`/`setArmor()`/`setWeapon()`, which currently write single combined `textContent` strings and must be split to drive independently-sized label/value spans) — purely cosmetic, the underlying data (`PlayerState.health`/`armor`, `LoadoutMessage.ammo`) is unchanged. |

---

## 2. Design decision: weapon auto-switch algorithm (fixed by Team Lead)

**Current behavior (confirmed by reading `server/src/playerRegistry.ts`):**

- `applyPickup()` (lines ~474-509): auto-equips a picked-up weapon **only** on a first-time unlock (`!alreadyOwned`) whose `tier` is higher than the currently-equipped weapon's `tier`. Re-picking up ammo for an already-owned weapon never re-equips it, even if it's the player's best weapon and they're currently on something worse.
- `fire()` (lines ~386-398): for a finite-ammo weapon at `currentAmmo <= 0`, returns `{ hit: false, dry: true }` and blocks the shot. **Nothing auto-switches** — the player stays stuck on the dry weapon until they manually press `E`. Confirmed: this is the entire dry-weapon code path, there is no fallback logic anywhere else.
- `WEAPON_ORDER = ["pistol", "rifle", "grenade_launcher"]` (`shared/src/weapons.ts`) is already ascending by both `tier` (0/1/2) and `damage` (5/20/70) — they coincide today, so "next weapon by damage" (the user's wording) and "next weapon by tier" (the existing `E`-cycle / auto-equip convention) are the same ordering. The spec below uses `tier`, matching the codebase's existing convention (`WEAPON_STATS[...].tier`'s own doc comment: "used for auto-equip... and the `E` cycle order").
- The pistol (tier 0) is **always owned** (`ownedWeapons` starts as `Set(["pistol"])` in `applyBaselineLoadout()` and is never removed from — weapons are only ever added, the whole set resets on respawn, nothing ever deletes a single entry) and has `infiniteAmmo: true`, so it is a guaranteed, never-empty floor for any auto-switch search.

**New rule 1 — auto-switch DOWN on empty (`fire()`):** when a fire attempt causes a finite-ammo weapon's ammo to reach 0 (either the shot that empties it, or a subsequent attempt against an already-empty weapon), the server auto-equips the best owned weapon that currently has ammo (or is infinite), searching `WEAPON_ORDER` **descending** by tier from just below the now-empty weapon's tier down to the pistol. Implementation shape (exact code is Programmer's, this is the required behavior):

```ts
/**
 * Auto-switch away from a weapon that has just run dry, to the best owned
 * weapon that currently has ammo (or is infinite) — EPIC 13 Story 13.1.
 * Searches WEAPON_ORDER descending in tier from directly below the current
 * weapon's tier down to the pistol (tier 0, infinite ammo, always owned —
 * the guaranteed floor, see Section 2). No-op if a better-than-pistol
 * candidate is found; otherwise lands on the pistol.
 */
private autoSwitchDown(player: PlayerRecord): void { ... }
```

Called from `fire()` at both points where a dry state is reached: (a) immediately after a decrement brings ammo to exactly 0 (this shot itself still fires and deals damage — the weapon/damage stats are already captured in local `const`s before the switch, so changing `player.equippedWeapon` afterward cannot retroactively change this shot's own outcome), and (b) defensively, at the existing `currentAmmo <= 0` dry-return branch (should be effectively unreachable in normal play once (a) is implemented — since a weapon can only become equipped-and-empty via a firing sequence (a) already redirects away from, or an edge case — but kept as a defensive no-op-safe call, not a special case to special-case around).

**New rule 2 — auto-equip on pickup, generalized (`applyPickup()`):** the existing `!alreadyOwned` gate is dropped. New rule: after **any** pickup that changes a weapon's ammo (first-time unlock **or** ammo refill of an already-owned weapon), if that weapon's tier is higher than the currently-equipped weapon's tier **and** the weapon now has ammo > 0 (or is infinite, defensive — pickups are never issued for the pistol, `applyPickup()` already guards `!weapon || weapon === "pistol"`), auto-equip it:

```ts
player.ownedWeapons.add(weapon);
const newAmmo = Math.min(stats.maxAmmo, currentAmmo + stats.ammoPerPickup);
player.ammo[weapon] = newAmmo;
if (stats.tier > WEAPON_STATS[player.equippedWeapon].tier && (stats.infiniteAmmo || newAmmo > 0)) {
  player.equippedWeapon = weapon;
}
return { applied: true };
```

This is a strict generalization of the old rule (first-time-unlock-of-a-higher-tier is still covered — `newAmmo` is always `> 0` on a first pickup since `ammoPerPickup > 0` for every non-pistol weapon), and it specifically closes the gap the new Rule 1 would otherwise create: a player who ran dry on the rifle and got auto-switched to the pistol (Rule 1), then picks up rifle ammo, now automatically gets the rifle back — matching the user's explicit follow-up example — instead of staying stuck on the pistol until they manually press `E`.

**Interaction / anti-thrash reasoning (must hold, verify in Story 13.3's regression script):**

- Rule 1 only fires from an actual fire-attempt event (a deliberate player action, rate-limited by the weapon's own cooldown), never from a passive tick — no per-tick oscillation risk.
- Rule 2 only fires from an actual pickup-consumption event (walking within `PICKUP_RADIUS` of an *active* pickup, which is immediately consumed and only respawns after a multi-second delay) — not a continuous per-tick re-trigger, so a player standing still next to a pickup cannot get re-switched every tick.
- The two rules can legitimately alternate across *separate* player actions (dry rifle -> auto-switch to pistol -> walk over rifle ammo -> auto-switch back to rifle) — this is the **intended** behavior per the user's own example, not a bug, and is not an infinite loop since each step requires a distinct player action (a fire attempt or a pickup walk-over) to occur.
- Manual `E` cycling (`cycleWeapon()`) is completely unmodified by this EPIC and must keep working normally interleaved with the two automatic rules above (e.g., after an auto-switch-down to pistol, pressing `E` still cycles forward through owned weapons in tier order starting from whatever is currently equipped, same as always).

**Observability:** `fire()`'s return type (`FireOutcome`) and `applyPickup()`'s return type (`ApplyPickupResult`) must surface whether an auto-switch happened (e.g. an optional `autoSwitchedTo?: WeaponType` field on each), so `Match.resolveFire()` and the per-tick pickup loop in `Match.tick()` (`server/src/match.ts`) — which already call `sendLoadout()` unconditionally after every ammo-changing event, confirmed by reading the current code, so no new `sendLoadout()` call site is needed — can add one `console.log` line each for a material game-state transition (per `global-standards.mdc`'s logging rule), matching the existing style of the adjacent `switch: ${playerId} -> ...` log line in `server/src/index.ts`.

---

## 3. Design decision: HUD stat sizing & positioning (fixed by Team Lead)

**Current state (confirmed by reading `client/index.html` and `client/src/combatHud.ts`):**

- `#healthHud` / `#armorHud`: `bottom:18px`, `left:24px`/`right:24px`, `font-size:30px`, `font-weight:800`. Each is a single text node — `"Health: 100"` / `"Armor: 100"` (label + number in one string, one font-size, no independent span for the number).
- `#weaponHud`: `bottom:18px; left:50%; transform:translateX(-50%); font-size:15px; font-weight:600`. Also a single text node — `` `${displayName} — ${ammoText}` `` (e.g. `"Rifle — 48"` or `"Pistol — ∞"` or `"Rifle — EMPTY"`). **There is no separate DOM element for the ammo number today** — it cannot be resized independently of the weapon name without a markup change.
- Health/armor max value is 100 (`COMBAT.maxHealth`/`maxArmor`, both 100) — worst case a 3-digit number. Ammo max value is 48 (rifle, 2 digits) / 6 (grenade launcher, 1 digit) / `∞` — worst case a 2-character token.

**Required change — split label from value, size only the value:** the user's ask is specifically about the **numbers** ("количество патронов и здоровье и броню" — the ammo count, health, and armor, i.e. the numeric readouts), not the surrounding label text. Restructure each of the three HUD elements into a small label + a large value, consistently:

- `#healthHud`: label span (e.g. `"HP"`, kept close to a normal small readable size, ~14-16px) + a new value span (id e.g. `#healthValue`) sized at the literal 5x target: `30px * 5 = 150px`, expressed as that lineage in a code comment (matching this project's established style for tuned constants, e.g. EPIC 11/12's `jumpSpeed`/`maxSpeed` comments).
- `#armorHud`: identical structure/sizing (`#armorValue`).
- `#weaponHud`: split into a weapon-name portion (stays close to its current ~15px size — the user did not ask to enlarge the label, only the numbers) and a new `#ammoValue` span for just the ammo number/token, sized up substantially. **This one is a genuine judgment call, not a fixed number:** health/armor's own badges are single 1-3-digit numbers with no competing content, but `#weaponHud` is horizontally centered and flanked immediately by the (now much wider) health/armor badges — a literal 5x-of-15px (75px) or anything comparable to health/armor's 150px risks the combined weapon-name + ammo-value badge overlapping its neighbors or the badge running off-screen at the standard 1280x800 QA viewport (`{ width: 1280, height: 800 }`, matching this project's existing Playwright scripts, e.g. `scripts/qa-epic09-tester-playwright.mjs`). **Programmer picks the largest ammo-value font-size that stays clean at that viewport** (no overlap with `#healthHud`/`#armorHud`, no clipping off either screen edge, ammo digits still clearly larger/bolder than the weapon-name text next to them) — this must be an **evidenced, documented judgment call**: a code comment stating the chosen px value, the literal-5x figure it was measured against, and a one-line reason if dialed back; plus a Playwright screenshot at 1280x800 in Tester's evidence and a sentence of reasoning in Critic's review, not a silent, unexplained downgrade.
- Same authorization extends to health/armor's own 150px target if — contrary to expectation, since they don't have `#weaponHud`'s neighbor-crowding problem — the literal number turns out to visibly clip or overlap at 1280x800; the same evidence-and-documentation bar applies either way.

**"Closer to center":** `#healthHud`/`#armorHud` currently anchor at the screen edges (`left:24px`/`right:24px`). Reposition them inward, nearer the (already horizontally-centered) `#weaponHud` they flank — Programmer's exact values, but the three elements must remain clearly visually separated (a visible gap, not touching/overlapping) at 1280x800 once all three are enlarged per above. A reasonable starting point to tune from: swap the fixed edge offset for a percentage-based or larger fixed inward offset (e.g. `left: ~18-22%` / `right: ~18-22%` of viewport width) — verify visually, don't assume the first number chosen is correct without a screenshot.

**Implementation note:** `client/src/combatHud.ts`'s `setHealth()`/`setArmor()`/`setWeapon()` currently write one combined string via `.textContent` to the whole element — these must be updated to write into the new child value spans (label spans are static markup, set once in `index.html`, never touched by TS). `setWeapon()`'s existing `this.weaponEl.style.color = colorCss` (the weapon-identity color-coding) must keep applying to the whole badge including the new ammo span (verify child spans inherit color rather than needing their own explicit color rule that could silently break the existing "color-coded per weapon" identity) — confirm this in Tester evidence, not just by inspection.

---

## 4. Story 13.1 — Auto-switch down on empty ammo (server)

**As a** player **I want** the game to automatically switch me to my next-best usable weapon the moment my current one runs dry **so that** I'm never stuck holding an empty weapon in a fight, without having to notice "EMPTY" and manually press `E`.

- **Fix:** implement `autoSwitchDown()` per Section 2 in `server/src/playerRegistry.ts`, called from `fire()` at the point ammo reaches/is-already 0 for a finite-ammo weapon.
- **Constraints:** server-authoritative — no new client-trusted field, no change to `FireEvent`'s shape (still a bare fire intent, per the existing anti-spoofing discipline documented in `fire()`'s own doc comment). Must not change this shot's own damage/hit outcome (the switch happens strictly after the weapon/damage stats for *this* shot are already resolved).
- **Acceptance criteria:**
  - [ ] Firing a shot that brings a finite-ammo weapon's ammo to exactly 0 both (a) resolves normally (damage/hit/miss exactly as today) and (b) leaves the player auto-equipped on the best owned weapon that has ammo or is infinite, immediately after that shot.
  - [ ] A player owning pistol + rifle + grenade launcher, currently on an empty grenade launcher with rifle ammo available, auto-switches to the rifle (not straight to the pistol) — confirms the "next weapon by damage/tier, not just the guaranteed floor" requirement from the user's own example.
  - [ ] A player with only the pistol left usable (every owned higher-tier weapon empty) always lands on the pistol — never stuck on an empty weapon, never an undefined/invalid equipped state.
  - [ ] `FireOutcome` surfaces whether an auto-switch happened (and to what weapon) so `Match.resolveFire()` can log it; `sendLoadout()` (already called unconditionally after every `fire()`, confirmed in current code) reflects the new equipped weapon to the client on the very next message.
  - [ ] Manual `E` cycling (`cycleWeapon()`) is unmodified and still works normally, including immediately after an auto-switch-down.
  - [ ] `server/src/combat.ts` (hitscan resolution) is untouched — confirmed, it has no notion of weapon type.

---

## 5. Story 13.2 — Auto-equip on pickup, generalized (server)

**As a** player **I want** picking up ammo for my best owned weapon to automatically re-equip it, not just the very first time I unlock it **so that** running dry, getting auto-switched down, and then finding ammo again for my best weapon gets me back to full strength without a manual `E` press.

- **Fix:** generalize `applyPickup()`'s weapon/ammo branch per Section 2 — drop the `!alreadyOwned` gate, keep the "strictly higher tier than currently equipped" and "has ammo (or infinite) after this pickup" conditions.
- **Constraints:** the existing "consume only if useful" pickup-consumption rule (a pickup at max ammo for an already-owned weapon is left unconsumed, `applied: false`) is unchanged — this story only changes the auto-equip *decision* made once a pickup **is** applied, not whether it's applied at all.
- **Acceptance criteria:**
  - [ ] First-time unlock of a strictly-higher-tier weapon still auto-equips it (no regression to the pre-EPIC-13 behavior — this is a strict generalization, not a replacement).
  - [ ] Picking up ammo for an already-owned, strictly-higher-tier weapon that the player is *not* currently equipped on (e.g. just auto-switched down to pistol per Story 13.1) auto-equips it — the specific gap this EPIC closes, matching the user's explicit example.
  - [ ] Picking up ammo for an already-owned weapon that is *lower or equal* tier than what's currently equipped does **not** auto-equip it (no downgrade-on-pickup regression).
  - [ ] `ApplyPickupResult` surfaces whether an auto-switch happened so the per-tick pickup loop (`server/src/match.ts` `tick()`) can log it; `sendLoadout()` (already called unconditionally after every applied pickup, confirmed in current code) reflects the change on the next message.
  - [ ] No change to the health/armor pickup branches of `applyPickup()` — this story only touches the weapon/ammo branch.

---

## 6. Story 13.3 — Regression evidence script (weapon auto-switch)

**As a** developer **I want** a committed, re-runnable script that exercises both auto-switch rules and their interaction against the real shared weapon table **so that** this mechanic has the same kind of deterministic, numeric evidence this project's other gameplay-logic EPICs already established (EPIC 8/11/12's regression scripts), not just a one-off manual playtest.

- New script `scripts/regression-weapon-autoswitch.ts` (style/rigor matching `scripts/regression-crate-mount.ts`/`scripts/regression-bot-aim-miss-rate.ts` — import the real `PlayerRegistry`/`WEAPON_STATS`/`WEAPON_ORDER`, drive real `fire()`/`applyPickup()`/`cycleWeapon()` calls, report actual observed states, non-zero exit code on any failure). Add an `npm run regression:weapon-autoswitch` script entry in `package.json`, matching the existing `regression:collision-overshoot` / `regression:bot-aim-miss-rate` / `regression:crate-mount` naming convention.
- **Minimum coverage:**
  1. Auto-switch-down picks the next-best *owned, non-empty* weapon by tier, not straight to the pistol, when a mid-tier fallback exists (grenade launcher runs dry, rifle has ammo -> lands on rifle).
  2. Auto-switch-down falls back to the pistol when no higher-than-pistol weapon has ammo left.
  3. Auto-equip-on-pickup re-equips an already-owned higher-tier weapon on an ammo-refill pickup (not just a first-time unlock) when it's strictly better than what's currently equipped.
  4. Auto-equip-on-pickup does **not** re-equip a lower-or-equal-tier weapon's ammo pickup.
  5. The documented interaction sequence from Section 2 (dry rifle -> auto-switch to pistol -> pick up rifle ammo -> auto-switch back to rifle) resolves deterministically with no oscillation within a single call.
  6. Manual `cycleWeapon()` still behaves correctly when called immediately after an auto-switch (no fight between the two mechanisms — cycling from whatever the auto-switch just landed on works exactly like a normal cycle from that weapon).
- **Acceptance criteria:**
  - [ ] Script runs via `npx tsx scripts/regression-weapon-autoswitch.ts` (and the new `npm run` alias), reports real observed states (equipped weapon before/after each step) for each case, not just pass/fail assertions with no detail shown.
  - [ ] Exits non-zero if any of the six coverage cases fails.
  - [ ] Uses the real `WEAPON_STATS`/`WEAPON_ORDER` from `shared/src/weapons.ts`, not hardcoded/duplicated numbers.

---

## 7. Story 13.4 — HUD stat sizing & repositioning (client)

**As a** player **I want** my health, armor, and ammo count shown as much larger numbers, positioned closer to the center of the screen **so that** my vital combat stats are easier to read at a glance (user's explicit ask, "5x bigger, closer to center").

- Restructure `#healthHud`/`#armorHud`/`#weaponHud` markup and CSS per Section 3 (label + value split, value spans sized up — 150px target for health/armor, a judged-and-evidenced size for ammo). Update `client/src/combatHud.ts`'s `setHealth()`/`setArmor()`/`setWeapon()` to target the new child spans.
- Reposition `#healthHud`/`#armorHud` inward from the screen edges, closer to the horizontally-centered `#weaponHud`, per Section 3.
- **No functional/data change** — values still update live exactly as before (server-driven every `world_state` tick / `LoadoutMessage`), this story only changes markup/CSS and how `combatHud.ts` writes text into it.
- **Acceptance criteria:**
  - [ ] Health, armor, and ammo-count numbers are visibly, substantially larger than their pre-EPIC-13 sizes (30px/30px/15px respectively) — screenshot evidence at the standard 1280x800 QA viewport required, not a written claim.
  - [ ] The literal 5x target (150px) is what's implemented for health/armor unless the 1280x800 screenshot evidence shows it visibly breaks (overlap/clipping/unreadable) — in which case the dialed-back value is documented (code comment + Tester/Critic note) with the screenshot as evidence, not a silent downgrade.
  - [ ] Ammo-count sizing is a documented judgment call per Section 3 — code comment states the chosen px value and the reasoning (compared against the literal-5x figure), backed by the same 1280x800 screenshot evidence.
  - [ ] No overlap between `#healthHud`, `#armorHud`, and `#weaponHud` at 1280x800 — a visible gap between all three, verified in the screenshot.
  - [ ] No element clipped off either horizontal edge of the viewport at 1280x800.
  - [ ] `#healthHud`/`#armorHud` are positioned visibly closer to the horizontal center than their pre-EPIC-13 edge-anchored (`left:24px`/`right:24px`) positions.
  - [ ] Weapon-identity color-coding (`setWeapon()`'s `style.color`) still visibly applies to the ammo number, not just the weapon name — verified in the screenshot (e.g. equip the rifle, confirm the ammo number renders in the rifle's orange, not default/uncolored).
  - [ ] The "EMPTY" dry-weapon state and its existing pulse animation (`#weaponHud[data-empty="true"]`) still work correctly with the restructured markup.
  - [ ] `HealthHud[data-low]` (low-health red tint) and `#armorHud[data-zero]` (zero-armor grey tint) still work correctly against the new value spans.

---

## 8. Story 13.5 — Docs

**As a** developer reading `README.md` **I want** an EPIC 13 entry summarizing what changed **so that** the project's running EPIC history (EPIC 6 through EPIC 12 are all documented there) stays complete and accurate.

- `README.md`: add an EPIC 13 section following the existing EPIC-list format/placement convention (see the EPIC 11/12 entries for style) — summarizing the two auto-switch rules (Story 13.1/13.2) and the HUD sizing/repositioning change (Story 13.4), including the actual final numbers used (not the pre-implementation targets, if any were dialed back per Section 3's judgment-call provision).
- **Acceptance criteria:**
  - [ ] `README.md` has an EPIC 13 entry in the established style/location, reflecting the actual shipped numbers/behavior.

---

## 9. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | Server: `autoSwitchDown()` helper + call sites in `fire()` | auto-switch to best owned non-empty weapon on ammo depletion | `server/src/playerRegistry.ts` | Story 13.1 acceptance criteria |
| 2 | Server: generalize `applyPickup()`'s weapon/ammo auto-equip rule | re-equip on any pickup (not just first unlock) that yields a strictly-better, non-empty weapon | `server/src/playerRegistry.ts` | Story 13.2 acceptance criteria |
| 3 | Server: surface auto-switch in `FireOutcome`/`ApplyPickupResult`; log in `Match.resolveFire()` / pickup tick loop | observability for both new auto-switch paths | `server/src/playerRegistry.ts`, `server/src/match.ts` | new log line appears for an auto-switch event, matching existing `switch:`-line style |
| 4 | New regression script `scripts/regression-weapon-autoswitch.ts` + `npm run regression:weapon-autoswitch` | committed, re-runnable, numeric/state evidence | `scripts/regression-weapon-autoswitch.ts`, `package.json` | 6 coverage cases from Story 13.3, non-zero exit on failure |
| 5 | Client: restructure `#healthHud`/`#armorHud`/`#weaponHud` markup + CSS (label/value split, enlarge values, reposition health/armor) | Story 13.4's visual result | `client/index.html` | Story 13.4 acceptance criteria, screenshot-verified at 1280x800 |
| 6 | Client: update `setHealth()`/`setArmor()`/`setWeapon()` to target the new child spans | HUD text plumbing keeps working, values still server-driven | `client/src/combatHud.ts` | live updates confirmed in Tester screenshot evidence |
| 7 | Docs: `README.md` EPIC 13 section | doc record matches shipped behavior/numbers | `README.md` | Story 13.5 acceptance criteria |

---

## 10. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] A player whose equipped weapon runs dry (mid-fire or on a subsequent fire attempt) is automatically switched to their best owned weapon that currently has ammo (or is infinite), searching down from just below the empty weapon's tier to the pistol floor.
- [ ] A player who picks up ammo (first-time unlock or refill) for an already-owned weapon strictly better than what's currently equipped, with resulting ammo > 0, is automatically equipped onto it — including the specific "ran dry, auto-switched down, found ammo again" recovery case the user asked for explicitly.
- [ ] Manual `E` weapon cycling continues to work correctly, including immediately interleaved with either automatic rule.
- [ ] No thrash/oscillation risk: both automatic rules only trigger from discrete player actions (a fire attempt or a pickup walk-over), never from a passive tick — verified in Story 13.3's regression script and Tester's gameplay evidence.
- [ ] `server/src/combat.ts` (human hitscan resolution) is untouched; bot behavior (`server/src/botAI.ts`, pistol-only, no pickups) is unaffected — confirmed, not just assumed.
- [ ] Health, armor, and ammo-count numbers are all substantially larger (health/armor at the literal 150px/5x target unless documented-and-evidenced otherwise; ammo at the largest size that stays clean, per Section 3) and `#healthHud`/`#armorHud` are repositioned visibly closer to center — all verified via Playwright screenshot at the standard 1280x800 QA viewport, with no overlap between the three elements and no off-screen clipping.
- [ ] Any dial-back from the literal 5x target (either stat) is a documented, evidenced judgment call (code comment + Tester/Critic screenshot + one-line reasoning), not a silent downgrade.
- [ ] No regression to existing HUD behavior: "EMPTY" pulse, low-health tint, zero-armor tint, weapon-identity color-coding (now including the ammo number) all still work.
- [ ] Committed, re-runnable regression script (`scripts/regression-weapon-autoswitch.ts`) with real observed-state evidence for the 6 coverage cases in Story 13.3.
- [ ] `README.md` has an EPIC 13 entry reflecting the actual shipped behavior/numbers.
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass.
- [ ] Tester's Gameplay & feel section includes: a server-log excerpt showing an auto-switch-down event and an auto-equip-on-pickup event (with the new log lines from Task 3), a screenshot of the resized/repositioned HUD at 1280x800 in a state with visible health/armor/ammo values, and a screenshot or log confirming manual `E` cycling still works normally around the new automatic behavior.

---

## 11. Risks

- **Ping-pong/thrash between the two auto-switch rules:** addressed by design (Section 2) — both rules are gated on discrete player actions (a rate-limited fire attempt, or a pickup-consumption event with a multi-second respawn delay), not a per-tick re-evaluation, so there is no continuous oscillation risk. Story 13.3's regression script explicitly covers the documented dry-then-refill sequence to verify this holds in practice, not just in the reasoning above.
- **HUD literal-5x sizing may not fit cleanly**, specifically for the ammo number (`#weaponHud` is centered and flanked by the now-larger health/armor badges, unlike health/armor which each have their own uncontested corner-ish region) — this EPIC explicitly authorizes dialing back from literal 5x if 1280x800 screenshot evidence shows a real problem (overlap, clipping, unreadability), but requires that decision to be documented and evidenced, not silently made. Tester/Critic must actually look at the screenshot, not accept a written claim.
- **`FireOutcome`/`ApplyPickupResult` type changes are additive** (new optional field), so existing consumers (`server/src/match.ts`, `server/src/index.ts`) that don't read the new field are unaffected — low risk, but Tester should confirm `npm run typecheck` still passes cleanly across the whole workspace, not just the two touched files.
- **Bots are pistol-only and never call `applyPickup()`** (confirmed: `server/src/match.ts`'s per-tick pickup loop explicitly skips any id `botAI.isBot()` recognizes) — Story 13.1's `autoSwitchDown()` is reachable in principle for a bot's `fire()` call, but a bot's `equippedWeapon` is always `"pistol"` (infinite ammo, `fire()` never even enters the `!stats.infiniteAmmo` branch for a bot), so this EPIC is a no-op for bot behavior in practice. Tester should still verify a bot match plays normally (no regression), not just assume this from the reasoning above.
- **No new client-trusted state**: the client remains a pure renderer of the server's own `LoadoutMessage` (confirmed by reading `client/src/main.ts`'s `onLoadout` handler) — Story 13.1/13.2 introduce no new client message field and no new client-side weapon/ammo prediction, keeping the existing anti-spoofing posture intact.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
