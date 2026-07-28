# Fix: tiksurfer crash-loop / "no response on localhost:8443"

**Symptom.** `tiksurfer` restarts forever (systemd restart counter in the
thousands) and/or `curl localhost:8443/api/health` returns *"couldn't connect"*,
so the monitoring extension marks the service dead.

Two distinct root causes produced this, both about **which address the app
binds** — not the port number. Ports are correct: **tiktok = 8443, insta = 8442**.

---

## Why it broke

The tiktok app is fronted by a Tailscale Funnel:

```
funnel :8443  ->  http://localhost:8443
```

To serve that, `tailscaled` itself **listens on the tailnet IP `:8443`**
(`100.115.149.3:8443` and the IPv6 equivalent). Check with:

```bash
sudo ss -tlnp | grep :8443
```

You will see `tailscaled` owning the tailnet-IP `:8443` sockets. The app must
bind an address that does **not** overlap those.

- **Cause A — wildcard bind (`EADDRINUSE`).** `app.listen(PORT)` with no host
  binds the wildcard `0.0.0.0`/`::`. The wildcard overlaps tailscaled's
  existing `100.115.149.3:8443` bind → `listen EADDRINUSE 0.0.0.0:8443` →
  systemd restarts → repeat forever.

- **Cause B — LAN-IP bind (no localhost).** Binding a specific non-loopback
  address such as `192.168.1.3` avoids the crash, but then **`localhost` is not
  served**. The funnel dials `localhost:8443` and the health check curls
  `localhost:8443`, so both fail even though the process is "up."

Insta (`:8442`) never hit this because its funnel listener is on port **443**
(a *different* port from the app's 8442), so nothing else is on 8442 and a
wildcard bind is uncontested.

## The fix

Bind the app to **loopback `127.0.0.1`**. Loopback is:
- reachable by the funnel proxy (`localhost:8443`), and by local health checks,
- **not** one of the tailnet IPs tailscaled holds, so no `EADDRINUSE`.

In `databases/tiktok/server.js`:

```js
// Bind to loopback by default: tailscaled funnel owns the tailnet IP :8443
// and proxies to localhost:8443. Wildcard (0.0.0.0) would collide (EADDRINUSE).
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => { ... });
```

Do **not** set `HOST` to a tailnet or wildcard address for a service whose
funnel-listen port equals its app port (i.e. tiktok/8443).

## Verify

```bash
sudo ss -tlnp | grep :8443     # expect a node 127.0.0.1:8443 line + tailscaled tailnet lines
curl -s localhost:8443/api/health   # expect {"...","database":"connected",...}
```

## Restart safely

Use `./restart-services.sh` (repo root). It restarts both units, kills any
**stale orphaned `node server.js`** squatting a port (matched by working dir,
so tailscaled/postgres are never touched), then **polls localhost health with
retries** — it treats "no localhost response" as failure and restarts until
curl answers, which is exactly the state the extension watches for.

```bash
./restart-services.sh            # both services
./restart-services.sh tiksurfer  # just one
```

## Quick reference

| Service      | App binds        | Funnel listener        | Local health check           |
|--------------|------------------|------------------------|------------------------------|
| tiksurfer    | `127.0.0.1:8443` | tailnet-IP `:8443`     | `curl localhost:8443/api/health` |
| insta-surfer | `*:8442`         | `:443` → `localhost:8442` | `curl localhost:8442/api/health` |
