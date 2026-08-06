# EPIC 18 Tester Report

## Result

PASS.

## Evidence

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run regression:locational-splash-damage` | PASS |
| `npm run qa:epic18-hold-fire` | PASS: single click produced `1` accepted shot; `1.3s` hold produced `3` accepted shots; console errors `0` |
| `npm run regression:weapon-autoswitch` | PASS |
| `npm run regression:fire-input-drop-rate` | PASS: control `17/17`, real-architecture `25/25`, true-flood bounded with throttled aggregate logs |

## Coverage Notes

- Locational regression covers pistol and grenade direct `head/body/legs` damage values.
- Splash regression covers grenade wall impact near a target, including partial damage less than direct base damage.
- Negative regression covers pistol wall miss near a target, confirming non-grenade weapons do not splash.
- Hold-fire QA uses a real server, Vite client, and Playwright pointer-lock mouse input path.

## Residual Risk

Hit zones use the existing player AABB and vertical split, not skeletal hitboxes. This is intentional for the current hand-rolled hitscan model and matches the EPIC 18 scope.
