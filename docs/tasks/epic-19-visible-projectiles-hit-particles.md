# EPIC 19: Visible Projectiles and Hit Particles

## 1. EPIC

| Field | Value |
|---|---|
| **Name** | Visible Projectiles and Hit Particles |
| **System goal** | Make shots readable in-world for the local player and other players, and make confirmed hits visibly obvious at the impact location. |
| **Business/gameplay problem** | Shots currently rely on HUD/audio feedback. Other players' shots are audible but not spatially visible, grenade-launcher shots are instant hitscan, and confirmed hits do not show where the target was struck. |
| **Architectural role** | Shared visual/projectile protocol, server-authoritative grenade projectile simulation, Three.js client-side combat effects. |
| **Main components** | `shared/src/index.ts`, `shared/src/combat.ts`, `server/src/combat.ts`, `server/src/playerRegistry.ts`, `server/src/match.ts`, `client/src/combatEffects.ts`, `client/src/main.ts`, QA/regression scripts. |
| **Stack** | Fixed stack unchanged: Three.js + TypeScript client, Node.js + TypeScript server, shared TypeScript protocol. No new dependency. |

## 2. Design

- Pistol and rifle remain server-authoritative hitscan for gameplay. Their `fire_broadcast` now carries a server-computed `trace` used by all clients to render fast visual travel.
- Grenade launcher now spawns a server-simulated projectile. Damage is applied only when that projectile hits a player or map geometry.
- Projectile speeds:
  - pistol visual laser: `240` world units/sec
  - rifle visual bullet: `145` world units/sec
  - grenade projectile: `26` world units/sec
- Hit particles are spawned from server `HitEvent.point`, using `HitEvent.hitZone` so head/body/legs hits visibly burst at the correct height.

## 3. Stories

### Story 19.1 — Visible pistol and rifle shots

- [x] Pistol shots render as a thin cyan laser/tracer.
- [x] Rifle shots render as a visible white bullet/trail.
- [x] The local player and observers see the same server-computed shot path from `fire_broadcast`.

### Story 19.2 — Dodgeable grenade projectile

- [x] Grenade launcher shots create a server-tracked projectile instead of instant damage.
- [x] The projectile moves at a slower speed so long-range shots can be dodged.
- [x] Direct projectile hits still use locational grenade damage.
- [x] Geometry impacts still apply EPIC 18 splash damage from the server-computed impact point.

### Story 19.3 — Hit particles

- [x] Confirmed hits spawn red cube/pixel particles at the server-reported impact point.
- [x] Particles are cosmetic and never affect health, collision, or hit resolution.
- [x] Grenade impacts spawn a small visible explosion pulse.

## 4. Risks

- Pistol/rifle tracer travel is cosmetic only; gameplay remains instant hitscan. This preserves existing combat feel while adding readability.
- Grenade launcher behavior changed from instant hitscan to server projectile. This is intentional to satisfy the dodge requirement and is covered by a regression script.
- Client projectile visuals can be slightly behind the server impact broadcast due to network latency; the server impact event removes the projectile and shows the explosion.

## Sign-off

- **Specification (author):** Team Lead (Tusya), 2026-08-06
- **Approval (Team Lead):** Team Lead (Tusya), 2026-08-06
- **Assignee:** Programmer (Pusya)
