# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-26 19:16 UTC |
| Author (Pusya) | Pusya (Programmer) |
| Task / Story / EPIC | EPIC 50 — Critic F-001 revision (lion pet icon species readability) |
| Branch / commit / PR | `task/epic-50-half-maps-pet-clarity` (pushed; tip at handoff time) — https://github.com/ryu878/cubewars/compare/master...task/epic-50-half-maps-pet-clarity |
| Revision round (if this is a Critic/Judge fix, not first pass) | yes — finding IDs: F-001 |

## What was done (brief)

1. **F-001 — Lion glyph:** Replaced blank concentric mane-ring + face disc with a **6-tuft mane silhouette** (clip-path), larger face disc, round eyes, and a short muzzle + nose tip so the icon reads as a lion at bag (~36px) and rail (`inv-icon-sm` ~22px), distinct from dog/cat/bird.
2. Regenerated Playwright evidence shots `09`–`11` (full epic-50 script also refreshed `01`–`08`).

## Changed files / areas

- `client/index.html` — `.inv-pet-lion-mane` / `.inv-pet-lion-face` + new `.inv-pet-lion-eye*` / `.inv-pet-lion-nose` CSS
- `client/src/inventoryOverlay.ts` — `createPetIcon("lion")` appends mane, face, eyes, nose (bag/rail/ghost/detail share this builder)
- `docs/tasks/epic-50-programmer-handoff-f001.md` — this revision handoff

## How to verify (steps for Trusya)

1. Open Deathmatch inventory: identify **lion** from the glyph alone in the bag (no reliance on `+100 Damage`); confirm dog/cat/bird still distinct and non–pig-snout.
2. Equip lion to PET SLOT 1: rail `inv-icon-sm` still shows mane + face features (not concentric-circle mush).
3. Select lion: detail panel glyph matches bag species cue.
4. Review regenerated shots: `qa-artifacts/epic-50/09-pet-bag-icons.png`, `10-pet-detail-grants.png`, `11-pet-equip-rail.png` (git-ignored; regenerate with `node scripts/qa-epic50-programmer-playwright.mjs` if missing).

## Build and run

- Build command: (CSS/DOM only; optional) `npm run typecheck --workspace=client`
- Evidence command: `node scripts/qa-epic50-programmer-playwright.mjs`
- Run command: `npm run dev` (or Playwright-managed stack on ports 7850/5250)
- Expected smoke result: Playwright `[epic50-qa] OK — map + pet shots written`; lion cell shows tufted mane + eyes/muzzle

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: Playwright stdout (`[epic50-qa] …`); console log also under `qa-artifacts/epic-50/playwright-f001-console.log` locally
- Key success messages: `[epic50-qa] OK — map + pet shots written`; pet bag inspect includes `inv-icon-pet-lion`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged (display-only CSS/DOM icon)
- What the client is allowed to predict/render only: pet species glyph presentation

## Risks / known limitations

- Mane uses CSS `clip-path` polygon (same technique as cat ears / bird beak); no asset pipeline.
- Playwright artifacts remain git-ignored — Tester regenerates or uses local `qa-artifacts/epic-50/`.
- Out of scope this revision: dog/cat/bird redesign, map scale, grant copy, auction UI.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
