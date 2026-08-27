# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-27 |
| Task / Story / EPIC | EPIC 56 — Pet armor max HUD + pet grant integrity + combat HUD typography |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-56-programmer-handoff.md` @ tip `052be05` (impl `ef81c3f`) |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (local Node `v24.18.1` via nvm); Redis localhost for economy
- Branch / commit: `feature/epic-56-pet-armor-max-hud` / `052be058d8eca8dca86b22e7d3c7f6fdf2fa539a`
- Worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-56-pet-armor-max-hud`

## Checklist sections applied

- Universal (AC, secrets, docs)
- Build and run (typecheck + regressions + Playwright)
- Backend / game server (maxArmor authority, pickups, multipliers)
- Client (HUD CSS, ratings strip, About)
- Gameplay & feel (live vs-bots join + move/jump/shoot smoke + screenshots)

## Check results

### Build

- Command: `npm run typecheck` (shared + server + client)
- Result: OK — all workspaces `tsc --noEmit` clean

### Run

- Command: `npm run regression:epic56-pet-armor-max`
- Result: OK — `[epic56-pet-armor-max] PASS` (156/156, 22/100, 0/100, pickup, respawn, cat HP, bird/lion multipliers)
- Also OK: `regression:weapon-autoswitch`, `regression:epic31-bot-loadouts`, `regression:economy-pets`
- Playwright: `node scripts/qa-epic56-tester-playwright.mjs` → `[epic56-tester] ALL PASS` (note: process can hang on SIGKILL wait after PASS; evidence written)
- Programmer Playwright: `node scripts/qa-epic56-programmer-playwright.mjs` → `[epic56] ALL PASS` (typography CSS)

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Dog armor 156 spawn | Server + HUD `156/156` | Live bots join after seeding slot-1 dog 156: `armor=156 maxArmor=156`, HUD `156/156` |
| Dog armor 22 | `22/100` | Regression: `player.armor=22`, `maxArmor=100` |
| No dog | `0/100` | Regression: `armor=0`, `maxArmor=100` |
| Armor pickup toward raised max | Caps at `player.maxArmor` (can fill toward 156) | Regression: pickup from 140 applies; at 156 → `applied=false` |
| Respawn dog 156 | Restores `156/156` even if stale maxArmor | Regression: after kill/respawn `156/156` |
| Cat HP integrity | Full current/max on spawn; heal toward boosted max | Regression: spawn `245/245`; heal above 100 toward max; respawn full — **Verified OK** |
| Bird speed / lion damage | `1 + rating/100`, no wrongful clamp | Shared math + registry `stepPlayer` / `scaleWeaponDamage` use multipliers unclamped — **Verified OK** |
| Ratings strip | `formatRatingGrant` style, non-zero axes | Live: `+156 Armor`; CSS inject: `+145 HP · +156 Armor · +100% Speed · +50% Damage` |
| Typography 1280×800 | `.hud-value` ~50px; `#ratingsHud` ~36px; no right overflow | Computed `50px` / `36px`; `ratingsRight=1262` ≤ 1280 |
| About EN+RU dog armor | No “caps at 100”; documents max(100, pet) / 156/156 | EN+RU both updated; screenshots taken |
| Changelog | EPIC 56 entry present | `client/public/changelog.json` top entry 2026-08-27 |

### Config and secrets

- `config.vars.example` / README up to date: N/A (no new env vars)
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — About EN+RU pets.dog; changelog; shared JSDoc for `maxArmor` / `armorBonusFromRatings`; EPIC/handoff docs

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — `PlayerRecord.maxArmor`, spawn/respawn armor, armor pickup cap, health max/heal, speed/damage multipliers computed server-side; client HUD renders `PlayerState` + `economy_profile` ratings via `formatRatingGrant` (display only)

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-56/tester/t01-combat-hud-1280x800.png` — typography inject 245/245 · 156/156 · grant strip
  - `qa-artifacts/epic-56/tester/t02-armor-156-156.png`, `t03-ratings-grants.png`
  - `qa-artifacts/epic-56/tester/t04-about-pets-ru.png`
  - `qa-artifacts/epic-56/tester/t05-live-bots-hud-156.png` — live match armor **156/156**, ratings **+156 Armor**
  - `qa-artifacts/epic-56/tester/t06-live-armor-closeup.png`, `t07-live-ratings-grants.png`
  - `qa-artifacts/epic-56/tester/t08-gameplay-smoke.png` — after W / Space / LMB
  - `qa-artifacts/epic-56/tester/tester-playwright-run.log`, `qa-artifacts/epic-56/qa-result.txt` (`PASS`)
  - Programmer: `qa-artifacts/epic-56/01-…` through `05-…`
- Movement: OK — KeyW held ~400ms in live bots match; scene advanced (sky view after look)
- Jump: OK — Space pressed; no stuck state observed
- Shoot / hit registration: OK — LMB click smoke (fire input sent); hit registration not the epic focus; combat path unchanged per regressions
- Camera / controls feel: OK — canvas click + mouse move; pointer-lock overlay present then smoke continued
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — blocky map, pistol viewmodel, HUD readable
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`).

### Briefly verified

1. Effective `maxArmor = max(100, petArmor)` with live HUD **156/156** for dog 156; regression covers 22/100 and 0/100; pickups use `player.maxArmor`.
2. Cat HP / bird speed / lion damage integrity **Verified OK** (regression + code path audit); no wrongful clamps found.
3. Ratings strip uses EPIC 51 `formatRatingGrant` (non-zero axes only).
4. Typography: health/armor values **50px**, ratings **36px**, usable at 1280×800 (no right overflow).
5. About EN+RU + changelog updated for dog armor ceiling behavior.
6. Typecheck + related regressions PASS; Playwright evidence under `qa-artifacts/epic-56/`.

### Handoff notes for Critic (Krisya)

- Do **not** merge or deploy from this QA sign-off.
- Tip SHA verified: `052be058d8eca8dca86b22e7d3c7f6fdf2fa539a` (impl commit `ef81c3f`).
- Untracked QA helper used for evidence: `scripts/qa-epic56-tester-playwright.mjs` (Tester-authored; not part of Programmer delivery — Critic may note whether to keep on branch).
- Known process quirk (from handoff): Playwright `stop()` may hang after ALL PASS; artifacts already written.
- Compare URL (from handoff): https://github.com/ryu878/cubewars/compare/master...feature/epic-56-pet-armor-max-hud (`gh pr create` previously failed on auth).
