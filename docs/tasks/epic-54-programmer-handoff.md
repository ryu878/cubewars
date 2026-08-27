# Handoff: Programmer → Tester

> Unified format. Copy the block and fill it in; do not replace with an ad-hoc "done, look".

## Meta

| Field | Value |
|-------|-------|
| Date / time (UTC optional) | 2026-08-27 |
| Author (Pusya) | Pusya |
| Task / Story / EPIC | EPIC 54 — About page accuracy audit + fresh screenshots |
| Branch / commit / PR | `feature/epic-54-about-accuracy-screenshots` / (see PR) / (see PR URL) |
| Revision round (if this is a Critic/Judge fix, not first pass) | no |

## What was done (brief)

1. Re-captured all About PNGs from current master UI via Playwright (`scripts/qa-epic54-programmer-playwright.mjs`): inventory + pets-inventory now show **6×5 bag + right Loadout** (dog/cat equipped, amulet, stats); also refreshed modes, maps, auction, combat, gameplay, pause.
2. Audited and updated EN+RU About copy for pets (Armor cap 100, HP 1:1, same-axis gems, slot 2 needs amulet, visible companions), Unplaced overflow, 8 half-size themed maps, DM capacity 8, ~2s spawn ghost, dual lobby inventories + lobby auction, EN\|RU, optional kill-loot VFX; removed leftover EPIC-51 / vague wording.
3. Bumped `LAST_UPDATED` (kept `2026-08-27`), added newest-first changelog entry; filed evidence under `qa-artifacts/epic-54/` (before/after).

## Changed files / areas

- `client/public/about.html` — EN/RU dict + default HTML copy audit
- `client/public/about/*.png` — all 8 illustrative assets refreshed
- `client/public/changelog.json` — EPIC 54 docs refresh entry
- `scripts/qa-epic54-programmer-playwright.mjs` — capture/promote script
- `docs/tasks/epic-54-about-accuracy-screenshots.md` — spec (synced)
- `docs/tasks/epic-54-programmer-assignment.md` — assignment (synced)
- `docs/tasks/epic-54-programmer-handoff.md` — this handoff

## How to verify (steps for Trusya)

1. Open `/about.html` on the branch client (Vite). Confirm EN|RU switcher; spot-check pets, inventory, maps, spawn, pools strings against the audit checklist in the spec.
2. Confirm images: `inventory.png` / `pets-inventory.png` show Cells **/30**, **Loadout** panel (not /64, not DR). Compare `qa-artifacts/epic-54/before/` vs `after/` (also mirrored at repo-root `qa-artifacts/epic-54/`).
3. Confirm `LAST_UPDATED` is `2026-08-27` and changelog newest entry title is **EPIC 54 — About page accuracy + fresh screenshots**.
4. Optional: re-run `node scripts/qa-epic54-programmer-playwright.mjs` (needs Redis on `:6379`, Node 24 PATH).

## Build and run

- Build command: docs/static assets only — N/A for app TS; optional `npx tsc -b` if desired (no TS changes)
- Run command: `npx vite --host 127.0.0.1 --port 5264` in `client/` with server if verifying live overlays; About page alone is static under `client/public/`
- Expected smoke result: About page loads; inventory/pets images show 6×5 + Loadout; EN|RU strings match checklist

## Configuration

- New environment variables: no
- Secrets in the repository: no

## Logs / observability

- Where to look at logs: Playwright `qa-artifacts/epic-54/notes.txt`; capture run stdout
- Key success messages: `cellCount=30`, `heroTitle=Loadout`, `amuletVisible=true`, `promoted 8 PNGs`

## Server-authority note (if gameplay-relevant state is touched)

- What is validated/computed server-side: N/A — client static docs/assets only
- What the client is allowed to predict/render only: N/A

## Risks / known limitations

- `inventory.png` and `pets-inventory.png` are the same full-overlay capture (both satisfy 6×5 + Loadout with pets visible); Tester may still want a pets-focused crop later.
- Loadout/ratings can display raw Armor rating above the combat Armor cap of 100; About copy correctly states Armor caps at 100 for combat HUD absorption.
- Capture script process cleanup previously hung on `stop()`; fixed with harder kill timeout — re-verify if re-running.
- Worktree uses symlinked `node_modules` from epic-53 worktree (native `better-sqlite3` rebuild fails on this host’s g++); not committed.

## Status

- [x] Ready for QA (Trusya)
- [ ] Draft / WIP (do not take into QA)
