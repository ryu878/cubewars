# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-07-30 |
| Task / Story / EPIC | EPIC 1 — Project Scaffolding & Dev Environment (`docs/tasks/epic-01-project-scaffolding.md`) |
| Handoff from Pusya (link/commit) | `feature/project-scaffolding` @ `37d1ce8` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | no |

## Environment

- OS / Docker: Zorin OS 16.3 (Ubuntu 20.04-based), glibc 2.31, no Docker used
- Node: v24.18.1 (installed via nvm — was not present on the machine before this task)
- Branch / commit: `feature/project-scaffolding` @ `37d1ce8`

## Check results

### Build

- Command: `npm install && npm run build`
- Result: OK — `server` (`tsc`) and `client` (`tsc --noEmit && vite build`) both build clean. Note: chunk-size warning (506 kB JS bundle, mostly Three.js) — expected at this stage, not a defect.

### Run

- Command: `npm run dev` (root) — starts server (`tsx watch`) and client (`vite`) concurrently
- Result: OK — server logs `listening on ws://localhost:7777`; client Vite dev server serves on the first free port (5173 was occupied by an unrelated pre-existing local service, Vite auto-fell-back to 5174 — normal Vite behavior, not a bug)

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| Open client in browser | 3D scene renders, not blank/black | OK — ground, 8 colored blocks, red player capsule, sky background all visible (`qa-artifacts/epic-01/01-initial.png`) |
| Drag mouse on canvas | Camera orbits | OK — camera angle changed substantially between before/after screenshots (`01-initial.png` vs `02-after-camera-drag.png`) |
| Client connects to server | WS opens, `WelcomeMessage` received, status text updates | OK — status flipped from "connecting…" to `"connected — player <id>"` within ~1.5s |
| Raw WS handshake (independent of client UI) | Server sends typed `welcome` message | OK — verified directly with a throwaway `ws` client script; received `{"type":"welcome","protocolVersion":1,"playerId":"...","serverTimeMs":...}` |
| Browser console | No errors | OK — 0 console errors/pageerrors captured by the Playwright script |

### Config and secrets

- `config.vars.example` / README up to date: yes (`CUBEWARS_SERVER_PORT`, `VITE_CUBEWARS_WS_URL` both documented)
- No secrets in diff: yes (only textual explanation of the `.env` exception in README, no actual values)

### Documentation

- README / docs updated: yes — full rewrite with install/run/config/build instructions and current status

### Server authority (if gameplay-relevant state touched)

- N/A this task — no gameplay state yet, only connection handshake

### Gameplay & feel (player-facing mechanics/visuals touched)

- Screenshot/evidence path(s): `qa-artifacts/epic-01/01-initial.png`, `qa-artifacts/epic-01/02-after-camera-drag.png` (captured via `scripts/qa-screenshot.mjs`, headless Chromium + SwiftShader software GL)
- Movement: N/A — no player movement in this task (EPIC 2 scope)
- Jump: N/A — not in this task's scope
- Shoot / hit registration: N/A — not in this task's scope
- Camera / controls feel: OK — OrbitControls drag works and is smooth (damping enabled); note the test drag was large and ends looking mostly at sky, that's the synthetic test input, not a control bug
- Visual sanity (no black screen / missing textures / broken lighting / z-fighting): OK — lit, colored materials render correctly; one **minor** cosmetic note: the finite 80×80 ground plane shows a visible straight horizon edge against the sky (no skybox/horizon blending) — flagging for Critic, not treating as a blocker for a scaffolding task
- Matches intended "Roblox-like" look (colorful, readable, low-poly): yes — colorful blocks and capsule, not a bare default Three.js grey scene

## On FAIL: reproduction

N/A — PASS.

## Outcome

- **PASS:** ready for Critic review (`ai-office/agents/critic/role.mdc`). Verified: build, typecheck, dev run (server + client), end-to-end WS handshake (both via the client UI and independently via a raw `ws` script), 3D scene renders with colorful materials, camera orbit control works (proven via before/after screenshots), zero console errors, config/docs/secrets hygiene. One non-blocking cosmetic note passed to Critic: visible horizon edge on the ground plane.
