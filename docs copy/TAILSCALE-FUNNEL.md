# Tailscale Funnel — Public Access Config

How our services are exposed to the **public internet** via Tailscale Funnel,
so anyone can reach them **without installing Tailscale**. This is the reference
for checking, changing, or fixing the funnel setup later.

> **Machine:** `medpush-virtual-machine` (this VM)
> **Tailnet hostname:** `medpush-virtual-machine.tail3e5104.ts.net`
> **Tailnet IP:** `100.115.149.3`
> Funnel gives a free, valid HTTPS cert on this hostname — **no domain purchase needed.**

---

## Currently exposed (live)

| Service | Local port | Public port | Public URL | Confirmed |
|---|---|---|---|---|
| insta-surfer API | `3033` | `443` | `https://medpush-virtual-machine.tail3e5104.ts.net/api/health` | ✅ working |        
| tiksurfer API | `3030` | `8443` | `https://medpush-virtual-machine.tail3e5104.ts.net:8443/api/health` | ✅ working |     
| Prisma Studio (TikTok) | `5555` | `5555` | `https://medpush-virtual-machine.tail3e5104.ts.net:5555/` | ⚠️ see notes | 

**Health check URLs (the ones confirmed working):**
```
https://medpush-virtual-machine.tail3e5104.ts.net/api/health         # insta (3033)
https://medpush-virtual-machine.tail3e5104.ts.net:8443/api/health    # tiktok (3030)
https://medpush-virtual-machine.tail3e5104.ts.net:5555/              # Prisma Studio (TikTok)
```

**Not exposed (intentionally):**

| Service | Local port | Why not public |
|---|---|---|
| Prisma Studio (Insta) | `5556` | No auth — left off the public funnel |
| PostgreSQL | `5432` | Database stays private; only APIs are exposed |

---

## ⚠️ Important caveats — read before changing anything

1. **Funnel's official public ports are `443`, `8443`, and `10000` only.**
   These three are guaranteed to work from anywhere on the internet. Other
   ports (like `5555`) may only be reachable **from inside our tailnet** (e.g.
   from `trippy`), not from a device without Tailscale.
   **To confirm a URL is *truly* public, test it from a phone on cellular with
   Tailscale OFF.** If `:5555` fails there, it was only working because the test
   device was on the tailnet.

2. **Prisma Studio has NO login.** Anyone who can reach `:5555` / `:5556` can
   **read and edit/delete the whole database**. Do not expose it to the real
   public internet. Safer alternative — SSH tunnel from an untrusted machine:
   ```bash
   ssh -L 5555:localhost:5555 -L 5556:localhost:5556 medpush@100.115.149.3
   # then open http://localhost:5555 and http://localhost:5556 locally
   ```

3. **The two APIs are now reachable by the whole internet.** Add a shared secret
   so random scanners can't use them — validate an
   `Authorization: Bearer <long-random-token>` header in each API.



4. **Keep PostgreSQL (`5432`) closed.** Apps talk to the HTTP APIs, which talk to
   Postgres locally. The DB never needs to be public.

---

## How the funnel was set up (commands)

```bash
# DNS fix (the VM couldn't reach configured DNS servers)
sudo tailscale set --accept-dns=false

# insta-surfer API -> public 443
sudo tailscale funnel --bg --https=443 localhost:3033

# tiksurfer API -> public 8443
sudo tailscale funnel --bg --https=8443 localhost:3030

# Prisma Studio (TikTok) -> 5555   (see caveat #1: may be tailnet-only)
sudo tailscale funnel --bg --https=5555 localhost:5555
```

`--bg` = run in the background (survives logout). Funnel config is stored by
`tailscaled` and persists across reboots.

---

## Managing / changing the funnel

```bash
# See everything currently exposed
tailscale funnel status

# Add or change a mapping (re-run with the port you want)
sudo tailscale funnel --bg --https=<PUBLIC_PORT> localhost:<LOCAL_PORT>


### To stop exposing one service
There's no per-port "off" flag; the simplest reliable way is:
```bash
sudo tailscale funnel reset           # clears all
# then re-add only the ones you want to keep (commands above)


sudo tailscale funnel --bg --https=5555 localhost:5555
sudo tailscale funnel --bg --https=3033 localhost:3033

sudo tailscale funnel --https=3033 off
sudo tailscale funnel --https=5555 off

```

---

## Verify it's working

```bash
# From the VM / a tailnet device
curl -s https://medpush-virtual-machine.tail3e5104.ts.net/api/health
curl -s https://medpush-virtual-machine.tail3e5104.ts.net:8443/api/health

# From a device WITHOUT Tailscale (phone on cellular) — proves it's truly public
# open the same URLs in a browser
```

Expected API response:
```json
{"status":"ok","database":"connected"}
```

---

## App config — what clients should use


```
TikTok API : https://medpush-virtual-machine.tail3e5104.ts.net:8443/api/...
Insta API  : https://medpush-virtual-machine.tail3e5104.ts.net/api/...
```

Replaces the old tailnet-only URLs (`http://100.115.149.3:3030` / `:3033`),
which only worked on devices that had Tailscale installed.

---




The re-auth prompt comes from your Tailscale SSH ACL rule using "action": "check". The check action forces periodic browser re-authentication. Switch it to "accept" to skip the login.

  In your Tailscale admin console → Access Controls, find your SSH rule and change it:

  "ssh": [
    {
      "action": "accept",        // was "check" — this is what caused the login prompt
      "src":    ["autogroup:member"],
      "dst":    ["autogroup:self"],
      "users":  ["autogroup:nonroot", "root"]
    }
  ]

  - check = allowed, but must re-verify identity in a browser every N hours (default ~12h).
  - accept = allowed with no interactive re-auth.

  Key points:
  - dst must match the target host (medpush@100.115.149.3), and users must include the Unix user you're logging in as (medpush).
  - Both source and destination machines need Tailscale SSH enabled: on the server run sudo tailscale up --ssh.
  - After saving the ACL, the change takes effect immediately — no restart needed.


  _Last updated: 2026-06-30_
  _Last updated: 2026-07-01_