# EPIC 46 — Programmer assignment (Team Lead → Pusya)

Implement `docs/tasks/epic-46-multi-map-select-capacity.md` in full.

## Branch

- Create from current `master`: `task/epic-46-multi-map-select-capacity`
- Prefer an isolated git worktree if convenient.
- Do **not** commit unrelated dirty files on master (deploy docs already present may be left alone; do not mix ai-office policy edits). Only EPIC 46 work + the filed spec under `docs/tasks/`.

## Must deliver

1. Shared map catalog: 8 maps (`base` + 7 themed ids), bounds/geometry/spawns/pickups/displayName; Base ~4× area (prefer 2× linear); building with doors+windows + car; document scale choice.
2. Server owns `mapId` per match; `map_state` from catalog; join existing ignores client mapId; invalid map rejected.
3. Lobby/UI map picker for public + bots; lobby list shows map; `MAX_PUBLIC_PLAYERS_PER_MATCH = 8`.
4. Client renders/predicts from `map_state` only (no divergent hard-coded walls).
5. Regressions + README Current status.
6. Handoff to Tester: `docs/tasks/epic-46-programmer-handoff.md` per template.
7. Open PR into `master` when ready for QA.

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/global-standards.mdc`, `english-only.mdc`, `security-baseline.mdc`
- `ai-office/templates/programmer-handoff-template.md`
- Endless `map_state` path in `server/src/match.ts`
- Lobby join in `server/src/matchManager.ts`, `client/src/modeSelect.ts`

## Out of scope

Endless map picker (unless trivial); full art assets; Rapier; redesign unrelated lobby UI.
