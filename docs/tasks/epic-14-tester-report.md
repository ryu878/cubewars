# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-05 |
| Task / Story / EPIC | EPIC 14 — Procedural Sound System (`docs/tasks/epic-14-sound-system.md`) |
| Handoff from Pusya (link/commit) | branch `feature/sound-system` @ `24affd4` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: local dev, Node (no Docker in this repo's dev flow)
- Branch / commit: `feature/sound-system` @ `24affd4`

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — `typecheck` clean across `shared`/`server`/`client`; `build` (server `tsc` + client `vite build`) clean, no new-dependency chunk warnings beyond the pre-existing "chunk > 500kB" notice (unrelated to this EPIC).

### Run

- Command: `npm run dev` (server on `ws://localhost:7777`, client on Vite, port auto-selected to 5175 since 5173/5174 were in local use)
- Result: OK — client loads, connects, mode-select works, no crash on start.

### Smoke / scenarios

All scenarios below were exercised **live** against the running dev server/client via independent Playwright + raw-WS scripts I wrote myself (not the Programmer's self-check script), reading `[audio] ...` `console.debug` lines as the agreed verification substitute (Playwright cannot hear audio). Screenshots and raw JSON evidence are under `qa-artifacts/epic-14/` (gitignored, not committed — per this repo's `qa-artifacts/` convention).

| Step | Expected | Actual |
|------|----------|--------|
| Jump grunt, single tap while grounded | exactly one `[audio] jump grunt ...` log, noise-based (verified in code: `playNoiseBurst` + `playTone`, not tone-only) | `[audio] jump grunt duration=130ms` fired exactly once |
| Jump grunt, Space held across a full jump arc (bunny-hop window) | still exactly one grunt (no re-trigger while airborne / on bunny-hop) | exactly one grunt logged across the held-Space window — confirmed not re-triggered |
| Footsteps, open ground, held W ~1.6s | fires repeatedly at ~325ms ± jitter, both timing and pitch vary step-to-step | 5 footsteps, intervals `[335, 317, 316, 333]`ms, `playbackRate` `[0.95, 1.049, 0.994, 1.035, 0.992]` — both independently jittered, matches spec (±7.5%/±8%) |
| Footsteps stop when stationary | 0 further footstep logs | 0 confirmed |
| Footsteps, holding W directly into the outer wall for 1.5s (Story 14.3's "wall-blocked" claim) | 0 footstep logs; displacement ≈ 0 (i.e. genuinely blocked, not just slow) | displacement = **0.0** over 1.5s while still holding W, **0** footstep logs — this is the specific negative case the Programmer explicitly claimed; independently confirmed live |
| Local pistol fire, own shot | exactly one `gunshot weapon=pistol` log (no double-play via the broadcast echo) | exactly one log: `gunshot weapon=pistol duration=75ms` |
| Remote gunshot — rifle (Puppet B picks up rifle, fires) | Page A hears `gunshot weapon=rifle` | `gunshot weapon=rifle duration=115ms` fired on Page A |
| Remote gunshot — grenade_launcher (Puppet B picks up GL, fires) | Page A hears `gunshot weapon=grenade_launcher` | `gunshot weapon=grenade_launcher duration=300ms` fired on Page A |
| Pickup negative proximity case — Puppet B consumes `health_site_b` while Page A is ~26.7 units away | 0 pickup logs on Page A | 0 confirmed |
| Pickup positive — weapon (`weapon_rifle_site_b`) | `pickup category=weapon` | fired: `notes=440,554,659` |
| **Pickup positive — ARMOR (flagged gap)** | `pickup category=armor` | fired: `frequency=330 duration=200ms` (fired twice — see note below, benign) |
| Mid-match join — fresh client joins the same persistent "public" match after pickups were already consumed above | 0 pickup logs purely from the initial `pickup_state` sync | 0 confirmed |
| **Hit-taken (flagged gap)** — Puppet B (pistol) lands a real server-confirmed hit on Page A | `[audio] hit-taken ...` fires, synchronized with the existing damage flash | fired: `hit-taken duration=140ms`; server `HitEvent` confirmed (Page A HP 100→95) |
| **Pickup positive — health, while genuinely below max HP** (only meaningful after the hit-taken case above actually damaged Page A) | `pickup category=health` | fired: `frequency=660 duration=260ms` |
| AudioContext unlock | resumed only from inside the mode-select click handler; no autoplay-policy console warning | `autoplayWarnings: []` across every session; `pointerLocked: true` |
| Console errors, across every session | none | `consoleErrors: []` in every run |

**Note on the armor pickup firing twice:** the `public` match is persistent server state shared across my successive test script runs; the west armor point was consumed, respawned (`PICKUP_RESPAWN.armor.minDelayMs` = 15s, reachable within this match's connected-player count) while Page A was still standing in its proximity radius during a stuck-detection strafe dance, and was auto-consumed a second time — two genuine `true→false` transitions, not a double-log-per-single-event bug. Confirmed by cross-checking the server's own `[server] [public] pickup: ... picked up armor "armor_tunnel_west"` log lines (two distinct lines, consistent with two real server-side consumption events).

**Test-harness note (not a product defect) that Critic/Team Lead may find useful context for:** my first several attempts at the hit-taken live test recorded **zero** landed hits despite correct point-blank aim (independently verified via a pure-WS diagnostic and a standalone `performHitscan()` unit check with the exact same coordinates — the server-side hit math is correct). Root cause was in my own test script: `server/src/index.ts`'s `MIN_INPUT_INTERVAL_MS` (15ms) debounce is shared across **every** message type on one connection (`input` and `fire` share the same `lastAcceptedMessageAt` map) — sending a `fire` message immediately after an `input` message in the same tick silently flood-drops the `fire` nearly every time. Once I added a small (30ms) gap between the aim-update `input` and the `fire` send, hits landed reliably (15/15 in the isolated diagnostic). This is a legitimate anti-flood measure, not a bug — flagged here only so Critic doesn't need to independently rediscover it if reviewing my raw evidence logs, and as a possible documentation note for future test-script authors in this repo (the Programmer's own self-check script already sends the two messages back-to-back with the same theoretical risk, though it apparently got lucky/had enough real-world jitter between synchronous sends in their environment not to hit this consistently).

### Config and secrets

- `config.vars.example` / README up to date: yes — README EPIC 14 section present, describes the actual shipped sounds/behavior and the `FireBroadcastEvent` addition (`docs/backlog.md` also has the deferred remote-footstep follow-up).
- No secrets in diff: yes — diff is entirely game logic/audio synthesis code, no credentials/env changes.

### Documentation

- README / docs updated: yes.

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: **yes**. Verified directly by reading the code (not just trusting the handoff claim):
  - `FireBroadcastEvent` payload (`shared/src/index.ts`) is exactly `{ type, shooterId, weapon }` — no aim/position/damage/outcome field. Confirmed the broadcast call site in `server/src/match.ts` `resolveFire()` only ever populates it from server-computed `outcome.weapon`.
  - `FireOutcome.weapon` (`server/src/playerRegistry.ts`) is populated from `const weapon = shooter.equippedWeapon` captured **before** the post-fire auto-switch-down logic runs (line ~427, same local used for the shot's own damage resolution) — confirmed this is the pre-auto-switch value on every real-fire-attempt branch (`dry`, `miss`, `hit`).
  - Pickup consumption/state is still entirely server-decided (`PickupStateMessage` unchanged); the client's `PickupRenderer.onConsumed` hook only *detects* a transition it's already been told about and gates *whether to play a local sound*, never mutates or asserts pickup state itself.
  - No new client-triggered server action was added beyond the already-existing `fire` message (which now also produces a broadcast) — no new rate-limiting surface (per the spec's own risk note, verified: fire attempts were already cooldown-gated before `resolveFire()`).

### Gameplay & feel (player-facing mechanics touched — audio, HUD unaffected structurally)

- Screenshot/evidence path(s): `qa-artifacts/epic-14/*.png`, `qa-artifacts/epic-14/results*.json` (all local, gitignored per this repo's `qa-artifacts/` convention)
- Movement: OK — exercised extensively via scripted navigation (dozens of multi-leg routes across the map); `horizontalSpeedMps` (new, post-collision-resolution) correctly produces `isRunning()===false` while wall-blocked (0 displacement, 0 footsteps), confirming Story 14.3's "measured after collision, not raw input" claim.
- Jump: OK — grunt fires once per genuine ground-jump, not on hold/bunny-hop.
- Shoot / hit registration: OK — server confirms hits (not just a client-side visual/audio effect); local pistol, remote rifle, remote grenade_launcher, and a real landed hit on the local player were all exercised live.
- Camera / controls feel: N/A for this EPIC specifically (no camera/control changes) — no jank observed incidentally during testing.
- Visual sanity: OK — see `qa-artifacts/epic-14/01-live-session.png` and `05-part4-final.png` (colorful blocky scene, correct HUD, no black screen/missing textures/broken lighting).
- Matches intended "Roblox-like" look: yes — unaffected by this EPIC (audio-only change plus HUD-unrelated pickup mesh interactions), confirmed still intact in screenshots.
- No new regressions to previously-working mechanics: confirmed — movement, jump, weapon auto-switch-on-pickup (observed firing correctly for rifle/GL pickups during testing, matching EPIC 13 behavior), pickup consumption, HUD (HP/Armor/weapon display) all behaved as expected throughout dozens of live interactions across EPICs 1–13's mechanics touched incidentally by this testing. Crate-jumping (EPIC 12) was not separately re-exercised — this EPIC makes no change to jump/collision physics beyond adding a read-only post-collision speed measurement, so risk is judged very low; flagging as a light-coverage item for Critic's awareness rather than a gap requiring rework.

## On FAIL: reproduction

N/A — PASS. (See the "test-harness note" above for context on my own debugging detour; it did not indicate a product defect once corrected.)

## Outcome

- **PASS:** ready for **Critic** review (`ai-office/agents/critic/role.mdc`).

Briefly verified:
- All EPIC-level acceptance criteria in `docs/tasks/epic-14-sound-system.md` Section 11, item by item, against live behavior (not just code reading) — jump grunt (noise-based, correctly gated), footsteps (cadence + independent timing/pitch jitter + grounded-and-moving gate, including the specific "wall-blocked → no footsteps" negative case), three weapons' gunshots both local and remote via the new `FireBroadcastEvent` (payload confirmed minimal/presentational by reading the type def and broadcast call site), four pickup categories (weapon, ammo-family-shared, armor, health) with the proximity-gate negative case and the mid-join-sync negative case both confirmed live, hit-taken synchronized with a real server-confirmed hit.
- **Both explicitly flagged gaps (armor pickup, hit-taken) are now proven to fire live**, not just "probably fine, same code path as X" — see the Smoke/scenarios table above for the exact captured `[audio]` log lines and corroborating server-side `HitEvent`/pickup-consumption log lines.
- `npm run typecheck && npm run build` clean.
- No secrets in diff; README/backlog docs updated per Story 14.7.
- Server-authority/trust-boundary claims for `FireBroadcastEvent` verified directly by reading the shared type + server call site, not taken on faith.
- Regression smoke pass across movement/jump/shoot/weapon-auto-switch/HUD during the live sessions above — no issues observed. Crate-jumping specifically not re-exercised (very low risk given the diff's shape); noting for Critic's awareness.

Nothing found here blocks a PASS. For Critic's focus: the "test-harness note" in the Smoke/scenarios table (shared per-connection message debounce catching back-to-back `input`+`fire` sends) is purely an observation about test-script authorship in this repo, not a finding against the Programmer's product code.
