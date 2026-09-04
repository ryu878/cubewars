# EPIC 60 — Modern weapon hold, pickups & avatar polish

## Context

Player feedback (RU): update models to look more modern/beautiful; weapons should look cooler and clearly held (pistol = one hand, rifle / grenade launcher = two hands) instead of floating; ground weapon pickups must match the new weapon design; armor pickups on the map must read clearly as armor.

## Architecture

Client-only cosmetics (Three.js). No server authority / protocol / combat changes.

| Area | Files |
|------|--------|
| FP viewmodel + hands | `client/src/viewmodel.ts` |
| Remote held weapons + body polish | `client/src/remotePlayers.ts` |
| World pickups (weapons + armor) | `client/src/pickups.ts` |
| Shared colors (optional reuse) | `shared/src/pickups.ts`, `shared/src/weapons.ts` (colors only if needed; no gameplay stats) |
| About / changelog | `client/public/about.html`, `client/public/changelog.json` |

Stack: Three.js/TS client + Vite. No new assets/GLTF required — keep box/cylinder composite style, but richer and more readable. No Rapier.

## Design goals

1. **Held weapons (FP):** Visible low-poly hand(s). Pistol = right hand grip. Rifle and grenade launcher = two-hand grip (right on grip, left on foregrip/barrel). Weapon must not float mid-air with empty space under it.
2. **Weapon silhouettes:** More modern, readable shapes (distinct pistol vs rifle vs GL); multi-material gunmetal + accent (keep weapon identity colors from `WEAPON_STATS` / existing palette).
3. **Shared visual language:** FP viewmodel, remote held props, and ground weapon pickups must share the same silhouette family (same builders or shared helper module e.g. `client/src/weaponMeshes.ts`).
4. **Remote hold:** Parent weapon to the right arm (or sync transform each frame) so run/stand poses keep the gun in hand; rifle/GL show a two-hand pose (left arm toward foregrip).
5. **Armor pickup:** Instantly readable as armor — breastplate / vest with straps, pads, helmet-hint or clear shield-plate silhouette; not a vague blue box. Keep distinct from health (red cross).
6. **Avatar polish:** Slightly more modern remote humanoid (cleaner proportions, subtle bevel/detail parts) without breaking avatar color parts (`AvatarBodyPart`). Local player remains FPS (no full-body self-view).

## Stories

### Story 60.1 — Shared weapon mesh builders

- Extract or unify pistol / rifle / grenade_launcher mesh builders used by viewmodel, remote props, and pickups.
- Scale/orientation variants: FP (camera), TP (avatar hand), world ground (y-lifted).
- Keep materials disposable / no leaks on weapon swap.

### Story 60.2 — FP hands + hold poses

- Add right-hand mesh for pistol; both hands for rifle + grenade_launcher.
- Grip sockets so the weapon sits in the palm; tune `VIEWMODEL_BASE_POSITION` / per-weapon offsets.
- Preserve sway / recoil / muzzle flash from EPIC 10/30.

### Story 60.3 — Remote hold + two-hand poses

- Attach weapon to right arm hierarchy.
- Rifle / GL: left arm posed toward foregrip (cosmetic, no IK solver required — fixed pose offsets).
- Pistol: one-hand right-arm pose.

### Story 60.4 — Armor + weapon world pickups

- Rebuild armor pickup as clear vest/breastplate (straps, plates, optional shoulder pads).
- Rebuild weapon pickups from shared builders so they match held weapons.
- Health / ammo crates unchanged unless needed for contrast.

### Story 60.5 — Avatar visual refresh

- Polish remote avatar proportions / detail (head, torso, limbs) while keeping color customization and pet/amulet attachment points.
- Do not change hitbox / collision (server still cylinder/AABB; client mesh is cosmetic).

### Story 60.6 — Docs

- Update About (RU/EN) briefly if player-facing visuals of pickups/weapons are described.
- Changelog entry for EPIC 60.

## Tasks (Programmer)

1. **T60.1** Shared `weaponMeshes` (or equivalent) + wire viewmodel / remotes / pickups.
2. **T60.2** FP hands + hold poses.
3. **T60.3** Remote arm-parented weapons + two-hand poses.
4. **T60.4** Armor pickup redesign.
5. **T60.5** Avatar mesh polish.
6. **T60.6** About + changelog; smoke screenshots for Tester.

Branch: `feature/epic-60-weapon-hold-visual-polish` from `master`.

## Acceptance criteria

- [ ] FP pistol clearly held in one hand; rifle and grenade launcher clearly held with two hands (hands visible).
- [ ] Weapons no longer read as floating unsupported in FP view.
- [ ] Ground weapon pickups match the new held weapon silhouettes (same family).
- [ ] Armor pickup is obviously armor (vest/plate), distinct from health and ammo.
- [ ] Remote players show weapons attached to hands with sensible one/two-hand poses.
- [ ] Avatar color customization still works; pets/amulets still attach.
- [ ] No gameplay/protocol/server combat changes; `npm` client+server build OK.
- [ ] About / changelog updated; Tester PASS + Critic APPROVED (or Judge ALL_CLOSED) before merge.
- [ ] Deploy to https://cubewars.ru/ after merge.

## Risks

- Over-detailed meshes → fillrate / draw calls on low-end; keep primitive counts modest.
- Parenting weapon to arm can break if pivot wrong — verify standing + running poses.
- Shared builder orientation mistakes → upside-down ground pickups; add per-context transforms.

## Out of scope

- GLTF / external asset pipeline.
- New weapon types.
- Changing damage, cooldowns, or pickup spawn counts.
- First-person full body / legs.
