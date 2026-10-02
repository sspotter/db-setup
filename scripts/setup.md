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
ls databases/tiktok/.env databases/instagram/.env
```

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
```

Both should return JSON containing `"database":"connected"`. Note the path is
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
sudo systemctl stop tiksurfer                  # stop one
```

Prefer `./restart-services.sh` over `sudo systemctl restart` — a bare restart can
leave a service "up but dead" when an orphaned process still holds the port. See
`FIX-tiktok-8443-binding.md`.

If anything doesn't come up, paste the output of Step 4 plus
`journalctl -u <unit> -n 40 --no-pager`.
