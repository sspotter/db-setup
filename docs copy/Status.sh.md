status.sh — now shows local + public URLs

Added two columns — Local URL and Public URL (Tailscale) — driven off a single SERVICES list. Each row carries its funnel mapping, and the status column now fo):
Renders well. The only nit: the em-dash — inwide/ambiguous-width char that throws off the right border alignment on that row. Let me se box stays square in every terminal:
                                                                                                                     Ran 1 shell commandBoth done and verified. Here's what changed:status.sh — now shows local + public URLs
                                                                                                                   Added two columns — Local URL and Public URLingle SERVICES list. Each row carries itsfunnel mapping, and the status column now fo):

┌──────────────────────┬───────────────────────────┬────────────────────┐
│       Service        │           Local
├──────────────────────┼────────────────────
│ tiksurfer (3030)     │ http://localhost:30
├──────────────────────┼────────────────────
│ insta-surfer (3033)  │ http://localhost:30
├──────────────────────┼───────────────────────────┼────────────────────┤
│ prisma-tiktok (5555) │ http://localhost:55
├──────────────────────┼────────────────────
│ prisma-insta (5556)  │ http://localhost:5556     │ (not exposed)      │
└──────────────────────┴────────────────────

Postgres is shown in the footer as private/ting later, just edit the one SERVICES=( … )
block at the top — the table auto-sizes.

redeploy.sh — pull + restart after a GitHub

./redeploy.sh            # git pull → npm intart → status
./redeploy.sh --no-pull  # skip pull, just r
./redeploy.sh --restart  # only restart the

It pulls (fast-forward only, so it won't sil refreshes deps + Prisma client for both DB
projects, runs sudo systemctl restart tiksur the status table and points you at the logs
if anything comes up unhealthy.

Both scripts are syntax-checked, executable, and status.sh is confirmed rendering live.

One thing I did not wire in: prisma migrate A pull that changes the schema won't touchthe actual database tables — redeploy.sh onlt's deliberate (auto-migrating production onevery pull is risky). If you want schema chao, tell me and I'll add a guarded step. Wantme to do that?