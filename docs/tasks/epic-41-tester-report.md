# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 41 — Spawn Protection Must Block Firing (`docs/tasks/epic-41-spawn-protection-no-fire.md`); AC §6; tasks 41.1–41.5 |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-41-programmer-handoff.md` (handoff tip was `e43a9b5` / impl `05ca5a1`); QA on branch tip `795c684` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Node via nvm v22.20.0 / npm 10.9.3; Redis `PONG` on `:6379`; Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-41-spawn-protection-no-fire` @ `795c684502e24c193c0ed1ae4090071379c73b7a` (impl commit `05ca5a1`)
- Live stack for smoke: `CUBEWARS_SERVER_PORT=7795` → `ws://127.0.0.1:7795`; client Vite `http://127.0.0.1:5215/`
- Evidence script: `scripts/qa-epic41-tester-playwright.mjs` (Tester-authored; artifacts under `qa-artifacts/epic-41/`)

## Check results

Checklist sections applied: **Universal**, **Build and run**, **Backend / game server**, **Client**, **Real-time / multiplayer** (server-authoritative fire gate; client UX-only suppress), **Gameplay & feel**. Docs: README Current status note present; no new env vars.

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client `tsc --noEmit` clean; server `tsc` + client Vite production build OK

### Run

- Command: `npm run regression:spawn-protection`; live Playwright smoke via `node scripts/qa-epic41-tester-playwright.mjs`
- Result: OK — `[spawn-protection] PASS`; Playwright `[epic41-qa] ALL PASS`; 0 pageerrors on exercised path

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| AC: typecheck/build | PASS | **PASS** |
| Server: protected shooter no-op | No ammo spend, no hit, no `weapon` on outcome (→ no fire_broadcast), protection TTL unchanged | **PASS** — regression EPIC 41 cases; `registry.fire()` early-returns `{ hit:false, dry:false }` when `isSpawnProtected(shooter)` |
| Server: fire after window | Hit + ammo consume + weapon on outcome | **PASS** — regression “after shooter protection expires” (rifle ammo 12→11, hit true) |
| Incoming immunity (EPIC 36) | Protected targets still unhittable (hitscan/splash/projectile/env); unprotected still hittable | **PASS** — same regression script still covers EPIC 36 cases before EPIC 41 block |
| Humans/bots same path | Bot id through `registry.fire()` same no-op | **PASS** — regression bot-id case; live bots match uses same resolveFire path |
| Cooldown not burned on blocked attempts | Human/bot skip `lastFireAcceptedAt` while protected | **PASS** — code path verified in `index.ts` / `botAI.ts` (gate before stamp); preferred AC met |
| Client: suppress while protected | No muzzle/viewmodel/gunshot juice; no outbound `{type:"fire"}` | **PASS** — live: `muzzleVisible=false`, `outboundFireCount=0` while `SPAWN PROTECTED` + `protected:true` (`01` + smoke-summary) |
| Client: fire after window | Muzzle + outbound fire (+ fire_broadcast possible) | **PASS** — live: `muzzleVisible=true`, outbound fire ≥1, hold-fire also fires (`04`/`05`) |
| Live evidence | Ghost cannot fire; after ~2s fire resumes | **PASS** — `qa-artifacts/epic-41/` Playwright ALL PASS |

### Config and secrets

- `config.vars.example` / README up to date: N/A new env vars (none); README Current status updated for EPIC 41
- No secrets in diff: yes (feature diff vs `master`: README, client, server, scripts, docs only)

### Documentation

- README / docs updated: yes — README Current status EPIC 41 note; approved spec + programmer handoff committed on branch

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — authoritative no-op in `PlayerRegistry.fire()` via `isSpawnProtected(shooter)`; client gate is broadcast `serverTimeMs < spawnProtectedUntilMs` only (same as HUD); cheating past client still blocked server-side

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-41/`
  - `01-protected-fire-attempt-no-muzzle.png` — SPAWN PROTECTED ~1.0s, HP 100, fire click held, no muzzle flash
  - `02-bots-movement.png` / `03-bots-jump.png` — WASD + jump smoke
  - `04-after-window-fire-muzzle.png` — HUD cleared; pale yellow muzzle flash visible; outbound fire accepted
  - `05-after-window-hold-fire.png` — pistol hold-fire path after window
  - `smoke-summary.json`, `server.log`, `client.log`, `playwright-console.log`, `playwright-run.log`
  - Runner: `scripts/qa-epic41-tester-playwright.mjs`
- Movement: OK — KeyW exercised in bots match
- Jump: OK — Space mid-air capture
- Shoot / hit registration: OK — suppressed while protected (WS + muzzle asserts); after window muzzle + outbound fire + inbound fire_broadcast observed; server hit/no-hit covered by regression
- Camera / controls feel: OK — pointer lock acquired; look/move usable
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — viewmodel, HUD, sky/arena render
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky pistol viewmodel + HUD in live shots

### Notes (non-blocking)

- Programmer handoff tip SHA lagged later docs pin commits; QA verified branch tip `795c684` (includes handoff pin atop impl `05ca5a1`).
- Cooldown fairness is verified by code inspection + shared server gate; regression asserts no ammo/hit/weapon rather than stamping `lastFireAcceptedAt` directly.
- Live bots can damage the local player only after the protection window (observed HP drop after HUD cleared); EPIC 36 incoming immunity remains covered by `regression:spawn-protection`.

## On FAIL: reproduction

### Failure reason

- N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Briefly verified: AC §6 typecheck/build; server fire no-op while spawn-protected (no ammo/hit/weapon/broadcast) + fire after window; EPIC 36 incoming immunity still PASS in same regression; human/bot shared `registry.fire()`; cooldown stamps skipped when protected; client suppresses juice + outbound fire while protected then resumes; Playwright evidence under `qa-artifacts/epic-41/`.
