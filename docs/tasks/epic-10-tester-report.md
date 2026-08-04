# Tester report (Trusya) — EPIC 10

## Meta

| Field | Value |
|-------|-------|
| Date | 2026-08-04 |
| Handoff from Pusya (link/commit) | `feature/weapon-viewmodel-visual-polish` @ `bf5648a` |
| Status | **PASS** |

## Check results

### Build/typecheck

Both clean, re-verified twice.

### Damage rebalance (independent raw-WS hit counting)

| Weapon | Confirmed |
|---|---|
| Pistol | Kills in exactly 20 shots (5×20=100) |
| Rifle | Kills in exactly 5 shots (20×5=100) |
| Grenade launcher | Kills full-HP target in exactly 2 hits (100→30→0); kills a chipped target (60 HP) in 1 hit |
| Armor absorption at new values | Full-absorb branch (75 armor vs 70 dmg → armor 5, health unaffected) and spillover branch (5 armor vs 70 dmg → armor 0, health -65) both exact |

### Viewmodel & fire feedback

- All 3 weapon viewmodels present, correctly shaped/colored, fully on-screen (off-screen bug Programmer mentioned fixing is confirmed fixed).
- Idle sway confirmed via 4-frame sequence — visible motion, not static.
- Weapon switch (E) — instant visible viewmodel swap, correct tier-order cycling.
- Fire recoil + flash escalate pistol<rifle<GL (kickBack 0.045/0.085/0.22, flashScale 1/1.6/2.8 in source).
- **Pistol-vs-rifle distinction (specifically scrutinized per Programmer's own flag):** genuinely the closest pairwise distinction of the three, but reliably tellable apart via 4 independent redundant signals (flash color, flash size, viewmodel body color — the strongest signal — and shape). PASS, not a failing case — weakest of three good distinctions.
- Empty-weapon dimming confirmed (darker/muted color at 0 ammo vs full-ammo idle).

### Pickup shapes & visuals

- Weapon/armor pickups read as genuinely distinct silhouettes at real play distance, not just color — armor especially, no longer reads as generic octahedron.
- Wood and brick wall textures confirmed real (plank grain / brick+mortar pattern), not flat tints.
- Sky gradient confirmed (lighter blue top → warmer horizon) in every outdoor screenshot.
- Texture generation confirmed one-time at scene setup (source read: `buildWallTextures()`/`buildSkyDome()` called once, outside the render loop), not per-frame.

### Regression (EPICs 1-9)

Movement, jump, weapon pickup/switch/ammo/auto-equip, mode-select/join flow (EPIC 9, untouched by this diff per `git diff --stat`) all confirmed unaffected. Zero console errors across 8 Playwright sessions.

### Server authority

Damage/kill resolution unchanged logic, only constants moved. Viewmodel/textures/pickup shapes are purely cosmetic, driven by existing data paths (LoadoutMessage, existing onFire trigger) — no new client-trusted state.

## Outcome

**PASS** — ready for Critic review. 30 screenshots in `qa-artifacts/epic-10-tester/`.
