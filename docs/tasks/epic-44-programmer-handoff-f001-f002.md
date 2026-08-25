# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 44 — Kill Loot Drop VFX (Victim → Killer) |
| Branch / commit / PR | `task/epic-44-kill-loot-drop-vfx` / VFX fix `2a7405d` + this handoff / same branch as feature `897f101` |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: **F-001**, **F-002** |

## What was done (brief)

1. **F-001 (outdoor gold / loot readability):** Enlarged gold (and other kinds toward upper AC band ~0.6–0.78u), stronger emissive with `toneMapped: false`, unlit amber core + glow shell for gold, higher chest/arc (`CHEST_Y_OFFSET` 1.45, `ARC_HEIGHT` 2.1), `frustumCulled = false`, outdoor scale multiplier + short spawn punch so midflight reads against sand/wood/sky.
2. **F-002 (shard silhouette):** Enlarged shard to fat magenta wedge + tetra facet + magenta glow shell (was thin cone with ~36 px footprint in inject evidence).
3. No EPIC 32/35 rule changes; client still only renders server `grants[]` kinds.

## Changed files / areas

- `client/src/killLootVfx.ts` — mesh sizes, materials, glow shells, arc/height, frustum, scale pulse (F-001 / F-002 only)
- `docs/tasks/epic-44-programmer-handoff-f001-f002.md` — this revision handoff

## How to verify (steps for Trusya)

1. `npm run regression:kill-loot-vfx` — still PASS (protocol/server unchanged).
2. `npm run typecheck` and client build.
3. **F-001 (critical):** Re-run live Sandbox rewarding kill QA; capture midflight while `economy_kill_loot_fx` lists `gold` (and any other grants). `05-*.png` (or successor) must show **measurable in-world** amber/yellow loot pixels in center FOV — not only HUD `GOLD` / kill banner. Prefer capture earlier in the 0.9s flight (Critic note: prior script slept ~280ms after fx detect — tighten if needed).
4. **F-002:** Inject or live multi-kind flight including `shard`; magenta/purple wedge must be a clear readable cluster (not a few-dozen-pixel speck) next to gem/gold.
5. Confirm kinds still match server grants only; DM bot still no VFX.

## Build and run

- Build command: `npm run typecheck && npm run build --workspace=client`
- Run command: `npm run dev` (or existing compose/dev flow) + Playwright live-kill path under `qa-artifacts/epic-44/`
- Expected smoke result: typecheck/build clean; regression PASS; outdoor FPS midflight gold/shard clearly visible

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: server stdout (unchanged)
- Key success messages: `[economy] kill_loot_fx kinds=...` after rewarding kill; correlate with midflight screenshot

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged — grants still built only after `grantKillGold`
- What the client is allowed to predict/render only: larger/brighter meshes for listed kinds only

## Risks / known limitations

- Capture timing still matters for mid-arc evidence; Tester should not sleep past most of the 0.9s flight.
- Glow shells use transparent `MeshBasicMaterial` — intentional for outdoor contrast; no new deps.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
