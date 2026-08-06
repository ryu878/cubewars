# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-06 |
| Task / Story / EPIC | EPIC 17 / Animated Humanoid Player Avatars |
| Handoff from Pusya | `docs/tasks/epic-17-programmer-handoff.md` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: local Linux workspace, no Docker in scope.
- Branch / commit: `task/epic-17-animated-player-avatars`, local working tree.

## Check results

### Build

- Command: `npm run typecheck`
- Result: OK — `shared`, `server`, and `client` TypeScript checks passed.
- Command: `npm run build`
- Result: OK — server compiled and Vite client production build completed. Vite emitted the existing large-chunk warning only.

### Run

- Command: `npm run regression:playerstate-equipped-weapon`
- Result: OK — fresh spawn broadcasts pistol, rifle pickup broadcasts rifle, server-side weapon cycle broadcasts pistol again.
- Command: `npm run qa:epic17-avatar-selfcheck`
- Result: OK — Playwright/Vite selfcheck rendered the actual `RemotePlayers` module and captured screenshots.

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Render three remote player states plus one self state | Self is excluded; three remote avatars render | PASS — `avatarCount: 3` |
| Avatar parts | Each remote avatar has torso, head, face, arms, legs, weapon anchor | PASS — all required named parts present |
| Held weapon props | Pistol, rifle, grenade launcher are all visible and distinct | PASS — visible weapons: `weapon:pistol`, `weapon:rifle`, `weapon:grenade_launcher` |
| Facing direction | Front/side/back should be visually distinct | PASS — screenshots show face markers/front, side silhouette, and dark back panel; yaw values 0, PI/2, PI |
| Running animation | Moving avatars alternate leg length/offset | PASS — leg scale/offset differs per running check |
| Console health | No browser console errors | PASS — 0 errors |

### Config and secrets

- `config.vars.example` / README up to date: yes / no config change.
- No secrets in diff: yes.

### Documentation

- README / docs updated: yes.

### Server authority

- Server validates/computes the relevant state, not the client: yes. `PlayerState.equippedWeapon` comes from server `PlayerRecord.equippedWeapon`; no new client-originated gameplay field was added.

### Gameplay & feel

- Screenshot/evidence path(s): `qa-artifacts/epic-17-avatar-selfcheck/01-standing-facing-and-weapons.png`, `qa-artifacts/epic-17-avatar-selfcheck/02-running-leg-alternation.png`
- Movement: OK — running pose is visibly distinct from standing pose.
- Jump: N/A — not touched.
- Shoot / hit registration: N/A — combat behavior not touched; held weapon visibility only.
- Camera / controls feel: N/A — not touched.
- Visual sanity: OK — avatars render nonblank with readable front/side/back silhouettes and no console errors.
- Matches intended "Roblox-like" look: yes — simple colorful low-poly block avatars.

## On FAIL: reproduction

N/A — PASS.

## Outcome

- **PASS:** ready for Critic review. Verified protocol field, avatar hierarchy, held weapon props, orientation readability, simple run animation, screenshots, typecheck, and build.
