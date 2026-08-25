# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-25 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 30 — Weapon Viewmodel & Pickup Visual Polish (Round 2); Stories 30.1–30.4 |
| Branch / commit / PR | `task/epic-30-weapon-pickup-visual-polish` @ `8029c65f4a4e5b4b61cfc0cc8710f6785a3e5a81`; PR not opened yet (Tester gate first) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. **Story 30.1** — Upgraded pistol/rifle/grenade-launcher viewmodels in `client/src/viewmodel.ts` to multi-material composites (body + darkened grip/stock accent + shared gunmetal trim) with 2–3 identity details each; preserved sway, recoil, muzzle flash, and empty-ammo dim via unchanged `update()` / `triggerFire()` / `setEmpty()`.
2. **Story 30.2** — Upgraded world weapon pickups in `client/src/pickups.ts` with matching multi-material silhouette language; ammo crates now use a neutral wood body + weapon-color lid stripe.
3. **Story 30.3** — Redesigned armor pickup into a breastplate silhouette (plate + collar + center ridge + diagonal strap + corner rivets) using `ARMOR_PICKUP_COLOR` plus strap/trim accents.
4. **Story 30.4** — Added Playwright self-check script + captured evidence under `qa-artifacts/epic-30/` (gitignored); before/after notes in `BEFORE-AFTER-NOTES.md` there.

## Changed files / areas

- `client/src/viewmodel.ts` — multi-material viewmodel geometry (30.1)
- `client/src/pickups.ts` — weapon/ammo/armor world meshes (30.2 / 30.3)
- `docs/tasks/epic-30-weapon-pickup-visual-polish.md` — approved EPIC spec
- `scripts/qa-epic30-programmer-selfcheck-playwright.mjs` — deterministic selfcheck + optional live smoke
- `docs/tasks/epic-30-programmer-handoff.md` — this handoff

## How to verify (steps for Trusya)

1. `npm run typecheck --workspace=client` and `npm run build --workspace=client` — expect PASS.
2. Run deterministic evidence (no live server required):  
   `node scripts/qa-epic30-programmer-selfcheck-playwright.mjs selfcheck`  
   Review `qa-artifacts/epic-30/` especially:  
   - `01` / `05` / `09` viewmodel idles (all 3 weapons, multi-material)  
   - `03` / `06` / `10` fire flashes  
   - `14` empty-dim GL  
   - `20-pickups-lineup-side-by-side.png` (rifle, GL, ammo crates, armor, health)  
   - `11` / `12` armor closeups (strap + rivets)  
   - `BEFORE-AFTER-NOTES.md`
3. Optional live smoke (server on `:7779`, client on `:5199` with `VITE_CUBEWARS_WS_URL=ws://localhost:7779`):  
   `node scripts/qa-epic30-programmer-selfcheck-playwright.mjs live http://localhost:5199 ws://localhost:7779`  
   Confirms movement/jump and in-match pistol viewmodel with 0 console errors.
4. Spot-check Gameplay & Feel (movement / jump / shoot) in a normal Quick Join session — no gameplay files were touched.

## Build and run

- Build command: `npm run typecheck --workspace=client && npm run build --workspace=client`
- Run command: `npm run dev` (or isolated ports as above for QA)
- Expected smoke result: client builds; selfcheck PASS with 0 console errors; armor reads as breastplate; weapons show accent materials; ammo crates show colored lids

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: Playwright console summary in `qa-artifacts/epic-30/playwright-selfcheck.log` / `playwright-live.log` (local, gitignored)
- Key success messages: `[qa] PASS (selfcheck)`, `[qa] PASS (live)`, `console errors: 0`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: unchanged — pickup activation, ammo, damage remain server-authoritative
- What the client is allowed to predict/render only: mesh/material cosmetics only; no protocol/shared/server edits

## Risks / known limitations

- Shared gunmetal trim (`0x3a3f45`) and armor strap/trim accents are intentional secondary colors; primary weapon identity still uses `WEAPON_STATS[...].color` / `ARMOR_PICKUP_COLOR`
- Idle bob/spin on pickups was left out (spec optional / nice-to-have) to stay in budget
- Long live map walks are flaky under headless WebGL; primary evidence is the deterministic selfcheck importing real modules

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
