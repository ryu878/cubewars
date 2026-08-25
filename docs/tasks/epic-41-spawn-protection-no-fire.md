# EPIC 41: Spawn Protection Must Block Firing (No Shoot While Ghost)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User ask (RU, 2026-08-25): While a player is transparent / just respawned (spawn-protected), they must not be able to shoot — today they can fire at others while invincible, which is unfair.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Spawn Protection Must Block Firing |
| **System goal** | While a player (human or bot) is inside the EPIC 36 spawn-protection window (`spawnProtectedUntilMs`), they cannot fire. Incoming immunity from EPIC 36 stays intact. After the window ends, fire works normally. |
| **Business/gameplay problem** | EPIC 36 made freshly-spawned players nearly transparent and unkillable for ~2s, but they can still shoot. That asymmetry lets ghosts deal damage while taking none. |
| **Architectural role** | **Server-authoritative** fire gate (mandatory) + **client** local fire-prediction / viewmodel suppress (UX only, not authority) + extend existing spawn-protection regression. |
| **Main components** | `server/src/playerRegistry.ts` (`fire()`), optionally `server/src/index.ts` / `server/src/botAI.ts` cooldown gates, `client/src/main.ts` / `client/src/fpsController.ts`, `scripts/regression-spawn-protection.ts` |
| **Stack** | Fixed project stack. No new dependency. |
| **Interaction** | Builds directly on EPIC 36 (`COMBAT.spawnProtectionMs`, `isSpawnProtected`, `spawnProtectedUntilMs`). Does **not** weaken "cannot be hit while protected." Same choke path for humans and bots: `match.resolveFire()` → `registry.fire()`. |

## 2. Current state (read before implementing)

- EPIC 36: `COMBAT.spawnProtectionMs = 2000`; `PlayerRecord.spawnProtectedUntilMs` set on `spawn()` / `spawnAt()` / `processRespawns()`; `isSpawnProtected()` in `server/src/combat.ts`.
- **Incoming** protection: protected players filtered out of hitscan / splash / projectile candidates; `applyDamage` returns `null` as safety net. **Keep this.**
- **Outgoing** fire today: `registry.fire(shooterId)` only early-bails if shooter missing/dead — **does not** check shooter spawn protection. Ammo can decrement; hitscan/projectile can resolve; `FireBroadcastEvent` can go out.
- Humans: `server/src/index.ts` `"fire"` → rate-limit → `match.resolveFire`.
- Bots: `botAI` cooldown → `resolveFire(bot.id)` — same `registry.fire()`.
- Client: `FpsController.onFire` in `main.ts` always plays muzzle/viewmodel/gunshot and `send({ type: "fire" })` while alive/pointer-locked — no protection gate. Local HUD already shows `SPAWN PROTECTED` from broadcast (`hud.setSpawnProtection`).

## 3. Design

### 3.1 Server (authoritative — mandatory)

1. At the top of `PlayerRegistry.fire(shooterId)`, after the existing alive check: if `isSpawnProtected(shooter)`, return a no-op outcome equivalent to "did not fire" — **no ammo consume**, **no hitscan**, **no projectile spawn**, **no `weapon` on outcome** so `match.resolveFire` does **not** emit `fire_broadcast`.
2. Prefer also short-circuiting **before** human `lastFireAcceptedAt` / bot `lastFireAcceptedAt` stamps so a blocked attempt does not burn cooldown (index.ts and/or botAI — Programmer's call on exact placement; outcome must be fair).
3. Do **not** clear or shorten `spawnProtectedUntilMs` when the player tries to fire — protection runs full TTL; firing is simply denied until it expires.
4. Humans and bots must behave the same (shared `registry.fire()` gate is the intended single choke).

### 3.2 Client (UX — required for AC, not authority)

While local player is spawn-protected (`serverTimeMs < self.spawnProtectedUntilMs` from latest `world_state`, same pattern as HUD cue):

- Do **not** send `{ type: "fire" }`.
- Do **not** play local muzzle flash / viewmodel recoil / local gunshot for that click (and hold-to-auto-fire on pistol).

Suggested hooks: gate inside `onFire` in `main.ts`, and/or `shouldAutoFire` / a small `canFire` predicate on `FpsController` — Programmer's call; must track broadcast state only (no free-running local protection timer).

### 3.3 Out of scope

- Changing `spawnProtectionMs` duration (keep 2000 unless a bug forces a comment-only clarification).
- Weakening incoming immunity / ghost opacity / HUD "SPAWN PROTECTED" cue.
- New protocol fields (reuse existing `spawnProtectedUntilMs`).
- Weapon/ammo/loadout redesign.

## 4. Architecture

```text
Client click (alive + pointer lock)
  → [EPIC 41] if local spawn-protected: suppress juice + do not send "fire"
  → else send { type: "fire" }

Server index.ts / BotAI
  → [EPIC 41 preferred] skip cooldown stamp if shooter spawn-protected
  → match.resolveFire → registry.fire
       → [EPIC 41 mandatory] if isSpawnProtected(shooter): no-op (no ammo / hit / broadcast)
       → else existing fire path

Incoming damage (unchanged EPIC 36):
  protected targets filtered / applyDamage null
```

## 5. Stories / Tasks

### Story 41.1 — As a player I want spawn protection to also disarm me so ghosts cannot shoot while invincible

| # | Task | Place |
|---|------|-------|
| 41.1 | Gate `registry.fire()`: spawn-protected shooter → no-op (no ammo, no hit, no projectile, no fire_broadcast) | `server/src/playerRegistry.ts` (+ `isSpawnProtected` already in combat) |
| 41.2 | Ensure human/bot cooldown stamps do not advance on protection-blocked attempts | `server/src/index.ts`, `server/src/botAI.ts` as needed |
| 41.3 | Client: suppress local fire prediction + outbound `fire` while protected | `client/src/main.ts` and/or `fpsController.ts` |
| 41.4 | Extend `regression-spawn-protection.ts`: protected shooter cannot deal damage / consume ammo / register fire; after window, fire works; incoming immunity still holds; bots/humans same path | `scripts/regression-spawn-protection.ts` |
| 41.5 | README Current status note for EPIC 41 | `README.md` |

**Branch:** `task/epic-41-spawn-protection-no-fire`  
**Base:** `master` (tip at task start: `d1f1b6a`)

## 6. Acceptance criteria

- [ ] Server rejects / no-ops fire while shooter is spawn-protected (authoritative) — no ammo spend, no HitEvent, no FireBroadcastEvent, no projectile
- [ ] Client suppresses local fire prediction/viewmodel/muzzle/gunshot and does not send `fire` while protected
- [ ] Protection still blocks **incoming** damage (EPIC 36 regression still PASS for protected targets)
- [ ] After protection expires (`nowMs >= spawnProtectedUntilMs`, strict `<` rule unchanged), fire works normally
- [ ] Humans and bots consistent (both go through `registry.fire()` gate)
- [ ] Cooldown is not unfairly burned by blocked attempts (preferred / strongly expected)
- [ ] `npm run typecheck` / `npm run build` PASS
- [ ] `npm run regression:spawn-protection` PASS with new shooter-blocked cases
- [ ] Live/QA evidence (smoke or Playwright) showing no muzzle/fire while ghost, then fire after window

## 7. Risks

- Forgetting ammo restore if a mid-function return is placed after decrement — gate **before** ammo mutation.
- Client-only gate without server gate would leave cheating / lag asymmetry — server gate is non-negotiable.
- Accidentally weakening target immunity while adding shooter checks — keep target filtering untouched; extend regression for both directions.

## 8. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25
- **Assignee:** Programmer (Pusya)
