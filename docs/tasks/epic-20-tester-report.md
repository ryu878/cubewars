# EPIC 20 Tester Report

## Result

PASS.

## Evidence

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run regression:lobby-nicknames` | PASS |

## Coverage

- Four clients quick-join `public`.
- Fifth client quick-joins `public-2`.
- Duplicate nickname in `public` is rejected with `nickname_taken`.
- Same nickname in `public-2` is accepted.
- A lobby viewer receives `public 4/4` and `public-2 2/4`.

## Residual Risk

No persistent identity exists by design. A nickname is only unique inside the active match.
