# EPIC 17: Animated Humanoid Player Avatars

## 1. EPIC

| Field | Value |
|---|---|
| **Name** | Animated Humanoid Player Avatars |
| **System goal** | Replace remote-player capsule placeholders with readable low-poly humanoid avatars for humans and bots. |
| **Business/gameplay problem** | Players currently see only capsule silhouettes, so it is hard to tell whether another player/bot is facing toward them, standing still, running, or which weapon is being held. |
| **Architectural role** | Client rendering and animation, plus a small shared/server world-state field for currently equipped weapon. |
| **Main components** | `shared/src/index.ts`, `server/src/playerRegistry.ts`, `client/src/remotePlayers.ts`, `client/src/main.ts`, QA script/docs. |
| **Stack** | Fixed stack unchanged: Three.js + TypeScript client, Node.js + TypeScript server, shared TypeScript protocol. No new dependency. |
| **Interaction with other components** | The server adds `equippedWeapon` to each `PlayerState` from authoritative loadout state. The client renders that as a held weapon prop; movement animation is inferred client-side from world-state position deltas. |

## 2. Story 17.1 — Weapon-aware remote player state

**As a** client renderer  
**I want** each `PlayerState` to include the server-authoritative equipped weapon  
**So that** every visible player and bot can render the correct held weapon.

### Acceptance criteria

- [ ] `PlayerState` includes `equippedWeapon: WeaponType`.
- [ ] `PlayerRegistry.toWorldState()` populates the field from the authoritative `PlayerRecord.equippedWeapon`.
- [ ] No client message is added that lets a client claim another weapon.
- [ ] The field is documented as an intentional visual information reveal.

## 3. Story 17.2 — Humanoid avatar renderer

**As a** player  
**I want** remote players and bots to have a head, torso, arms, legs, and held weapon  
**So that** their facing direction and equipment are understandable at a glance.

### Acceptance criteria

- [ ] Remote capsules are replaced by a grouped low-poly humanoid model.
- [ ] The model has distinct legs, arms, torso, head, and face markers on the front.
- [ ] A weapon prop is visible in-hand and differs for pistol, rifle, and grenade launcher.
- [ ] The avatar rotates by server yaw so front/side/back are visually distinct.
- [ ] Dead players remain hidden and disconnected players are removed.

## 4. Story 17.3 — Simple run/stand animation

**As a** player  
**I want** avatars to show whether they are standing or running  
**So that** bot/player movement reads better without requiring a complex animation system.

### Acceptance criteria

- [ ] Standing avatars have a stable neutral stance.
- [ ] Moving avatars alternate leg lengths/positions and swing arms in opposite phase.
- [ ] Running is inferred from received world-state position deltas, not from a new trusted client field.
- [ ] Animation runs for both humans and bots because both are represented as `PlayerState`.
- [ ] Animation remains purely cosmetic and does not affect hitboxes or collision.

## 5. Tasks

| # | Task | Expected result | Place in code/service | Completion criterion |
|---|---|---|---|---|
| 1 | Add equipped weapon to world state | Remote renderer has authoritative weapon data | `shared/src/index.ts`, `server/src/playerRegistry.ts` | Typecheck passes; world-state payload includes `equippedWeapon` |
| 2 | Replace capsule renderer with humanoid avatar | Distinct body parts and facing direction | `client/src/remotePlayers.ts` | Remote avatars render as grouped models with face markers |
| 3 | Add held weapon props | Pistol/rifle/grenade launcher are visually different | `client/src/remotePlayers.ts` | Weapon model changes when `PlayerState.equippedWeapon` changes |
| 4 | Add simple movement animation | Stand/run states are distinguishable | `client/src/remotePlayers.ts`, `client/src/main.ts` | Renderer `update(dt)` advances run cycle; sync infers running from deltas |
| 5 | Add verification script/docs | Reproducible evidence for avatar hierarchy and state changes | `scripts/qa-epic17-avatar-selfcheck.mjs`, docs | Script exits 0 and captures screenshot evidence |

## 6. Risks

- Broadcasting `equippedWeapon` reveals the currently-held weapon before a player fires. This is accepted for this EPIC because the user explicitly asked for visible held weapons and EPIC 14 already accepts a weapon reveal on fire broadcasts. No aim, ammo, inventory, hit outcome, or hidden pickup state is added.
- Animation inferred from 20Hz position deltas can briefly classify reconciliation snaps as movement. The threshold should be conservative and the effect is cosmetic only.
- The rendered humanoid does not change server hitboxes; hitscan still uses the existing server-side AABB approximation.

## Sign-off

- **Specification (author):** Team Lead (Tusya), 2026-08-06
- **Approval (Team Lead):** Team Lead (Tusya), 2026-08-06
- **Assignee:** Programmer (Pusya)
