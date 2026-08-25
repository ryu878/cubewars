# EPIC 34: Email + Code Stub Auth, Persistent Sessions

Spec format per `ai-office/task-intake.md`. Filed by Team Lead (Tusya).
User ask ("Part B"), Russian, translated: enter an email, get a code shown directly on screen (not emailed yet — real email delivery is future work), re-entering the same email+code later is "login," and the session should persist as long as possible so play is never interrupted by a forced re-auth.

## 1. EPIC

| Field | Value |
|-------|-------|
| **Name** | Email + Code Stub Auth, Persistent Sessions |
| **System goal** | Introduce the game's first real account identity: a player registers with an email, the server generates a short display code (shown on-screen, not sent anywhere — a deliberate stub for a future real email-delivery step), and a long-lived session token lets them reconnect without re-entering anything. Nickname stays as a separate, cosmetic display name on top of the new account (not replaced). |
| **Business/gameplay problem** | Today there is no account system at all — `README.md`'s existing documented risk is "Profiles are keyed by normalized nickname... nickname spoofing is an accepted interim risk" (EPIC 20-era). This EPIC is the first step off that, and other in-flight work (the proposed Deathmatch/Sandbox economy split, EPIC 35, still pending user confirmation) wants a non-spoofable identity to eventually key off. |
| **Architectural role** | server (new account/session store + WS handlers) + shared (protocol messages) + client (login UI, session persistence) |
| **Main components** | `server/src/accounts/` (new), `shared/src/index.ts` (new message types), `client/src/` (new login/account UI + `network.ts` wiring) |
| **Stack** | Fixed project stack. **No HTTP framework** (no Express/etc.) — auth/session exchange happens over the **same existing WebSocket connection** as everything else in this game, as new message types, consistent with "Real-time transport: raw WebSocket... no other framework on top." Redis (already in the fixed stack via `EconomyStore`) is the natural persistence choice — reuse the same Redis connection config, new key namespace, not a new store technology. |
| **Interaction with other components** | Deliberately **decoupled** from `EconomyStore`/nickname-keyed profiles for this EPIC — do **not** migrate economy/inventory keying to the new account id as part of this task (that's explicitly out of scope, see Section 6). Nickname (`shared/src/index.ts` normalization, `join` message) is untouched; a player still picks/types a nickname per session as today, now alongside (not replacing) their account login. |

## 2. Current state (read before implementing — confirm still accurate)

- No account/session/identity concept exists anywhere in the codebase today. `server/src/index.ts`'s `join` message handler takes a bare `nickname` string, normalizes it (`normalizeNickname()`, `shared/src/`), and that's the entire "identity" a connection has — no password, no token, nothing tying a nickname to a person across sessions beyond typing the same string again.
- `client/src/modeSelect.ts` already persists the player's **nickname** in `localStorage` (`NICKNAME_STORAGE_KEY`) purely for UI convenience (pre-filling the input) — this is the only existing client-side persistence precedent to follow for the new session token.
- The server has no plain HTTP API today — `server/src/index.ts` only opens a `WebSocketServer`. This EPIC does not change that.

## 3. Design

### 3.1 Account model

- An **account** = `{ accountId (opaque, server-generated), email (normalized, e.g. lowercased/trimmed), codeHash (hashed, never stored in cleartext), createdAtMs }`.
- **Code:** server-generated on registration, format `NNN-NNN` (6 digits, dash in the middle — e.g. `482-917`; the user's own examples were illustrative, this exact format is a reasonable, readable default). Returned **once**, directly in the registration response — never emailed (that's explicit future work, not built here). The client is responsible for showing it clearly to the user with a "save this, you'll need it to log back in" message, since the server does not re-display it later.
- **Do not store the code in cleartext** (`ai-office/global/security-baseline.mdc`: "Passwords (if stored): hashed with a modern algorithm... never plaintext"). Even though this is a stub and the "code" is conceptually a persistent password substitute (it's re-entered on every future login until real email delivery replaces this flow), it functions exactly like a password at rest and must be treated with the same baseline — hash it (bcrypt/argon2, or at minimum a strong salted hash if those aren't already a project dependency; Programmer's call on the minimal well-established option per `global-standards.mdc`'s "small utility library" allowance, state the choice).
- **Session token:** a separate, high-entropy random opaque token (e.g. 256-bit, hex/base64url), generated on successful registration or login, **not** derived from the code. Stored server-side (hashed or plain — Team Lead's call: a bearer session token isn't itself a "password," but treat it as a secret regardless: never log it, and prefer storing a hash of it server-side over the raw token, same discipline as the code). Long-lived by design (no forced short expiry) per the user's explicit "never log out" ask — Team Lead sets a generous but non-infinite TTL as a safety net, e.g. 180 days, refreshed/extended on each successful use, rather than a literal forever-token with no revocation path; note this choice in the handoff, it's a judgment call the user can override if they explicitly want zero expiry.

### 3.2 Protocol (new WS message types, `shared/src/index.ts`)

Client → server:
- `account_register { email }` — new email. Server creates the account, generates + hashes + stores the code, issues a session token, returns both the **plaintext code (once)** and the session token.
- `account_login { email, code }` — existing email. Server validates the code against the stored hash; on success, issues a (possibly refreshed) session token; on failure, a generic rejection (do not reveal whether the email exists vs. the code was wrong — standard auth-enumeration hygiene).
- `account_session_resume { token }` — client's stored session token from a prior visit. Server validates, returns the account's basic info (email, accountId) silently; no code re-entry needed. This is what makes reconnects/reloads invisible to the player.

Server → client:
- `account_created { email, code, token }` (stub: code returned directly since there's no email delivery yet — documented as explicitly temporary in both the code comment and the client UI copy)
- `account_login_result { ok: boolean, token?, reason?: "invalid_credentials" | "rate_limited" | ... }`
- `account_session_result { ok: boolean, email?, reason?: "invalid_token" | ... }`

### 3.3 Anti-brute-force (mandatory — flagging prominently, this is the one genuinely security-sensitive part of this EPIC)

A 6-digit numeric code is only 10^6 combinations — **trivially brute-forceable without a hard rate limit**, unlike a real password. `account_login` **must** be aggressively rate-limited server-side (`ai-office/global/security-baseline.mdc`: "rate-limit auth and other sensitive endpoints"): e.g. a small fixed number of failed attempts per email (and/or per connection/IP) within a rolling window, then a lockout/backoff, logged as a potential abuse signal (not logging the code/token itself). Team Lead recommends a formal **Infosec review** of this EPIC's auth surface before or shortly after implementation, given it's the first real identity/session subsystem in this codebase — will request one separately; this does not block Programmer starting implementation, but merge should not happen without at least Critic's security checklist items being satisfied, and ideally Infosec's sign-off too.

### 3.4 Client flow

- New lightweight UI step, gating or sitting alongside the existing mode-select screen (Programmer's call on exact placement/sequencing, but it must not break the existing "type nickname → pick mode" flow for a player who already has a session — see below).
- On page load: if a session token exists in `localStorage`, send `account_session_resume` immediately; on success, skip straight to the existing nickname/mode-select flow with no visible interruption (this satisfies "nothing should interrupt play"). On failure (invalid/expired token), fall through to the registration/login UI.
- No stored token: show an email input. On submit, try `account_login`-shaped intent first only if the server/client already knows this email needs a code (simplest: client always calls `account_register`; if the server recognizes the email as already-registered, it responds asking for the code instead of creating a duplicate — Programmer's call on the exact single-request-vs-two-step UX, either is acceptable as long as it's not confusing).
- On successful registration, prominently display the code with a short explanation it won't be shown again and will (for now) also be needed to log in from another device/browser.
- Store the returned session token in `localStorage` (new key, e.g. `cubewars_session_token`, distinct from the existing nickname key) immediately on any successful register/login/resume.

### 3.5 Explicitly swappable for real email later

Structure the account model so a future "send the code via email instead of displaying it" change only touches the **delivery** of the code (i.e., where `account_created`'s code goes), not the account/session data model itself. Concretely: keep code-generation and code-verification entirely server-side and delivery-agnostic; the only thing that changes later is whether the plaintext code is included in the `account_created` response payload or sent out-of-band by an email provider integration.

## 4. Nickname vs. account (Team Lead scoping decision)

Nickname (`shared/src/` normalization, the `join` message) **stays** as a separate, per-session display name — it is **not** replaced by email/account. A player registers/logs into an account once, then still types/keeps a nickname for the match itself, same as today. This keeps this EPIC's blast radius contained (no changes to leaderboards, kill feed, chat, or any nickname-keyed system) while still delivering real account identity. A future task may choose to key the Deathmatch economy pool (EPIC 35, if/when confirmed) off `accountId` instead of nickname once this lands — that is an explicit **option**, not a requirement created by this EPIC.

## 5. Out of scope

- Real email delivery (explicitly future work per the user).
- Migrating `EconomyStore`/nickname-keyed profiles to `accountId` keying.
- Password reset / account recovery flows beyond "re-enter email + code."
- Multi-device concurrent session management UI (a session token existing on 2 devices is fine/expected for now, no explicit multi-session list).
- OAuth/third-party login.

## 6. Tasks

| # | Task | Place |
|---|------|-------|
| 34.1 | Account/session protocol message types | `shared/src/index.ts` |
| 34.2 | Account store: create, code hash+verify, session issue+validate, rate-limit tracking | `server/src/accounts/` (new) |
| 34.3 | WS handlers: `account_register`/`account_login`/`account_session_resume` | `server/src/index.ts` |
| 34.4 | Client: session-resume-on-load, email/code UI, localStorage token persistence | `client/src/` (new module, e.g. `accountAuth.ts`) + `client/index.html` |
| 34.5 | Rate-limit/brute-force guard on `account_login` + abuse logging | `server/src/accounts/` |
| 34.6 | Live verification + regression: register → see code → reload page → still logged in (no re-entry); log in from a second "device" (fresh localStorage) with email+code; wrong code rejected; brute-force guard trips after N attempts | `scripts/`, `qa-artifacts/epic-34/` |

**Branch:** `task/epic-34-account-auth-sessions`
**Base:** `master` (tip at task start: `d1738e2`)

## 7. Acceptance criteria

- [ ] `npm run typecheck` / `build` PASS
- [ ] Registering a new email returns a code, displayed clearly client-side, plus an immediate working session (no separate login step required right after registering)
- [ ] Reloading the client with a valid stored session token skips the email/code UI entirely and reaches mode-select normally — live evidence (not just code read)
- [ ] Logging in with the correct email+code from a fresh client (cleared `localStorage`) succeeds and issues a working session
- [ ] Logging in with a wrong code is rejected with a generic reason (no user-enumeration leak)
- [ ] Repeated failed `account_login` attempts trip a rate limit/lockout — server-side proof (log line + rejected attempt), not just a code read
- [ ] Code is never stored or logged in cleartext; session token is never logged
- [ ] Nickname/join flow is unaffected — existing regressions around lobby/nickname/matchmaking still PASS
- [ ] `EconomyStore`/economy protocol untouched by this diff

## 8. Risks

- This is the first real auth/session surface in the codebase — recommend a follow-up Infosec pass (Team Lead will request separately) before treating this as fully hardened, independent of the standard Programmer→Tester→Critic chain.
- Small numeric code space makes brute-force the primary realistic threat — the rate-limit guard (3.3) is not optional polish, it's load-bearing.
- Long-lived session tokens raise the stakes of token leakage (XSS, shared machine) — out of scope to fully mitigate here (no XSS sanitization gaps introduced by this EPIC specifically, but flag if anything in the new UI renders unescaped user input).

## 9. Sign-off

- **Author/Approval:** Team Lead (Tusya), 2026-08-25
- **Assignee:** Programmer (Pusya)
