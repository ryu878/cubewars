# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-26 |
| Task / Story / EPIC | EPIC 46 — Multi-Map Catalog, Map Picker, Expanded Base, 8-Player Public |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-46-programmer-handoff.md` @ impl `ccc437a` / tip `43a6789` on `task/epic-46-multi-map-select-capacity` |
| Status | **PASS** (QA sign-off) — ready for **Critic** (not Team Lead) |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Linux 5.15 (local Node via nvm v22.20.0); Redis at `127.0.0.1:6379` for accounts/economy
- Branch / commit: `task/epic-46-multi-map-select-capacity` worktree `.claude/worktrees/epic-46-multi-map` (tested against tip `43a6789`; QA commit follows)

## Check results

Checklist sections applied: Universal; Build and run; Backend / game server; Client; Real-time / multiplayer (authority + capacity); Gameplay & feel.

### Build

- Command: `npm run typecheck && npm run build`
- Result: OK — shared/server/client typecheck clean; server `tsc` + client Vite production build OK

### Run

- Command: `npm run regression:epic46-maps` && `npm run regression:lobby-nicknames` && `npm run regression:endless`
- Result: OK — all three printed PASS (`[epic46-maps] PASS`, `[lobby-nicknames] PASS`, `[endless] PASS`)
- Playwright: `node scripts/qa-epic46-tester-playwright.mjs` → `[epic46-qa] ALL PASS`

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Lobby map picker | `#mapSelect` visible; 8 catalog maps | OK — Base + 7 themed ids/labels; screenshot `01-lobby-map-picker.png` |
| Lobby list shows map + capacity 8 | Rows include map name and `/8` | OK — `Game 1 · Base · 0/8`, `Game 2 · Rust Canyon · 1/8`; `02-lobby-list-map-name.png` |
| Join Public with `rust_canyon` | Server creates match on that map | OK — server log `public-2 map=rust_canyon (8 max players)` |
| Join Bots Base | `map_state` expanded Base with building + car | OK — bounds ±92/±52; `base_bld_*` doors/windows walls; 6 `base_car_*` props; screenshots `03`–`08` |
| Join Bots Rust Canyon | Distinct themed geometry via `map_state` | OK — `rc_*` ravine/wreck ids; screenshot `09-rust-canyon-in-match.png` |
| Move / jump / fire on Base | Position changes; jump + fire smoke | OK — `moved: true` (Δz ≈ 9.3); jump/fire screenshots |
| Endless regression | Endless still works (no map picker required) | OK — `regression:endless` PASS |
| Capacity / authority regressions | Cap 8; ignore client mapId on join-existing; `map_invalid` | OK — covered by `regression:epic46-maps` + lobby nicknames spillover |

### Config and secrets

- `config.vars.example` / README up to date: yes — no new env vars; README Current status documents EPIC 46
- No secrets in diff: yes

### Documentation

- README / docs updated: yes — README EPIC 46 status; programmer handoff documents 2× linear Base scale

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: yes — match `mapId`, geometry/spawns/pickups/bounds from catalog; join-existing ignores client `mapId`; invalid → `map_invalid`; client renders from `map_state` only (verified via WS tap + regressions)

### Gameplay & feel (if player-facing mechanics/visuals touched — see `ai-office/checklists/qa-checklist.md`)

- Screenshot/evidence path(s):
  - `qa-artifacts/epic-46/01-lobby-map-picker.png`
  - `qa-artifacts/epic-46/02-lobby-list-map-name.png`
  - `qa-artifacts/epic-46/03-base-in-match-spawn.png`
  - `qa-artifacts/epic-46/04-base-building-approach.png`
  - `qa-artifacts/epic-46/05-base-car-area.png`
  - `qa-artifacts/epic-46/06-base-movement.png`
  - `qa-artifacts/epic-46/07-base-jump.png`
  - `qa-artifacts/epic-46/08-base-fire.png`
  - `qa-artifacts/epic-46/09-rust-canyon-in-match.png`
  - `qa-artifacts/epic-46/smoke-summary.json`
  - `qa-artifacts/epic-46/playwright-run.log`
  - Helper: `scripts/qa-epic46-tester-playwright.mjs`
- Movement: OK — server position changed after KeyW with pointer lock
- Jump: OK — Space held; screenshot captured mid-jump path
- Shoot / hit registration: OK — LMB fire smoke (visual); hit registration not newly in EPIC scope; no regression noted
- Camera / controls feel: OK — pointer lock acquired; look/move usable
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — colorful blocky arena visible on Base and Rust Canyon
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — AABB walls/crates/props readable; themed layouts distinct in `map_state`

### Acceptance criteria (EPIC §6)

- [x] Lobby shows map names; choose map for public/bots; listed matches show map
- [x] 8 maps playable (catalog ids present in picker + Base/Rust Canyon exercised live)
- [x] Base larger (~4× area via 2× linear), named Base, building + car in geometry
- [x] New maps ~same bounds; Rust Canyon thematically distinct
- [x] Public capacity 8; spawn/pickup density covered by catalog + regressions
- [x] Server-authoritative geometry via catalog + `map_state`
- [x] Typecheck/build + regressions + Playwright evidence
- [ ] Merge + push + deploy — **out of Tester scope** (Critic → Team Lead)

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified map picker (8 maps), lobby map names + capacity 8, expanded Base building/car via `map_state`, Rust Canyon themed join, server ownership of `mapId`, typecheck/build, `regression:epic46-maps` / `lobby-nicknames` / `endless`, and Playwright evidence under `qa-artifacts/epic-46/`.
- **Next:** Critic (Krisya). Do **not** hand to Team Lead for merge until Critic APPROVED (or Judge ALL_CLOSED).
