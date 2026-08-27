# Tester report (Trusya) — F-001 re-verify

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-27 |
| Task / Story / EPIC | EPIC 55 — Ammo does not unlock weapons; HUD current/max; maxHealth integrity |
| Handoff from Pusya (link/commit) | `docs/tasks/epic-55-programmer-handoff.md` revision F-001; fix `4784ef1535b780457299af80f459b32e1b99544b`; tip `c1e7b837995689a80e45e121572fc5279ec62eef` |
| Status | **PASS** |
| Re-verify after Critic/Judge revision? | yes — finding IDs re-checked: **F-001** |

## Environment

- OS / Docker: Linux local worktree (Node v24.18.1)
- Branch / commit: `feature/epic-55-ammo-not-unlock-hud-maxhp` @ `c1e7b837995689a80e45e121572fc5279ec62eef`
- Worktree: `/home/dmitry/Documents/Projects/Python/cubewars/.claude/worktrees/epic-55-ammo-not-unlock-hud-maxhp`
- Scope: Critic F-001 only + light regression on cases 7–9 (not a full EPIC re-QA)

## Check results

Checklist sections applied (scoped): **Universal (AC slice for F-001)**, **Build/run (regression)**, **Backend / server authority**. Gameplay & feel: **N/A** for this revision (server pickup gate only; prior PASS evidence at `qa-artifacts/epic-55/` unchanged by intent).

### Build

- Command: `npx tsc --noEmit -p shared && npx tsc --noEmit -p server`
- Result: OK

### Run

- Command: `npm run regression:weapon-autoswitch`
- Result: OK — `OVERALL: PASS` including case 10

### Smoke / scenarios

| Step | Expected | Actual |
|------|----------|--------|
| F-001 full unowned stockpile → weapon | `applied: true`, owns weapon, ammo may stay at max, auto-equip if higher tier | **PASS** — case 10: stockpile `48/48`, `ownedBefore=false`, weapon `applied=true`, `owned=true`, `ammo=48`, `equipped=rifle` |
| Reject full `"ammo"` at max | `applied: false` | **PASS** — case 10: `extraAmmoApplied=false` |
| Reject owned `"weapon"` at maxAmmo | `applied: false` | **PASS** — case 10: `ownedRefillApplied=false` |
| Light regression case 7 | Unowned ammo no unlock / no E-cycle | **PASS** |
| Light regression case 8 | Partial stockpile → weapon owns + capped ammo | **PASS** — stockpile 24 → ammo 36 |
| Light regression case 9 | Heal above 100 toward pet maxHealth | **PASS** — 80→105, maxHealth 245 |
| Code gate | Unowned weapon not blocked solely by `atMaxAmmo` | **PASS** — `playerRegistry.ts`: ammo rejects at max; weapon rejects only `alreadyOwned && atMaxAmmo`; unlock path runs for unowned at cap |

### Config and secrets

- `config.vars.example` / README up to date: yes (no new env vars in revision)
- No secrets in diff: yes

### Documentation

- README / docs updated: N/A for F-001 logic-only revision (About/changelog already present from original EPIC 55)

### Server authority (if gameplay-relevant state touched)

- Server validates/computes the relevant state, not the client: **yes** — ownership unlock remains in `PlayerRegistry.applyPickup()` only

### Gameplay & feel

- Screenshot/evidence path(s): N/A for this scoped re-verify (logic-only F-001). Prior player-facing evidence: `qa-artifacts/epic-55/` from original Tester PASS
- Movement / Jump / Shoot / Camera / Visual: N/A — not in F-001 re-verify scope

## On FAIL: reproduction

N/A — PASS

## Outcome

- **PASS:** F-001 closed for Tester purposes. Ready for **Judge** (`ai-office/agents/judge/role.mdc`) — not Critic again.

Briefly verified: unowned full-stockpile weapon pickup unlocks and keeps ammo at max; full ammo and owned-at-max weapon still rejected; cases 7–9 still green; case 10 PASS. Do **not** merge/deploy.
