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
- **Click** (while locked) — fire
- **Space** — jump
- **Esc** — release pointer lock

Movement/look is predicted locally for responsiveness, but the **server is authoritative**: it computes and broadcasts every player's real position, and no client's self-reported position is ever trusted or relayed to other players directly (see `ai-office/global/security-baseline.mdc`). Every other connected player is rendered as a capsule avatar; you don't see your own (first-person).

Combat is server-authoritative too: firing sends a bare "fire" event, and the server resolves the actual hitscan raycast from its own tracked position/yaw/pitch for that player — the client never states an aim origin/direction, let alone a hit, of its own. See "Current status" below for the exact model.

## Current status

EPIC 4 (Shooting & Combat) — see `docs/tasks/epic-04-shooting-combat.md`. Players can now fight: clicking while pointer-locked fires a hitscan shot resolved entirely server-side (`server/src/combat.ts`) against **both** the shared `ARENA_GEOMETRY` (shots are blocked by walls/crates) **and** other players' hitboxes (an axis-aligned bounding box matching the same capsule dimensions rendered client-side — see `shared/src/combat.ts` for the exact approximation); nearest candidate along the ray wins, so a wall/crate closer than a player blocks the shot. Health (100 max, 25 dmg/hit, so 4 hits to kill), death, and a 3-second respawn timer are tracked per-player in `server/src/playerRegistry.ts` and broadcast every tick via `WorldStateMessage.players[].health/alive`, plus one-off `HitEvent`/`DeathEvent`/`RespawnEvent` messages for cosmetic feedback triggers (`shared/src/index.ts`). The client shows a crosshair, a health readout, and short muzzle-flash/hit-marker/damage-flash pulses (`client/src/combatHud.ts`) — all cosmetic; the client never unilaterally declares a hit or a kill. Dead players' avatars are hidden client-side and their movement/fire is frozen server-side until respawn. EPIC 3's arena/collision and EPIC 2's movement/jump/sync are unchanged.
