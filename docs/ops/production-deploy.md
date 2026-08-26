# Production deploy (playable VPS)

Players (and you) verify EPICs on the live host, not only on localhost.

| | |
|---|---|
| **URL** | https://cubewars.ru/ (also http://195.60.237.4/ until DNS/SSL cutover) |
| **WebSocket** | `wss://cubewars.ru/ws` (nginx → game server `:7777`) |
| **SSH** | `root@195.60.237.4` |
| **App path** | `/opt/cubewars` |
| **Static client** | `/var/www/cubewars` |
| **Default branch** | `master` (this repo’s default; docs elsewhere may say `main`) |
| **Deploy script** | `scripts/deploy-production.sh` |

## When to deploy (mandatory after an EPIC)

Deploy **immediately** after the office gate succeeds and the task is merged to `master`, so the user can play-test on the server.

```text
Programmer → Tester PASS → Critic APPROVED
  (or REVISE → fix → Tester re-verify → Judge ALL_CLOSED)
→ Team Lead merge approve → merge to master
→ ./scripts/deploy-production.sh
→ Team Lead final report includes https://cubewars.ru/
```

**Do not** report an EPIC as done for playable work until:

1. Merge to `master` is done, **and**
2. Production deploy + smoke succeed, **or**
3. Team Lead explicitly notes “deploy skipped” (docs-only / no runtime change).

Never deploy a **feature branch** for normal EPICs. Hotfix only with `--skip-gate` / `--ref` and a clear note in the final report.

## One-command deploy

From your laptop (SSH key already works for `root@195.60.237.4`):

```bash
# After merge to master:
git fetch origin
./scripts/deploy-production.sh
```

What the script does:

1. Archives `origin/master` to `/opt/cubewars`
2. Ensures Redis (Docker, AOF, bound to `127.0.0.1:6379`)
3. `npm ci` + production build with `VITE_CUBEWARS_WS_URL=wss://cubewars.ru/ws` (default)
4. Publishes `client/dist` → `/var/www/cubewars`
5. Restarts `cubewars.service`, reloads nginx
6. Smoke: HTTP(S) `200` on `/`, WebSocket open on `/ws`

Overrides:

```bash
CUBEWARS_DEPLOY_SSH=root@195.60.237.4 \
CUBEWARS_PUBLIC_HOST=cubewars.ru \
CUBEWARS_WS_URL=wss://cubewars.ru/ws \
./scripts/deploy-production.sh
```

Emergency (not for normal EPICs):

```bash
./scripts/deploy-production.sh --ref HEAD --skip-gate
```

## Gate checklist (Team Lead)

Before running the script:

- [ ] Tester report: **PASS**
- [ ] Critic: **APPROVED** (or Judge: **ALL_CLOSED**)
- [ ] Team Lead merge approve recorded
- [ ] PR merged into **`master`**
- [ ] Release checklist skimmed: [`ai-office/checklists/release-checklist.md`](../../ai-office/checklists/release-checklist.md)

After the script:

- [ ] Open https://cubewars.ru/ — lobby loads
- [ ] Join a mode, pointer lock, move/shoot once (or automated smoke already green)
- [ ] Final user report includes the production URL under “How to verify yourself”

## Server layout (already provisioned)

| Piece | How it runs |
|--------|-------------|
| Game server | systemd `cubewars.service` via `tsx server/src/index.ts` (shared is TS source) |
| Redis | `docker compose` in `/opt/cubewars`, AOF on, port **not** public |
| nginx | site `cubewars`: static `/` + proxy `/ws` → `127.0.0.1:7777` + TLS |
| Firewall (ufw) | **22**, **80**, **443** |

**Dev console cheats (EPIC 51):** `CUBEWARS_ENABLE_CHEATS=1` enables IDDQD cheats; unset defaults to **on**. Set `CUBEWARS_ENABLE_CHEATS=0` in `cubewars.service` environment to disable on production.

Useful commands on the VPS:

```bash
systemctl status cubewars nginx
journalctl -u cubewars -f
cd /opt/cubewars && docker compose ps
certbot certificates
```

## HTTPS / domain

- Domain: **cubewars.ru** / **www.cubewars.ru**
- DNS (Cloudflare): A records must point to **195.60.237.4** (not orange-cloud proxy for WS, or set SSL to Full and allow WebSockets — prefer DNS-only / grey cloud for the game host)
- Cert: Let's Encrypt via `certbot --nginx -d cubewars.ru -d www.cubewars.ru`
- Client WS: `wss://cubewars.ru/ws` baked in at build time by `deploy-production.sh`

Do **not** install aaPanel on this VPS — it replaces nginx and breaks the game stack. Use the existing nginx + certbot setup.

## Policy links

- Deploy order: [`ai-office/policies/deployment-policy.md`](../../ai-office/policies/deployment-policy.md)
- Approvals: [`ai-office/policies/approval-policy.md`](../../ai-office/policies/approval-policy.md)
- Team Lead role: [`ai-office/agents/team-lead/role.mdc`](../../ai-office/agents/team-lead/role.mdc)
