# EPIC 36: Post-Respawn Spawn Protection (Transparency + Invincibility)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).
Small, independent, unambiguous ask — does not depend on EPIC 33/34/35 or EPIC 30, can be assigned whenever programmer bandwidth is free.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Post-Respawn Spawn Protection (Transparency + Invincibility) |
| **System goal** | For a short window after a player becomes alive again (respawn, and initial spawn on join — see Section 3 scoping note), they render nearly transparent to other players and cannot take damage or be killed, server-enforced. |
| **Business/gameplay problem** | Today a player respawns at full health with zero grace period — a shooter camping a spawn point (or already aiming through it) can kill a player before they have any chance to react. |
| **Architectural role** | server (authoritative damage-immunity gate, hooked into the existing hit-resolution choke point) + protocol (broadcast the protection window, timestamp-based like existing clock-synced fields) + client (transparency rendering only, no client-side timer of its own) |
| **Main components** | `server/src/playerRegistry.ts` (`applyDamage`, `spawn`, `spawnAt`, `processRespawns`), `shared/src/index.ts` (`PlayerState`), `shared/src/combat.ts` (`COMBAT` constants), `client/src/remotePlayers.ts` |
| **Stack** | Fixed project stack. No new dependency. |
| **Interaction with other components** | Hooks into the **existing** respawn path (EPIC 4/5-era `processRespawns()` / `applyDamage()` in `server/src/playerRegistry.ts`, `RespawnEvent` in `shared/src/index.ts`) — no parallel respawn system. Applies uniformly across all match types (`public`/`bots`/`endless`) since the underlying respawn/damage code path is already shared across all of them; no mode-specific carve-out unless implementation surfaces a concrete reason (state it if so). |

## 2. Current state (read before implementing — confirm still accurate)

- `shared/src/combat.ts` `COMBAT` constants: `respawnDelayMs: 3000` (death → automatic respawn timer). No existing invincibility/protection concept anywhere in the codebase.
- `server/src/playerRegistry.ts` `processRespawns(nowMs)`: when a dead player's `respawnAtMs` timer elapses, resets position/health/armor/loadout and sets `player.alive = true`. This is the single place a player transitions dead → alive after a kill.
- `server/src/playerRegistry.ts` `applyDamage(shooter, target, damage, ...)`: the **single choke point** every damage source funnels through — direct hitscan hits (`fire()`), grenade direct hits (`applyGrenadeProjectileDirect`), grenade splash (`applyGrenadeSplash`/`applyGrenadeSplashImpact`), and environmental damage (`applyEnvironmentalDamage`) **all** call this one method. This is the correct single place to gate on spawn protection — no need to touch every caller separately.
- `PlayerState` (`shared/src/index.ts`) already has a precedent for a **timestamp-based, clock-synced, server-authoritative** field the client uses only for display, with readiness/effect gated server-side: e.g. egg `hatchDeadlineMs` (EPIC 24, "client clock only for display, readiness gated server-side"). The same pattern applies here — broadcast a deadline timestamp, not a raw boolean the client would otherwise have to re-derive from its own possibly-drifting clock.

## 3. Design

- New constant in `shared/src/combat.ts` `COMBAT`: `spawnProtectionMs: 2000` (2 seconds — reasonable default per the user's own example; Team Lead confirms this is fine as the default, not a hard requirement to deviate from).
- New field on `PlayerRecord` (server-only, `server/src/playerRegistry.ts`): `spawnProtectedUntilMs: number` (0 or a past timestamp = not protected). Set to `Date.now() + COMBAT.spawnProtectionMs` in **both** `processRespawns()` (post-death respawn) **and** `spawn()`/`spawnAt()` (a player's very first spawn on join, and a bot's spawn) — a freshly-joining player is equally vulnerable to being shot before they've even gotten their bearings, so protection applies uniformly to "just became alive," not only "just respawned after dying." (Scoping call — flag to Team Lead if this needs to be respawn-only instead, but the default is "applies whenever a player transitions to alive.")
- **Server-authoritative immunity, single choke point:** at the top of `applyDamage()`, if `Date.now() < target.spawnProtectedUntilMs`, the call is a genuine no-op — no armor/health change, `killed: false`, and (see below) this must not even register as a "hit" for HUD/hit-marker purposes on the shooter's side, not just a 0-damage hit. The cleanest way to achieve that: exclude spawn-protected players from becoming valid hitscan/splash **targets** in the first place (filter them out of the candidate list `performHitscan()`/`findGrenadeSplashCandidates()` iterate over, sourced from `this.players.values()`) rather than letting a shot "hit" them and then discarding the damage — a protected player should feel like a ghost (shots pass through, no hit marker, no hit sound), not like a target that mysteriously takes 0 damage. Programmer's call on the exact filtering mechanism, but the **outcome** (no hit event of any kind against a protected player) is the requirement.
- Extend `PlayerState` with `spawnProtectedUntilMs: number` — broadcast every tick like `health`/`armor`, same clock-synced pattern as `hatchDeadlineMs`. Client computes `isProtected = worldState.serverTimeMs < player.spawnProtectedUntilMs` every frame from broadcast state — **no local countdown timer that free-runs between broadcasts** (must self-correct every tick from the server's own value, so it can never drift ahead or be spoofed into extending itself).
- Client (`client/src/remotePlayers.ts`): while `isProtected`, render that avatar at a low opacity across all its materials (torso/head/arms/legs/backpack — everything, so it reads clearly as "not a normal target," not just one body part) — restore full opacity the instant the server-broadcast window elapses. This is purely a `material.transparent`/`opacity` toggle on already-existing materials (interacts with EPIC 33's per-avatar material work if that lands first or concurrently — if both EPICs are in flight together, whichever lands second should rebase cleanly since they touch overlapping but different concerns in the same file, same low-risk pattern as EPIC 31/32's shared `match.ts` overlap).
- Local player's own screen: since the local player doesn't render their own third-person avatar (first-person only), consider a small HUD cue (e.g. a brief "SPAWN PROTECTED" countdown near the health readout, driven by the same `spawnProtectedUntilMs` broadcast for the local player) so they know they're currently unkillable — recommended, not a hard requirement; Programmer's call, note in the handoff either way.

## 4. Out of scope

- Any change to `respawnDelayMs` (3s death→respawn timer) itself — unrelated, unchanged.
- Any client-side prediction of protection state beyond rendering the server-broadcast value.
- Weapon pickups / ammo / any other post-respawn state (already handled by existing `processRespawns()` logic, untouched).

## 5. Tasks

| # | Task | Place |
|---|------|-------|
| 36.1 | `COMBAT.spawnProtectionMs` constant | `shared/src/combat.ts` |
| 36.2 | `spawnProtectedUntilMs` on `PlayerRecord`, set in `spawn()`/`spawnAt()`/`processRespawns()` | `server/src/playerRegistry.ts` |
| 36.3 | Gate `applyDamage()`'s single choke point (and the hitscan/splash target-candidate filtering feeding into it) on the protection window — no hit event at all against a protected player | `server/src/playerRegistry.ts`, `server/src/combat.ts` (if candidate filtering lives there) |
| 36.4 | Broadcast `spawnProtectedUntilMs` in `PlayerState` | `shared/src/index.ts`, `server/src/match.ts` |
| 36.5 | Client: low-opacity rendering while protected, driven by broadcast state only | `client/src/remotePlayers.ts` |
| 36.6 | (Recommended) local HUD "spawn protected" cue | `client/src/combatHud.ts` |
| 36.7 | Live verification + regression: respawn into a shooter's line of fire, confirm zero damage/no hit event during the window, confirm damage resumes exactly once the window elapses, confirm other clients see the transparency | `scripts/`, `qa-artifacts/epic-36/` |

**Branch:** `task/epic-36-spawn-protection`
**Base:** `master` (tip at task start: `d1738e2`)

## 6. Acceptance criteria

- [ ] `npm run typecheck` / `build` PASS
- [ ] A freshly-respawned (and freshly-joined) player takes **zero damage** from any damage source (hitscan, grenade direct, grenade splash, environmental) for `COMBAT.spawnProtectionMs` after becoming alive — server-side regression proof, not just a visual claim
- [ ] No hit event/hit-marker/hit-sound fires against a protected player (shots visibly "pass through," not "land for 0")
- [ ] Protection ends exactly at the broadcast deadline — a shot landing immediately after must deal normal damage (no off-by-one grace extension)
- [ ] Client renders reduced opacity on a protected avatar, visible to **other** connected clients — live two-client screenshot evidence
- [ ] Opacity restores to normal the instant protection ends, driven by server-broadcast state (no client-owned timer)
- [ ] Applies in all three match modes (public/bots/endless) — spot-checked in at least two
- [ ] No regression to existing combat/hit-registration/respawn timing (3s respawn delay unchanged, existing damage math for non-protected players unchanged)

## 7. Risks

- Filtering protected players out of hitscan target candidates touches a hot path (`performHitscan()`, called every fire attempt) — must not introduce a performance regression or, worse, accidentally exclude a *non*-protected player due to a filtering bug (would silently make them unkillable — a serious anti-cheat regression, must be covered by an explicit "normal players remain hittable" regression case, not just "protected players aren't").
- If EPIC 33 (avatar color) lands concurrently, both touch `client/src/remotePlayers.ts` material handling — low collision risk (different concerns: color vs. opacity), rebase whichever merges second.

## 8. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25
- **Assignee:** Programmer (Pusya)
