# EPIC 1: Project Scaffolding & Dev Environment

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | Project Scaffolding & Dev Environment |
| **System goal** | Stand up the fixed stack (`ai-office/global/global-standards.mdc`) as a running skeleton: a 3D client the player can look around in, and a server the client can connect to — the foundation every later gameplay EPIC builds on. |
| **Business/gameplay problem** | There is no code yet. Nothing else (movement, shooting, world) can start until client, server, and shared protocol exist and talk to each other. |
| **Architectural role** | client (renderer/UI/input) + game server (authoritative state, currently just connection handling) + shared protocol |
| **Main components** | `client/` (Three.js + Vite), `server/` (Node.js + `ws`), `shared/` (protocol types) |
| **Stack** | Fixed project stack, no deviation — see `ai-office/global/global-standards.mdc` |
| **Interaction with other components** | Client opens a WebSocket to the server on load; server sends a typed "welcome" message from `shared/`; this is the first proof the transport works end-to-end. |

## 2. Story 1.1 — Workspace setup

**As a** developer **I want** an npm-workspaces monorepo with `client/`, `server/`, `shared/` **so that** all three packages build, type-check, and reference each other correctly.

- **Inputs:** empty repo (only `README.md`, `LICENSE`, `ai-office/`, `.claude/`, `docs/`)
- **Outputs:** root `package.json` with workspaces, root `tsconfig.base.json`, `.gitignore`, `shared/` package with at least one exported protocol type
- **Acceptance criteria:**
  - [ ] `npm install` at repo root installs all three workspaces without error
  - [ ] `shared/` exports a `WelcomeMessage` type (or similarly named) importable from both `client/` and `server/`
  - [ ] `.gitignore` excludes `node_modules/`, build output, and any local env files

## 3. Story 1.2 — Client boots a 3D scene

**As a** player **I want** the game to load in the browser and show a navigable 3D scene **so that** there's a visible game world to build gameplay on.

- **Inputs:** `client/` workspace from Story 1.1
- **Outputs:** Vite + TypeScript + Three.js app; a scene with a ground plane, a placeholder player capsule/box, basic lighting, and mouse-look camera control
- **Constraints:** colorful, readable materials — not Three.js default grey/unstyled — this is the first checkpoint against the "Roblox-like" visual bar (`ai-office/global/global-standards.mdc`)
- **Acceptance criteria:**
  - [ ] `npm run dev` in `client/` (or the documented root script) starts a dev server; opening it in a browser shows a 3D scene, not a blank/black screen
  - [ ] Mouse-look camera control works (click-drag or pointer-lock — Programmer's choice, documented in the handoff)
  - [ ] No console errors on load

## 4. Story 1.3 — Server accepts WebSocket connections

**As a** game server **I want** to accept WebSocket connections and exchange a typed hello/welcome message **so that** client↔server communication is proven end-to-end before any gameplay logic exists.

- **Inputs:** `server/` and `shared/` workspaces
- **Outputs:** Node.js/TypeScript `ws` server; on connection, sends a `WelcomeMessage` (from `shared/`) to the client; logs connect/disconnect
- **Acceptance criteria:**
  - [ ] Server starts via a documented command and listens on a configurable port (env var, documented in `config.vars.example`)
  - [ ] Client connects to the server on load and visibly reflects connection status (a small on-screen indicator is enough — full HUD is out of scope here)
  - [ ] Server logs connect/disconnect events

## 5. Tasks

| # | Task | Expected result | Place in code | Completion criterion |
|---|------|------------------|----------------|----------------------|
| 1 | Root workspace setup | `package.json` workspaces, `tsconfig.base.json`, `.gitignore` | repo root | `npm install` succeeds |
| 2 | `shared/` protocol package | `WelcomeMessage` type exported, buildable | `shared/` | importable from client & server via TS |
| 3 | `client/` Three.js scene | Vite dev server renders scene, mouse-look works | `client/` | manual load + Playwright screenshot show a populated, colorful scene |
| 4 | `server/` WS server | Accepts connections, sends `WelcomeMessage`, logs events | `server/` | Playwright/manual client connect shows "connected" |
| 5 | Wire client → server | Client opens WS to server on load, shows connection status | `client/src` | status indicator flips to "connected" in a real run |
| 6 | README + `config.vars.example` | Run instructions for client + server, env vars documented | repo root | Tester can follow README from a clean checkout |

## 6. Acceptance Criteria (EPIC-level, Definition of Done)

- [ ] `npm install` at root sets up all workspaces
- [ ] Documented commands start client dev server and game server (concurrently or in two terminals — Programmer documents which)
- [ ] Browser shows a colorful, navigable 3D scene (ground + placeholder player + lighting), not a blank/grey/default screen
- [ ] Client establishes a WebSocket connection and visibly shows "connected" status after receiving the server's `WelcomeMessage`
- [ ] No secrets committed; port/config via env vars
- [ ] No TypeScript build errors
- [ ] Tester's Gameplay & feel section filled with screenshot evidence (`qa-artifacts/epic-01/`) — this is the first task where that evidence matters, since there's now a visible scene

## 7. Risks

- Playwright + WebGL in headless mode can be finicky (needs software rendering flags); Tester should note the exact launch flags used so later tasks can reuse them.
- Vite + npm workspaces + TypeScript project references need care to avoid path/alias issues — keep `shared/`'s surface minimal for this task to reduce that risk.
- "Colorful, Roblox-like" is a subjective bar at this stage (no real art yet) — Critic should judge it as "not a bare default Three.js demo," not expect final art quality this early.

---

## Backlog (not detailed yet — sketched for context, will be broken into Story/Task when Team Lead opens each EPIC)

- **EPIC 2 — Player Movement & Multiplayer Sync:** WASD movement, server-authoritative position validation, broadcast to other connected clients, client-side prediction + reconciliation, basic jump.
- **EPIC 3 — Shooting & Combat:** aim/shoot input, server-side raycast hit detection, health, respawn, simple weapon feedback (muzzle flash, hit marker).
- **EPIC 4 — World & Visual Direction:** a real (if simple) map/arena, consistent low-poly art direction, player avatar beyond a placeholder box.
- **EPIC 5 — Match Flow:** join/leave, scoreboard, match start/end.

## Sign-off

- **Specification (author):** Team Lead (Tusya)
- **Approval (Team Lead):** Tusya — approved for assignment
- **Assignee:** Programmer (Pusya)
