# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-25 |
| Task / Story / EPIC | EPIC 33 — Avatar Color Customization (Player Palette + Bot Random Colors) |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-33-programmer-handoff.md` / impl `31d7ce0` / branch tip `2f42bb2` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (host Node via nvm v24.18.1 / npm 11.16.0); Redis available (`PONG`); Playwright Chromium + SwiftShader
- Branch / commit: `task/epic-33-avatar-color-customization` @ `2f42bb213846922aeb0370dd1c2e65fc7c8276dd`

## Checklist sections applied

- Universal (AC, secrets, docs)
- Build and run
- Backend / game server (AvatarProfileStore Redis; `avatar_set_color` validation; bot spawn colors)
- Client (Appearance UI + per-avatar materials)
- Real-time / multiplayer (two-client broadcast + reconnect persist; illegal payload rejection)
- Gameplay & feel (move / jump / shoot smoke; visual isolation; spawn-protection opacity on colored avatars)

## Check results

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client typecheck PASS; server `tsc` PASS; client Vite production build PASS

### Run

- Command: `npm run regression:avatar-colors` (+ related regressions)
- Result: OK — `[avatar-colors] PASS`; also `regression:spawn-protection` PASS, `regression:epic31-bot-loadouts` PASS, `regression:playerstate-equipped-weapon` PASS
- Live: `node qa-artifacts/epic-33/qa-epic33-tester-playwright.mjs` (dedicated server `:7783` / client `:5201` / selfcheck Vite `:5190`) — PASS

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Diff scope | shared palette/protocol + avatar store + client materials/UI + bots; separate from EconomyStore | Confirmed vs `master...HEAD`: `shared/src/avatar.ts`, `PlayerState.avatarColors`, `server/src/avatarProfile.ts` (`cw:avatar:v1:…`), WS handler, `remotePlayers` per-avatar materials, inventory Appearance UI, bot spawn colors, regression script |
| Palette + types | 6–8 fixed colors; indices on wire | 8-color `AVATAR_COLOR_PALETTE`; `AvatarColors` indices; regression validates range helpers |
| Appearance UI | 4 rows × swatches in inventory (I) | PASS — 4 rows × 8 swatches; status `Appearance: legs → 8`; evidence `14-appearance-swatches-scrolled.png` (panel scrolls; rows sit below grid fold) |
| Persist reconnect | same nickname keeps colors | PASS — selected `{head:2,torso:5,hands:3,legs:7}` after reconnect (`08-…`, `smoke-summary.json`) |
| Other clients see colors | B observes A's `avatarColors` in `world_state` | PASS — B tap saw A's indices; A saw B's distinct set; no cross-corruption |
| Material isolation | recolor A must not recolor B | PASS — selfcheck materials: after recolor A, B hexes unchanged (`01`/`02`) |
| Illegal payloads | reject bad `part` / out-of-range index; no crash | PASS — `face` / `99` / `-1` left colors at defaults; valid `head=3` still applied (`illegal-payload.json`) |
| Bot random colors | varied sets + server log | PASS — Bot1 `0,7,5,7` vs Bot2 `2,5,7,4`; logs `colors=h#/t#/a#/l#` |
| Spawn-protection opacity | still works with colored materials | PASS — selfcheck protected opacity `0.35` then restore `1`; live HUD `SPAWN PROTECTED` on colored bots join (`13-…`) |
| EPIC 17/31 tells | weapon / pet / amulet still render | PASS — selfcheck `hasWeapon`/`hasPet`/`hasAmulet` flags true on fixtures |
| Economy untouched | separate key namespace | PASS — `cw:avatar:v1:` module; server log shows both `[avatar] redis ready` and `[economy] redis ready`; no economy protocol changes in diff |

### Config and secrets

- `config.vars.example` / README up to date: N/A — no new env vars (reuses Redis URL/prefix); README not required for this cosmetic AC
- No secrets in diff: yes

### Documentation

- README / docs updated: yes for task docs (`docs/tasks/epic-33-*.md`); README unchanged (no new run instructions)

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — `part` ∈ head\|torso\|hands\|legs and in-range `paletteIndex` validated in `match.handleAvatarSetColor`; persist via `AvatarProfileStore`; broadcast only server `PlayerRecord.avatarColors`. Client sends intent only; optimistic UI highlight is non-authoritative.

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-33/01-selfcheck-three-avatars-distinct-colors.png`
  - `qa-artifacts/epic-33/02-selfcheck-recolor-A-B-unchanged.png`
  - `qa-artifacts/epic-33/03-selfcheck-spawn-protection-opacity-restored.png`
  - `qa-artifacts/epic-33/04-appearance-ui-default.png` / `05-appearance-ui-after-picks.png` / `14-appearance-swatches-scrolled.png`
  - `qa-artifacts/epic-33/06-client-b-sees-remote-a.png` / `07-client-b-appearance.png` / `08-reconnect-appearance-persisted.png`
  - `qa-artifacts/epic-33/09-bots-match-varied-colors.png` … `13-bots-spawn-protection-with-colors.png`
  - `qa-artifacts/epic-33/smoke-summary.json` / `server-log.txt` / `illegal-payload.json`
  - Runner: `qa-artifacts/epic-33/qa-epic33-tester-playwright.mjs`
- Movement: OK — WASD in bots match (`10-bots-movement.png`)
- Jump: OK — Space midair capture (`11-bots-jump.png`)
- Shoot / hit registration: OK — fire smoke path exercised (`12-bots-fire-smoke.png`); no combat regression claimed beyond smoke
- Camera / controls feel: OK for verification path (pointer lock + look); no new control scheme
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — selfcheck + live arena readable; colorful per-part materials
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — distinct bright body-part colors on existing blocky avatars; weapon/pet/amulet tells retained

## On FAIL: reproduction

N/A (PASS)

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified: typecheck/build green; `regression:avatar-colors` (+ spawn-protection / epic31 / equipped-weapon) PASS; live two-client broadcast + Redis persist across reconnect; illegal `avatar_set_color` ignored without state corruption; per-avatar material isolation (no shared-material leak); bots spawn with varied logged colors; Appearance UI 4×8 swatches in inventory; spawn-protection opacity still applies on colored avatars. Evidence under `qa-artifacts/epic-33/`.
