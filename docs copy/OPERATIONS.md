# Operations — Run & View Guide

How to run, view, and manage the backend services and databases on this box.

> **This machine _is_ the VM.** `100.115.149.3` is its own (Tailscale) IP, so
> `ssh testuser@100.115.149.3` and the local `medpush` session are the same
> computer. The project lives at `/home/medpush/databases/db-setup` and runs
> as user `medpush`.

---

## Always-on services

These run as **systemd services** — they survive logout, survive reboot, and
auto-restart if they crash. You do **not** need to keep a terminal open.

```
┌──────────────┬──────┬──────────────────┬────────────────────────────────────────┐
│   Service    │ Port │      Status      │              Health check              │
├──────────────┼──────┼──────────────────┼────────────────────────────────────────┤
│ tiksurfer    │ 3030 │ active (running) │ {"status":"ok","database":"connected"} │
├──────────────┼──────┼──────────────────┼────────────────────────────────────────┤
│ insta-surfer │ 3033 │ active (running) │ {"status":"ok","database":"connected"} │
└──────────────┴──────┴──────────────────┴────────────────────────────────────────┘
```

Run **`./status.sh`** to print this table live (real systemd status + health each time).
The health URL is **`/api/health`** (not `/health`).

---

## All ports at a glance

| What | Port | Always on? | URL |
|---|---|---|---|
| TikTok API (`tiksurfer`) | 3030 | ✅ systemd service | `http://100.115.149.3:3030/api/...` |
| Insta API (`insta-surfer`) | 3033 | ✅ systemd service | `http://100.115.149.3:3033/api/...` |
| PostgreSQL | 5432 | ✅ system service | `postgres://…@100.115.149.3:5432` |
| Prisma Studio — TikTok | 5555 | ❌ run on demand | `http://100.115.149.3:5555` |
| Prisma Studio — Insta | 5556 | ❌ run on demand | `http://100.115.149.3:5556` |

---

## Check status & health

```bash
# Live boxed table (status + health for every service)
./status.sh

# Are the services up?
systemctl is-active tiksurfer insta-surfer

# Full status
sudo systemctl status tiksurfer insta-surfer

# Live health (should print {"status":"ok","database":"connected", ...})
curl -s localhost:3030/api/health; echo
curl -s localhost:3033/api/health; echo
```

## Manage the services

```bash
# Watch live logs (replaces the old terminal output)
journalctl -u tiksurfer -f
journalctl -u insta-surfer -f

# Restart after you change code / git pull  (no --watch anymore!)
sudo systemctl restart tiksurfer insta-surfer

# Stop / start one
sudo systemctl stop tiksurfer
sudo systemctl start tiksurfer
```

---

## View the database with Prisma Studio

Prisma Studio is a web UI to browse/edit the data. There's one per database
(TikTok → 5555, Insta → 5556).

### Quick view (from this machine)

```bash
# TikTok DB  → opens on http://localhost:5555
cd /home/medpush/databases/db-setup/databases/tiktok && npm run prisma:studio

# Insta DB   → opens on http://localhost:5556
cd /home/medpush/databases/db-setup/databases/instagram && npm run prisma:studio
```

### View from another computer on the network

Studio binds to `localhost` by default, so to reach it at `100.115.149.3:5555`
you must bind it to all interfaces (and skip the browser, since the VM is headless):

```bash
# TikTok DB
cd /home/medpush/databases/db-setup/databases/tiktok
npx prisma studio --port 5555 --hostname 0.0.0.0 --browser none
# then open  http://100.115.149.3:5555  in your laptop's browser

# Insta DB
cd /home/medpush/databases/db-setup/databases/instagram
npx prisma studio --port 5556 --hostname 0.0.0.0 --browser none
# then open  http://100.115.149.3:5556
```

> ⚠️ **Security:** Prisma Studio has **no login**. Anyone who can reach the port
> can read *and edit* the database. Only bind it to `0.0.0.0` on a trusted
> network (your Tailscale tailnet). On an untrusted network, leave it on
> `localhost` and use an SSH tunnel instead:
> `ssh -L 5555:localhost:5555 testuser@100.115.149.3` then open `http://localhost:5555`.

> ℹ️ These commands run in the **foreground** and stop when you close the
> terminal (same as the old `npm run dev`). If you want Studio always-on like
> the APIs, it can be turned into a systemd service too — ask and it'll be added.

---

## After changing code

```bash
cd /home/medpush/databases/db-setup
git pull                                        # if pulling changes
sudo systemctl restart tiksurfer insta-surfer   # pick up the new code
```