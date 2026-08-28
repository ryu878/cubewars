# Mail on cubewars.ru

Same pattern as `777doc.ru`: Postfix + OpenDKIM + Dovecot on the game VPS.

| | |
|---|---|
| Host | `mail.cubewars.ru` → `195.60.237.4` |
| Stack | Postfix (25/465/587), Dovecot IMAPS/POP3S (993/995), OpenDKIM |
| `postmaster@` | Autoreply (“technical address, unread”) then **discard** — never stored |
| Aliases → postmaster | `root@` `hostmaster@` `webmaster@` |
| `abuse@` | Forward to `ryu8777@gmail.com` (stored/read there) |
| `noreply@` | Inbound **discard** (no store, no reply) |
| Size limit | **1 MiB** (`message_size_limit=1048576`) — larger rejected at SMTP |
| Creds (send-only) | `/root/cubewars-mail-credentials.txt` (root only) |

## Cloudflare DNS (DNS only / grey cloud)

| Type | Name | Content | Proxy |
|------|------|---------|--------|
| A | `mail` | `195.60.237.4` | DNS only |
| MX | `@` | `mail.cubewars.ru` (priority **10**) | — |
| TXT | `@` | `v=spf1 a mx ip4:195.60.237.4 ~all` | — |
| TXT | `default._domainkey` | *(DKIM value from server — see below)* | — |
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; pct=100` (no `rua=` while postmaster discards) | — |

Keep existing A for `@` and `www` as DNS only.

### DKIM value

On the VPS:

```bash
python3 -c 'import re; t=open("/etc/opendkim/keys/cubewars.ru/default.txt").read(); print("".join(re.findall(r"\"([^\"]*)\"", t)))'
```

Paste the whole `v=DKIM1; ... p=...` string as one TXT record.

## Reverse DNS (mandatory for Gmail)

At the VPS panel (RuVDS): set **PTR** for `195.60.237.4` → **`mail.cubewars.ru`**.

Without PTR, Gmail will often quarantine or reject. `777doc.ru` has `mail.777doc.ru` PTR — same requirement.

## After DNS is live

```bash
certbot certonly --nginx -d cubewars.ru -d www.cubewars.ru -d mail.cubewars.ru --expand
# renew hook already copies certs to /etc/ssl/mail-*.pem and reloads postfix/dovecot
```

## Postmaster policy (implemented)

- Inbound to `postmaster@` (and aliases): script autoreply from `noreply@`, then discard.
- Autoreply at most once per sender / 7 days; skips lists, bounces, DMARC reports, `Auto-Submitted`.
- Messages over 1 MiB rejected at SMTP (`552`).
- Nothing is stored under `/var/mail/vhosts/.../postmaster`.

**Safer long-term:** `abuse@` is forwarded to the operator Gmail for abuse complaints; `postmaster@` stays a technical sink (autoreply + discard). For DMARC visibility, either omit `rua=` or point it at an external aggregator — not at a discarding mailbox.

## Outbound client (noreply / app mail)

- SMTP: `mail.cubewars.ru`, port **587**, STARTTLS (or **465** SSL)  
- Username: `noreply@cubewars.ru` (password in `/root/cubewars-mail-credentials.txt`)
- Do not use `postmaster@` as an IMAP inbox — it does not store mail.
