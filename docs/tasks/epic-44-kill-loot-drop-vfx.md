# EPIC 44: Kill Loot Drop VFX (Victim → Killer)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

User ask (RU, 2026-08-25), intent:

- After a kill, the player must **see** that loot dropped (gem/diamond, amulet piece/shard, etc.).
- Items should be **larger**, **multicolored**, and **glowing**.
- Clear feedback that loot came **from the victim** and **flew toward the killer**.
- User currently does not notice any drop VFX at all.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Kill Loot Drop VFX (Victim → Killer) |
| **System goal** | When the server grants kill rewards (gold and/or item drops), the killer (and ideally other match clients) sees distinct glowing low-poly loot meshes spawn at the victim and arc toward the killer — reflecting **only** what the server actually granted for that kill. |
| **Business/gameplay problem** | Economy kill rewards already exist (gold + probabilistic item drops via `grantKillGold` / `resolveKillDrops`), but the client only gets `economy_gold_update` / `economy_profile` inventory updates. There is **no** world-space drop VFX, so players do not perceive that anything dropped. |
| **Architectural role** | **Shared protocol** (new server→client cosmetic event) + **server** (emit after authoritative grant) + **client** (Three.js VFX only). Server remains sole authority for *what* dropped; client never invents loot kinds. |
| **Main components** | `shared/src/index.ts` (message type); `server/src/match.ts` (`grantKillGold`); new client module e.g. `client/src/killLootVfx.ts`; wire in `client/src/network.ts` + `client/src/main.ts`; regression script; README Current status. |
| **Stack** | Fixed project stack. Three.js procedural primitives + emissive materials (same Roblox-like language as pickups/pets). No new npm deps, no asset pipeline, no client-side reward RNG. |
| **Interaction** | After existing kill economy path succeeds, server sends a cosmetic event listing granted kinds + killer/victim ids (and positions if useful). Client spawns VFX. Deathmatch/Sandbox reward **rules unchanged** (EPIC 32/35). |

## 2. Current state (verified in code — do not invent)

### 2.1 Server grants on kill (`server/src/match.ts` → `grantKillGold`)

- Skips fog / self-kill / non-human shooters (no socket).
- **Deathmatch:** bot victims → **no** gold, **no** item drops (EPIC 32). Human victims → gold + `resolveKillDrops`.
- **Sandbox:** gold + drops into sandbox pool for bot **and** human victims (EPIC 35); victim inventory copy (gem/amulet/shard) only when victim context is human.
- Always mints primary gold in `[GOLD_DROP_MIN, GOLD_DROP_MAX]` when rewards apply.
- Item rolls via `economy.resolveKillDrops` (egg, stimulator, gem, shard, amulet, repair kit; overflow → `substitutedGold` / `substitutedKinds`).
- Notifies killer via:
  - `economy_gold_update` (gold + gained) — always when gold minted
  - `economy_profile` — when items granted and/or substituted gold path refreshes profile
- **No** dedicated loot-VFX / drop-kinds message today.

### 2.2 Client today

- `onKill` → kill feed only (`client/src/main.ts`).
- `onEconomyGoldUpdate` / `onEconomyProfile` → HUD gold + inventory overlay — **no** 3D drop meshes, no fly-to-killer animation.
- Pickup / pet / amulet visuals exist as emissive low-poly meshes (`client/src/pickups.ts`, `client/src/remotePlayers.ts`) — reuse that style, not the map pickup system itself.

### 2.3 Protocol gap

- `KillEvent` has ids/nicknames only — no loot payload.
- `economy_gold_update` has `{ gold, gained }` only — no item kinds, no victim id/position.
- Inferring drops by diffing successive `economy_profile` snapshots is fragile (race, lobby, other grants) and must **not** be the source of truth for VFX.

## 3. Design

### 3.1 Server-authored cosmetic event (required)

Add a shared message, e.g. `economy_kill_loot_fx` (name may be refined; keep `economy_` / kill-loot naming consistent):

```ts
// Illustrative — Programmer finalizes exact fields in shared/
{
  type: "economy_kill_loot_fx";
  killerId: string;
  victimId: string;
  /** World positions at grant time (server registry), so client need not guess. */
  victimPosition: { x: number; y: number; z: number };
  killerPosition: { x: number; y: number; z: number };
  /**
   * Only kinds actually granted this kill.
   * Include "gold" when primary and/or substituted gold was minted.
   * Do NOT include rolled-but-failed item kinds that became substitute gold —
   * those contribute to gold only (show as gold, not as fake egg/gem).
   */
  grants: Array<{
    kind:
      | "gold"
      | "gem"
      | "shard"
      | "amulet"
      | "egg"
      | "stimulator"
      | "repair_kit";
    /** Optional display hint (e.g. gem type) — cosmetic only. */
    detail?: string;
  }>;
}
```

**Emit rules:**

- Emit **only** from `grantKillGold` after grants are resolved, and **only** when there is at least one real grant (gold and/or items). If the early-return paths apply (DM bot victim, etc.), emit **nothing**.
- Payload kinds must match what was actually minted/granted for **this** kill (including gold when `primaryGained > 0` or `substitutedGold > 0`).
- Audience: **broadcast to all clients in the match** (cosmetic spectacle; kill is already public). Alternatively private-to-killer is acceptable if broadcast is awkward — prefer broadcast. Never let non-killers treat the message as granting inventory.
- Do **not** change drop chances, EPIC 32/35 gates, shard once-per-victim logic, or gold amounts.

### 3.2 Client VFX

- New small module (suggested `client/src/killLootVfx.ts`) owned by the render loop:
  - On message: spawn one mesh (or small cluster) per `grants[]` entry at `victimPosition` (slightly above torso / chest height).
  - Animate along a short **arc / bezier** toward `killerPosition` (or live killer mesh position if available and stable) over ~0.6–1.2s, then fade/despawn (optionally a brief “absorb” pop at the killer).
  - If local player is the killer, flight toward self must be obvious (“к тебе прилетело”).
- **Visual identity** (distinct shape + color + emissive glow; **larger than a tiny speck** — readable at typical engagement range; aim ~0.35–0.7 world units characteristic size, not particle dust):

| Kind | Visual idea (low-poly) | Color family (suggested) |
|------|------------------------|---------------------------|
| `gem` | Faceted octahedron / diamond | Cyan / bright blue, strong emissive |
| `shard` | Sharp crystal splinter / wedge | Magenta / purple emissive |
| `amulet` | Pendant / torus+disk “piece” | Gold / amber emissive |
| `gold` | Coin / small stacked disks or chunky nugget | Yellow / orange emissive |
| `egg` | Oval / egg | Soft pastel / cream + tint |
| `stimulator` | Bolt / syringe-like stick | Lime / green emissive |
| `repair_kit` | Small crate / wrench block | Steel + orange accent |

- Multicolor + glow is mandatory per user ask. Reuse MeshStandardMaterial emissive patterns from pets/pickups.
- Stagger multiple grants slightly in spawn time/offset so a multi-drop kill reads as a burst, not one muddled blob.
- **Forbidden:** client-side random “sparkles” or fake loot kinds not listed in the server message.
- No gameplay effect: no pickup radius, no inventory mutation from the VFX module.

### 3.3 Out of scope

- Changing Deathmatch vs Sandbox reward eligibility or drop tables.
- Ground-trade auction VFX, map weapon pickups, inventory overlay icons (EPIC 43).
- Sound optional; if cheap and existing SFX pattern fits, one soft chime is OK — not required for AC.
- Showing VFX for kills that grant nothing.

## 4. Architecture

```text
Kill confirmed
  → grantKillGold (unchanged economy rules)
      → mint gold + resolveKillDrops
      → economy_gold_update / economy_profile (unchanged)
      → NEW: economy_kill_loot_fx { killer, victim, positions, grants[] }
            ↓ broadcast (match)
Client KillLootVfx
  → spawn glowing meshes at victim
  → arc toward killer
  → despawn
```

Authority: server decides grants. Client only renders listed kinds.

## 5. Stories / Tasks

### Story 44.1 — As a player I want the server to tell my client exactly what loot a kill granted so the VFX cannot invent rewards

| # | Task | Place |
|---|------|-------|
| 44.1.1 | Add `economy_kill_loot_fx` (or agreed name) + grant kind union to `shared/`; export on wire union | `shared/src/index.ts` (+ rebuild shared) |
| 44.1.2 | After successful grants in `grantKillGold`, build `grants[]` from actual gold/items (not failed rolls) and broadcast with killer/victim ids + server positions | `server/src/match.ts` |
| 44.1.3 | Regression: DM bot kill → no fx message; rewarding kill with forced drops → fx kinds match grants; substituted item → gold kind only for that substitute | `scripts/regression-kill-loot-vfx.ts` (+ `package.json` script) |

### Story 44.2 — As a killer I want to see large glowing multicolored loot leave the victim and fly to me

| # | Task | Place |
|---|------|-------|
| 44.2.1 | Implement `KillLootVfx` (spawn, distinct meshes/materials per kind, arc-to-killer, size/glow polish, cleanup) | `client/src/killLootVfx.ts` (new) |
| 44.2.2 | Wire network handler + main loop update; resolve killer/victim positions from message (fallback: known remote/local transforms if message positions missing — prefer server positions) | `client/src/network.ts`, `client/src/main.ts` |
| 44.2.3 | README Current status blurb for EPIC 44 | `README.md` |

### Story 44.3 — QA evidence

| # | Task | Place |
|---|------|-------|
| 44.3.1 | Playwright (or house pattern) screenshots / evidence of loot VFX in flight when grants occur; document how forced/high-rate drops were obtained for QA if needed | `scripts/qa-epic44-*.mjs` or Tester evidence dir per house pattern |

**Branch:** `task/epic-44-kill-loot-drop-vfx`  
**Base:** `master` (tip at task start — Programmer records SHA)

## 6. Acceptance criteria

- [ ] On a kill that grants loot, clients receive a server `economy_kill_loot_fx` (name as implemented) listing **only** granted kinds.
- [ ] Killer sees distinct glowing drop(s) leave the victim and travel toward the killer (clear for local killer).
- [ ] Visual identity differs by loot type (at least **gem vs shard vs amulet-related vs gold**; other common drops distinct if granted).
- [ ] Larger than a tiny speck; readable at engagement range; multicolor + emissive glow.
- [ ] No VFX for loot that was not granted; no client-authoritative inventing of rewards.
- [ ] Deathmatch/Sandbox reward rules unchanged (EPIC 32/35); DM bot victims still grant nothing and emit no loot fx.
- [ ] `npm run typecheck` / `npm run build` pass; new regression script passes; Playwright/screenshot evidence for Tester/Critic.
- [ ] README Current status updated.

## 7. Risks

- Drop rates are low — QA may need forced rolls / test hooks in the regression (inject grants list / stub `resolveKillDrops` results) without changing production probabilities. Prefer test-only forcing over permanent rate changes.
- Position desync: use server positions at grant time for spawn/target; short flight so mid-move killer drift is acceptable.
- Do not leak or trust client-reported drop kinds.

## 8. Definition of Done

Full office chain: Programmer → Tester PASS → Critic APPROVED (or Judge ALL_CLOSED) → Team Lead merge to `master` + push. Standing ops: after Critic APPROVED (or Judge ALL_CLOSED), merge `master` and `git push origin master` without asking; update README Current status if not already done.

## Sign-off

- **Specification (author):** Tusya (Team Lead) — 2026-08-25
- **Approval (Team Lead):** Tusya — approved for implementation
- **Assignee:** Pusya (Programmer)
