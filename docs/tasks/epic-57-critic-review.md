# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 57 — Hold-fire all weapons; cooldown ring + no fake juice; repairKit 0.002; sandbox bot amulet shards
- Diff / PR reference: `feature/epic-57-hold-fire-cooldown-ring-drops` @ `54ce34ec46db84847a92fbb14a22ea0c7657ab98` vs `master` — https://github.com/ryu878/cubewars/compare/master...feature/epic-57-hold-fire-cooldown-ring-drops (worktree `.claude/worktrees/epic-57-hold-fire-cooldown-ring-drops`)
- Tester PASS report reference: `docs/tasks/epic-57-tester-report.md` @ `54ce34e` (worktree + parent)
- Iteration (1 if first pass): 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git rev-parse HEAD` = `54ce34e`; `git diff master...HEAD` — 16 files / core feat commit `b8a3fe6` |
| Tester PASS report matches this commit | PASS | Tester meta: branch + `54ce34e`; Status **PASS** |
| Every acceptance criterion traceable to a change or explicit note | PASS | Stories 57.1–57.5 mapped below to `main.ts` / `combatHud.ts` / `economy.ts` / `store.ts` / `match.ts` / About+changelog / regressions |
| Scope matches the task (no unexplained extra changes) | PASS | Diff limited to hold-fire, ring, repairKit, bot shards, docs, regressions, QA scripts — no unrelated feature creep |
| Gameplay evidence present (player-facing tasks only) | PASS | Opened `qa-artifacts/epic-57/*.png` + logs; ring ready/recovering + in-match hold-fire/crosshair/move-jump + About EN/RU |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Hold-fire uses `WEAPON_STATS[currentWeapon].cooldownMs` with juice/`fire` gated by `isLocalFireReady` (`client/src/main.ts`); cooldown ring opacity 0 when ready (`combatHud.ts`); `repairKit=0.002`; sandbox bot shards via `bot:${id}` + `victimHasAmulet` without Redis profiles/amulet invent (`match.ts`/`store.ts`); killer-amulet gate removed from shard path (`shouldGrantShard`); regressions + screenshots hold.

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | — | Hold: `shouldAutoFire` + `getAutoFireIntervalMs` → `WEAPON_STATS[currentWeapon].cooldownMs` (`main.ts` ~385–387). Juice gate: `isLocalFireReady` then flash/viewmodel/gunshot/`fire` (`main.ts` ~357–383). Ring: `setCooldownProgress` full→opacity 0 (`combatHud.ts` ~125–132). `DROP_CHANCE.repairKit === 0.002` (`shared/src/economy.ts`). Bot shard: sandbox context without `nickname` (`match.ts` ~775–783); store shard without inventing copies (`store.ts` ~1293–1339). `shouldGrantShard` no killer-amulet arg (`economy.ts` ~368–373). |
| 2 | Server authority for gameplay-relevant state | PASS | — | Client gate cosmetic only (`main.ts` comment + early return before send). Economy grants in `EconomyStore` / `grantKillGold`; DM bot early return (`match.ts` ~741–746). Fire accept still server-side (unchanged authority). |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | — | Three.js/TS + Vite client; Node/TS + `ws`; shared economy helpers; Playwright for QA. No Socket.IO / UI framework / second physics. |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | — | No secrets in diff. Bots never `getOrCreateProfile` (`match.ts` bot branch). Gem/amulet copy only if `victim.nickname` (`store.ts` ~1304). |
| 5 | Error handling | PASS | — | Shard/gem/amulet/repair `EconomyActionError` → `substitute` (`store.ts` ~1297–1350). |
| 6 | Logging / observability | PASS | — | `[economy] kill item drops ... shard`, DM `kill vs bot victim -> no reward` (regression log + `match.ts`). |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | — | `regression-epic57-bot-shards` (sandbox amulet once / non-amulet / DM bot / human shard / amulet-cap); gems-amulets bot-style + cap; Tester mid-cooldown spam `fireCount=1`; live pistol hold gaps. Rifle/GL live hold not separately pointer-locked — shared code path only (note). Critic re-ran epic57-bot-shards + economy-gems-amulets → PASS. |
| 8 | Readability / maintainability | PASS | — | Clear EPIC 57 comments on gate, `VictimDropContext`, drop-audit table in handoff. |
| 9 | Scope discipline | PASS | — | Feat commit + docs SHA syncs only; no favicon/mail/other-epic bundling. |
| 10 | Config / docs updated | PASS | — | About EN+RU weapons/pools + hotkeys; `LAST_UPDATED=2026-08-27`; `changelog.json` EPIC 57 entry. No new env vars. |
| 11 | No dead code / debug scaffolding | PASS | — | `__cwQaCooldownProgress` QA pin mirrors existing `__cwQaHoldPose` pattern. |
| 12 | Regression risk considered | PASS | — | Human Redis shard path + once-per-victim preserved; DM bot no-reward early return intact; amulet-item gate still uses Redis amulet rows + killer amulet cap via `grantAmulet`. |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | — | `in-match-hold-fire.png` / tester log: 4 outbound `fire`, gaps ~500ms; mid-cooldown spam ≤1; move-jump screenshot. |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | — | Blocky pistol viewmodel + HUD in `in-match-hold-fire.png` / `in-match-move-jump.png`; ring arc visible recovering (`cooldown-ring-recovering.png`, `in-match-crosshair-ring.png`); ready transparent (`cooldown-ring-ready.png` + programmer metrics). |
| 15 | Controls & feel usable | PASS | — | Pointer lock + hold cadence verified; ring fills between shots; juice suppressed on spam. |
| 16 | Playability sanity (honest fun/usability call) | PASS | — | Hold-fire + honest juice + readable ring address the stated broken rifle/GL feel; economy bot-shard fix matches visible amulets. Usable, not a tech-only stub. |

## Findings (actionable)

None blocking.

## Revision task (if REVISE)

N/A — `APPROVED`

## Notes (non-blocking)

- **N-001 (docs polish):** In-match `hint.controls` still says “Click to fire” / “Клик стрельба” (`client/src/locales/en.ts`, `ru.ts`, `client/index.html` default) while About hotkeys say “Hold click”. Spec AC required About+changelog (done); overlay copy is stale relative to the shipped mechanic — optional follow-up.
- **N-002 (QA depth):** Live Playwright hold-fire exercised default pistol only; rifle/GL share `getAutoFireIntervalMs` / `isLocalFireReady` path — acceptable for this round, not a separate live cadence proof.
- **N-003 (feel quirk):** `FpsController` latches `setInterval` at hold-start; local gate can skip an early tick → occasional ~2× gap (tester `[506,500,999]`). Cosmetic; server cooldown still authoritative.
- Tester artifacts `scripts/qa-epic57-tester-playwright.mjs` + `docs/tasks/epic-57-tester-report.md` are untracked in the worktree (expected for QA evidence packaging); do not treat as missing from the reviewed feat commit.
