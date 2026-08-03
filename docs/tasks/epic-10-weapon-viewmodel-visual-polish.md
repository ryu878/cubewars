# EPIC 10: Weapon Viewmodel, Visual Polish & Damage Rebalance

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Weapon Viewmodel, Visual Polish & Damage Rebalance |
| **System goal** | Three user-requested changes bundled because they touch the same client-visual surface: (1) a visible, animated first-person weapon model so the player can tell what's equipped at a glance, not just from the HUD text; (2) a general visual upgrade — textured walls (wood/brick) instead of flat colors, a nicer sky, more visual interest overall; (3) a full damage rebalance to slow down time-to-kill, which the user reported feels too fast. |
| **Business/gameplay problem** | User feedback, verbatim: weapon isn't visually identifiable beyond the HUD text; the arena looks flat/plain; combat kills too fast to feel fair or fun. |
| **Architectural role** | client (viewmodel rendering/animation, materials/textures/sky) + shared (damage constants — single source of truth already exists in `WEAPON_STATS`, `shared/src/weapons.ts`) |
| **Main components** | `client/`, `shared/` |
| **Stack** | Fixed project stack. Textures are procedurally generated at runtime via the browser's 2D Canvas API into `THREE.CanvasTexture` — **no new dependency, no external asset files/pipeline**, staying inside the fixed stack. |
| **Interaction with other components** | Damage change touches `shared/src/weapons.ts`'s `WEAPON_STATS` — the same single table both client HUD and server `fire()` resolution already read, so this is a constants-only change, not new logic. Viewmodel and wall textures are additive client-only changes; the wall texturing must not alter arena geometry/collision (`shared/src/mapData.ts`'s `ARENA_GEOMETRY` boxes are unchanged — this is a materials-only change, `shared/src/collision.ts` must not need to change at all). |

## 2. Damage rebalance (fixed by Team Lead — replaces the EPIC 6 table)

User reported dying too fast and asked for the time-to-kill to be much longer, giving target hit-counts (with some flexibility — "or figure it out yourself"). New values, all measured against `COMBAT.maxHealth = 100`:

| Weapon | Old damage/hit | New damage/hit | Hits to kill (full HP, no armor) | Rationale |
|---|---|---|---|---|
| Pistol | 25 | **5** | 20 | User asked for ~20 |
| Rifle | 50 | **20** | 5 | User asked for ~5 |
| Grenade launcher | 100 | **70** | 2 (often 1 if the target is already chipped by prior pistol/rifle hits) | User asked for "~1.5" — not a literal integer, so implemented as: guaranteed 2-hit kill from full health, but frequently a 1-hit finisher in real play once a target has taken any prior damage. This is the practical way to realize a non-integer "shots to kill." |

- **Only the damage values change.** Fire cooldowns (300/250/1500ms), ammo economy (ammoPerPickup/maxAmmo), and every other weapon/pickup/armor mechanic from EPICs 6-9 are unchanged.
- Armor absorption math (`armor first, then spillover to health`, EPIC 7) is unchanged — it now just takes more hits to burn through 100 armor at the new lower per-hit damage, which is a reasonable side effect of a slower-TTK design, not something to compensate for separately.
- Update `docs/tasks/epic-06-weapons-ammo.md`'s balance table with a note pointing to this EPIC as the current source of truth (don't leave two contradictory tables — Programmer's call on the cleanest way to note this, e.g. a one-line "superseded by EPIC 10" annotation).

## 3. Story 10.1 — Weapon viewmodel with animation

**As a** player **I want** to see my currently-equipped weapon rendered in-view **so that** I know what I have without reading HUD text.

- **Outputs:** a simple low-poly first-person weapon model (reuse the existing per-weapon color coding already established for pickups/HUD — pistol grey, rifle orange, grenade launcher red/purple — so the viewmodel, the world pickup, and the HUD text all agree at a glance), positioned in the lower-right of the view like a typical FPS, attached to the camera so it moves with look direction.
  - The model swaps shape/color when the equipped weapon changes (reacting to the same `LoadoutMessage`/`world_state` data already driving the HUD — no new server message needed).
  - **Idle animation:** a subtle sway/bob (e.g. a small sine-wave offset tied to time and/or movement speed) so it doesn't look static — should read as "held," not "stapled to the screen."
  - **Fire animation:** a quick recoil kick (moves back/up briefly, eases back to rest) synced with the existing muzzle-flash trigger (`client/src/combatHud.ts`'s `onFire` path) — reuse that trigger, don't add a second one.
  - **Weapon-distinct fire feedback (user's explicit follow-up ask — "add a shooting animation so it's clear what you're shooting from, it's completely unclear right now"):** the current muzzle flash is a single generic effect regardless of weapon. Make it visibly different per weapon so a player (and anyone watching) can tell what was just fired without reading the HUD: e.g. pistol = small quick yellow-white flash; rifle = brighter/larger flash, possibly with a slight muzzle-smoke puff; grenade launcher = a noticeably bigger, distinct-colored blast flash (matching its red/purple identity) with a stronger viewmodel recoil kick to match its heavier feel. This must be visible both from the shooter's own screen (viewmodel + flash) and ideally give *some* signal to other nearby players too (Programmer's call on scope — at minimum the shooter's own experience must clearly read as "which weapon," that's the hard requirement; a bystander-visible cue is a nice-to-have if cheap, not required).
  - **Empty-weapon feedback:** when the equipped weapon has 0 ammo (existing "EMPTY" HUD state), give the viewmodel some matching subtle visual cue (e.g. dimmed material) — Programmer's call on exact treatment, keep it simple.
- **Acceptance criteria:**
  - [ ] Viewmodel is visible whenever a weapon is equipped, correct shape/color for pistol/rifle/grenade launcher
  - [ ] Switching weapon (`E`) visibly changes the viewmodel immediately
  - [ ] Idle sway is visible during normal movement (not a static prop)
  - [ ] Firing visibly kicks the viewmodel, synced with the existing muzzle flash
  - [ ] Firing pistol vs. rifle vs. grenade launcher produces **visibly different** fire feedback (flash size/color, recoil strength) — a player should be able to tell which weapon was just fired from the visual alone, without reading the HUD

## 4. Story 10.2 — Visual polish: textured walls, nicer sky

**As a** player **I want** the arena to look more interesting **so that** it doesn't feel flat/placeholder.

- **Outputs:**
  - Two procedurally-generated textures (Canvas 2D → `THREE.CanvasTexture`, tiled via UV repeat): a **wood** texture (plank pattern with grain lines, warm brown tones) and a **brick** texture (brick pattern with mortar lines, reddish tones) — matching the user's explicit request ("деревянные стены или часть кирпичные" — wood walls, or some brick).
  - Apply these across `ARENA_GEOMETRY`'s wall/crate meshes in `client/src/main.ts` — some walls wood, some brick, for variety (Programmer's call on exact assignment, e.g. by wall id or a deterministic pattern — just not uniformly one texture on literally everything, that would defeat the "variety" goal).
  - A nicer sky than the current flat color fill — e.g. a simple vertical gradient (a large inverted sphere with a vertex-colored gradient material is a standard cheap Three.js technique, no new dependency) — lighter blue at the top, warmer near the horizon.
  - Keep the existing colorful low-poly "Roblox-like" direction — this is a polish pass, not a re-theme. Ground/crate/player-capsule colors can stay as-is unless Programmer judges a small complementary tweak genuinely improves cohesion with the new wall textures.
- **Acceptance criteria:**
  - [ ] At least one wall segment renders with a visible wood-plank texture, at least one with a visible brick texture (not just flat colors)
  - [ ] Sky is a visible gradient, not a flat fill
  - [ ] No FPS/performance regression perceptible in manual testing (procedural canvas textures are generated once at load, not per-frame — don't regenerate them in the render loop)
  - [ ] Arena remains readable/navigable — texturing must not make walls harder to distinguish from open space or from each other in ways that hurt gameplay (e.g. don't camouflage a wall against the ground)

## 5. Story 10.3 — Recognizable pickup shapes (weapons & armor)

**As a** player **I want** weapon and armor pickups on the ground to be visually distinct from each other by shape, not just color **so that** I can tell what I'm about to pick up before I'm standing on it.

- **Problem:** current world pickups (`client/src/pickups.ts`, from EPICs 6-7) are simple primitive shapes (pillars/boxes) that mainly differ by color — user reports it's unclear what's on the ground. Ammo/health pickups already read reasonably per earlier QA (small crates vs. a health cross) and are lower priority; the ask is specifically weapons and armor.
- **Outputs:** redesign the weapon and armor pickup meshes as small **composite** shapes assembled from combined primitives (box + box + cylinder, etc. — still low-poly/procedural, no external model loading, staying inside the fixed stack) so each reads as a distinct silhouette, not just a differently-colored blob:
  - Pistol pickup: a compact, small silhouette (e.g. a short grip block + a slim barrel box) — reads as "small weapon."
  - Rifle pickup: a longer, more elongated silhouette (e.g. a longer barrel + a stock) — visibly bigger/longer than the pistol shape.
  - Grenade launcher pickup: a bulkier, distinct silhouette (e.g. a thicker barrel/tube shape) — reads as "heavy weapon."
  - Armor pickup: replace (or clearly enhance) the current octahedron with something that reads more like "armor" at a glance — e.g. a chest-plate-like faceted shape — Programmer's call on the exact geometry, the goal is "looks like armor," not a specific implementation.
  - Keep the existing per-category color coding (pistol grey, rifle orange, grenade launcher red/purple, armor steel-blue) — this task is about **shape** clarity on top of the color clarity that already exists, not replacing it.
- **Acceptance criteria:**
  - [ ] Pistol, rifle, and grenade launcher pickups are each visually distinguishable by silhouette alone (not just color) from a normal play-distance screenshot
  - [ ] Armor pickup reads more clearly as "armor" than the current plain octahedron
  - [ ] No change to pickup collision/proximity radius or any gameplay logic — this is a mesh-only change (`client/src/pickups.ts`), the server doesn't know or care what shape a pickup renders as

## 6. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `shared/`: update `WEAPON_STATS` damage values | 5/20/70 per Section 2 | `shared/src/weapons.ts` | server `fire()` and client HUD both reflect new values automatically (single source) |
| 2 | Client: weapon viewmodel meshes + camera attachment | per-weapon shape/color, positioned lower-right | `client/src/` (new file suggested, e.g. `client/src/viewmodel.ts`) | visible in-game for all 3 weapons |
| 3 | Client: idle sway + fire recoil animation | smooth, non-jarring | same file | visible during movement and on fire, synced with existing muzzle-flash trigger |
| 4 | Client: procedural wood/brick textures + wall assignment | `THREE.CanvasTexture`s, applied to `ARENA_GEOMETRY` meshes | `client/src/main.ts` (or a new `client/src/textures.ts`) | both textures visible in-game on real wall segments |
| 5 | Client: gradient sky | replaces flat `scene.background` fill | `client/src/main.ts` | visible gradient in-game |
| 6 | Docs: reconcile EPIC 6's balance table with this EPIC's | one-line supersession note, no contradictory tables left | `docs/tasks/epic-06-weapons-ammo.md` | note present |
| 7 | Client: per-weapon distinct fire flash (color/size) + stronger GL recoil | pistol/rifle/GL fire feedback visibly different from each other | same viewmodel file | a viewer can identify the weapon from the fire effect alone |
| 8 | Client: composite (multi-primitive) pickup meshes for weapons + armor | distinct silhouettes per weapon tier, clearer armor shape | `client/src/pickups.ts` | distinguishable at a glance in a screenshot, no gameplay/collision change |

## 7. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Pistol/rifle/grenade launcher deal exactly 5/20/70 damage per hit (server-authoritative, unchanged resolution logic, only the constants moved)
- [ ] Weapon viewmodel visible, correct per equipped weapon, animated (idle sway + fire recoil), matches established per-weapon color coding
- [ ] Fire feedback (flash/recoil) is visibly distinct per weapon — identifiable without the HUD
- [ ] World pickups for weapons and armor are distinguishable by shape, not just color
- [ ] Walls show real wood/brick textures, not flat colors; sky is a gradient
- [ ] No regression to EPICs 1-9 — this is a client-visual + one-constants-table change, but budget a real (if lighter than EPIC 9's) regression pass since `main.ts` (scene setup) is touched
- [ ] No TypeScript build errors; `npm run build` / `npm run typecheck` pass
- [ ] Tester's Gameplay & feel section includes: viewmodel screenshots for all 3 weapons (including one mid-fire-recoil if capturable) showing the distinct fire feedback, screenshots of the new weapon/armor pickup shapes, a wood wall, a brick wall, the gradient sky, and a kill sequence showing the new hit-count-to-kill (e.g. server log of ~20 pistol hits landing before a death, or the equivalent for rifle/GL)

## 8. Risks

- Viewmodel positioning/animation is purely cosmetic (client-only) — confirm it introduces no new client-trusted gameplay state (it shouldn't; it's driven entirely by data the client already receives for the HUD).
- Procedural canvas textures must be generated once (e.g. at module load / scene setup), not regenerated per frame — a naive implementation that re-draws the canvas every render tick would be a real, if subtle, performance regression. Critic should specifically check this.
- The rebalance is a large TTK (time-to-kill) shift — Critic/Tester should sanity-check it doesn't make the grenade launcher (2-hit-kill, 1500ms cooldown, 6 max ammo) feel weirdly weak relative to its scarcity, but per the user's explicit request this is the intended direction; don't second-guess the core ask, just verify the numbers are implemented as specified.
- Wall texture assignment must not accidentally make a wall visually blend into the ground/sky in a way that hurts navigation — a genuine (if minor) gameplay-readability risk from a visual-only change, worth a specific check.
- New composite pickup meshes must not change the pickup's effective world footprint in a way that misleads the player about pickup radius (`PICKUP_RADIUS` itself is unchanged — purely a mesh swap) — Critic should confirm the visual size is a reasonable match for the actual (unchanged) proximity radius.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
