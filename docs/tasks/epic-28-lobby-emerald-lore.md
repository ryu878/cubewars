# EPIC 28: Lobby Emerald Lore

Spec format per `ai-office/task-intake.md`.  
Product lore: `docs/product/emerald-wasteland-economy-tz-v2.1.md` §1 + user TZ v2.0 intro.  
Depends on: `task/epic-27-redis-economy-store`.  
**User ask (RU):** add lore text on the main screen so the story (what / why / purpose) can be read in the background.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Lobby Emerald Lore |
| **System goal** | Show Emerald Wasteland backstory on the mode-select / main lobby screen as readable atmospheric background (or side) copy, without blocking nickname/mode CTAs. |
| **Business/gameplay problem** | Players land on mode select with no narrative context for pets/economy/wasteland fantasy. |
| **Architectural role** | client UI only (`client/index.html` + light CSS; optional tiny `client/src/lore.ts` if needed) |
| **Stack** | Plain HTML/CSS/TS — no new UI framework |
| **Interaction** | No server/protocol changes |

## 2. Design

### 2.1 Placement

- Layer **behind** or **beside** `#modeSelect .mode-select-box` inside `#modeSelect`.
- Lore must be readable but visually secondary (lower contrast, smaller type than title/CTAs).
- Mode-select card stays primary and clickable; lore uses `pointer-events: none` if it sits under/over the full viewport, **or** sits in a dedicated scrollable column that does not cover buttons.
- Desktop: prefer split — lore column left / form card center-right — or soft full-bleed paragraphs behind a translucent card.
- Mobile: lore above or below the card in a short scrollable block (`max-height` + overflow), still readable without hiding Join buttons.

### 2.2 Copy (player-facing)

**Language:** Russian (in-game localization — user request / original TZ). Keep existing English lobby chrome (Gold, mode buttons) unchanged unless a string is already Russian.

**Content requirements (story beats — paraphrase, do not dump the whole TZ):**

1. Year **2157**, failed portal experiment → dimension **Изумрудная Пустошь (Emerald Wasteland)**.
2. Animals evolved into symbiotic **Пэты** that empower their host.
3. Survivors fight for resources: gold, eggs → pets, gems, amulets.
4. Goal: survive, strengthen pets, rise on the wasteland leaderboard.

Title suggestion: `Изумрудная Пустошь`  
Short kicker under title OK.

Store final copy in HTML (or a small exported string module). Spec/docs remain English.

### 2.3 Visual

- Match existing dark lobby palette (`#modeSelect` rgba backdrop).
- No purple-glow AI cliché; no emoji.
- Subtle fade/opacity is fine; avoid busy animation that hurts readability.
- Accessibility: sufficient contrast for body lore (not pure 10% gray on black); `aria-hidden="true"` only if lore is purely decorative — **prefer** exposing lore to screen readers as a complementary region (`aria-label` / `<section>`).

### 2.4 Out of scope

Redis/economy changes, inventory grid, auction, new fonts unless already loaded, localization framework.

## 3. Tasks

| # | Task | Place |
|---|------|-------|
| 28.1 | Markup + CSS for lore region on `#modeSelect` | `client/index.html` |
| 28.2 | Responsive layout so CTAs remain usable | same |
| 28.3 | Brief note in README or EPIC doc that lore is on lobby | docs optional |

**Branch:** `task/epic-28-lobby-emerald-lore`  
**Base:** `task/epic-27-redis-economy-store`

## 4. Acceptance criteria

- [ ] Main/lobby screen shows Emerald Wasteland lore (what / why / purpose) readable in the background or side panel
- [ ] Nickname + mode buttons remain usable on desktop and a narrow viewport
- [ ] `npm run typecheck` / `build` PASS (client)
- [ ] No server/protocol changes
- [ ] Playwright or screenshot evidence of lobby with lore visible (`qa-artifacts/epic-28/`)

## 5. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-24  
- **Assignee:** Programmer (Pusya)
