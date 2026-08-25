# Critic review (Krisya) → Team Lead

## Meta

- Task ID: EPIC 35 — Split Economy — Deathmatch vs Sandbox Pools (`docs/tasks/epic-35-split-economy-deathmatch-sandbox.md`)
- Diff / PR reference: branch `task/epic-35-split-economy-deathmatch-sandbox` vs `master` (`8115674`…`bdaa7d8`); feature commit `708af28`; tip `bdaa7d87c9d506842b3b5201ce66383fefbfb818`
- Tester PASS report reference: `docs/tasks/epic-35-tester-report.md` (QA on tip `bdaa7d8`; evidence `qa-artifacts/epic-35/`)
- Iteration: 1
- Reviewer: Krisya

## Package gates (before checklist)

| Gate | Status | Evidence (file/line/commit) |
|------|--------|-------------------------|
| Diff/PR present and reviewable | PASS | `git diff master...HEAD` — 12 files; feature `708af28` + handoff tip docs |
| Tester PASS report matches this commit | PASS | Tester report Meta → tip `bdaa7d87c9d506842b3b5201ce66383fefbfb818` = current `HEAD` |
| Every acceptance criterion traceable to a change or explicit note | PASS | AC §8 → scoped keys/`grantKillGold`/`regression:split-economy`/UI labels/README+TZ; 35.4 explicitly skipped (EPIC 37) |
| Scope matches the task (no unexplained extra changes) | PASS | Economy keying + match routing + client labels + docs/regressions only; no leaderboard re-implementation |
| Gameplay evidence present (player-facing tasks only) | PASS | `qa-artifacts/epic-35/01-mode-select-labels.png`, `03-inventory-sandbox-badge.png`, `05-inventory-deathmatch-badge.png`, `02`/`04` ingame; `smoke-summary.json` pool strings |

- Gate overall: PASS → continue checklist

## Verdict

- `APPROVED`
- One-line rationale: Isolation is airtight at the Redis key + match-scope boundary (`store.ts` `economyKey(scope,…)` / `match.ts` `economyScope()` from `mode` only; Critic re-ran `regression:split-economy` + `regression:bot-kill-no-reward` PASS; cross-scope hatch of a sandbox egg under deathmatch scope returns `not_found`).

## Checklist

| # | Item | Status | Severity | Evidence (file/line — not prose) |
|---|------|--------|----------|-------------------------------------|
| 1 | Correctness vs acceptance criteria | PASS | | Scoped keys `economy:v1:{scope}:{nick}` (`store.ts` ~287–288); migration legacy→deathmatch (`migrateLegacyEconomyDoc` ~501–514); `grantKillGold` DM human-only / SB rewards bots (`match.ts` ~573–578, ~587); UI labels (`client/index.html` ~1061–1066; `inventoryOverlay.ts` ~213–218); docs README + TZ §3.0 |
| 2 | Server authority for gameplay-relevant state | PASS | | `economyScopeFromMatchMode` comment + impl (`store.ts` ~225–228); `Match.economyScope()` (`match.ts` ~284–286); client economy messages have no scope field (`shared/src/index.ts` equip/hatch/etc.); `economyPool` server→client only |
| 3 | Stack compliance (fixed stack, no substitutions) | PASS | | Same Redis/`EconomyStore`/ws/Three.js/Vite; no new competing libs |
| 4 | Security baseline (secrets, injection, XSS, auth) | PASS | | No secrets in diff; scope not client-supplied; gold/item grants server-side |
| 5 | Error handling | PASS | | `saveDoc` still invalidates cache + throws on Redis MULTI failure (`store.ts` ~560–576); economy action failures still surface via existing match path |
| 6 | Logging / observability | PASS | | Migration log; mint/no-reward lines include `[scope=…]` (`match.ts` ~578–591, ~648+) |
| 7 | Test/QA coverage adequacy (risky paths, not just happy path) | PASS | | `scripts/regression-split-economy.ts` isolation + bot routing + migration; `regression-bot-kill-no-reward.ts` DM zero + SB-only; Critic re-run both PASS; Tester economy suite PASS |
| 8 | Readability / maintainability | PASS | | Explicit `EconomyScope`, defaults to deathmatch, career/endless hardcoded to deathmatch docs |
| 9 | Scope discipline | PASS | | Task 35.4 absent; `onKillRecorded` remains `mode === "public"` only (`match.ts` ~809–813) |
| 10 | Config / docs updated | PASS | | README EPIC 35 block; `docs/product/emerald-wasteland-economy-tz-v2.1.md` §3.0 + drop-victim table; no new env vars |
| 11 | No dead code / debug scaffolding | PASS | | No leftover probes/debug in feature diff |
| 12 | Regression risk considered | PASS | | Economy suite defaults stay deathmatch; EPIC 32 path preserved for public; Critic spot-check: colliding egg ids across pools — DM hatch still OK; sandbox→DM hatch blocked |
| 13 | Core mechanics actually work (movement/jump/shoot/hit-reg, per evidence) | PASS | | Light WASD smoke + arena/HUD in `02-bots-match-ingame.png` / `04-public-match-ingame.png`; kill-reward paths covered by regressions (this EPIC’s real mechanic) |
| 14 | Visual direction matches "Roblox-like" style, no visual bugs | PASS | | Bots match crop shows blocky avatar + brick/wood arena; no black-screen/missing-HUD in evidence |
| 15 | Controls & feel usable | PASS | | Smoke summary `ok: true`, console errors `0`; pointer/canvas usable per Tester |
| 16 | Playability sanity (honest fun/usability call) | PASS | | Pool labeling is unambiguous (mode buttons + inventory badge); isolation copy visible on mode-select (`01` / OCR hint + `smoke-summary.json`) |

## Findings (actionable)

_None blocking._

## Revision task (if REVISE)

- N/A (`APPROVED`)

## Notes (non-blocking)

- **Isolation scrutiny (extra pass):** Profile documents and gold/items are keyed by scope; match mutations always pass `this.economyScope()`. Critic additionally verified that a sandbox egg id cannot be hatched under deathmatch scope (`not_found`), and that discarding a colliding sandbox egg id does not prevent hatching the deathmatch egg with the same local id (doc-local path, not owner-key path).
- **`itemOwnerKey` remains global** (`store.ts` ~583–585: `${prefix}:item:{kind}:{id}` without scope). Pre-existing across nicknames; dual pools make same-nickname id collisions routine. Does **not** let sandbox inventory be spent in deathmatch (actions require the item in the scoped doc). Future hardening could namespace owner keys by scope — out of EPIC 35 AC.
- **`regression:economy-redis-safety` / `better-sqlite3`:** still broken locally (Tester + handoff). SQLite import callback targets deathmatch keys (`store.ts` open path). Not an AC fail for this epic; track as tooling debt.
- **Playwright smoke used separate nicknames** for sandbox vs deathmatch inventory badges; same-nickname isolation is covered by `regression:split-economy` (`SplitRunner`), not the live UI script.
- Highest-risk area called out in EPIC §9 is addressed with explicit regression coverage; Infosec may still want a dedicated pass on Redis key migration races (orphan legacy key if crash between `SET NX` and `DEL`) — idempotent on next deathmatch read when scoped key already exists.
