# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-27 |
| Task / Story / EPIC | EPIC 55 — Ammo does not unlock weapons; HUD `current/max` HP & armor; preserve boosted maxHealth |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-55-programmer-handoff.md`; impl `9beaea4d9d6372e82fb6d8e4c4409c533614d165`; tip tested `ec973c4b64abf7d23718243013ebd051170a0b89` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux local worktree (Node v24.18.1 / npm 11.16.0); Redis localhost for economy
- Branch / commit: `feature/epic-55-ammo-not-unlock-hud-maxhp` @ `ec973c4b64abf7d23718243013ebd051170a0b89`
- Worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-55-ammo-not-unlock-hud-maxhp`
- PR: not opened (`gh` auth blocker noted in handoff); tested branch tip anyway

## Check results

Checklist sections applied: **Universal**, **Build and run**, **Backend / game server**, **Client**, **Docs**, **Gameplay & feel**. N/A: reconnect/rate-limit (not in EPIC scope); no new env vars.

### Build

- Command: `npx tsc --noEmit -p shared && npx tsc --noEmit -p server && npx tsc --noEmit -p client`
- Result: OK — all packages typecheck clean

### Run

- Command: `npm run regression:weapon-autoswitch`; `npm run regression:playerstate-equipped-weapon`; `node scripts/qa-epic55-programmer-playwright.mjs`; `node scripts/qa-epic55-tester-playwright.mjs` (tester smoke, ports 7866/5266)
- Result: OK — all exit 0 / `OVERALL: PASS` / `ALL PASS`

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| AC1 unowned ammo | Ammo ↑; rifle not owned; E cannot cycle to rifle | **PASS** — regression case 7: `owned=[pistol]`, `rifleAmmo=12`, `autoSwitchedTo=none`, `cycleWeapon=false` |
| AC2 stockpile → weapon | Owns weapon; ammo = stockpile + pickup capped | **PASS** — case 8: stockpile 24 → weapon → `ammo=36`, `owned=true`, equipped rifle |
| AC3 owned ammo refill auto-equip | EPIC 13 no regression | **PASS** — cases 3, 5b (and 1–6 suite) |
| AC4 HUD current/max from server | `health`/`maxHealth`, `armor`/`maxArmor` on PlayerState; HUD `N/M` | **PASS** — Playwright probe `245/245`, `0/100` matching `maxHealth=245` `maxArmor=100`; wired via `main.ts` → `setHealth`/`setArmor` (no pet-rating math for combat HUD max) |
| AC5 boosted maxHealth + heal | Survives damage; medkit heals above 100 toward max | **PASS** — case 9: `maxHealth=245`, heal `80→105`, broadcast max fields present |
| AC6 regressions + Playwright | Green + `qa-artifacts/epic-55/` | **PASS** — see evidence paths below |
| AC7 About + changelog | Player-facing ammo + HUD notes; Last updated | **PASS** — `about.html` weapons/pets copy + `LAST_UPDATED=2026-08-27`; `changelog.json` EPIC 55 entry 2026-08-27 |

### Config and secrets

- `config.vars.example` / README up to date: yes (no new env vars)
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — About + changelog (player-facing-docs); task docs under `docs/tasks/epic-55-*`

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: **yes** — `PlayerRegistry.applyPickup()` owns unlock/stockpile/equip/heal caps; `toWorldState()` emits `maxHealth`/`maxArmor`; client HUD only renders server fields (fallback to `COMBAT.*` only if payload omits fields)

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-55/01-hud-current-max-in-match.png` — pet-boosted HUD `245/245` / `0/100`
  - `qa-artifacts/epic-55/02-health-hud-closeup.png`, `03-armor-hud-closeup.png`
  - `qa-artifacts/epic-55/04-about-weapons-ammo-hud.png` — About weapons copy
  - `qa-artifacts/epic-55/05-tester-movement.png`, `06-tester-jump.png`, `07-tester-look-fire.png`
  - `qa-artifacts/epic-55/playwright-run.log`, `tester-playwright-run.log`, `tester-gameplay-smoke.json`
- Movement: OK — KeyW changed server position (`z` 22.70 → 16.65; `moved=true`)
- Jump: OK — Space produced `y` lift to 0.615 (`jumped=true`)
- Shoot / hit registration: OK for smoke — left-click fire path exercised after pointer lock (spawn protection may noop hit; no combat regression observed). Ammo ownership / heal proven by whitebox regressions rather than in-match pickup automation
- Camera / controls feel: OK — pointer lock acquired; look mousemove + fire smoke
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — Base map + HUD readable in captures
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes

Note: top-right ratings strip (`HP 145` with cat equipped) is the pet-rating overlay (flat bonus), not combat current/max — combat HUD correctly shows `245/245` from server `maxHealth`. Not an AC failure.

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** ready for **Critic** review (`ai-office/agents/critic/role.mdc`).

Briefly verified: ammo never unlocks; stockpile→weapon preserves ammo; EPIC 13 owned refill auto-equip intact; HUD `current/max` from broadcast `maxHealth`/`maxArmor`; medkit heal above 100 with pet max; regressions green; Playwright + tester gameplay smoke evidence; About/changelog updated. Do **not** merge/deploy — Critic next.
