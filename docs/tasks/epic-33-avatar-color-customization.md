# EPIC 33: Avatar Color Customization (Player Palette + Bot Random Colors)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).
Combines the user's "Part C" (player color customization) and "Part D" (bots get random colors too) into one EPIC: D is strictly additive on top of C's palette/protocol (same `avatarColors` broadcast field, same palette constant), so building them separately would duplicate the plumbing. Both are independent of Parts A/B and can proceed immediately.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Avatar Color Customization (Player Palette + Bot Random Colors) |
| **System goal** | Let a human player pick colors for 4 body-part groups (head, torso, hands, legs) from a small fixed palette, persist the choice, and broadcast it so other players see it in-match — same cosmetic-reveal precedent as `equippedWeapon` (EPIC 17) / `equippedPetTypes`+`hasAmulet` (EPIC 31). Bots get a random full color set assigned at spawn, reusing the same palette/field, for visual variety in "vs Bots"/"endless" matches. |
| **Business/gameplay problem** | Every avatar in the game currently looks identical (see Section 2) — no player identity/expression, and bots are visually indistinguishable from each other beyond the EPIC 31 pet/amulet tell. |
| **Architectural role** | shared (palette constant + protocol field) + server (validation, persistence, broadcast, bot random assignment) + client (customization UI, avatar material rendering) |
| **Main components** | `shared/src/` (new small module, e.g. `avatar.ts`), `server/src/` (new lightweight avatar-color store + WS handler), `client/src/remotePlayers.ts`, `client/src/inventoryOverlay.ts` (or wherever the UI lands), `client/src/network.ts` |
| **Stack** | Fixed project stack. No new dependency. Palette is a small fixed array of hex colors (~6-8), not a full color picker. |
| **Interaction with other components** | **Not** part of the economy/gold/item system, and explicitly **not** inside the EPIC 35 Deathmatch/Sandbox economy-pool split under discussion — this is an account-level cosmetic preference, unaffected by which match mode a player is in. Reuses the `PlayerState` broadcast pattern (`shared/src/index.ts`) established by `equippedWeapon`/`equippedPetTypes`/`hasAmulet` — server-computed, read-only, client never sends its own claimed color for rendering purposes (it may send a *request* to change its own stored preference, which the server validates before it ever appears in any broadcast). |

## 2. Current state (read before implementing — confirm still accurate)

`client/src/remotePlayers.ts` defines avatar body-part materials as **module-level shared singletons**: `bodyMaterial` (torso), `limbMaterial` (used for **both** arms AND legs today — one material, not two), `headMaterial`, `faceMaterial`, `backpackMaterial`. Every avatar instance (`buildAvatar()`) reuses these same `THREE.MeshStandardMaterial` objects. This means **every player and bot today renders with identical colors** — changing a shared material would recolor every avatar at once, which is the opposite of per-player customization. This is the key architectural fact driving Story 33.1 below: per-avatar coloring requires **per-avatar material instances** (or at minimum per-color-value instances, reused across avatars that happen to share a color), not a global palette swap on the existing shared materials.

Body-part mapping for the user's ask ("hands, legs, head, torso"):
- **torso** → `torso` mesh (currently `bodyMaterial`)
- **head** → `head` mesh (currently `headMaterial`) — do **not** recolor the `face` mesh (eyes/mouth accent, stays as-is)
- **hands** → `leftArm`/`rightArm` meshes (currently share `limbMaterial` with legs — needs splitting into an arm-specific material)
- **legs** → `leftLeg`/`rightLeg` meshes (currently share `limbMaterial` with arms — needs splitting into a leg-specific material)

## 3. Story 33.1 — Palette + protocol

- Define a small fixed palette in a new shared module, e.g. `shared/src/avatar.ts`: `AVATAR_COLOR_PALETTE: readonly number[]` (6-8 hex colors, colorful/readable, consistent with the game's existing low-poly bright palette — reuse colors already established elsewhere in the codebase where sensible, e.g. weapon/pickup colors, for visual family resemblance, Programmer's call on exact hex values). Export a `AvatarBodyPart = "head" | "torso" | "hands" | "legs"` type and an `AvatarColors` interface (`Record<AvatarBodyPart, number>`, values are **palette indices**, not raw hex, to keep the wire payload tiny and keep the palette itself as the single source of truth for what's a valid color).
- Extend `PlayerState` (`shared/src/index.ts`) with `avatarColors: AvatarColors` — cosmetic-only, server-computed, same precedent/doc-comment style as `equippedPetTypes`.
- New client→server WS message, e.g. `avatar_set_color { part: AvatarBodyPart, paletteIndex: number }` — server validates `part` is one of the 4 known values and `paletteIndex` is in-range for `AVATAR_COLOR_PALETTE`; reject/ignore anything else (never trust the client's claimed color into the broadcast without this validation).

## 4. Story 33.2 — Server: persistence + validation + broadcast

- New lightweight, clearly-separate persistence store (do **not** fold this into `EconomyStore`/the economy Redis documents — this is not currency/items, and must stay outside whatever pool-scoping the Deathmatch/Sandbox economy split (EPIC 35, if/when confirmed) ends up applying to). A small Redis-backed key per nickname is sufficient, e.g. `cw:avatar:v1:<nicknameKey>` — reuse the same Redis connection the economy store already uses (same `redis://` config), just a separate key namespace/module (e.g. `server/src/avatarProfile.ts`), so this doesn't require a second infra dependency.
- On `avatar_set_color`, validate + persist + update the live `PlayerRecord`'s `avatarColors` + it flows into the next `WorldStateMessage` broadcast automatically (same mechanism as `equippedWeapon`).
- On join, load the player's persisted `avatarColors` (default: some fixed default palette index per part, e.g. index 0 everywhere, if never customized) into their `PlayerRecord`.
- Log color changes at a reasonable level (not spammy) — a single line per successful `avatar_set_color`, matching the logging style used for `economy_*` action results.

## 5. Story 33.3 — Client: customization UI + avatar rendering

- Small UI: 4 rows (head/torso/hands/legs) × palette swatches, click a swatch to select — place inside the existing inventory overlay (`client/src/inventoryOverlay.ts`, toggled with `I`) as a new "Appearance" section, reusing its existing panel chrome/styling rather than a new screen (Programmer's call if a different placement is clearly better, but must not require a new full-screen overlay system).
- `client/src/remotePlayers.ts`: split the avatar-building/updating code so each avatar instance gets **its own** material instances for torso/head/arms/legs (split `limbMaterial` into an arm material and a leg material) driven by that player's `PlayerState.avatarColors` — reusing one shared material instance across avatars that currently share the exact same palette index is a fine, cheap optimization (Programmer's call), but a color change for one player must never visually affect another avatar.
- Apply/update colors whenever `PlayerState.avatarColors` changes for a given player (including the local player's own avatar, if/when it's ever rendered — today the local player doesn't see their own third-person avatar per the existing first-person-only design, confirm this is still true and scope accordingly; the viewmodel (`viewmodel.ts`) is **not** in scope here, it has no body-part meshes).

## 6. Story 33.4 — Bots get random colors (Part D)

- `server/src/botAI.ts`: at bot spawn (both `spawnBots()` and `spawnBotAt()`), alongside the existing EPIC 31 loadout-archetype assignment, generate a random `AvatarColors` (independently random palette index per body part, or a single random index applied to all 4 parts for a more "one clear color" look — Programmer's call, state the choice) and set it on the bot's `PlayerRecord`, in-memory only (no persistence — bots are ephemeral, matching EPIC 31's precedent exactly). Fixed for that bot's lifetime, same as its loadout archetype.
- No behavior change to bot AI targeting/movement.

## 7. Out of scope

- Full color picker / arbitrary hex input — fixed palette only.
- New avatar geometry — material-color changes only, on existing EPIC 17 meshes.
- Skin-tone/face customization.
- Any interaction with the economy/gold/item system or the Deathmatch/Sandbox pool split (EPIC 35).

## 8. Tasks

| # | Task | Place |
|---|------|-------|
| 33.1 | Palette constant + `AvatarColors`/`AvatarBodyPart` types + `avatar_set_color` message type | `shared/src/avatar.ts`, `shared/src/index.ts` |
| 33.2 | Avatar-color store (new, Redis-backed, separate from EconomyStore) | `server/src/avatarProfile.ts` (or similar) |
| 33.3 | WS handler: validate + persist + apply to `PlayerRecord` | `server/src/index.ts`, `server/src/playerRegistry.ts` |
| 33.4 | Broadcast `avatarColors` in `PlayerState`/`WorldStateMessage` | `server/src/match.ts` |
| 33.5 | Bot random color assignment at spawn | `server/src/botAI.ts` |
| 33.6 | Client: per-avatar material instances (split shared singletons), apply `avatarColors` | `client/src/remotePlayers.ts` |
| 33.7 | Client: "Appearance" palette-swatch UI in inventory overlay | `client/src/inventoryOverlay.ts`, `client/index.html` |
| 33.8 | Live verification + regression: color persists across reconnect, other clients see it, bots show varied colors, illegal `avatar_set_color` payloads rejected server-side | `scripts/`, `qa-artifacts/epic-33/` |

**Branch:** `task/epic-33-avatar-color-customization`
**Base:** `master` (tip at task start: `d1738e2`)

## 9. Acceptance criteria

- [ ] `npm run typecheck` / `build` PASS
- [ ] A player can set a color per body part (head/torso/hands/legs) from the palette; persists across reconnect (same nickname)
- [ ] Color choice is visible to **other** connected clients (not just self) — live two-client verification, screenshot evidence
- [ ] Changing one player's color does not affect any other avatar's rendered color (regression against the shared-material bug described in Section 2)
- [ ] Server rejects an out-of-range `paletteIndex` or invalid `part` without crashing or corrupting state
- [ ] Bots spawn with randomized colors (varied across multiple bot spawns) — server-side evidence (log line) + screenshot
- [ ] No change to economy/gold/item persistence or protocol; avatar-color storage is a separate module/key namespace from `EconomyStore`
- [ ] No regression to movement/jump/shoot/existing avatar rendering (weapon prop, pet orbs, amulet pendant from EPIC 17/31 still render correctly alongside the new coloring)

## 10. Risks

- Splitting shared materials into per-avatar instances touches rendering code shared by every avatar (human and bot) — regression risk to EPIC 17/31's existing visuals if done carelessly; QA must screenshot before/after.
- Palette-index wire format is small and cheap; no meaningful payload-size risk.

## 11. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25
- **Assignee:** Programmer (Pusya)
