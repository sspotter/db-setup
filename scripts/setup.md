# Installing the backend services on the VM

Runs the backend APIs under systemd so they survive logout and come back after a
reboot. PostgreSQL stays a separate system service.

The script is `scripts/setup-services.sh` in this repo — run it from the
checkout. Do **not** paste a copy onto the VM: an inline copy in this file drifted
out of sync with the real script and lost the `readlink -f` fix, which meant the
services worked until the first reboot and then died.

Ports and unit names come from `scripts/services.conf`. Change them there.

---

## Step 1 — SSH in and go to the project root

```bash
ssh testuser@100.115.149.3
cd ~/path/to/db-setup     # the folder that contains the "databases" subfolder
```

If you're not sure of the path:

```bash
find ~ -name server.js -path '*tiktok*' 2>/dev/null
```

The project root is the part before `/databases/tiktok/server.js`.

## Step 2 — Get the latest scripts

```bash
git pull
```

## Step 3 — Check each service has its `.env`

`.env` is not in git — it carries the DB credentials. The setup script refuses to
run without it, so create them now if they're missing:

```bash
ls databases/tiktok/.env databases/instagram/.env dashboard/.env
```

The dashboard's `.env` holds its own password plus both backends' admin
passwords: `cp dashboard/.env.example dashboard/.env` and fill it in. Run
`(cd dashboard && npm install --omit=dev)` once before Step 4.

## Step 4 — Run it (it asks for your sudo password)

```bash
sudo bash scripts/setup-services.sh "$PWD" "$(whoami)" "$(command -v node)"
```

Notice the three arguments — that's deliberate. They're evaluated as *you*
before `sudo` takes over, so the services run as your user with your node, not
as root.

---

## What you should see

A `wrote /etc/systemd/system/…` line per service, then `Active: active (running)`
for each. Now close the terminal — they keep running, and they come back
automatically after a reboot.

## Verify it worked

```bash
curl localhost:8443/api/health   # tiktok
curl localhost:8442/api/health   # insta
curl localhost:8444/api/health   # dashboard
```

The backends should return JSON containing `"database":"connected"`; the
dashboard has no database and returns `"database":"none"`. That only proves the
dashboard is running — to prove it can reach both backends:

```bash
curl -s -H "x-dashboard-password: <DASHBOARD_PASSWORD>" localhost:8444/api/overview
```

Both `tiktok` and `instagram` must show `"up":true` and `"errors":[]`. Note the path is
`/api/health` — the routers mount under `/api` (`app.use('/api', healthRoutes)`),
so a bare `/health` returns 404 even on a healthy service.

For the full picture including the public Funnel URLs:

```bash
./scripts/status.sh
```

## Everyday commands

```bash
./scripts/status.sh                            # live status table
./restart-services.sh                          # restart both + verify health
./restart-services.sh tiksurfer                # restart just one
./scripts/redeploy.sh                          # git pull, reinstall, restart

journalctl -u tiksurfer -f                     # live logs
journalctl -u insta-surfer -f
journalctl -u tiksurfer-dashboard -f
sudo systemctl stop tiksurfer                  # stop one
```

## Monitoring dashboard

`tiksurfer-dashboard` (`dashboard/`) is one read-only page showing both backends
side by side: health, alerts, failures in the last 15 min, slow endpoints, user
counts and a merged activity feed. It is not on the Funnel — open it over
Tailscale at `http://100.115.149.3:8444/` and log in with `DASHBOARD_PASSWORD`.
"Run checks" sends one failed login (`smoke-check@dashboard.invalid`) per
backend, so it shows up in their activity logs; it is limited to once per 2 min
so it can never trip the backends' own failed-logins-per-IP alert.

Prefer `./restart-services.sh` over `sudo systemctl restart` — a bare restart can
leave a service "up but dead" when an orphaned process still holds the port. See
`FIX-tiktok-8443-binding.md`.

If anything doesn't come up, paste the output of Step 4 plus
`journalctl -u <unit> -n 40 --no-pager`.
