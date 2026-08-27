# EPIC 54 — Programmer assignment (Team Lead → Pusya)

## Branch / worktree

- Create from current `master` (tip should include EPIC 53 merge `6c91790` or later).
- Branch: `feature/epic-54-about-accuracy-screenshots`
- Preferred worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-54-about-accuracy-screenshots`
- Spec (authoritative): `docs/tasks/epic-54-about-accuracy-screenshots.md` — copy/sync into worktree.

## Environment

`export PATH="$HOME/.nvm/versions/node/v24.18.1/bin:$PATH"` or `source ~/.nvm/nvm.sh`

## Must deliver

### Story A — Fresh screenshots

1. Re-capture About images from **current master** UI (local build matching prod tip). **Must** refresh:
   - `client/public/about/inventory.png`
   - `client/public/about/pets-inventory.png`
   Both must clearly show **6×5 bag + right LOADOUT** panel (colors, pets, amulet, stats). No `/64`, no old 8×8 look, no DR-era chrome.
2. Refresh the others if they are stale vs current UI: `modes.png`, `maps.png`, `combat.png`, `auction.png`, `pause.png`, `gameplay.png`.
3. Prefer Playwright capture script under `scripts/` writing to `qa-artifacts/epic-54/`, then copy final assets into `client/public/about/`. Keep old copies under `qa-artifacts/epic-54/before/` (or similar) for old-vs-new evidence.

### Story B — Copy audit (EN + RU)

4. Audit `client/public/about.html` default HTML + embedded `dict.en` / `dict.ru` against current mechanics. Fix inaccuracies. Checklist:

   - **Pets:** dog = flat Armor (HUD ARMOR, cap 100); cat = flat HP 1:1; bird = speed %; lion = damage %; gems add to same axes; slot 2 requires amulet; companions visible in match
   - **Inventory:** 6×5 + loadout preview + Unplaced overflow when over capacity
   - **Maps:** 8 catalog maps, picker, themed look, half-size (EPIC 50)
   - **Deathmatch:** up to 8 players
   - **Spawn:** ghost + cannot fire ~2s
   - **ESC:** resume, change map, inventory, auction (DM), exit lobby
   - **Lobby:** dual inventories + Deathmatch auction from lobby
   - **Language:** EN|RU
   - **Kill loot VFX:** optional short player-facing mention
   - Remove any leftover “8×8” / “64” / “DR” in text or captions

5. Bump `LAST_UPDATED` in `about.html`.
6. Add newest-first changelog entry in `client/public/changelog.json` for this docs refresh.
7. Follow `ai-office/policies/player-facing-docs.md`. Prefer player-facing wording over raw constant names.

### Delivery hygiene

8. Playwright/manual evidence under `qa-artifacts/epic-54/` (old vs new inventory/pets at minimum).
9. `docs/tasks/epic-54-programmer-handoff.md`; open PR to `master`.
10. Do **not** merge or deploy. Do not mix unrelated dirty parent files (favicons, `docs/ops/mail.md`, other worktrees).

## Read first

- `ai-office/agents/programmer/role.mdc`
- `ai-office/global/{global-standards,handoff-contracts,english-only,security-baseline}.mdc`
- `ai-office/templates/programmer-handoff-template.md`
- `ai-office/policies/player-facing-docs.md`
- Spec: `docs/tasks/epic-54-about-accuracy-screenshots.md`
- About: `client/public/about.html`, `client/public/about/*.png`
- Changelog: `client/public/changelog.json`
- Prior capture patterns: `scripts/qa-epic52-programmer-playwright.mjs`, `scripts/qa-epic53-programmer-playwright.mjs`
- Mechanics refs: EPIC 51 pets/`COMBAT.maxArmor`, EPIC 50 maps, EPIC 53 inventory 6×5 + loadout + Unplaced
- Deploy docs (context only — do not deploy): `docs/ops/production-deploy.md`

## Return summary (to Team Lead)

Branch, PR URL, HEAD SHA, which PNGs replaced, copy changes summary (EN+RU), LAST_UPDATED value, changelog title, evidence paths, handoff path, blockers.
