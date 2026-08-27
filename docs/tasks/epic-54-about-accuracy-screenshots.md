# EPIC 54 — About page accuracy audit + fresh screenshots

**Status:** Approved for implementation (Team Lead)  
**Date:** 2026-08-27  
**Depends on:** EPIC 53 merged (`6c91790`+)  
**Branch:** `feature/epic-54-about-accuracy-screenshots`  
**Worktree (preferred):** `.claude/worktrees/epic-54-about-accuracy-screenshots`

## User intent

User (RU): About still has **old screenshots** from before the inventory loadout panel; text may also lag mechanics. EPIC 53 updated About **copy** for 6×5 + loadout preview, but PNGs under `client/public/about/` are still EPIC-52-era (~14:39 Aug 27) and Critic EPIC 53 already noted stale `inventory.png` (old `/64`, no LOADOUT).

**Goal:** Re-capture About images from current master UI and audit all About EN+RU copy against live mechanics. Ship docs refresh + deploy.

---

## 1. EPIC

| Field | Description |
|-------|-------------|
| **Name** | About page accuracy audit + fresh screenshots |
| **System goal** | `/about.html` shows current visuals and accurate EN/RU mechanics so new players are not misled |
| **Business/gameplay problem** | Screenshots show pre–loadout inventory (8×8 / 64 cells era look); some mechanics (pets caps, maps count/size, DM capacity, spawn ghost, dual lobby inventory, Unplaced overflow) under-documented or vague |
| **Architectural role** | **Client static docs only** — `client/public/about.html`, `client/public/about/*.png`, `client/public/changelog.json`. No gameplay/server changes |
| **Main components** | About HTML + dict EN/RU, About PNG assets, changelog entry, Playwright capture/compare evidence |
| **Stack** | Fixed client Vite public assets + Playwright for capture/evidence. No new deps |
| **Explore baseline** | `client/public/about/` PNGs dated ~14:39 Aug 27 (pre–EPIC 53 loadout). Copy already mentions 6×5 + loadout but images do not. Critic EPIC 53 optional finding on stale `inventory.png` |

---

## 2. Architecture

```text
Current master client UI (lobby + match overlays)
        │
        ▼
  Playwright capture (or manual) → qa-artifacts/epic-54/
        │
        ▼
  client/public/about/*.png  (committed illustrative assets)
        │
  client/public/about.html   (EN+RU dict + LAST_UPDATED bump)
        │
  client/public/changelog.json (newest-first docs refresh entry)
```

No protocol, economy, or combat code changes. Follow `ai-office/policies/player-facing-docs.md`.

---

## 3. Stories

### Story A — Fresh About screenshots

**As a** player **I want** About images to match the live UI **so that** I recognize inventory loadout, modes, maps, and HUD.

**Acceptance criteria:**

- [ ] Re-capture from **current master** build (local matching prod tip), especially:
  - `inventory.png`, `pets-inventory.png` — must show **6×5 grid + right LOADOUT** panel (colors, pets, amulet, stats)
  - Refresh if stale vs current UI: `modes.png`, `maps.png`, `combat.png`, `auction.png`, `pause.png`, `gameplay.png`
- [ ] No leftover visual “8×8” / “64” / “DR” chrome in committed About images
- [ ] Playwright (preferred) or manual evidence under `qa-artifacts/epic-54/` comparing old vs new (at least inventory + pets-inventory)
- [ ] Committed assets under `client/public/about/`

### Story B — About EN+RU copy accuracy audit

**As a** player **I want** About text to match current mechanics **so that** pet grants, maps, spawn, and lobby economy are correct in EN and RU.

**Audit checklist (fix inaccuracies; remove leftover “8×8” / “64” / “DR” wording in captions/text if any remain):**

| Topic | Must reflect |
|-------|----------------|
| Pets (EPIC 51) | dog = flat Armor (HUD ARMOR, capped at `COMBAT.maxArmor` 100); cat = flat HP 1:1; bird = speed %; lion = damage %; gems add to same axes; **slot 2 needs amulet**; companions visible in match |
| Inventory | 6×5 + loadout preview + **Unplaced** overflow if over capacity |
| Maps (EPIC 50) | **8** catalog maps, picker, themed look, **half-size** |
| Deathmatch | up to **8** players |
| Spawn protection | ghost + no fire ~**2s** |
| ESC menu | resume / change map / inventory / auction (DM) / exit lobby |
| Lobby economy | dual lobby inventories + Deathmatch auction from lobby |
| Language | EN\|RU switcher |
| Kill loot VFX | optional short player-facing mention |
| Stale wording | no “8×8” / “64” / “DR” in About text or image captions |

**Acceptance criteria:**

- [ ] EN and RU About strings audited and corrected where needed
- [ ] `LAST_UPDATED` bumped in `about.html` (today’s date or merge day)
- [ ] Changelog entry newest-first for this docs refresh
- [ ] Follows `ai-office/policies/player-facing-docs.md`

### Story C — Evidence + handoff

- [ ] Typecheck/build green if any TS touched (docs-only may be N/A for app code)
- [ ] Programmer handoff + PR to `master`
- [ ] **Do not merge/deploy** (Team Lead after Tester PASS + Critic APPROVED)

---

## 4. Tasks

| ID | Task | Owner | Done when |
|----|------|-------|-----------|
| 54.1 | Branch/worktree from master | Programmer | `feature/epic-54-about-accuracy-screenshots` |
| 54.2 | Capture + replace About PNGs | Programmer | Assets show current UI; inventory/pets show 6×5+LOADOUT |
| 54.3 | Audit/fix About EN+RU copy | Programmer | Checklist items accurate; no stale 8×8/64/DR |
| 54.4 | Bump LAST_UPDATED + changelog | Programmer | Date + newest changelog entry |
| 54.5 | Playwright/manual old-vs-new evidence | Programmer | `qa-artifacts/epic-54/` |
| 54.6 | Handoff + PR | Programmer | Handoff filed; PR open — **do not merge/deploy** |

---

## 5. Acceptance Criteria (EPIC-level)

- About screenshots match current inventory (**6×5 + loadout**)
- Copy accurate EN+RU per audit checklist
- Playwright or manual evidence comparing old vs new screenshots
- After TL merge + deploy: live `https://cubewars.ru/about.html` + images

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| Capture needs seeded economy (pets/amulet) | Use cheats/dev fixtures or existing qa patterns; document in handoff |
| Over-capturing unrelated UI churn | Prefer targeted recaptures; always refresh inventory + pets-inventory |
| Copy over-specifying internal constants | Prefer player-facing language (“about 2 seconds”, “Armor up to 100”) over raw code identifiers in About |

---

## 7. Out of scope

- Gameplay / economy / combat code changes
- Rebuilding i18n module (only About page dict + assets)
- Merge/deploy (Team Lead after chain)

---

## 8. Standing ops (Team Lead after chain)

```text
merge to master → ./scripts/deploy-production.sh → https://cubewars.ru/
```

Smoke: open `/about.html`, confirm inventory/pets images show LOADOUT, spot-check EN|RU.
