# Tester report (Trusya)

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-03 |
| Task / Story / EPIC | EPIC 7 — Health & Armor Pickups (`docs/tasks/epic-07-health-armor.md`) |
| Handoff from Pusya (link/commit) | `feature/health-armor` @ `117c929` |
| Status | **PASS** |

## Check results

### Build/typecheck

Both clean.

### Smoke / scenarios (raw WS harness + real Playwright client)

| Step | Actual |
|------|--------|
| Health below 100 | +25 exactly, capped at 100, pickup consumed |
| Health at 100 | NOT consumed, pickup stays active |
| Armor 0→25→50→75→100 | Exact sequence across 4 pickups (with waits for respawn) |
| Armor at 100 | Further pickup no-op, stays active |
| Armor > damage (rifle 50 vs 100 armor) | Only armor drops (100→50), health unchanged |
| Armor == damage boundary (rifle 50 vs 50 armor) | Armor exactly 0, health unchanged, no spillover — case Programmer didn't test |
| Armor == 0 | Full damage to health (pre-EPIC-7 behavior preserved) |
| Spillover, independent cases (25 armor + 100 dmg GL → armor 0/health -75; 50 armor + 100 dmg GL → armor 0/health -50) | Both exact, different numbers from Programmer's own example |
| Armor resets on respawn | Confirmed 0 immediately post-respawn regardless of pre-death level (2 independent runs) |
| Server-authority / anti-spoof | Forged health/armor/pickup/hit fields all ignored — only input/fire/switch_weapon are handled server-side |
| EPIC 6 regression | Weapon/ammo pickup, auto-equip, E-cycle, ammo depletion all still function correctly alongside new pickup categories in the same spawner |

### Gameplay & feel

9 screenshots in `qa-artifacts/epic-07/`: health = white medkit + red cross, armor = steel-blue octahedron, both visually distinct from each other and from all EPIC 6 weapon/ammo pickups. HUD shows live armor value. Real Playwright client: movement, jump, server-confirmed hit all verified.

## Non-blocking finding

`README.md` was not given an EPIC 7 section, unlike every prior EPIC (1-6). Documentation-consistency gap, not functional — flagged for Critic/Team Lead.

## Outcome

**PASS** — ready for Critic review.
