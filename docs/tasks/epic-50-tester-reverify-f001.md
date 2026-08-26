# Tester report (Trusya) — scoped re-verify F-001

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-26 |
| Task / Story / EPIC | EPIC 50 — Critic F-001 revision (lion pet icon species readability) |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-50-programmer-handoff-f001.md` @ `cb35b6165a59aa6c6acd91821c4e13a43f815cd0` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | yes — finding IDs re-checked: **F-001** |

## Environment

- OS / Docker: Linux 5.15 (host); Node `v24.18.1` via nvm; Redis local for economy regressions
- Branch / commit: `task/epic-50-half-maps-pet-clarity` @ `cb35b6165a59aa6c6acd91821c4e13a43f815cd0` (`fix(epic-50): make lion pet icon species-readable (F-001)`)
- Worktree: `.claude/worktrees/epic-50-half-maps-pet-clarity`

## Scope

Scoped re-verify after Critic `REVISE` on F-001 only, plus light regression (grant labels, half-size maps, typecheck / targeted regressions). Out of scope: dog/cat/bird redesign, map scale changes, grant math, auction UI.

## Check results

### Build

- Command: `npm run typecheck --workspace=client`
- Result: OK — `tsc --noEmit` clean

### Run

- Command: `npm run regression:economy-pets`; `npm run regression:epic46-maps`
- Result: OK — `[economy-pets] PASS`; `[epic46-maps] PASS`
- Evidence already present (Programmer-regenerated): `qa-artifacts/epic-50/09`–`11` (+ map shots / `summary.json`); timestamps ~2026-08-26 22:15–22:16 local

### Smoke / scenarios (F-001 + light regression)

| Step | Expected | Actual |
|------|----------|--------|
| F-001: lion readable at bag size without relying on `+100 Damage` | Mane + face features (eyes/muzzle), not concentric circles | **PASS** — `09-pet-bag-icons.png` / `10-pet-detail-grants.png` / bag cell in `11-pet-equip-rail.png`: darker orange 6-tuft mane silhouette, light face disc, two eye dots, muzzle/nose tip. Identifiable as lion from glyph alone |
| F-001: distinct from dog/cat/bird; non–pig-snout | Species scan still clear | **PASS** — cat (pointed ears), bird (blue + beak), dog (ears/snout), lion (tufted mane) all distinct in 09–11 |
| F-001: rail `inv-icon-sm` lion | Mane + face at ~22px | **PASS with residual** — Playwright `11` still equips **dog** on rail (`inv-icon-sm`); lion only in bag cells. Same `createPetIcon("lion")` + %-based CSS (`.inv-pet-lion-*`) drives bag/rail/ghost/detail; bag-size proof closes F-001’s concentric-circle failure. No dedicated lion-on-rail capture in regenerated 11 |
| Light: pet grant labels | `+N Armor/HP/Speed/Damage` | **PASS** — bag metas `+80 HP`, `+40 Speed`, `+100 Damage`; rail/detail dog `+156 Armor` / gems / `Total: +176 Armor · +10 Speed` (`summary.json` inspect + shots 09–11) |
| Light: half-size maps | Catalog envelope ±46 / ±26, `maxWallH=6` | **PASS** — all 8 maps in `summary.json` bounds `minX/maxX ±46`, `minZ/maxZ ±26`, `maxWallH=6`; spot-check `01-base.png` readable arena + HUD |

### Config and secrets

- `config.vars.example` / README up to date: N/A — display-only CSS/DOM revision
- No secrets in diff: yes — `client/index.html`, `client/src/inventoryOverlay.ts`, docs handoff only

### Documentation

- README / docs updated: yes — revision handoff `epic-50-programmer-handoff-f001.md`; this re-verify report

### Server authority

- N/A for F-001 — client presentation of pet species glyph only; grant math / map geometry unchanged this revision

### Gameplay & feel (player-facing visuals — scoped)

- Screenshot/evidence path(s):
  - Primary F-001: `qa-artifacts/epic-50/09-pet-bag-icons.png`, `10-pet-detail-grants.png`, `11-pet-equip-rail.png`
  - Light maps: `qa-artifacts/epic-50/01-base.png` (+ `summary.json` for all eight)
- Movement / jump / shoot / camera: N/A — unchanged by F-001
- Visual sanity: OK — inventory overlay readable; lion glyph no longer blank concentric discs
- Matches intended look: yes — stylized low-poly pet glyphs remain distinct

### Checklist sections applied

- Universal (AC for F-001, secrets)
- Build (client typecheck)
- Client (inventory pet icons)
- Light regression (grant labels, map bounds / epic46 + economy-pets)
- Gameplay & feel (inventory visual evidence only for this revision)

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** F-001 closed for Critic / Judge re-check. Verified: lion bag glyph shows tufted mane + eyes + muzzle (not concentric circles) in regenerated `09`–`11`; dog/cat/bird remain distinct; grant labels and half-size map bounds still OK; client typecheck + `regression:economy-pets` / `regression:epic46-maps` green.
- Residual (non-blocking): shot `11` still shows dog at `inv-icon-sm` on the equip rail; lion rail-size is inferred from shared builder/CSS rather than a dedicated lion-equipped rail capture.
- Ready for Critic review of F-001 only (`ai-office/agents/critic/role.mdc` / review-judge cycle). Do not merge/deploy from Tester.
