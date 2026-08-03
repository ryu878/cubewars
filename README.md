# cubewars

A 3D browser multiplayer shooter (Roblox-like: colorful, low-poly, casual). Built with a fixed stack — see `ai-office/global/global-standards.mdc` for the full policy and `ai-office/README.md` for the project's multi-agent delivery process.

## Stack

- **Client:** Three.js + TypeScript, built with Vite (`client/`)
- **Server:** Node.js + TypeScript, authoritative game server over raw WebSocket (`ws`) (`server/`)
- **Shared:** protocol/message types used by both (`shared/`), consumed directly as TypeScript source (no build step)

## Requirements

- Node.js 20+ (this repo was set up against Node 24 LTS via `nvm`)
- npm 10+

## Install

```bash
npm install
```

This installs all three workspaces (`client/`, `server/`, `shared/`) in one pass.

## Run locally

Both client and server, together:

```bash
npm run dev
```

- Client dev server: http://localhost:5173
- Game server: ws://localhost:7777 (configurable, see below)

Or run them separately in two terminals:

```bash
npm run dev --workspace=server
npm run dev --workspace=client
```

## Configuration

- **Server port:** `CUBEWARS_SERVER_PORT` (see `config.vars.example`). Set via your shell: `export CUBEWARS_SERVER_PORT=7777`.
- **Client → server URL:** `VITE_CUBEWARS_WS_URL` (see `client/.env.example`). Copy to `client/.env` to override the default `ws://localhost:7777`. This is the one place the fixed stack's "no `.env` files" rule is relaxed — Vite conventionally loads `.env` for client-side config; no secrets ever go here.

## Type-checking and build

```bash
npm run typecheck   # all workspaces
npm run build        # server + client production build
```

## Project layout

```
client/   Three.js/TypeScript game client (Vite)
server/   Node.js/TypeScript authoritative game server (ws)
shared/   protocol types shared by client and server
docs/     specs (EPIC/Story/Task), filed under docs/tasks/
ai-office/ the multi-agent delivery process (Team Lead/Programmer/Tester/Critic/Judge/Infosec)
```

## Controls

Click the canvas to lock the pointer and start playing:

- **Mouse** — look around (yaw + pitch, pitch clamped so you can't flip over)
- **W / A / S / D** — move relative to look direction
- **Click** (while locked) — fire
- **Space** — jump; press it again while still airborne (a genuine second press, not held) for a one-time bunny-hop boost — farther and higher, once per air-time
- **E** — switch weapon (cycles forward through weapons you own, in tier order)
- **Tab** (hold) — show the live scoreboard
- **Esc** — release pointer lock

Movement/look is predicted locally for responsiveness, but the **server is authoritative**: it computes and broadcasts every player's real position, and no client's self-reported position is ever trusted or relayed to other players directly (see `ai-office/global/security-baseline.mdc`). Every other connected player is rendered as a capsule avatar; you don't see your own (first-person).

Combat is server-authoritative too: firing sends a bare "fire" event, and the server resolves the actual hitscan raycast from its own tracked position/yaw/pitch **and equipped weapon** for that player — the client never states an aim origin/direction, a weapon, or a hit, of its own. See "Current status" below for the exact model.

## Current status

EPIC 8 (Movement Tuning) — see `docs/tasks/epic-08-movement-tuning.md`. Two changes, both to the single shared `MOVEMENT` constant set so client and server never drift:

- **Base speed:** ×1.33 (5 → 6.65 m/s), unchanged normal-jump physics otherwise.
- **Bunny hop:** pressing Space a second time while still airborne (a genuine fresh press, edge-detected server-side against the server's own stored input state — not a held key) applies a one-time boost: 1.3× horizontal speed and +40% of `jumpSpeed` added to current vertical velocity, once per air-time, resetting on landing. Entirely server-computed and gated — a client can only ever send a boolean "jump" field, never a boost magnitude, and cannot chain multiple boosts in one air-time no matter how fast it spams the input. Still resolved through the same wall/crate collision as normal movement.

EPIC 7 (Health & Armor) — see `docs/tasks/epic-07-health-armor.md`. Extends EPIC 6's generic pickup spawner with two new categories, no second spawner built:

- **Health pickups:** +25 HP, capped at 100, consumed only if the player is below max — same "only if useful" rule as weapon/ammo pickups. Two spawn points, one per site.
- **Armor pickups:** +25 armor, capped at 100 (four pickups for a full 100), same "only if useful" rule. Two spawn points, both in the tunnel — rarer/slower-respawning than health (35s base / 15s min vs. health's 20s base / 8s min) per the design intent that armor is a bigger commitment.
- **Damage absorption order:** on a confirmed hit, armor absorbs first — `armor >= damage` reduces only armor; `armor < damage` zeroes armor and spills the remainder into health (`spillover = damage - armor`). Armor at 0 behaves exactly like pre-EPIC-7 (all damage to health). Entirely server-computed in `playerRegistry.ts`'s `fire()`, same authority discipline as everything else.
- **Armor resets on respawn:** folded into the same reset path EPIC 6 added for weapons/ammo (`applyBaselineLoadout()`) — armor is always 0 right after respawning, regardless of pre-death level, matching "armor should not be present by default."
- **Visual identity:** health renders as a white medkit box with a red cross; armor as a steel-blue octahedron — both shapes/colors distinct from every EPIC 6 weapon/ammo pickup so they're identifiable at a glance.

EPIC 6 (Weapons & Ammo) — see `docs/tasks/epic-06-weapons-ammo.md`. Replaces the single fixed pistol with a 3-tier weapon system, built entirely server-authoritative on top of EPIC 4's hitscan and EPIC 3's arena geometry:

- **Weapon tiers:** pistol (tier 0, 25 dmg, 300ms cooldown, infinite ammo, owned from spawn), rifle (tier 1, 50 dmg, 250ms cooldown, 12 ammo/pickup, 48 max), grenade launcher (tier 2, 100 dmg/one-shot-kill, 1500ms cooldown, 2 ammo/pickup, 6 max) — one balance table, `WEAPON_STATS` in `shared/src/weapons.ts`, consumed by both server enforcement and client HUD/pickup color.
- **Pickups:** a small, generic, instantiable spawner (`server/src/pickupSpawner.ts`) tracks 6 fixed spawn points (`PICKUP_SPAWN_POINTS`, `shared/src/pickups.ts`) spread across both sites, mid lane, and the tunnel. Walking within 1.5 units of an active pickup (server-checked against the player's own tracked position, every tick) unlocks the weapon (if not owned) and tops up ammo, capped at the weapon's max — **but only if it would actually benefit the player**: a pickup for a weapon you already own at max ammo is left untouched so it stays for someone else. Consumed pickups respawn after a delay that scales down with player count (weapon: 25s base / 10s min; ammo: 18s base / 7s min).
- **Auto-equip / switching:** picking up a weapon you didn't previously own auto-equips it only if its tier is higher than what's currently equipped ("always have the best"). `E` cycles forward through owned weapons in tier order (pistol → rifle → grenade launcher → pistol → …), server-decided (`registry.cycleWeapon()`) — the client only ever sends a bare "cycle" intent, never a target weapon, same anti-spoofing posture as `FireEvent`.
- **Ammo/loadout privacy:** each player's own equipped weapon + remaining ammo is sent via a private `LoadoutMessage`, to that player's socket only — never broadcast to opponents (a small addition to `security-baseline.mdc`'s "filter server → client payloads per player" for this EPIC, since ammo counts aren't otherwise gameplay-visible to other players). Pickup on/off state (which world pickups are currently available) **is** broadcast to everyone, the same way the scoreboard is.
- **Dry weapons:** firing with 0 ammo does nothing server-side (no damage, no further decrement); the HUD shows "EMPTY" so the player knows to switch or find ammo. The pistol never runs dry.

EPIC 5 (Match Flow Polish) — see `docs/tasks/epic-05-match-flow.md`. Builds directly on EPIC 4's death/respawn logic (reused, not duplicated) to make a match read as an actual ongoing game:

- **Kill feed:** every confirmed kill (server-side, `server/src/playerRegistry.ts` `fire()`) broadcasts a `KillEvent` (`shared/src/index.ts`) to **every** connected client, not just the two involved. The client renders a short-lived "X eliminated Y" line (`client/src/killFeed.ts`) that fades out after 5s — purely a renderer of the server's broadcast, never a client-side guess.
- **Scoreboard:** the server tracks a per-player kill count in-memory (`PlayerRecord.kills`, resets on restart, no persistence) and broadcasts the full, sorted list as a `ScoreboardMessage` on every join, leave, and kill (`server/src/index.ts`) — always a complete replacement list, so a client that just joined (or missed an update) is correct from the very next message. The client shows it as a hold-Tab-to-view panel (`client/src/scoreboard.ts`).
- **Spawn distribution:** `SPAWN_POINTS` (`shared/src/mapData.ts`) already had 6 points spread across both sites; this EPIC adds an anti-clustering heuristic on top (`server/src/playerRegistry.ts` `chooseSpawnPoint()`): rank every spawn point by its distance to the nearest currently-alive player, randomly pick among the points that clear a 12-unit safety margin, and fall back to the single farthest-from-any-player point if the arena is crowded enough that none clear it. Used identically by both initial spawn and respawn (one implementation, not two).

EPIC 4 (Shooting & Combat) — see `docs/tasks/epic-04-shooting-combat.md`. Players can fight: clicking while pointer-locked fires a hitscan shot resolved entirely server-side (`server/src/combat.ts`) against **both** the shared `ARENA_GEOMETRY` (shots are blocked by walls/crates) **and** other players' hitboxes (an axis-aligned bounding box matching the same capsule dimensions rendered client-side — see `shared/src/combat.ts` for the exact approximation); nearest candidate along the ray wins, so a wall/crate closer than a player blocks the shot. Health (100 max, 25 dmg/hit, so 4 hits to kill), death, and a 3-second respawn timer are tracked per-player in `server/src/playerRegistry.ts` and broadcast every tick via `WorldStateMessage.players[].health/alive`, plus one-off `HitEvent`/`DeathEvent`/`RespawnEvent` messages for cosmetic feedback triggers (`shared/src/index.ts`). The client shows a crosshair, a health readout, and short muzzle-flash/hit-marker/damage-flash pulses (`client/src/combatHud.ts`) — all cosmetic; the client never unilaterally declares a hit or a kill. Dead players' avatars are hidden client-side and their movement/fire is frozen server-side until respawn. EPIC 3's arena/collision and EPIC 2's movement/jump/sync are unchanged.
