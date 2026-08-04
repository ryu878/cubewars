# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Task / Story / EPIC | EPIC 11 — Movement Speed Boost & Substep Collision Safety (`docs/tasks/epic-11-speed-boost-substep-collision.md`), Stories 11.1-11.4 |
| Handoff from Pusya (link/commit) | `feature/speed-boost-substep-collision` @ `91ad245` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS: Linux 5.15, Node v24.18.1 (nvm)
- Branch / commit: `feature/speed-boost-substep-collision` @ `91ad245`
- Dev server run with `NO_PROXY=localhost,127.0.0.1 http_proxy= https_proxy= npm run dev` — a proxy env var in this shell (`http_proxy=http://...:8000`) otherwise breaks local WS/HTTP to `localhost`; unsetting it was required to test at all. Client bound to `:5174` (`:5173` was occupied). Server WS on `:7777`.

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: **OK** — clean, zero errors, all three workspaces (shared/server/client) typecheck; `vite build` succeeds (only a pre-existing chunk-size warning, unrelated to this EPIC).

### Run

- Command: `npm run dev` (server on `ws://localhost:7777`, client on `http://localhost:5174`)
- Result: **OK** — server starts, client loads, WS connects, no unjustified crash.

### Smoke / scenarios

All numbers below are from my own independent runs (regression scripts I executed myself, and my own raw-WebSocket/Playwright harnesses under `scripts/qa-tester-*.mjs` and `scripts/qa-epic11-tester.mjs`), not copied from the Programmer's handoff.

| Step | Expected | Actual |
|------|----------|--------|
| `grep maxSpeed shared/src/index.ts` | `5 * 1.33 * 2` (=13.3) | `maxSpeed: 5 * 1.33 * 2,` — confirmed. No stray `33.25`/`43.2`/`5x` leftovers anywhere in the repo (`grep -rn "33.25\|43.2\|5 \* 1.33 \* 5"` → empty). |
| `npm run regression:collision-overshoot` (self-run) | shipped/stepped rows safely under 0.35m at 13.3 and ~17.3 m/s | **base (13.3, stepped): 0.0291m (4.4%)**; **boosted (~17.29, stepped): 0.0146m (1.7%)** — exact match to the Programmer's claimed numbers, independently reproduced. Naive single-step informational rows at the same two speeds (not gating) show 0.4864m/0.5307m — this is the exact problem Story 11.1 fixes, visible in the same run. Script exits **PASS**. |
| Live wall approach, straight-on, BASE speed (13.3 m/s) | player stops at wall, never crosses to far face (outer_north wall: near face z=25.5, far face z=26.5) | Ran 3s straight into `outer_north` from open lane: final/clamped position **z=25.1**, max |z| sampled over the whole run = 25.100. Never approached 26.5. |
| Live wall approach, straight-on, BOOSTED speed (~17.3 m/s) | same, at boosted speed | Triggered a real bunny-hop boost (double-jump edge) then ran into the same wall: final z=25.1 again, max |z|=25.100. No tunneling. |
| Live CORNER approach, BASE speed | never crosses either wall's far face at the corner | Dynamically aimed at the actual nearest outer corner from spawn (NE/NW/SE/SW, live target resolved per spawn point): landed at (x=45.1, z=-25.1) resp. similar, i.e. clamped at both walls' near faces simultaneously — matches EPIC 8's already-bounded corner-pop behavior, still bounded at the new speed. |
| Live CORNER approach, BOOSTED speed | same at boosted speed | Landed at (x=-45.1, z=25.1) — clamped correctly, no overshoot past 46.5/26.5. |
| Live speed measurement, BASE (raw WS client, forward held, server-clock per-tick samples) | ~13.3 m/s | **median 13.3000 m/s** over 30+ per-tick samples (max single-tick sample 13.5714 m/s, expected minor per-tick quantization). |
| Live speed measurement, BOOSTED (bunny hop, still airborne throughout the sample window) | ~17.3 m/s | **17.2469 m/s** (also got 17.2900 m/s on an earlier run before I re-oriented the harness away from a wall) — matches. |
| `git diff 320cf34..HEAD -- server/src/combat.ts` | empty (human hitscan untouched) | **Empty** — confirmed byte-for-byte untouched. |
| `npm run regression:bot-aim-miss-rate` (self-run) | high accuracy close (3/10m), real miss rate at range (20/30m) | **3m: 100% hit, 10m: 100% hit, 20m: 37.0% hit (63% miss), 30m: 25.0% hit (75% miss)**. Close to the Programmer's claimed 41.5/24.5 (or 35.5/22.5) — small run-to-run variance from the RNG jitter is expected and doesn't change the conclusion (a real, non-trivial miss rate at range, high accuracy close). Script exits **PASS**. |
| `botAI.ts` jitter scope | applied only at bot fire-trigger, never touches human path | Confirmed by code read (`AIM_JITTER_RAD = 0.05`, applied to `jitteredYaw`/`jitteredPitch` immediately before `resolveFire()`, one tick only, next tick's `ENGAGING` pass recomputes clean) + the empty `combat.ts` diff above. Minor implementation note (not a bug, flagging for Critic): the jittered yaw/pitch is applied via the same `applyInput()` the bot uses for its normal smooth turn, so for the one tick a shot fires, the bot's *broadcast* facing is also the jittered value (not just the ray). At ±0.05 rad (~3°) this is visually negligible (reads as natural aim wobble) but is a slightly different mechanism than "only the fire ray is jittered, visible facing untouched" as literally read from the spec text — worth a quick look, not a blocker. |
| Live HUD relayout screenshot | health bottom-left, armor bottom-right, weapon bottom-center, all large/bold vs before | Confirmed visually (`qa-artifacts/epic-11-tester/01-hud-bottom-spawn.png`) and via computed style: `#healthHud`/`#armorHud` now `font-size: 30px; font-weight: 800` at `bottom: 18px` (was `top: 12/44px; font-size: 14px`, no explicit weight ⇒ 400) vs `#weaponHud` unchanged at `font-size: 15px; font-weight: 600`. `git diff 320cf34..HEAD -- client/index.html` confirms exactly this before/after. Low-health red color treatment (`data-low="true"`) still works post-relayout (`04-close-range-combat.png`, health=15 shown in red). |
| Weapon pickup + auto-equip (EPIC 6 regression) | picking up a higher-tier weapon auto-equips it | Live WS client navigated to `weapon_gl_mid` (0,0,0): loadout went from `{pistol, owned:[pistol]}` → `{grenade_launcher, ammo:2, owned:[pistol, grenade_launcher]}` automatically on proximity, no explicit pickup action needed. |
| Weapon switching (E / `switch_weapon`) | cycles equipped weapon among owned | Sent `switch_weapon` twice after the above: pistol → grenade_launcher → pistol, both transitions correct. |
| Hitscan damage values (EPIC 10 rebalance regression) | pistol 5/hit | Every `hit:` server-log line and every `HitEvent.damage` observed across all live combat sessions was **exactly 5** for pistol shots (dozens of samples) — matches EPIC 10's rebalance, no regression. |
| Armor absorption (EPIC 7 regression) | armor absorbs before health | Live: picked up `armor_tunnel_east` (armor 0→20), then took four more 5-dmg hits: `hp 50/armor 20 → hp50/armor15 → hp50/armor10 → hp50/armor5` — health held constant while armor drained first, exactly the spillover rule. |
| Kill feed / scoreboard (EPIC 5 regression) | `KillEvent`/`ScoreboardMessage` fire correctly on a kill | Live duel to the death vs a bot: got killed once (`DeathEvent` + `KillEvent{attackerId:"Bot 2"}`), respawned, killed the bot back (`KillEvent{attackerId:<me>, victimId:"Bot 2"}`), final `ScoreboardMessage` showed `me:1, Bot 2:1, Bot 1:0` — correct. |
| Bot patrol/engage (EPIC 9 regression) | bots seek then engage/fire with LOS | Observed live: bots found and engaged me, and also fought each other (`Bot 1 -> Bot 2`, `Bot 2 -> Bot 1` hit lines) — patrol/engage state machine intact. |
| Match mode selection: public vs bots | both connect and play cleanly | Both joined and produced a normal HUD/world_state with 0 console errors (`qa-tester-public-mode.mjs` for public; all combat scripts above for bots). |
| Rate/abuse guard (existing, unaffected by this EPIC) | still present | Server log showed `flood guard: dropped N message(s) ... (exceeding 15ms min interval)` firing correctly during my own high-frequency test scripts — unaffected regression. |
| Console errors during all Playwright sessions | none | 0 console errors across all sessions. |

### Config and secrets

- `config.vars.example` / README up to date: **partially** — no new env vars introduced by this EPIC, nothing to add there. However, `README.md` §EPIC 6/4 still documents the **pre-EPIC-10** damage numbers (pistol 25/rifle 50/GL 100, "4 hits to kill") and has no EPIC 10 or EPIC 11 section at all yet. This predates EPIC 11 (EPIC 10's README update was apparently never done either) — flagging for Critic/Team Lead attention as accumulating doc debt, not treating as an EPIC-11-caused blocker, consistent with this repo's established pattern of README updates landing at Critic-approval time (see e.g. commit `fdbc4b3` "Critic: APPROVED for EPIC 9 ... + README update").
- No secrets in diff: yes — `git diff 320cf34..HEAD` contains no credentials/tokens/keys.

### Documentation

- README / docs updated: no (see above — not blocking per this repo's established pattern, but flagged).
- EPIC 11 spec itself (`docs/tasks/epic-11-speed-boost-substep-collision.md`) is present and was used as the acceptance-criteria source for this report.

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: **yes**. `PlayerInputMessage` carries only intent (`moveForward`/`moveRight`/`yaw`/`pitch`/`jump`), never a position; `server/src/playerRegistry.ts stepPlayer()` computes displacement and resolves it through the new `resolveSteppedMovement()` — the only helper both client prediction (`fpsController.ts`) and server authority call, so they can never structurally diverge on where a wall is. `FireEvent` carries no origin/aim payload; the server reads its own stored yaw/pitch. Bot aim jitter is applied server-side only, never client-influenced. Confirmed by code read + all live WS tests above (I could never get the client-reported position to matter — every position I observed came from `world_state`, server-broadcast).

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-11-tester/01-hud-bottom-spawn.png`, `02-movement-mid-run.png`, `03-jump-bunnyhop-midair.png`, `04-close-range-combat.png`, `05-visual-sanity-wide.png` (my own independent Playwright run); cross-referenced against Programmer's own `qa-artifacts/epic-11-programmer-selfcheck/*.png`.
- Movement: **OK** — actually held W and watched the world move past (screenshot 02 vs 01: crate/wall perspective visibly shifted); live-measured 13.3 m/s base, ~17.25-17.29 m/s boosted (see table above).
- Jump: **OK** — jump + a genuine second Space-press while airborne triggered the bunny-hop boost (screenshot 03, mid-air pose); verified server-side via `airSpeedMultiplier`/velocity math in the live speed tests, not just visually.
- Shoot / hit registration: **OK** — fired at bots, server confirmed hits via `HitEvent`/log lines with correct damage (5/hit pistol), not just a client-side muzzle flash; also confirmed a full kill → death → respawn → revenge-kill cycle server-side.
- Camera / controls feel: **OK** — no obvious jank; pointer lock engaged normally; CDP mouselook limitation (Page A's yaw stays fixed post-lock) is a known Playwright/CDP quirk documented in prior EPICs' scripts, not a game bug — worked around the same way prior Tester scripts did (fixed-forward WASD navigation, raw-WS harness for anything needing real aim).
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): **OK** — see screenshots; colorful sky gradient, textured brick/wood walls, blocky crates, no black screen or missing textures in any capture.
- Matches intended "Roblox-like" look (colorful, readable, low-poly): **yes** — unchanged visual style from EPIC 10, this EPIC didn't touch models/materials.

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`).

Briefly verified, all independently reproduced (not taken from the handoff at face value):

1. **Story 11.1/11.2 (substep collision + speed):** `resolveSteppedMovement()` exists in `shared/src/collision.ts` and is the only collision entry point used by both `stepPlayer()` and `fpsController.ts`'s local prediction (`resolveHorizontalCollisions` is still used directly only for one-off point resolution — spawn placement — which is correct, not a tick-movement path). Self-ran `regression:collision-overshoot`: shipped/stepped overshoot 0.0291m (base)/0.0146m (boosted), both well under the 0.35m ceiling, exact match to the naive single-step rows showing what would have broken (0.4864m/0.5307m) without this fix. Four live wall/corner tests (straight-on + diagonal corner, base + boosted speed) all confirmed zero tunneling, clamped at the wall's near face every time.
2. **Story 11.2 (speed):** `MOVEMENT.maxSpeed = 5 * 1.33 * 2` (=13.3), no stray 5x/33.25/43.2 literals anywhere in the repo. Live raw-WebSocket measurement (server-clock, per-tick, median of many samples): 13.3000 m/s base, ~17.25-17.29 m/s bunny-hop-boosted.
3. **Story 11.3 (HUD):** health/armor moved to the bottom flanking the weapon HUD, font-size 14px→30px and default-weight→800 (bold) — confirmed via CSS diff, computed style, and screenshot. No functional regression (values still live-update, low-health red treatment intact).
4. **Story 11.4 (bot aim jitter):** `server/src/combat.ts` is byte-for-byte untouched (`git diff 320cf34..HEAD` empty). Self-ran `regression:bot-aim-miss-rate`: 100%/100% hit close range (3/10m), 37.0%/25.0% hit at range (20/30m) — a real, non-trivial miss rate at range, high accuracy close, matching the spec's intent and close to the Programmer's claimed numbers (small variance expected from RNG). One minor implementation note flagged above for Critic (jittered yaw briefly becomes the bot's own broadcast facing for the firing tick, not just the ray) — visually negligible at this magnitude, not a functional bug.
5. **Full regression pass (EPICs 1-10):** movement/multiplayer sync, weapon pickup + auto-equip, weapon switching (E), hitscan damage (pistol 5/hit confirmed live, matching EPIC 10's rebalance), armor absorption (confirmed order: armor drains before health), kill feed + scoreboard (confirmed via a full kill/death/respawn/revenge-kill cycle), bot patrol/engage (including bot-vs-bot combat), match mode selection (public + bots both clean, 0 console errors) — all exercised live, no regressions found.

Typecheck and build both clean (`npm run typecheck && npm run build`).

### Concerns for Critic to focus on

- The minor bot-facing-jitter-visibility note under Story 11.4 above (not a functional bug, just worth a look at whether the one-tick facing snap is intentional).
- README documentation debt (pre-existing from EPIC 10, not caused by this EPIC, but now two EPICs behind — EPIC 10's damage rebalance and all of EPIC 11's changes are undocumented in `README.md`).
