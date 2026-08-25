# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 33 — Avatar Color Customization (Player Palette + Bot Random Colors) (`docs/tasks/epic-33-avatar-color-customization.md`)
- Diff / PR reference: branch `task/epic-33-avatar-color-customization` vs `master`; feature `31d7ce0`; tip `2f42bb213846922aeb0370dd1c2e65fc7c8276dd`
- Tester PASS report reference: `docs/tasks/epic-33-tester-report.md` (QA on tip `2f42bb2`; evidence `qa-artifacts/epic-33/`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` — 15 files / +645; feature commit `31d7ce0` plus handoff-pin docs commits to tip `2f42bb2` |
| Tester PASS report matches this commit | PASS | Tester Meta → tip `2f42bb213846922aeb0370dd1c2e65fc7c8276dd` = branch HEAD; handoff impl `31d7ce0` |
| Every acceptance criterion traceable to a change or explicit note | PASS | AC §9 → shared palette/protocol, `AvatarProfileStore`, WS validate+persist, `PlayerState.avatarColors`, bot random, per-avatar materials, Appearance UI, regression + live QA |
| Scope matches the task (no unexplained extra changes) | PASS | No `server/src/economy/` edits; avatar-only module/key namespace; cosmetic UI/render/protocol only |
| Gameplay evidence present (player-facing tasks only) | PASS | Critic opened `qa-artifacts/epic-33/01`–`03`, `05`/`08`/`09`/`13`/`14`, plus movement/jump/fire smokes; selfcheck isolation + opacity compose + live bot colors |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Server owns colors (`isAvatarBodyPart`/`isValidPaletteIndex` → Redis `cw:avatar:v1:` → `PlayerRecord` → broadcast); per-avatar cloned materials isolate recolors (`remotePlayers.ts` `buildAvatar`/`applyAvatarColors`); `setMeshColor` leaves opacity for EPIC 36 (`applySpawnProtectionVisual`); economy pool keys untouched.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | | Palette 8 + indices (`shared/src/avatar.ts`); persist reconnect (`smoke-summary.json` `selectedReconnect`); two-client broadcast (`seenByB`/`bOnA`); isolation (`01`/`02` + sample2 B hexes unchanged); illegal reject (`illegal-payload.json`); bots varied (`uniqueColorSets` + `09`/`13`); economy untouched (no economy diff) |
| 2 | Server authority for gameplay-relevant state | PASS | | `match.handleAvatarSetColor` validates then `store.setPart` + `registry.setAvatarColors` (`server/src/match.ts` ~403–428); join load `applyAvatarColorsToPlayer` before play (`match.ts` ~203–204); client sends intent only (`inventoryOverlay.ts` `avatar_set_color`); render from `world_state` (`remotePlayers.ts` ~442–447) |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Three.js/TS + Vite client, Node/`ws` server, shared types; no new competing libs; Redis reuse via existing `connectRedis` |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | No secrets; palette indices sanitized on write (`avatarProfile.ts` `sanitizeColors` / `isValidPaletteIndex`); illegal payloads dropped (`index.ts` ~593–606 → malformed tracker); UI uses `textContent` for status (no XSS sink for color data) |
| 5 | Error handling | PASS | | Bad Redis JSON → defaults (`avatarProfile.ts` ~85–88); illegal WS → `false` + drop tracker, no crash (`illegal-payload.json` `crashed: false`) |
| 6 | Logging / observability | PASS | | `[avatar] redis ready`, `[avatar] <nick> set <part>=<index>`, bot `colors=h#/t#/a#/l#` (`server-log.txt` / `smoke-summary.json`) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | | `regression:avatar-colors` + spawn-protection / epic31 / equipped-weapon; live illegal `face`/`99`/`-1`; material isolation selfcheck; opacity 0.35→1; two-client + reconnect |
| 8 | Readability / maintainability | PASS | | Dedicated `shared/src/avatar.ts` + `server/src/avatarProfile.ts`; color vs opacity split documented at `setMeshColor` / `applySpawnProtectionVisual` |
| 9 | Scope discipline | PASS | | Diff confined to avatar protocol/store/WS/UI/render/bots/regression; economy modules untouched |
| 10 | Config / docs updated | PASS | | No new env vars (reuses Redis URL/prefix); README N/A per AC; task docs/handoff present |
| 11 | No dead code / debug scaffolding | PASS | | Feature diff clean; QA runner lives under gitignored `qa-artifacts/epic-33/` |
| 12 | Regression risk considered | PASS | | EPIC 17/31 tells asserted in selfcheck (`hasWeapon`/`hasPet`/`hasAmulet`); spawn-protection regression still PASS; movement/jump/fire smokes |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | `10`/`11`/`12` smoke; server hit/death lines in `server-log.txt` during bots session |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | | Distinct bright per-part colors on blocky avatars (`01`/`02`/`09`/`13`); face accent not recolored; weapon/pet/amulet tells retained |
| 15 | Controls & feel usable | PASS | | Inventory Appearance 4×8 swatches (`14`); WASD/jump/fire smokes; `consoleErrors` empty in summary |
| 16 | Playability sanity (honest fun/usability call) | PASS | | Readable identity via body colors; bots no longer clones; Appearance discoverable (below fold but scrollable — see Notes) |

## Findings (actionable)

_None blocking._

## Revision task (if REVISE)

- N/A (`APPROVED`)

## Notes (non-blocking)

- **Authority (requested focus):** Client never injects claimed colors into other players’ renders. Wire field is server `PlayerRecord.avatarColors` only; `avatar_set_color` is validated (`part` ∈ head\|torso\|hands\|legs, integer index in palette) before Redis persist and registry update. Optimistic swatch highlight is explicitly non-authoritative (`inventoryOverlay.ts` comment + `setAvatarColors` from self `world_state`).
- **Material isolation (requested focus):** `buildAvatar` clones torso/head/arm/leg templates per instance; arms and legs use separate clones so hands≠legs can diverge (`remotePlayers.ts` ~206–231, `applyAvatarColors` ~322–330). Selfcheck `02` / `smoke-summary.json` sample2: after recolor A, B hexes unchanged.
- **Redis outside economy pools (requested focus):** Keys are `${prefix}:avatar:v1:${nicknameKey}` (`avatarProfile.ts` ~44–45) vs economy `${prefix}:economy:v1:${scope}:${nicknameKey}` — no scope/pool dimension, no shared documents. Diff does not touch `server/src/economy/`. Server log shows both `[avatar] redis ready` and `[economy] redis ready`.
- **Opacity + color compose with EPIC 36 (requested focus):** `setMeshColor` sets `mat.color` only and leaves opacity/transparent/depthWrite (`remotePlayers.ts` ~312–316). Protection path still traverses meshes and sets opacity 0.35/1 (`applySpawnProtectionVisual` ~334–348). Sync applies colors then protection toggle (`~442–455`). Evidence: selfcheck protected opacity `0.35` with custom colors (`01`/`smoke-summary` sample1.protected) then restore `1` (`protectedAfter`).
- **Second Redis TCP client:** `AvatarProfileStore.open` uses same URL/prefix as economy but opens its own connection (handoff acknowledged). Spec’s “same connection” read as same Redis endpoint/config; key separation is what the AC requires. Optional future share via `options.redis` if desired — not blocking.
- **Default look:** `defaultAvatarColors()` is index `0` on all parts (all palette-blue), overwriting the prior multi-tone template defaults on first apply — allowed by spec §4 (“e.g. index 0 everywhere”).
- **Live two-client framing:** `06-client-b-sees-remote-a.png` is a weak visual of remote A (mostly wall); cross-client proof is solid via `world_state` capture in `smoke-summary.json` (`seenByB` matches A’s picks) plus selfcheck/bot live renders.
- **UI fold:** Appearance rows sit below the inventory grid; Tester needed scroll (`14-appearance-swatches-scrolled.png`). Usable, slightly easy to miss — product polish only.
- Programmer handoff listed impl `31d7ce0`; Tester correctly QA’d branch tip `2f42bb2` (docs pin commits atop the feature).
