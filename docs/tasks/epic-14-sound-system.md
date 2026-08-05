# EPIC 14: Procedural Sound System (Jump, Footsteps, Gunshots, Pickups, Hit-Taken)

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Procedural Sound System |
| **System goal** | Give the client audible, weapon/event-distinct sound feedback for the core FPS actions that currently have none: jumping, running, firing each weapon, picking up a weapon/armor/health, and taking a hit — synthesized entirely at runtime via the native Web Audio API (oscillators/noise/filters/envelopes), no sampled audio files, no audio library. |
| **Business/gameplay problem** | Direct user feedback (Russian, verbatim): "И добавь звуки, прыжки типа 'ух ух', топот когда бегаешь, звуки выстрелов чтобы разные были у разного оружия. Посмотри как это сделано в quake наприер, добавь звук когда берешь дроню, аптечку или оружие чтобы разные были. И когда в тебя попадают тоже звук. В общем посмотри лучшие практики по звукам" — "Add sounds: jump grunts like 'oof oof', footstep thuds when running, gunshot sounds that differ per weapon. Look at how it's done in Quake for example. Add a sound when picking up armor, a medkit, or a weapon — different sounds for each. And a sound when you get hit too. In general, look at sound design best practices." The game is currently **completely silent** — confirmed zero existing audio code anywhere in `client/src`, no audio library in `client/package.json` — so this is a genuine gap in game feel/juice, not a refinement of existing audio. |
| **Architectural role** | client only (new audio subsystem: `AudioContext` lifecycle, procedural synthesis, event wiring into existing gameplay hooks) + a small, deliberate **server + shared protocol** extension for one specific gap (remote gunshot audibility — see Section 2 Design Decision 2) — no persistence, no new client-trusted gameplay state. |
| **Main components** | `client/`, `shared/`, `server/` (Story 14.4 remote-fire broadcast only), `docs/` |
| **Stack** | Fixed project stack, no deviation, and **no new dependency**: all sound is synthesized at runtime via the browser's native **Web Audio API** (`AudioContext`, `OscillatorNode`, `GainNode`, `BiquadFilterNode`, `AudioBufferSourceNode` for noise, `DynamicsCompressorNode`) — the same "no external asset pipeline, synthesize procedurally at runtime" philosophy EPIC 10 already established for visuals (`THREE.CanvasTexture` instead of sourcing image files). **Do not add howler.js, tone.js, or any audio library; do not source/bundle external audio files (.wav/.mp3/etc.).** Story 14.4's server/shared touch is a minimal, additive protocol message (no physics, no persistence) — everything else in this EPIC is client-only. |
| **Interaction with other components** | New client module(s) under `client/src/audio/` are wired into: `client/src/fpsController.ts` (new public accessors/callback for jump + grounded/speed state — Section 2 Design Decision 1), `client/src/main.ts` (the `onFire` callback already firing per-shot for the local player at `main.ts:120-128`, the `onHit`/`onLoadout`/`onPickupState` handlers already wired at `main.ts:234-265`, and the render loop at `main.ts:162-169`), `client/src/pickups.ts` (`PickupRenderer` gains pickup-consumed-transition detection), `client/src/modeSelect.ts`'s existing first-click gesture (via `main.ts`'s `onSelect` callback at `main.ts:194-197`, the natural browser-autoplay-unlock point), and `client/src/network.ts` (`GameConnection`/`NetworkHandlers` gains one new inbound message type for Story 14.4). No change to `server/src/combat.ts` (hitscan) or any client-trusted gameplay state — sound is purely a rendering/feedback layer, same discipline as the HUD and viewmodel (EPIC 10). |

---

## 2. Design decisions (fixed by Team Lead)

### Design Decision 1 — new public surface needed on `FpsController`

Confirmed by reading `client/src/fpsController.ts`: `grounded` (line 41) and `velocityY` (line 40) are `private`, and there is no edge-triggered "jump happened" hook — the jump trigger itself is inline at lines 227-230 (`if (this.keys.has("Space") && this.grounded) { this.velocityY = MOVEMENT.jumpSpeed; this.grounded = false; }`), with no callback fired. `FpsControllerOptions` today only has `onFire` (line 27-29).

Required additions to `FpsController` (Programmer's exact method names, this is the required shape):

- **`FpsControllerOptions.onJump?: () => void`** — called exactly once per genuine jump trigger (the branch at `fpsController.ts:227-230`, i.e. `Space` held while `this.grounded` was true this frame), same style/placement as the existing `onFire` option. **Not** called for the EPIC 8 bunny-hop mid-air boost (`spacePressed && !this.grounded && this.bunnyHopAvailable`, lines 192-196) — that is a separate mechanic with its own feel; the user's ask ("прыжки", jumps) maps to the ground-jump trigger. (If Programmer judges the bunny-hop boost also warrants its own audio cue, that is an allowed, documented enhancement — not required for this EPIC's acceptance criteria — but must not replace or be confused with the ground-jump grunt.)
- **A public read accessor for "grounded and moving horizontally"** — e.g. `isGrounded(): boolean` (mirrors the existing private `grounded` field) plus either a `getHorizontalSpeed(): number` or a combined `isRunning(): boolean` — Programmer's choice of exact shape, but it must let a per-frame caller in `main.ts` distinguish "on the ground and actively moving" (footsteps should play) from "airborne", "grounded but stationary", or "dead"/"not locked" (footsteps should not play in any of these).
- **A public position read accessor** — e.g. `getPosition(): { x: number; y: number; z: number }` — needed both for the footstep system (if it needs the player's own position for any reason) and, more importantly, for Story 14.5's pickup-proximity gate (Section below). Confirmed no such accessor exists today (`main.ts` never reads `fps`'s position directly — it only ever calls `fps.reconcile(...)`, `fps.setAlive(...)`, `fps.update(dt)`, `fps.getInputIntent()`, `fps.isLocked()`).

These are purely additive, read-only/callback additions — no change to any existing prediction/collision/reconciliation behavior.

### Design Decision 2 — remote gunshot audibility (server + shared protocol change, in scope)

Confirmed by reading `shared/src/index.ts`: `ServerMessage` (lines 330-339) has no per-shot broadcast — the only shot-outcome broadcast is `HitEvent`, and only on an actual landed hit, not on every trigger pull (a miss or a dry-fire attempt produces no broadcast at all today). This means, out of the box, **only the local player's own gunshots could ever be heard** — every other player's/bot's gunshots would be silent, which is a significant gap for a multiplayer shooter's audio identity (hearing enemies fire is core FPS feel, not just polish, per the EPIC brief).

**Decision: implement a minimal, best-effort server rebroadcast of every fire attempt**, purely presentational:

- New shared message type, added to `shared/src/index.ts`:
  ```ts
  /**
   * Server -> all clients: someone in this match attempted to fire (EPIC 14
   * "Sound System" Story 14.4) — broadcast on EVERY fire attempt (hit, miss,
   * or dry), not just a landed hit, so every connected client can play that
   * shooter's weapon-specific gunshot sound. Purely presentational: carries
   * no aim/position/damage/outcome data and never affects hit resolution —
   * HitEvent remains the sole source of truth for "did this shot land and
   * what did it do". This is a minor, deliberate, accepted information
   * reveal (which weapon a given player currently holds), in the same spirit
   * as the already-accepted unfiltered position/health broadcast in
   * WorldStateMessage (docs/backlog.md "Accepted design decisions") — no
   * aim direction, exact hit outcome, or other gameplay-relevant secret is
   * exposed.
   */
  export interface FireBroadcastEvent {
    type: "fire_broadcast";
    shooterId: string;
    weapon: WeaponType;
  }
  ```
  Add to `ServerMessage` union.
- `server/src/playerRegistry.ts`'s `FireOutcome` (both variants, lines ~146-171) gains a `weapon: WeaponType` field, populated from the already-captured local `const weapon = shooter.equippedWeapon;` (line 414, captured **before** any possible auto-switch — see the existing EPIC 13 comment on that line) — so the broadcast always reflects the weapon that was **actually fired**, never a weapon it was auto-switched to afterward. The early bail (`!shooter || !shooter.alive`, line 407) returns `{ hit: false, dry: false }` with no `weapon` — correctly, since no real fire attempt happened server-side in that case (already filtered before reaching here, per the existing dead-player fire rejection in `server/src/index.ts`).
- `server/src/match.ts`'s `resolveFire()` (lines 175-229) broadcasts a `FireBroadcastEvent` for every call that reaches it with a real `weapon` on the outcome (i.e. skip only the theoretical no-shooter bail) — **before** the existing hit/dry/miss-specific branches, so it fires uniformly for hit, miss, and dry-fire alike (a real trigger pull should make a gunshot sound regardless of whether it happened to land). This is one `this.broadcast(...)` call, matching the existing pattern for `HitEvent`/`DeathEvent`/`KillEvent` in the same function.
- Client: `client/src/network.ts`'s `NetworkHandlers` gains `onFireBroadcast?: (message: FireBroadcastEvent) => void`, wired the same way as `onHit`. `client/src/main.ts`'s handler plays the remote gunshot sound **only when `message.shooterId !== selfId`** (the local player's own shot is already played instantly, at zero latency, via the existing local `onFire` callback — echoing the server broadcast back to the shooter too would double-play it).
- No change to rate-limiting/anti-flood posture: fire attempts are already cooldown-gated per weapon before `resolveFire()` is ever called (`server/src/index.ts` `fireCooldownDropTracker`), so this adds no new flood surface.

**Acceptance note:** with this change, remote players' and bots' gunshots become audible to every client, matching the "hearing enemies fire is core FPS feel" reasoning in the EPIC brief — this was judged worth the small protocol addition rather than deferred to backlog, since it's a natural, low-risk extension of the existing `fire`-message flow (already client→server, now also mirrored server→all-clients) and materially changes whether this EPIC actually delivers "gunshot sounds" as a multiplayer feature or only as a single-player-feeling local effect.

### Design Decision 3 — pickup sound attribution (client-side diff + proximity gate, no protocol change)

Confirmed by reading `shared/src/pickups.ts` and `client/src/pickups.ts`: `PickupStateMessage` only ever carries the full `{id, active}[]` list (no "who consumed it" field, by design — see `PickupStatus` doc comment), and `PickupRenderer.sync()` (lines 186-191) only toggles `mesh.visible` from the latest snapshot, with no memory of the previous state.

**Decision:** extend `PickupRenderer` (still a pure renderer — it does not decide game state, only detects an `active: true -> false` transition it already receives) to track previous `active` state per pickup id, and expose a hook fired on that specific transition:

- `PickupRenderer` gains an optional constructor callback, e.g. `onConsumed?: (point: PickupSpawnPoint) => void`, invoked from `sync()` the instant a point's `active` flips `true -> false` (never on `false -> false`/`true -> true`/initial sync, so a client that just joined doesn't fire a burst of "consumed" events for pickups that were already inactive before it connected).
- `PICKUP_SPAWN_POINTS` (imported from `@cubewars/shared`, already used by `PickupRenderer`) supplies `category`/`weapon` for the sound-selection branch (weapon/ammo/health/armor — Story 14.5's four distinct sounds map to `category`, with "weapon" and "ammo" pickups for the same slot sharing the "weapon pickup" sound family unless Programmer judges a first-time-unlock vs. ammo-refill distinction is worth a variant; not required for acceptance).
- **Attribution (who consumed it, since the message doesn't say):** gate on proximity to the **local player's own position** (via the new `fps.getPosition()` accessor, Design Decision 1) at the moment the transition is observed — if the consumed point's static position (from `PICKUP_SPAWN_POINTS`) is within a tuned radius of the local player, play the pickup sound; otherwise, it was (most likely) someone else's pickup, stay silent. Starting point for the radius: `PICKUP_RADIUS` (1.5, `shared/src/pickups.ts`, the server's own actual consumption radius) **plus a buffer** to account for `WorldStateMessage`'s 20 Hz broadcast interval and the player's own movement speed between the consuming step and the next `pickup_state` broadcast reaching this client (at `MOVEMENT.maxSpeed` = 13.3 m/s and up to ~50ms of tick lag, up to ~0.67m of extra drift) — Programmer picks and **documents** (code comment with the reasoning, same "judgment call, evidenced" bar EPIC 13 used for HUD sizing) the final radius, e.g. on the order of `PICKUP_RADIUS + 1.5` to `PICKUP_RADIUS + 2` as a reasonable starting point to verify against, not a number to accept blindly.
- This is a **best-effort heuristic**, not perfectly attributed (in principle two players could both be within the gate radius when a third pickup elsewhere transitions — this game's small arena and sparse simultaneous-pickup-consumption pattern make that rare) — acceptable for a "juice" cue, does not affect any gameplay-relevant state, and is explicitly allowed to be imperfect per the investigation brief ("simplest to just play pickup SFX for any pickup near the local player's own last-known position").

### Design Decision 4 — footsteps: local-only for this EPIC, remote deferred to backlog

Per the investigation brief: remote footstep timing *could* be inferred client-side from `WorldStateMessage` position deltas over time in `client/src/remotePlayers.ts`, with no protocol change needed — but this adds real complexity (per-remote-player velocity estimation, cadence-from-noisy-20Hz-samples, avoiding false footsteps from server reconciliation snaps) for a "nice to have" polish layer, on top of an EPIC that already spans jump/footstep/3-weapon-gunshot(x2 local+remote)/4-pickup-category/hit-taken sound design and wiring.

**Decision: local-player footsteps only for this EPIC.** Remote-player footstep audio (inferred from `WorldStateMessage` position deltas in `remotePlayers.ts`) is deliberately deferred — recorded as a follow-up in `docs/backlog.md` (Story 14.7), not silently dropped. This keeps the EPIC's scope converging on a shippable, well-tested result rather than open-ended.

### Design Decision 5 — sound design specification (the actual audio content)

All synthesized via Web Audio primitives (`OscillatorNode` for tones, a **single pre-generated, reused** white-noise `AudioBuffer` for noise-based sounds — generated once at `SoundManager` construction, never inside the render loop or per-play, matching this project's established "expensive procedural generation happens once at setup, not per-frame" discipline from EPIC 10's `buildWallTextures()`/`buildSkyDome()` — plus `BiquadFilterNode` for shaping and `GainNode` envelopes). A shared master chain (`GainNode` for overall volume -> `DynamicsCompressorNode` -> `AudioContext.destination`) prevents clipping/distortion when sounds overlap (e.g. a footstep and a gunshot landing in the same audio frame) without needing a full mixer.

| Sound | Character | Rough synthesis shape |
|---|---|---|
| **Jump grunt** ("ух") | Short, low, breathy/noisy burst — a human vocalization, NOT a UI beep. ~100-150ms. | Filtered noise burst (band-pass/low-pass around a low-mid center frequency) layered with a short downward-pitched tone (oscillator frequency ramping down over the burst) for body. |
| **Footstep** | Short percussive thud, cadence-timed while grounded+moving (~300-350ms base interval, i.e. roughly a running cadence), **±5-10% randomization on both timing and pitch/playback-rate per step** so repeated steps don't sound like a robotic metronome (a well-established "juice" best practice — identical repeated samples read as fatiguing/mechanical). | Very short filtered noise burst (~40-70ms) possibly layered with a brief low-frequency thump. |
| **Pistol gunshot** | Short, sharp, high-passed crack — the "smallest" of the three, matching the pistol's low-tier visual/damage identity (`RECOIL_PROFILES.pistol` in `client/src/viewmodel.ts` has the smallest kick/flash). | Brief noise burst through a high-pass filter + a short high-ish tone, ~60-90ms total. |
| **Rifle gunshot** | Punchier/louder crack than the pistol, more low-end, a touch longer — matches the rifle's mid-tier visual/damage escalation. | Noise burst with a lower-cutoff filter (more low-end than pistol) + a slightly longer/lower tone, ~100-130ms. |
| **Grenade launcher gunshot** | Deep, bassy thump/boom, clearly the "heaviest" of the three, longest decay — matches the grenade launcher's largest kick/flash/damage identity. | Low oscillator (e.g. ~60-90Hz sine/triangle) + noise, longer envelope decay, ~250-350ms. |
| **Weapon pickup** | Positive, rising "upgrade" feel — 2-3 note ascending arpeggio. | Sequence of 2-3 short oscillator tones, each a discrete step higher in pitch than the last. |
| **Armor pickup** | Solid, sturdy, "protective" — a mid-tone chime/clunk, single note, not bright/sparkly. | One mid-frequency oscillator (or oscillator + short noise thud for a "clunk" edge) with a firm, fairly quick decay. |
| **Health pickup** | Brighter, softer, "restorative" — audibly distinct from armor's clunk. | A higher-pitched tone (sine/triangle, optionally +harmonic) with a gentler attack/decay than armor's. |
| **Hit-taken** | Short, sharp, unambiguously negative — must not be confusable with any pickup or footstep sound. | A quick descending-pitch tone (e.g. ramping down over ~100-150ms) layered with a short noise burst for a "thud/grunt of pain" quality. |

Every sound in this table must be, per the acceptance criteria below, **distinguishable from every other sound in this table by its synthesis parameters** (fundamentally different waveform composition — tone-only vs. noise-only vs. tone+noise, different frequency ranges, different durations) — this is the concrete, checkable form of "look at Quake / sound design best practices," not a vague aesthetic ask.

### Design Decision 6 — `AudioContext` lifecycle & browser autoplay policy

Per the investigation brief: browsers require an `AudioContext` to be created/resumed inside a real user gesture. The mode-select buttons (`client/src/modeSelect.ts`, wired in `main.ts:194-197`) are the first real click in this game before any gameplay, and are the natural unlock point — this happens **before** `join` is sent, so audio is ready before the player can take any action that would need sound.

- `SoundManager` (new module) is instantiated at module scope in `main.ts`, alongside `hud`/`viewmodel`/etc. — `new AudioContext()` may be constructed immediately (constructing is allowed without a gesture; only *starting playback*/leaving the `suspended` state needs one), but an explicit `soundManager.unlock()` (or equivalently named) method must be called synchronously from inside the mode-select click handler (i.e. from the `onSelect` callback passed into `new ModeSelect(...)` at `main.ts:194-197`, alongside the existing `connection.send({ type: "join", mode })`), calling `audioContext.resume()`.
- `soundManager.update(dt)` is called from the existing render loop (`main.ts:162-169` `animate()`), alongside `fps.update(dt)`/`viewmodel.update(dt)`, for anything needing per-frame timing (the footstep cadence timer).
- A sane default master gain (e.g. ~0.5-0.7, tuned by ear/by Programmer, documented) keeps normal play from ever clipping even with several sounds overlapping — backed by the `DynamicsCompressorNode` in the master chain as a safety net, not the sole mechanism.

---

## 3. Story 14.1 — `SoundManager` core infrastructure

**As a** developer implementing every other story in this EPIC **I want** one shared, reusable audio subsystem (context lifecycle, master gain/compressor chain, reusable noise buffer, tone/noise synthesis primitives) **so that** every individual sound effect is a small, declarative synth call, not duplicated `AudioContext` boilerplate per sound.

- New module(s) under `client/src/audio/` (e.g. `soundManager.ts` for the public class, optionally a `synth.ts` for the low-level tone/noise/envelope helpers) implementing:
  - `AudioContext` construction, `unlock()` (Design Decision 6).
  - Master chain: master `GainNode` -> `DynamicsCompressorNode` -> `audioContext.destination`.
  - One reused white-noise `AudioBuffer`, generated once (Design Decision 5).
  - Low-level helpers: a short-tone player (oscillator type/frequency/duration/envelope params -> plays through the master chain) and a noise-burst player (duration/filter params -> plays through the master chain), both cleaning up their nodes after playback (no unbounded node accumulation over a long play session).
  - A lightweight `console.debug` (or similar) line on every sound trigger, naming the event and its key synth parameters (e.g. `"[audio] gunshot weapon=rifle"`, `"[audio] jump"`, `"[audio] pickup category=armor"`) — cheap, always-on, and specifically intended so Tester can capture these via Playwright's `page.on('console', ...)` as evidence that the right sound branch fired at the right trigger point (Playwright cannot "hear" audio — this is the agreed verification substitute per the EPIC brief).
- **Acceptance criteria:**
  - [ ] `AudioContext` is constructed once, resumed only via a call inside the mode-select click handler (no autoplay-policy console warning/error on a normal play session, verified in Tester evidence).
  - [ ] No new dependency added to `client/package.json` — grep confirms only Web Audio / native browser APIs are used.
  - [ ] The white-noise buffer is generated exactly once (not per-sound-play, not per-frame) — verified by code inspection (Critic) and, ideally, a call-count check in Tester's evidence.
  - [ ] Master chain includes a compressor (or equivalent) — playing several sounds simultaneously (e.g. rapid-fire pistol + footsteps) does not produce audibly clipped/distorted output (spot-checked by Tester; a `DynamicsCompressorNode` presence check is sufficient code-level evidence given Playwright can't judge audio quality directly).
  - [ ] Every sound trigger emits one `console.debug` line naming the event + key params, for Tester's console-capture verification.

---

## 4. Story 14.2 — Jump grunt

**As a** player **I want** to hear a short grunt ("ух") when I jump **so that** jumping has audible weight/feedback, matching the user's explicit ask.

- `FpsControllerOptions.onJump` (Design Decision 1) added and called from the existing ground-jump branch (`fpsController.ts:227-230`).
- `main.ts` wires `onJump: () => soundManager.playJumpGrunt()` into the existing `new FpsController(camera, renderer.domElement, { onFire: ..., onJump: ... })` construction.
- Jump grunt synthesis per Design Decision 5 (filtered noise + downward-pitched tone, ~100-150ms) — must NOT sound like a pure oscillator beep (i.e. must include a noise component, not tone-only).
- **Acceptance criteria:**
  - [ ] Jumping (while grounded, locked, alive) triggers exactly one grunt per jump — not per frame held, not retriggered while airborne, not triggered by the EPIC 8 bunny-hop mid-air boost (that's a separate trigger per Design Decision 1).
  - [ ] Not triggered while dead, not pointer-locked, or not grounded (pressing Space mid-air does nothing to this sound — same gating the existing jump-input branch already has).
  - [ ] Synth parameters include a noise component (not a pure tone) — verified in code (Critic) and via Tester's captured synth-call parameters.

---

## 5. Story 14.3 — Footsteps (local player)

**As a** player **I want** to hear my own footsteps thud while running **so that** movement has audible weight/feedback, matching the user's explicit ask.

- `FpsController` gains the grounded/moving accessor(s) (Design Decision 1).
- A footstep timer/cadence system — either inside `SoundManager` (fed grounded/speed state each frame) or a small dedicated `FootstepPlayer` class — driven from `main.ts`'s `animate()` loop (`soundManager.update(dt)` or an explicit `footsteps.update(dt, fps.isGrounded(), fps.getHorizontalSpeed())`-shaped call, Programmer's choice of exact wiring).
- Cadence ~300-350ms base interval while grounded+moving, **not** while airborne, stationary, dead, or not pointer-locked. **±5-10% per-step randomization** on both interval and pitch/playback-rate (Design Decision 5) — this is a required acceptance criterion, not optional polish, per the explicit "avoid robotic repeat" best-practice cited in the brief.
- **Acceptance criteria:**
  - [ ] Footstep sound plays repeatedly, roughly every ~300-350ms (±the randomization), only while the local player is grounded AND moving (non-zero horizontal input/speed), locked, and alive.
  - [ ] Footsteps stop immediately (no lingering cadence) when the player stops moving, jumps/becomes airborne, dies, or unlocks pointer.
  - [ ] Consecutive footstep sounds are measurably varied in timing and/or pitch (not bit-for-bit identical playback parameters every step) — verified via Tester's captured console/synth-parameter evidence across several consecutive steps.
  - [ ] No footstep sound plays for remote players in this EPIC (explicitly out of scope per Design Decision 4) — confirmed no footstep logic reads `RemotePlayers`/`remotePlayers.ts` state.

---

## 6. Story 14.4 — Per-weapon gunshots (local + remote)

**As a** player **I want** to hear a distinct gunshot sound for whichever weapon I (or anyone else) fires **so that** combat has audible weapon identity, matching the user's explicit "different sounds per weapon" ask and the "hear enemies fire" core-FPS-feel reasoning.

- **Local:** wire into the existing `onFire` callback (`main.ts:120-128`) — `soundManager.playGunshot(currentWeapon)` alongside the existing `hud.showMuzzleFlash(currentWeapon)`/`viewmodel.triggerFire(currentWeapon)` calls. Fires immediately, same zero-latency "juice" discipline as the existing visual feedback.
- **Remote:** implement Design Decision 2 in full — shared `FireBroadcastEvent`, `FireOutcome.weapon`, `Match.resolveFire()` broadcast, `NetworkHandlers.onFireBroadcast`, `main.ts` wiring that plays `soundManager.playGunshot(message.weapon)` only when `message.shooterId !== selfId`.
- Three distinct synth profiles (pistol/rifle/grenade_launcher) per Design Decision 5's table — escalating character matching `RECOIL_PROFILES` in `client/src/viewmodel.ts` (pistol smallest/shortest, grenade launcher deepest/longest).
- **Acceptance criteria:**
  - [ ] Firing locally plays the correct weapon's gunshot sound immediately, for all three weapons.
  - [ ] A remote player's (or bot's) fire attempt — hit, miss, or dry — is now audible to other connected clients as that weapon's gunshot sound (verified via a 2-connection or bot-match Playwright/log-based test, since this is the first time remote fire produces any client-observable effect at all beyond an eventual `HitEvent`).
  - [ ] The three weapon gunshot sounds are parameter-distinct per Design Decision 5 (different frequency range/duration/noise-vs-tone composition) — verified in code and via captured synth-call parameters, not just "sounds different" by ear-claim.
  - [ ] `FireOutcome.weapon` is populated from the pre-auto-switch captured local, not `shooter.equippedWeapon` re-read after a possible auto-switch (regression check against EPIC 13's auto-switch behavior — the broadcast weapon must be the one that was actually fired).
  - [ ] No change to hit resolution, damage, or any existing broadcast content — `FireBroadcastEvent` is additive and carries no gameplay-relevant secret beyond "this weapon was fired by this player" (already effectively inferable today from HitEvent + observing pickup state, per Design Decision 2's reasoning).
  - [ ] `npm run typecheck` passes across `shared`/`server`/`client` after the protocol addition.

---

## 7. Story 14.5 — Pickup sounds (weapon / armor / health, distinct per category)

**As a** player **I want** a distinct sound when I pick up a weapon, armor, or a medkit **so that** pickups have audible, category-distinguishable feedback, matching the user's explicit ask.

- Implement Design Decision 3 in full: `PickupRenderer` gains an `onConsumed` hook fired on an `active: true -> false` transition observed in `sync()`; `main.ts` wires it to a proximity-gated (local player only) call into `soundManager.playPickup(category)` (or a similarly-shaped API), using the new `fps.getPosition()` accessor and a documented, evidenced proximity radius (Design Decision 3).
- Three distinct synth profiles (weapon/armor/health) per Design Decision 5's table (rising arpeggio / solid chime-clunk / brighter-softer chime). "Ammo" category pickups may reuse the "weapon" sound family (Programmer's call, document if a variant is chosen instead).
- **Acceptance criteria:**
  - [ ] Walking over and consuming a weapon, armor, or health pickup as the local player plays that category's distinct sound.
  - [ ] The three category sounds are parameter-distinct per Design Decision 5 (verified in code + captured synth-call parameters).
  - [ ] A pickup consumed far from the local player (e.g. by a bot or another connected player elsewhere on the map) does **not** play a pickup sound on this client — verified via a multi-entity test (bot match or 2-connection test) exercising the proximity gate's negative case, not just the positive "I picked it up" case.
  - [ ] The proximity radius choice is documented (code comment with the reasoning against `PICKUP_RADIUS` + tick-lag buffer, Design Decision 3) — not a silent magic number.
  - [ ] No change to `PickupStateMessage`/pickup consumption server logic — this story is entirely client-side attribution/rendering.

---

## 8. Story 14.6 — Hit-taken sound

**As a** player **I want** a distinct, unambiguous "I got hurt" sound when I take damage **so that** getting hit has audible feedback, matching the user's explicit ask.

- Hook directly onto the existing `onHit` handler (`main.ts:234-237`), specifically the `if (message.targetId === selfId)` branch that already calls `hud.showDamageFlash()` — add `soundManager.playHitTaken()` alongside it. No new detection needed (per the investigation brief, this is the cleanest hook in the whole EPIC).
- Synth per Design Decision 5 (short descending tone + noise "thud", unambiguously distinct from every pickup/footstep/jump sound in the table).
- **Acceptance criteria:**
  - [ ] Taking a confirmed hit (server `HitEvent` with `targetId === selfId`) plays the hit-taken sound, synchronized with the existing damage-flash visual pulse.
  - [ ] Landing a hit on someone else (`shooterId === selfId`, the existing hit-marker branch) does **not** also trigger the hit-taken sound — the two remain independent, as they are today for the visual feedback.
  - [ ] The hit-taken sound is parameter-distinct from every pickup sound and the footstep/jump sounds (Design Decision 5's distinctness requirement) — no risk of a player confusing "I got hurt" with "I picked something up."

---

## 9. Story 14.7 — Docs (README + backlog)

**As a** developer reading `README.md`/`docs/backlog.md` **I want** an EPIC 14 entry and a recorded follow-up for the deferred remote-footstep scope **so that** the project's running EPIC history and backlog stay complete and accurate, matching the established convention (EPIC 6 through EPIC 13 are all documented in `README.md`; deferred/accepted design calls are tracked in `docs/backlog.md`).

- `README.md`: add an EPIC 14 section in the established style/location — what sounds exist, how they're synthesized (procedural Web Audio, no library/assets, matching the EPIC 10 texture philosophy), the `AudioContext` unlock-on-first-click behavior, and the remote-gunshot-broadcast addition (Design Decision 2).
- `docs/backlog.md`: add a follow-up entry for remote-player footstep audio (Design Decision 4) — inferred-from-position-deltas approach, explicitly noted as deferred, not forgotten.
- **Acceptance criteria:**
  - [ ] `README.md` has an EPIC 14 entry reflecting the actual shipped sounds/behavior (not the pre-implementation targets, if anything was tuned differently during implementation).
  - [ ] `docs/backlog.md` has a new follow-up entry for remote-player footstep audio, in the existing "Follow-ups (not yet scheduled)" section style.

---

## 10. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | `SoundManager` core: `AudioContext` lifecycle, master gain + compressor chain, reused noise buffer, tone/noise synth primitives, debug logging | shared audio infrastructure for every sound in this EPIC | `client/src/audio/soundManager.ts` (+ optional `synth.ts`) | Story 14.1 acceptance criteria |
| 2 | Wire `unlock()` into the mode-select click handler; `update(dt)` into the render loop | audio starts on first real user gesture, no autoplay warning | `client/src/main.ts` | Story 14.1 AC 1 |
| 3 | `FpsController`: `onJump` callback, `isGrounded()`/horizontal-speed accessor, `getPosition()` accessor | new public surface for jump/footstep/pickup wiring | `client/src/fpsController.ts` | Design Decision 1 |
| 4 | Jump grunt synth + wiring | jump plays a noise+tone grunt, gated correctly | `client/src/audio/*`, `client/src/main.ts` | Story 14.2 acceptance criteria |
| 5 | Footstep cadence system + synth + wiring | local footsteps play while grounded+moving, randomized | `client/src/audio/*`, `client/src/main.ts` | Story 14.3 acceptance criteria |
| 6 | Shared `FireBroadcastEvent`; `FireOutcome.weapon`; `Match.resolveFire()` broadcast | remote fire attempts become server-broadcast | `shared/src/index.ts`, `server/src/playerRegistry.ts`, `server/src/match.ts` | Design Decision 2 |
| 7 | `NetworkHandlers.onFireBroadcast`; client wiring (local + remote gunshot synth + dispatch) | local + remote gunshots audible, weapon-distinct | `client/src/network.ts`, `client/src/main.ts`, `client/src/audio/*` | Story 14.4 acceptance criteria |
| 8 | `PickupRenderer.onConsumed` transition hook; proximity-gated pickup sound wiring + synth (3 categories) | local pickups play distinct, attributed sounds | `client/src/pickups.ts`, `client/src/main.ts`, `client/src/audio/*` | Story 14.5 acceptance criteria |
| 9 | Hit-taken synth + `onHit` wiring | taking damage plays a distinct sound | `client/src/main.ts`, `client/src/audio/*` | Story 14.6 acceptance criteria |
| 10 | Programmer self-check evidence script (Playwright, console-log capture of synth-call parameters across jump/footstep/3x gunshot/4x pickup/hit-taken triggers) | reproducible, code-level evidence a browser-audio-blind Tester can rely on | `scripts/qa-epic14-programmer-selfcheck.mjs` (naming matches EPIC 11's `scripts/qa-epic11-*` self-check convention) | script runs, captures distinct params per sound, non-zero exit on missing/wrong trigger |
| 11 | Docs: `README.md` EPIC 14 section, `docs/backlog.md` remote-footstep follow-up | doc record matches shipped behavior | `README.md`, `docs/backlog.md` | Story 14.7 acceptance criteria |

---

## 11. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] Jumping (local player, grounded) plays a noise-based grunt sound, not a pure-tone beep.
- [ ] Footsteps play for the local player while grounded and moving, at a running cadence, with per-step timing/pitch randomization — silent while airborne, stationary, dead, or unlocked.
- [ ] All three weapons (pistol/rifle/grenade launcher) have distinct, escalating-character gunshot sounds, audible both for the local player's own fire (instant) and for remote players'/bots' fire (via the new `FireBroadcastEvent`, Design Decision 2).
- [ ] Picking up a weapon, armor, or health item (local player) plays a category-distinct sound; a pickup consumed elsewhere on the map by someone else does not.
- [ ] Taking a confirmed hit plays a distinct "hurt" sound, independent of and not confusable with the hit-marker (landing a hit on someone else) or any pickup sound.
- [ ] All ten-plus sounds in Design Decision 5's table are synthesized via native Web Audio API primitives only — zero new npm dependency, zero external audio asset files.
- [ ] A shared master gain + compressor chain prevents clipping when multiple sounds overlap.
- [ ] `AudioContext` is only resumed from inside a genuine user-gesture handler (the mode-select click) — no autoplay-policy warning/error under normal play.
- [ ] Every sound trigger emits a lightweight, distinguishing debug log line, used as Tester's/Critic's code-level verification substitute for "actually hearing" the result.
- [ ] Remote-player footstep audio is explicitly out of scope for this EPIC and recorded as a `docs/backlog.md` follow-up, not silently dropped.
- [ ] No regression to any existing EPIC 1-13 gameplay/visual/HUD behavior — this EPIC is additive (new callback options, new accessor methods, one new broadcast message type), touching no existing collision/combat/HUD logic paths beyond adding calls alongside them.
- [ ] `npm run typecheck` / `npm run build` pass across `shared`/`server`/`client`.
- [ ] `README.md` has an EPIC 14 entry; `docs/backlog.md` has the remote-footstep follow-up entry.
- [ ] Tester's evidence includes: a Playwright/console-log capture showing each of the 10 distinct sound triggers (jump, footstep x2+ consecutive steps, 3x local gunshot, 3x remote gunshot via bot match, weapon/armor/health pickup, hit-taken) firing with distinguishable synth parameters at the correct gameplay moment — not a written claim that "sounds work."

---

## 12. Risks

- **Playwright/Tester cannot literally hear audio** — mitigated by the debug-log instrumentation requirement (Story 14.1 Task 1) giving a deterministic, code-level trace of exactly which synth branch fired, with what parameters, at what trigger — this is the agreed verification substitute per the EPIC brief, not a workaround Team Lead invented unilaterally.
- **Browser autoplay policy** — an `AudioContext` left suspended (never resumed inside a real gesture) would silently produce no sound at all with no obvious error to a human tester unless they check the console; mitigated by wiring `unlock()` into the mode-select click (the first, unavoidable user gesture in this game) and requiring Tester to verify no autoplay-policy warning appears.
- **`FireBroadcastEvent` is a genuine (small) protocol/security-surface change**, not purely a client-side story like the rest of this EPIC — mitigated by keeping it strictly presentational (no aim/position/damage data, cannot affect hit resolution) and by the explicit comparison to the already-accepted unfiltered `WorldStateMessage` position/health broadcast in `docs/backlog.md`; Critic should confirm this reasoning holds and that no gameplay-relevant secret is newly exposed.
- **Pickup-sound attribution is a heuristic (proximity gate), not exact** — accepted per Design Decision 3's reasoning (small arena, sparse simultaneous pickup events, purely cosmetic outcome either way) — Tester should verify the heuristic's negative case (someone else's pickup elsewhere stays silent on this client) actually holds in practice, not just assume the reasoning.
- **Footstep robotic-repeat risk** — mitigated by the explicit ±5-10% timing/pitch randomization requirement (Story 14.3), called out as a required acceptance criterion, not optional polish, given how directly this maps to a well-known, named sound-design failure mode.
- **Scope creep risk (this EPIC touches 5 distinct gameplay hooks + 1 protocol change)** — mitigated by Design Decision 4 explicitly deferring remote footsteps to backlog, and by each Story having its own narrow, independently-testable acceptance criteria rather than one monolithic "sound works" claim.
- **No audio library means every envelope/filter/noise-buffer detail is hand-rolled** — more code than dropping in a sample player, but matches the fixed-stack "no new dependency, no asset pipeline" constraint deliberately established in EPIC 10; Critic should confirm no shortcut (e.g. a `data:` URI embedding an actual audio sample, which would violate "no external/bundled audio assets" in spirit even without a literal file) was taken instead of genuine synthesis.

---

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
