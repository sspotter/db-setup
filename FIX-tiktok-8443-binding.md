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

## Two access paths — bind BOTH loopback and the LAN IP

tiktok is reached two ways, and they need different bind addresses:

| Path | Reaches tiktok via | Requires bind on |
|------|--------------------|------------------|
| Tailscale Funnel (`…ts.net:8443`) | dials `localhost:8443` | `127.0.0.1` |
| Subdomain `tiksurfer.medpushmena.com` | DNS → `192.168.1.3` → `192.168.1.3:8443` | the LAN IP `192.168.1.3` |

Loopback-only (an earlier version of this fix) satisfied the funnel but broke
the subdomain (`curl tiksurfer.medpushmena.com:8443` → couldn't connect). The
wildcard would serve both but collides with tailscaled on 8443. So we bind the
**specific** addresses we need and skip the Tailscale one.

## The fix

`databases/tiktok/server.js` binds **loopback + every non-Tailscale IPv4**, one
`http` listener per address, each with an error handler so a single failed bind
can't crash the process:

```js
const inTailscaleRange = (addr) => {                 // Tailscale CGNAT 100.64.0.0/10
  const [a, b] = addr.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
};
const hosts = process.env.HOST
  ? process.env.HOST.split(',').map((s) => s.trim()).filter(Boolean)
  : ['127.0.0.1', ...Object.values(os.networkInterfaces()).flat()
      .filter((ni) => ni.family === 'IPv4' && !ni.internal && !inTailscaleRange(ni.address))
      .map((ni) => ni.address)];

for (const host of [...new Set(hosts)]) {
  const server = http.createServer(app);
  server.on('error', (err) => console.error(`could not bind ${host}:${PORT} — ${err.code}`));
  server.listen(PORT, host, () => console.log(`listening on http://${host}:${PORT}`));
}
```

On this box that resolves to `127.0.0.1` + `192.168.1.3`, leaving
`100.115.149.3:8443` to tailscaled. Override with `HOST="a,b,c"` if needed —
but never include a tailnet (`100.64/10`) or wildcard address for tiktok/8443.

## Verify (confirmed working)

```bash
sudo ss -tlnp | grep :8443     # node 127.0.0.1:8443 + node 192.168.1.3:8443 + tailscaled 100.115.149.3:8443
curl -s localhost:8443/api/health                     # funnel path   -> database:connected
curl -s tiksurfer.medpushmena.com:8443/api/health     # subdomain path -> database:connected
```

Both paths now return `{"Platform":"TikTok","status":"ok","database":"connected",...}`.

The health route (`routes/health.js`) also appends a trailing `\n` so the shell
prompt starts on its own line after `curl`, instead of running into the JSON.

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

| Service      | App binds                      | Funnel listener        | Local health check           |
|--------------|--------------------------------|------------------------|------------------------------|
| tiksurfer    | `127.0.0.1:8443` + `192.168.1.3:8443` | tailnet-IP `:8443`     | `curl localhost:8443/api/health` |
| insta-surfer | `*:8442`                       | `:443` → `localhost:8442` | `curl localhost:8442/api/health` |
