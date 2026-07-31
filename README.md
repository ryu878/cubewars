# cubewars

A 3D browser multiplayer shooter (Roblox-like: colorful, low-poly, casual). Built with a fixed stack — see `ai-office/global/global-standards.mdc` for the full policy and `ai-office/README.md` for the project's multi-agent delivery process.

## Stack

- **Client:** Three.js + TypeScript, built with Vite (`client/`)
- **Server:** Node.js + TypeScript, authoritative game server over raw WebSocket (`ws`) (`server/`)
- **Shared:** protocol/message types used by both (`shared/`), consumed directly as TypeScript source (no build step)

## Requirements

- Node.js 20+ (this repo was set up against Node 24 LTS via `nvm`)
- npm 10+

## Install

```bash
npm install
```

This installs all three workspaces (`client/`, `server/`, `shared/`) in one pass.

## Run locally

Both client and server, together:

```bash
npm run dev
```

- Client dev server: http://localhost:5173
- Game server: ws://localhost:7777 (configurable, see below)

Or run them separately in two terminals:

```bash
npm run dev --workspace=server
npm run dev --workspace=client
```

## Configuration

- **Server port:** `CUBEWARS_SERVER_PORT` (see `config.vars.example`). Set via your shell: `export CUBEWARS_SERVER_PORT=7777`.
- **Client → server URL:** `VITE_CUBEWARS_WS_URL` (see `client/.env.example`). Copy to `client/.env` to override the default `ws://localhost:7777`. This is the one place the fixed stack's "no `.env` files" rule is relaxed — Vite conventionally loads `.env` for client-side config; no secrets ever go here.

## Type-checking and build

```bash
npm run typecheck   # all workspaces
npm run build        # server + client production build
```

## Project layout

```
client/   Three.js/TypeScript game client (Vite)
server/   Node.js/TypeScript authoritative game server (ws)
shared/   protocol types shared by client and server
docs/     specs (EPIC/Story/Task), filed under docs/tasks/
ai-office/ the multi-agent delivery process (Team Lead/Programmer/Tester/Critic/Judge/Infosec)
```

## Controls

Click the canvas to lock the pointer and start playing:

- **Mouse** — look around (yaw + pitch, pitch clamped so you can't flip over)
- **W / A / S / D** — move relative to look direction
- **Space** — jump
- **Esc** — release pointer lock

Movement/look is predicted locally for responsiveness, but the **server is authoritative**: it computes and broadcasts every player's real position, and no client's self-reported position is ever trusted or relayed to other players directly (see `ai-office/global/security-baseline.mdc`). Every other connected player is rendered as a capsule avatar; you don't see your own (first-person).

## Current status

EPIC 2 (player movement & multiplayer sync) — see `docs/tasks/epic-02-movement-and-sync.md`. First-person pointer-lock controls (mouse-look, WASD, jump) replace EPIC 1's `OrbitControls` demo camera; the server maintains an authoritative player registry, validates/clamps movement input, and broadcasts world state to all connected clients at 20Hz. No map/collision/shooting yet — flat ground movement only.
