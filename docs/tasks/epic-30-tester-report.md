# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 30 — Weapon Viewmodel & Pickup Visual Polish (Round 2); Stories 30.1–30.4 |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-30-programmer-handoff.md` — implementation `8029c65`; branch tip `1501bae` (handoff pin) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15; Redis via `cubewars-redis-dev` on `:6379`
- Branch / commit: `task/epic-30-weapon-pickup-visual-polish` @ `1501bae` (feat `8029c65`)
- Checklist sections applied: Universal; Build and run; Client; Gameplay & feel. Backend/server authority N/A beyond confirming cosmetic-only scope. Real-time reconnect N/A.

## Check results

### Build

- Command: `npm run typecheck --workspace=client` && `npm run build --workspace=client`
- Result: OK — typecheck clean; Vite production build succeeded (`dist/assets/index-*.js`)

### Run

- Command (deterministic): `node scripts/qa-epic30-programmer-selfcheck-playwright.mjs selfcheck`
- Result: OK — `[qa] PASS (selfcheck)`, console errors: 0
- Command (live): server `CUBEWARS_SERVER_PORT=7779`, client `VITE_CUBEWARS_WS_URL=ws://localhost:7779` on `:5199`; then `node scripts/qa-epic30-programmer-selfcheck-playwright.mjs live http://localhost:5199 ws://localhost:7779`
- Result: OK — `[qa] PASS (live)`, joined public as `Qa30Leu64v6`, `moveDist: 9.14`, console errors: 0

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Diff confined to client mesh + QA/docs | No `server/` / `shared/` gameplay edits | `git diff master...HEAD --name-only` → only `client/src/viewmodel.ts`, `client/src/pickups.ts`, epic-30 docs, Playwright script |
| Viewmodels distinguishable (pistol / rifle / GL) | Multi-material + identity details; screenshots | Idle `01` grey pistol (grip + slide + sight); `05` orange/brown rifle (stock/foregrip/mag/rail); `09` purple GL (chunky barrel + muzzle rim). Clearly different silhouettes/colors |
| Muzzle flash + fire path | Flash still works per weapon | `03` / `06` / `10` show visible muzzle flash spheres; live `31-live-viewmodel-pistol-fire.png` shows flash glow |
| Idle sway | Viewmodel position changes over time | `02-sway-frame-0..3` pixel diffs vs frame 0 (mean_diff ~0.6–1.7, max channel 249) — not static |
| Empty-ammo dim | `setEmpty(true)` darkens materials | `14` vs `09` mean_diff 2.34; cropped viewmodel luma 154.7 → 148.3 |
| World weapon + ammo pickups | Multi-material weapons; ammo lid accent | Lineup `20-pickups-lineup-side-by-side.png`: orange rifle + purple GL meshes; wood crates with orange/purple lids; smaller/plainer than weapons |
| Armor reads as armor | Breastplate / not generic gem | `11` / `12`: steel-blue plate + collar + center ridge + diagonal brown strap + corner rivets — unambiguous armor vs medkit/weapons |
| Health still distinct | Medkit remains white + red cross | Lineup rightmost object is white box with red cross |
| Live movement / jump / shoot | No regression | Live smoke: walked ~9.1 units, Space jump captured (`32`), pistol fire with flash (`31`); 0 console errors |
| No console errors / black meshes | Clean render | Selfcheck + live: 0 console errors; screenshots show lit geometry, no missing textures |

### Config and secrets

- `config.vars.example` / README up to date: N/A — no new env vars or run-behavior change
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — EPIC spec + programmer handoff on branch; optional idle bob/spin noted as intentionally skipped (spec nice-to-have)

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: N/A — cosmetic mesh/material only; pickup radius / protocol / combat untouched (confirmed by file list)

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s): `qa-artifacts/epic-30/` (re-run by Tester 2026-08-25; logs `playwright-selfcheck-tester.log`, `playwright-live-tester.log`)
- Movement: OK — live `moveDist` 9.14
- Jump: OK — Space pressed; `32-live-jump-smoke.png` captured mid-air / sky look
- Shoot / hit registration: OK for visual fire path (muzzle flash in selfcheck + live); damage path untouched by this epic — not re-balanced here
- Camera / controls feel: OK — usable FPS aim/look in live join; no jank observed in short smoke
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — blocky multi-primitive composites, bright category colors, flat materials

#### Before / after (armor) — Tester note

- **Before (EPIC 10, per Programmer notes + prior epic knowledge):** hex-plate cylinder + sphere boss — abstract faceted gem.
- **After (this build):** breastplate silhouette with strap and rivets (`11`, `12`, lineup slot 5). Reads as armor at a glance; distinct from ammo crates and health medkit.

#### Evidence index (key frames)

- Viewmodels: `01`, `05`, `09` (idle); `03`, `06`, `10` (fire); `14` (empty dim); `02-sway-frame-*`
- Pickups: `20-pickups-lineup-side-by-side.png`, `11`/`12` armor
- Live: `30-live-viewmodel-pistol.png`, `31-live-viewmodel-pistol-fire.png`, `32-live-jump-smoke.png`
- Notes: `BEFORE-AFTER-NOTES.md`

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified AC: client typecheck/build, client-only diff, distinguishable multi-material viewmodels (3 weapons), upgraded world weapon/ammo pickups with lid accents, armor breastplate readability, sway/recoil-flash/empty-dim still working, live movement/jump/shoot smoke with 0 console errors, screenshots under `qa-artifacts/epic-30/`.
