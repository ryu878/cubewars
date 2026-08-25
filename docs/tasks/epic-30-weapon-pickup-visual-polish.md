# EPIC 30: Weapon Viewmodel & Pickup Visual Polish (Round 2)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).
User ask, verbatim intent: weapons should "look nice" both held (first-person viewmodel) and as world pickups; armor should "look normal" as a world pickup, not read as a generic colored primitive.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Weapon Viewmodel & Pickup Visual Polish (Round 2) |
| **System goal** | Improve the procedural Three.js geometry/materials of (a) the first-person held weapon viewmodels, (b) world weapon/ammo pickups, and (c) the world armor pickup, so all read as clearly distinct, decent-looking objects at a glance — building on the EPIC 10 pass (`docs/tasks/epic-10-weapon-viewmodel-visual-polish.md`), which established colored box/cylinder composites but user feedback says these still look crude, and the armor pickup specifically still reads as "a generic colored shape," not "armor." |
| **Business/gameplay problem** | User feedback after playing: weapons (viewmodel + world pickups) don't look nice; armor pickup doesn't look like armor. |
| **Architectural role** | client-only, purely cosmetic. No gameplay/protocol/server changes. |
| **Main components** | `client/src/viewmodel.ts`, `client/src/pickups.ts` |
| **Stack** | Fixed project stack (Three.js/TS client). Procedural geometry/materials only — **no new asset pipeline, no external model/texture files, no new dependency.** Same pattern already used in `client/src/remotePlayers.ts` (humanoid avatars built from primitives) and the existing `pickups.ts`/`viewmodel.ts` composite-mesh approach. |
| **Interaction with other components** | None — `PICKUP_RADIUS`, collision, `WEAPON_STATS` colors, and all proximity/pickup logic in `shared/` and `server/` are untouched; this is mesh/material-only. Reuses the existing color identity per weapon (`WEAPON_STATS[...].color`) and per pickup category (`HEALTH_PICKUP_COLOR`, `ARMOR_PICKUP_COLOR` in `shared/src/pickups.ts`) so viewmodel/world-pickup/HUD color-coding stays consistent — do not introduce new colors that break that existing identity unless there's a good reason, and note it if so. |

## 2. Current state (read before implementing — do not assume this summary is complete)

- `client/src/viewmodel.ts`: each weapon (`buildPistolVisual`/`buildRifleVisual`/`buildGrenadeLauncherVisual`) is 2-3 `BoxGeometry`/`CylinderGeometry` primitives sharing one flat-color `MeshStandardMaterial`, plus a separate flash mesh. Functional (sway, recoil, empty-dim) but visually plain — no secondary color/material accents, no distinguishing details (sights, grip texture, magazine, etc.).
- `client/src/pickups.ts`: `buildWeaponPickupMesh()` mirrors the same primitive-composite approach for world pickups (glowing emissive material). Ammo pickups are a single plain crate box. Armor (`category === "armor"`) is a hex-plate cylinder + a sphere "boss" — already one step beyond a plain octahedron (per EPIC 10), but still reads as an abstract faceted shape rather than "armor."

## 3. Story 30.1 — Viewmodel visual upgrade

**As a** player **I want** my held weapon to look like a distinct, decent weapon **so that** first-person view feels good, not crude.

- Add secondary materials/color accents per weapon (e.g. a darker grip/stock accent color distinct from the primary body color, a metallic barrel tip, a small highlight/sight detail) — multi-material composites, not a single flat color per weapon.
- Add 1-3 extra geometric details per weapon that reinforce its identity (e.g. pistol: sight nub + trigger guard; rifle: foregrip + a magazine block; grenade launcher: a chunky front sight/handle + visible barrel rim) — stay low-poly/blocky, consistent with the game's established Roblox-like art direction (see `client/src/remotePlayers.ts` for the house style: simple primitives, flat/bright colors, no smooth organic curves).
- Preserve all existing behavior: idle sway, per-weapon recoil kick, per-weapon muzzle flash, empty-ammo dim state (`setEmpty`) — these must keep working unchanged; this task only touches the geometry/material construction (`build*Visual()` functions and `WeaponVisual.materials` tracking), not `update()`/`triggerFire()`/`setEmpty()` logic.

## 4. Story 30.2 — World weapon/ammo pickup visual upgrade

**As a** player **I want** weapon/ammo pickups on the map to look appealing **so that** the world doesn't look plain.

- Apply an equivalent multi-material/multi-detail upgrade to `buildWeaponPickupMesh()` (mirror the viewmodel identity per weapon where sensible — same silhouette language, not necessarily identical geometry).
- Ammo pickup crate: at minimum a second accent material (e.g. a lid/stripe in the weapon's color on a neutral crate body) so it's visually more interesting than a flat single-color box, while staying clearly smaller/more mundane than the weapon pickup itself (existing "ammo reads as smaller/plainer than weapon" rule from EPIC 6/10 must hold).
- Optional (nice-to-have, your call, only if cheap): a subtle idle animation (slow spin and/or bob) on pickups for visual appeal — must not affect `PICKUP_RADIUS`/proximity/pickup logic (purely a render-loop transform on the mesh), and must not be added if it risks scope creep on this task's time budget. Not required for acceptance.

## 5. Story 30.3 — Armor pickup reads as "armor"

**As a** player **I want** the armor pickup to clearly look like armor, not a generic colored shape.

- Redesign `buildMesh("armor", ...)` in `client/src/pickups.ts` into something that reads unambiguously as an armor/chestplate/shield object — e.g. a rounded/beveled plate silhouette with a visible strap or rivet/stud details, or a small shield-like shape with a raised center ridge — using the existing `ARMOR_PICKUP_COLOR` (steel blue) as the base, with a secondary accent material for straps/rivets/trim.
- Keep it visually distinct from every weapon pickup, the ammo crate, and the health medkit (existing distinct-shape-and-color rule from EPIC 7/10 must hold).

## 6. Out of scope

- Any new asset files, textures, or external model pipeline.
- Any change to `PICKUP_SPAWN_POINTS`, pickup radius, collision, or server-side pickup state.
- Wall/sky visual polish (already covered by EPIC 10) — not touched here.

## 7. Tasks

| # | Task | Place |
|---|------|-------|
| 30.1 | Upgrade `buildPistolVisual`/`buildRifleVisual`/`buildGrenadeLauncherVisual` with secondary materials + extra detail geometry | `client/src/viewmodel.ts` |
| 30.2 | Upgrade `buildWeaponPickupMesh` (weapon world pickups) + ammo crate accent material | `client/src/pickups.ts` |
| 30.3 | Redesign armor world pickup mesh to read as armor (straps/rivets/plate silhouette) | `client/src/pickups.ts` |
| 30.4 | Playwright screenshot evidence: viewmodel (all 3 weapons equipped in turn) + world pickups (weapon/ammo/armor/health side by side) before/after comparison notes | `scripts/`, `qa-artifacts/epic-30/` |

**Branch:** `task/epic-30-weapon-pickup-visual-polish`
**Base:** `master` (tip at task start: `99175fe`)

## 8. Acceptance criteria

- [ ] `npm run typecheck` / `build` (client workspace) PASS
- [ ] No gameplay/protocol/server files touched (diff confined to `client/src/viewmodel.ts`, `client/src/pickups.ts`, and QA script/docs)
- [ ] Viewmodel: all 3 weapons visually distinguishable at a glance, each with more than a single flat-color primitive composite (multi-material/multi-detail) — screenshot evidence for pistol, rifle, grenade launcher equipped
- [ ] World weapon pickups upgraded similarly; ammo crate has a visible accent detail — screenshot evidence
- [ ] Armor world pickup clearly reads as "armor" (not a generic colored primitive) — screenshot evidence, before/after comparison note in the report
- [ ] Existing viewmodel behavior (sway, recoil kick, muzzle flash, empty-ammo dim) unaffected — verified live (not just code read)
- [ ] No console errors introduced; scene renders without missing textures/black meshes
- [ ] No regression to movement/jump/shoot (spot-check per `ai-office/checklists/qa-checklist.md` Gameplay & Feel section)

## 9. Risks

- Over-detailing could push poly count up — keep within the existing low-poly budget (a handful of primitives per object, same order of magnitude as the current implementation, not a jump to dozens of primitives).
- Must not accidentally change any pickup's collision/interaction radius (visual-only; radius lives in server/shared, untouched).

## 10. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-24
- **Assignee:** Programmer (Pusya)
