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

On connecting, pick a mode first: **vs Bots** (a private match against 2 AI opponents) or **Multiplayer** (the shared world — if no one else is online, you're just practicing alone). Then click the canvas to lock the pointer and start playing:

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

EPIC 14 (Procedural Sound System) — see `docs/tasks/epic-14-sound-system.md`. Direct user feedback (Russian): "И добавь звуки, прыжки типа 'ух ух', топот когда бегаешь, звуки выстрелов чтобы разные были у разного оружия. Посмотри как это сделано в quake наприер, добавь звук когда берешь дроню, аптечку или оружие чтобы разные были. И когда в тебя попадают тоже звук" — jump grunts, running footsteps, per-weapon-distinct gunshots, distinct pickup sounds (weapon/armor/health), and a hit-taken sound. The game was completely silent before this EPIC.

- **No new dependency, no audio assets:** every sound is synthesized at runtime via the native Web Audio API (`OscillatorNode`, `AudioBufferSourceNode`, `BiquadFilterNode`, `GainNode`, `DynamicsCompressorNode`) — the same "procedural, no external asset pipeline" philosophy EPIC 10 established for the wall/sky `THREE.CanvasTexture`s. New module `client/src/audio/soundManager.ts` (+ `client/src/audio/synth.ts` for the low-level tone/noise-burst primitives) owns a master `GainNode` (0.6) -> `DynamicsCompressorNode` -> `AudioContext.destination` chain and a single reused white-noise `AudioBuffer`, generated exactly once at construction (never per-play/per-frame).
- **`AudioContext` lifecycle:** constructed immediately at module scope (`client/src/main.ts`), but only `resume()`d from inside the mode-select click handler — the first real user gesture in this game, before `join` is even sent — per browser autoplay policy. Every sound-trigger call also emits one `console.debug("[audio] ...")` line naming the event + key synth parameters, the agreed verification substitute for a Playwright QA pass that cannot literally hear audio.
- **Ten distinct sounds:** jump grunt (filtered noise + downward-ramping tone, ~130ms, fired from a new `FpsControllerOptions.onJump` callback on the existing ground-jump trigger only — not the EPIC 8 bunny-hop boost); footsteps (short low-pass noise burst, ~325ms base cadence while grounded+moving, with independent +/-7.5% timing and +/-8% pitch/playback-rate randomization per step so repeated steps don't sound robotic); three escalating per-weapon gunshots matching `RECOIL_PROFILES` (`client/src/viewmodel.ts`) — pistol (sharp high-passed crack, ~75ms), rifle (punchier/lower, ~115ms), grenade launcher (deep ~80Hz thump + noise, ~300ms); three pickup sounds — weapon (3-note rising arpeggio; ammo reuses the same family as a 2-note rise), armor (solid mid-tone chime/clunk), health (brighter, softer, gentler-attack tone); and hit-taken (descending tone + low-pass noise thud, deliberately distinct from every other sound above).
- **Remote gunshot audibility (new, minimal protocol addition):** previously only the local player's own shot could ever be heard. A new `FireBroadcastEvent` (`shared/src/index.ts`, `{type:"fire_broadcast", shooterId, weapon}`) is broadcast by `server/src/match.ts`'s `resolveFire()` on every real fire attempt (hit, miss, or dry alike), sourced from a new `weapon` field on `FireOutcome` (`server/src/playerRegistry.ts`) captured from the pre-auto-switch local, never `shooter.equippedWeapon` re-read after an EPIC 13 auto-switch. Purely presentational — no aim/position/damage/outcome data, cannot affect hit resolution — accepted as a minor, deliberate information reveal in the same spirit as `WorldStateMessage`'s already-unfiltered position/health broadcast (see `docs/backlog.md` "Accepted design decisions"). The client only plays it when `shooterId !== selfId` (the local shot is already played instantly via the existing `onFire` callback).
- **Pickup sound attribution (client-side heuristic, no protocol change):** `PickupRenderer` (`client/src/pickups.ts`) gained an `onConsumed` callback fired on an observed `active: true -> false` transition (never on initial sync). `main.ts` gates it on proximity to the local player's own predicted position (new `FpsController.getPosition()` accessor) — a consumed pickup within `PICKUP_RADIUS + 1.75` (documented in-code: covers the 20Hz `world_state` broadcast lag plus movement at `MOVEMENT.maxSpeed` during that window) is assumed to be this player's own pickup; a pickup consumed elsewhere on the map stays silent on this client. A best-effort, purely cosmetic heuristic, not perfectly attributed — accepted per the spec.
- **New `FpsController` accessors (purely additive, no prediction/collision change):** `isGrounded()`, `isRunning()` (grounded + actually displacing horizontally, measured post-collision-resolution so a player blocked by a wall correctly reads as "not moving"), `getPosition()`.
- **Local-player footsteps only this EPIC** — remote-player footstep audio (inferable from `WorldStateMessage` position deltas) is deliberately deferred, tracked as a follow-up in `docs/backlog.md`, not silently dropped.
- Verified via `scripts/qa-epic14-programmer-selfcheck.mjs` (Playwright + a real second WebSocket connection, since bots are pistol-only and would never exercise the rifle/grenade-launcher remote-gunshot path) capturing the `[audio] ...` console lines across jump / footstep (with measured timing/pitch variance) / local pistol gunshot / remote rifle + grenade-launcher gunshot / hit-taken / pickup triggers.

EPIC 13 (Weapon Auto-Switch on Empty Ammo & HUD Stat Sizing) — see `docs/tasks/epic-13-weapon-autoswitch-hud-sizing.md`. Two independent user-driven asks delivered together: (A) direct feedback (Russian) "сделай чтоб если кончились патроны то переключался на следующее оружие по урону ... и чтобы если вхял оружие круче оно тоже автоматом выбиралось" — auto-switch off an empty weapon, and auto-equip a picked-up weapon that's better than what's equipped; (B) "сделай кол-во патронов и здоровье и броню больше шрифт в 5 раз, и ближе к центру" — 5x-bigger health/armor/ammo numbers, closer to center.

- **Auto-switch down on empty ammo (`server/src/playerRegistry.ts` `fire()`):** a new private `autoSwitchDown()` searches `WEAPON_ORDER` descending in tier from just below the now-empty weapon down to the pistol (always owned, infinite ammo — the guaranteed floor), landing on the first owned weapon with ammo left (or infinite). Triggered the instant a finite-ammo weapon's ammo reaches 0, strictly *after* that same shot's own damage/hit outcome is resolved from locally-captured weapon stats — the switch can never retroactively change the shot it happened on. A player with rifle+grenade-launcher who runs the launcher dry with rifle ammo still available lands on the rifle, not straight to the pistol.
- **Generalized auto-equip on pickup (`applyPickup()`):** the old EPIC 6 rule only auto-equipped on a *first-time* unlock. The `!alreadyOwned` gate is dropped — any applied pickup (unlock **or** an ammo refill of an already-owned weapon) that is strictly higher tier than the currently-equipped weapon, and now has ammo (or is infinite), auto-equips it. This closes the exact gap the user's own follow-up example described: run dry on the rifle (auto-switch to pistol, rule above), then walk over rifle ammo, and you're automatically back on the rifle — no manual `E` press needed.
- **No thrash risk:** both rules only trigger from a discrete player action (a rate-limited fire attempt, or a pickup-consumption event with a multi-second respawn delay) — never a passive tick — so the two rules can only alternate across separate player actions, not oscillate within one. Manual `E` cycling (`cycleWeapon()`) is completely unmodified and interleaves normally with both automatic rules (verified immediately after an auto-switch in both the regression script and a live end-to-end smoke test).
- **Observability:** `FireOutcome`/`ApplyPickupResult` gained an additive optional `autoSwitchedTo?: WeaponType` field; `server/src/match.ts`'s `resolveFire()` and per-tick pickup loop log a new `auto-switch (empty ammo): <id> -> <weapon>` / `auto-switch (pickup): <id> -> <weapon>` line, matching the existing `switch: <id> -> <weapon>` style used by the manual `E` cycle.
- Verified via `npm run regression:weapon-autoswitch` (`scripts/regression-weapon-autoswitch.ts`, 6/6 cases: mid-tier fallback not straight to pistol, fallback to pistol when nothing else has ammo, auto-equip-on-refill, no-downgrade-on-lower-tier-pickup, the full dry→pistol→pickup→rifle sequence with no oscillation, and manual cycling right after an auto-switch) and a live WS smoke test driving the real join/input/fire/switch_weapon protocol against a running server (`scripts/qa-epic13-live-autoswitch-selfcheck.mjs`), confirming both new log lines fire from real gameplay traffic. `server/src/combat.ts` (hitscan geometry) is untouched — it has no notion of weapon type; bots (pistol-only, never call `applyPickup()`) are unaffected in practice.
- **HUD stat sizing (`client/index.html`, `client/src/combatHud.ts`):** `#healthHud`/`#armorHud`/`#weaponHud` each split into a small label span + a value span. Health/armor values hit the user's literal "5x" ask: `30px * 5 = 150px` — verified clean (no overlap/clipping) at the standard 1280x800 QA viewport, so no dial-back was needed there. The new `#ammoValue` span (split out of the weapon-name text, which previously had no independent DOM node) is a documented judgment call: a literal 5x-of-15px (75px), or anything close to health/armor's 150px, visibly overlapped the now-much-wider health/armor badges once the longest weapon name ("Grenade Launcher") shares the centered `#weaponHud` badge with a multi-digit ammo count — **40px** is the largest size that stayed clean across every owned weapon's longest name + worst-case ammo digits, still clearly bigger/bolder than the 15px weapon-name text beside it. `#healthHud`/`#armorHud` moved inward from the old `left:24px`/`right:24px` edge anchors to `left:9%`/`right:9%` of viewport width (~115px at 1280px, still ~5x closer to center than before) — dialed in below the spec's "~18-22%" starting suggestion because at that range the enlarged badges overlapped `#weaponHud` in the worst-case content combination (100/100 health/armor + longest weapon name + 2-digit ammo). Weapon-identity color-coding (`setWeapon()`'s `style.color`, set on the whole `#weaponHud` badge) now visibly applies to the ammo number too, via ordinary CSS color inheritance (no explicit color on the child spans) — verified in screenshot evidence, not just by inspection. The "EMPTY" pulse animation and the low-health/zero-armor tint data-attributes are unchanged and still work against the new child spans. Verified via `scripts/qa-epic13-programmer-selfcheck.mjs` (Playwright, 1280x800): default state, worst-case content, low-health/zero-armor tints, and the EMPTY pulse state all screenshot clean with a visible gap between all three elements and nothing clipped off either edge.

EPIC 12 (Jumpable Crates / Climbable Cover) — see `docs/tasks/epic-12-jumpable-crates.md`. Direct user feedback (Russian): "на небольшие выступы можно было запрыгивать" — make the crate-like cover boxes on the map climbable, not just full-height obstacles:

- **Jump height tuning:** `MOVEMENT.jumpSpeed` (`shared/src/index.ts`) raised 25% (`6 * 1.25 = 7.5`, was 6), expressed as the lineage rather than a bare literal. New ballistic apex is `7.5^2 / (2*18) = 1.5625m`, clearing `CRATE_HEIGHT` (1.2m, `shared/src/mapData.ts`) by ~30% — previously max jump apex (1.0m) was strictly below crate height, so crates were physically unreachable. Gravity, bunny hop fraction, and `MOVEMENT.maxSpeed` are unchanged (bunny hop's kick magnitude scales automatically since it reads `jumpSpeed`, an expected side effect).
- **Height-aware crate collision (`shared/src/collision.ts`):** two new shared helpers, used identically by both the server's authoritative `stepPlayer()` (`server/src/playerRegistry.ts`) and the client's local prediction (`fpsController.ts` `update()`) — same "one shared source of truth, two call sites" discipline as EPIC 11's substep helper. `boxesBlockingAt(feetY)` excludes a crate from horizontal blocking once the player's feet rise above that crate's top (walls always block, at any height). `crateTopHeightAt(x, z)` returns the top height of whichever crate's radius-expanded footprint is under `(x, z)`, or 0 — combined with `MOVEMENT.groundY` as the landing/support clamp. A crate below the player's feet still blocks sideways exactly as before (no regression to ground-level "crates are cover"); once mounted, a player can walk on top and falls back to ground level under normal gravity on walking off the edge.
- **`grounded`-state correctness:** landing on a crate top (not just ground) required adding an explicit `else { grounded = false }` branch after the vertical integration in both `stepPlayer()` and `fpsController.ts` — without it, walking off a mounted crate's edge (no jump input) would incorrectly leave `grounded` stuck `true` from the last landing clamp, letting a player trigger an extra ungrounded jump before actually landing. Flagged as the highest-risk line in the EPIC spec; verified explicitly by `scripts/regression-crate-mount.ts` case (d).
- **Real mount technique:** at this game's numbers, a player's feet stay above `CRATE_HEIGHT` for ~0.40s of ballistic flight, covering ~5.3m at max forward speed — more than any crate's footprint. Holding the forward key for the *entire* jump arc always overshoots; the actual technique is approach until blocked, jump, and release forward ~350-500ms after the jump tick (a real, measured, non-frame-perfect ~150-250ms release window depending on crate size — not literally frame-perfect timing). Documented in `docs/backlog.md`.
- Verified via `npm run regression:crate-mount` (`scripts/regression-crate-mount.ts`) against real `crate_a1` (2x2) and `crate_mid1` (1.5x1.5): all 4 required cases pass for both — ground-level approach stays blocked, a running jump (with the release technique above) lands exactly at `position.y == CRATE_HEIGHT`, walking off falls back to `y == 0` via a smooth multi-tick sequence, and a jump-input tick while still falling grants no extra jump.

EPIC 11 (Movement Speed Boost & Substep Collision Safety) — see `docs/tasks/epic-11-speed-boost-substep-collision.md`. Direct user feedback that EPIC 8's speed still felt too slow (asked for 3x, then 5x, then explicitly corrected mid-task to "2x, to start"):

- **Base speed 2x:** `MOVEMENT.maxSpeed` (`shared/src/index.ts`) is now `5 * 1.33 * 2 = 13.3 m/s` (was 6.65), expressed as the full lineage so the balance history stays visible. Bunny hop's unchanged 1.3x multiplier now tops out at ~17.3 m/s. One shared constant, both client prediction and server authority pick it up automatically.
- **Substep collision (`resolveSteppedMovement()`, `shared/src/collision.ts`):** at the new top speed, a single tick's raw displacement can exceed a wall's 1-unit thickness, so a naive single-step collision check could let a fast player tunnel through. Both the server's authoritative `stepPlayer()` (`server/src/playerRegistry.ts`) and the client's local prediction (`client/src/fpsController.ts`) now resolve a tick's movement through this **same** helper, which splits the proposed displacement into sub-steps no larger than `PLAYER_COLLISION_RADIUS` (0.4m) and resolves collision after every sub-step — shipped as a proactive safety margin for future speed increases, not just a reaction to this one number. Verified via `npm run regression:collision-overshoot` (`scripts/regression-collision-overshoot.ts`): worst-case overshoot is 0.0291m/0.0146m (base/boosted) with sub-stepping, vs. 0.4864m/0.5307m for what a naive single-step resolve at the same speeds would have produced.
- **HUD relayout:** health and armor readouts moved from the top-right corner to the bottom of the screen, flanking the weapon/ammo readout, and made significantly larger and bolder (14px/normal-weight → 30px/800-weight) for at-a-glance readability during combat (`client/index.html`). CSS/layout only — the underlying `setHealth()`/`setArmor()` data plumbing (`client/src/combatHud.ts`) is unchanged.
- **Bot aim inaccuracy:** bots now apply a small random angular jitter (`AIM_JITTER_RAD = 0.05` rad, ~3°, independently to yaw and pitch) at the exact moment they fire (`server/src/botAI.ts`), so they demonstrably miss some shots at range instead of reading as an aimbot, while still hitting reliably up close. Verified via `npm run regression:bot-aim-miss-rate` (`scripts/regression-bot-aim-miss-rate.ts`): ~100% hit rate at 3m/10m, ~40%/25% hit rate at 20m/30m. Bot-only change — human hitscan resolution (`server/src/combat.ts`) is untouched.

EPIC 10 (Damage Rebalance & Weapon/World Visual Polish) — see `docs/tasks/epic-10-damage-visual-polish.md`. Two independent threads, both user-driven feedback after playing EPIC 9's bot matches:

- **Damage rebalance** (`shared/src/weapons.ts` `WEAPON_STATS`, superseding EPIC 6's original table): pistol 25 → **5** dmg/hit (20 hits to kill), rifle 50 → **20** dmg/hit (5 hits to kill), grenade launcher 100 → **70** dmg/hit (guaranteed 2-hit kill, often a 1-hit finisher on a chipped target) — slows down time-to-kill considerably. Cooldowns/ammo economy unchanged. Server-enforced, same single balance table the client HUD reads.
- **Visual polish:** viewmodel (first-person weapon model) redesigned per weapon so pistol/rifle/grenade-launcher are visually distinguishable at a glance, plus wall/sky/pickup visual tuning — see the EPIC 10 spec for the full list. Purely cosmetic; no gameplay-state changes.

EPIC 9 (Bots & Match Modes) — see `docs/tasks/epic-09-bots-and-modes.md`. The server changed from one global shared world to N independent match instances:

- **Mode select:** the client now shows a pre-game screen before anything else — **vs Bots** or **Multiplayer**. Picking a mode sends a `join` message; the server rejects any gameplay message (`input`/`fire`/`switch_weapon`) from a connection that hasn't joined a match yet.
- **`public` match:** one persistent instance, created at server startup — this is exactly the shared world from EPICs 1-8, unchanged (verified line-by-line against the pre-EPIC-9 tick loop). If you're the only one in it, you're simply playing alone — that **is** "waiting for players," not a separate mode.
- **`bots:*` matches:** created on demand when a player picks vs Bots, containing that one player plus 2 AI-controlled bots, fully isolated from every other match (no shared state, no cross-match broadcasts — independently adversarially tested), torn down cleanly when the player disconnects.
- **Bot AI:** a simple patrol/engage state machine (`server/src/botAI.ts`) — bots wander between the arena's spawn points when no target is visible, and turn to face and fire (pistol only, normal human damage/cooldown, line-of-sight gated through the same wall-raycast as player hitscan) when one is. Bots go through the exact same server-authoritative movement/collision/combat path as a human player — they're `PlayerRecord`s whose input happens to be AI-computed instead of read from a socket. Deliberately simple: no weapon/health/armor pickups, no bunny hop, no pathfinding beyond waypoint patrol.
- **`bots:<id>` match IDs are never client-suppliable** — derived server-side from the connection's own server-generated ID, so a client cannot join or influence another player's private match.

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

EPIC 4 (Shooting & Combat) — see `docs/tasks/epic-04-shooting-combat.md`. Players can fight: clicking while pointer-locked fires a hitscan shot resolved entirely server-side (`server/src/combat.ts`) against **both** the shared `ARENA_GEOMETRY` (shots are blocked by walls/crates) **and** other players' hitboxes (an axis-aligned bounding box matching the same capsule dimensions rendered client-side — see `shared/src/combat.ts` for the exact approximation); nearest candidate along the ray wins, so a wall/crate closer than a player blocks the shot. Health (100 max; per-hit damage was 25 at EPIC 4's original pistol-only baseline, since superseded by EPIC 6's weapon tiers and EPIC 10's rebalance — see those sections above for current numbers), death, and a 3-second respawn timer are tracked per-player in `server/src/playerRegistry.ts` and broadcast every tick via `WorldStateMessage.players[].health/alive`, plus one-off `HitEvent`/`DeathEvent`/`RespawnEvent` messages for cosmetic feedback triggers (`shared/src/index.ts`). The client shows a crosshair, a health readout, and short muzzle-flash/hit-marker/damage-flash pulses (`client/src/combatHud.ts`) — all cosmetic; the client never unilaterally declares a hit or a kill. Dead players' avatars are hidden client-side and their movement/fire is frozen server-side until respawn. EPIC 3's arena/collision and EPIC 2's movement/jump/sync are unchanged.
