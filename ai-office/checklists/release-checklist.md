# Release checklist

Check scope depends on **release type** (backend services, client build, docs, etc.). Mark **only what applies**; for a narrow release the rest is N/A with a note.

## Before release

- [ ] All target Stories/Tasks for the release are closed (Tester PASS + Critic `APPROVED` / Judge `ALL_CLOSED` + Team Lead approve)
- [ ] No hardcoded secrets, ports, URLs
- [ ] `config.vars.example` and/or README up to date; variables set via `export`/`set` **(if the release includes configurable services)**
- [ ] DB migrations (if any) verified and documented

## Build and environment (if applicable)

- [ ] **Build:** successful build using the method fixed for the release (`docker compose build`, client production build, etc.).
- [ ] **Run:** successful start (`docker compose up`, systemd, etc.); services start without unjustified crashes.
- [ ] **Health / smoke:** `GET /health` → 200 **(if there is an HTTP service)**; main scenario verified manually or by automated tests **as in the spec**.

If the release has **no** long-lived services (docs only, static client-only build) — fill this block partially or mark N/A.

## By delivery type

### Backend / game server

- [ ] Tests/linters per project policy (if used)
- [ ] Dependencies without known critical vulnerabilities (when possible)
- [ ] Server-authoritative validation intact for gameplay-relevant state

### Client (web)

- [ ] Production build and smoke of the key gameplay path
- [ ] No leaked debug/dev-only endpoints or verbose error output in the production build

### Docs / config only

- [ ] Consistency of changes; no secrets in repo; instructions updated

## Tests and quality (general)

- [ ] Unit/integration tests for critical logic pass **(if the project has tests and they are in release scope)**
- [ ] For runtime/E2E checks: background status `aborted` does not count as completion; the scenario must be re-run in the foreground, PASS/FAIL + runtime evidence obtained and included in the final report

## Documentation

- [ ] README: how to run, environment variables, examples **(for what is in the release)**
- [ ] Architecture/changes reflected in docs when needed
- [ ] API/protocol: contracts documented and up to date **(if there is an API or message protocol)**

## Deploy (server) — if applicable

- [ ] On the server: current code, environment variables, images **(if server deploy exists)**
- [ ] Services started via docker compose **or** systemd **or** another agreed method
- [ ] Logs are written; errors are not swallowed **(for a service release)**
- [ ] Firewall/ports: only what is needed is open **(if there is a network)**
- [ ] On key change — secret rotation, access check

## After release

- [ ] Main scenario check on production/staging **(if an environment exists)**
- [ ] Log monitoring for N minutes/hours **(for services)**
- [ ] Rollback plan known (build/tag, config rollback — **by release type**)
