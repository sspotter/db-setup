# Code Review — `scripts/`

**Reviewed:** `generate-ops.sh`, `redeploy.sh`, `setup-services.sh`, `status.sh`, `setup.md`
**Date:** 2026-08-09
**Method:** clean-code-guard review mode (Clean Code / SOLID / DRY-KISS-YAGNI + LLM failure-mode checks)
**Verdict:** 2 defects break the running system today. 1 script (`generate-ops.sh`) is non-functional as shipped. Do not rely on `status.sh` output until §1 is fixed.

### How these findings were verified

| Claim | Evidence |
|---|---|
| Real service ports are 8443 / 8442 | `FIX-tiktok-8443-binding.md:8`, `restart-services.sh:29-31` |
| Health route is `/api/health` | `databases/{tiktok,instagram}/server.js` → `app.use('/api', healthRoutes)` |
| `databases/` sits at repo root, not under `scripts/` | `git ls-files`, directory listing |
| Subshell drops `SERVICE_TABLE` appends | isolated bash repro (below) |
| `PORT_TABLE` rows glue onto the separator | isolated bash repro (below) |
| No `SERVICES_JSON` producer, no example config, `.env` untracked | `grep`, `git ls-files`, `find` |

`generate-ops.sh` **could not be executed end-to-end** — `jq` is not installed on this machine and no config file exists in the repo. Its findings are static analysis plus two isolated repros of the exact shell mechanics it uses. Everything else was verified against the source.

---

## 1. Critical — affects the running system

### C1 · `status.sh` reports ports that no service listens on

**`status.sh:21-26`**

```bash
SERVICES=(
  "tiksurfer|3030|api|https://$FUNNEL_HOST:8443"
  "insta-surfer|3033|api|https://$FUNNEL_HOST"
  ...
```

The services moved to **8443 (tiktok) / 8442 (insta)**. `FIX-tiktok-8443-binding.md:8` states it outright — *"Ports are correct: tiktok = 8443, insta = 8442"* — and `restart-services.sh:29-31` uses those ports. `scripts/status.sh` was never updated.

**Failure:** `curl -s -m 5 http://localhost:3030/api/health` connects to nothing, `resp` is empty, and line 46 falls through to `status="$status · no resp"`. Both API rows report **"no resp" on every run, on a perfectly healthy box**. The `systemctl is-active` column still reads `active`, so the table shows `active · no resp` — the precise signature that `FIX-tiktok-8443-binding.md` teaches operators to treat as a crash-loop. The tool actively misleads.

Note the tell: the *public* URL column already carries `:8443`, so the two halves of the same row disagree with each other.

**Fix:** `3030 → 8443`, `3033 → 8442`. Better, per §4, read the inventory from one shared file.

---

### C2 · `redeploy.sh` installs nothing — the dependency step is silently dead

**`redeploy.sh:16`**

```bash
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
```

The script lives in `scripts/`, so `PROJECT_ROOT` resolves to `<repo>/scripts`. But `databases/` is at the **repo root**. So line 44 builds `<repo>/scripts/databases/tiktok`, line 45 finds no `package.json`, and line 45's `|| continue` skips it — with no message:

```bash
dir="$PROJECT_ROOT/databases/$db"
[ -f "$dir/package.json" ] || continue
```

Both projects are skipped. No `npm install`. No `prisma generate`. The script then prints `Done.` and exits 0.

**Testable consequence:** `--no-pull` and `--restart` are **behaviorally identical today** — both skip the pull, skip the (dead) install, restart, and print status. The flag distinction the header documents does not exist at runtime.

Compare `restart-services.sh:25`, which uses the identical idiom *correctly* — because that file sits at the repo root. `redeploy.sh` was moved into `scripts/` and the path was never adjusted.

**Fix:**

```bash
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"   # status.sh lives here
```

and change line 66 to `"$SCRIPT_DIR/status.sh"` — that call currently works *only* because both files share a directory, and it breaks the moment `PROJECT_ROOT` is corrected.

The `|| continue` is what hid this for so long. A missing project directory in a deploy script is not a normal condition — it should be loud (*rule 15: never swallow the failure you needed to see*).

---

## 2. `generate-ops.sh` — non-functional as shipped

This file has never run successfully. Grouping its defects together, because they compound: there is no config file to feed it, no format contract for its central data structure, and its two output artifacts are both malformed. Treat it as unfinished work, not as code with bugs.

### G1 · The generated `status.sh` has no service list — the generation step was never written

**`generate-ops.sh:50-61`, `137-139`**

The heredoc is quoted (`<<'STATUSEOF'`), so nothing inside is expanded, and no `sed`/substitution pass follows it (`grep -n PLACEHOLDER` matches only the three definition sites). The generated file ships literally:

```bash
HOST_IP="HOST_IP_PLACEHOLDER"
PROJECT_NAME="PROJECT_NAME_PLACEHOLDER"
SERVICES_JSON='SERVICES_JSON_PLACEHOLDER'
```

This is **not a missing `sed`**. Nothing anywhere in the script converts `.services[]` into the `unit|port|endpoint` lines that line 59 parses — the only two `jq` reads of `.services[]` (lines 149, 161) emit tab- and markdown-formatted text for other purposes. The `health_endpoint` key documented in the header (line 14) is **never read by any jq expression in the file**. The wire format between config and generated script is undefined.

Downstream, the generated script runs `systemctl is-active SERVICES_JSON_PLACEHOLDER` and curls `http://localhost:` with an empty port, then renders a table of that garbage. It reports confidently and reports nonsense — *rule 18*.

**Remediation:** implement the missing step (roughly `jq -r '.services[] | "\(.name)|\(.port)|\(.health_endpoint // "")"'` piped into the placeholder), not a one-line patch.

### G2 · The services table in `OPERATIONS.md` is always empty

**`generate-ops.sh:149-155`** — appends inside a pipeline `while` run in a subshell and are discarded:

```
$ printf 'a\nb\n' | while read -r n; do T+="|row-$n"; done; echo "[$T]"
[HEADER]
```

The `sed` on line 155 then rewrites the trailing separator into a bottom border, so the output is a header box with **zero data rows** — and it looks intentional, which is worse.

**Fix:** `while ... done < <(jq ...)` (process substitution), or accumulate via `mapfile`.

### G3 · The ports table is invalid markdown

**`generate-ops.sh:158-166`** — `PORT_TABLE+="$(cat ...)"` strips the command substitution's newlines and adds none, so the first row lands *on* the separator line:

```
| Component | Port | Purpose |
|---|---|---|| tiksurfer | 8443 | API |
| insta | 8442 | API |
```

No markdown renderer will parse that as a table. **Fix:** `PORT_TABLE+=$'\n'"$(jq -r ...)"`.

### G4 · Shared, predictable temp file with append-mode redirection

**`generate-ops.sh:161-166`** — `>> /tmp/port_table.tmp`, a fixed world-writable path, opened for *append*. A leftover from any run that died before the `rm` silently duplicates every row into the next run's output; two concurrent runs interleave. And because the path is predictable and pre-creatable, a symlink planted there redirects the write to any file the invoking user can write.

**Fix:** drop the temp file — the value is already being captured into a variable. If one is genuinely needed, `mktemp` plus a cleanup `trap`.

### G5 · `$HOST_IP` is emitted literally into `OPERATIONS.md`

**`generate-ops.sh:239`** — inside a **single-quoted** jq program, so no shell expansion occurs:

```bash
jq -r '.prisma_studios[] | "- **\(.database):** http://$HOST_IP:\(.port)"'
```

Every Prisma Studio link in the generated doc reads `http://$HOST_IP:5555`.

**Fix:** `jq -r --arg host "$HOST_IP" '... "http://\($host):\(.port)"'`.

### G6 · `HOST_IP` is otherwise dead, and defaults to one specific machine

**`generate-ops.sh:39`** — `HOST_IP` feeds only the placeholder that is never substituted (G1) and the string that never expands (G5). It is computed and unused. Its default also hard-codes `100.115.149.3` — one particular tailnet address baked into a tool whose entire premise is being project-agnostic (*rules 21, 1*).

### G7 · The documented example config does not exist

Line 8 says *"see example-ops-config.json."* `git ls-files` and `find` both come up empty. The script's one required argument has no reference implementation — which is consistent with G1's conclusion that it was never run.

### G8 · Smaller items

| Line | Issue |
|---|---|
| 30 | Comment claims *"bash + jq, or fallback grep-based parser."* There is no fallback; lines 31-34 hard-fail without `jq`. Comment lies about the code (*rule 5*). |
| 61 | `\| while read -r line; do echo "$line"; done` is a no-op passthrough — it reads lines and echoes them unchanged. Delete (*rule 21*). |
| 162, 166 | `[ -f /tmp/port_table.tmp ] && … && rm` guards a file the previous line just created with `>>`. Always true — dead defensive branch (*rule 16*). |
| 37 | `jq -r '.project_name'` with no `// ""` writes the literal string `null` into the doc when the key is absent. Neighboring lines all use `//` defaults. |
| 151 | `printf '%4d' "$port"` aborts on a non-numeric port; `printf '%-12s'` pads but never truncates, so names >12 chars break the box alignment. |
| 22 vs 52 | Generator runs `set -euo pipefail`, generated script runs `set -uo pipefail`. Reasonable for a status tool, but undocumented. |

---

## 3. `setup.md` — instructs operators to install a known-broken copy

### D1 · The pasted script is a drifted duplicate that reintroduces a fixed bug

**`setup.md:12-51`** tells the operator to `cat >` an inline copy of `setup-services.sh`. That copy is missing this line from the real script (`setup-services.sh:19`):

```bash
NODE="$(readlink -f "$NODE")"
```

That line exists for a documented reason — the comment above it explains that fnm/nvm hand out temporary per-shell node paths that vanish on reboot. Anyone who follows `setup.md` gets systemd units pointing at a path that disappears, so **the services come up now and fail after the next reboot** — exactly the failure the real script was written to prevent. The copy has also lost `--full` from the status check.

This is textbook duplicated *knowledge*, not duplicated text (*rule 11*): one fact — how to write these unit files — living in two places, already out of sync.

**Fix:** delete lines 12-51 entirely. Replace Step 2 with `git pull`, and have Step 3 run the repo's script.

### D2 · The verification commands are wrong on both port and path

**`setup.md:65-66`**

```bash
curl localhost:3030/health   # tiktok
curl localhost:3033/health   # insta
```

Both ports are stale (8443 / 8442), and the path is wrong — `server.js` mounts health at `app.use('/api', healthRoutes)`, so the endpoint is `/api/health`. A **correctly installed system fails this check**, sending the operator to debug a working install. Line 72's restart commands are fine.

Correct form:

```bash
curl localhost:8443/api/health   # tiktok
curl localhost:8442/api/health   # insta
```

---

## 4. Cross-cutting — the service inventory is written out four times

The same facts (unit name → port → directory) are hard-coded in four files:

| File | Lines | Ports |
|---|---|---|
| `restart-services.sh` | 29-31 | **8443 / 8442** ✅ |
| `scripts/status.sh` | 21-26 | 3030 / 3033 ❌ |
| `scripts/redeploy.sh` | 4, 58, 70-71 | 3030 / 3033 ❌ (comments) |
| `scripts/setup-services.sh` | 59-60 | 3030 / 3033 ❌ (unit `Description`) |

It has already drifted, and C1 is the direct consequence. The fixes in this report will drift again on the next port change unless this is consolidated.

**Fix:** one `scripts/services.conf` holding `unit|port|dir|label`, sourced by all four scripts. This is the one abstraction in this review that has multiple real consumers *today* — it passes the YAGNI test that most of `generate-ops.sh` fails.

Separately, `status.sh:65-115` and the embedded copy at `generate-ops.sh:90-136` are ~50 duplicated lines of table-rendering helpers (`absorb`, `repeat`, `center`, `border`, `row`). The two copies have **already** diverged — `generate-ops.sh:69` adds `|| echo 'not-installed'` where `status.sh:36` does not.

---

## 5. Remaining findings

### `redeploy.sh`

| ID | Sev | Finding |
|---|---|---|
| R1 | Med | **Reimplements `restart-services.sh`, minus every safeguard.** Line 59 does `sudo systemctl restart tiksurfer insta-surfer; sleep 3`. `restart-services.sh` exists *specifically* because a plain restart leaves services "up but dead" — its header documents stale orphan processes squatting the port and bad binds, and it adds `kill_stale` plus a health-retry loop. `redeploy.sh` ships the naive version that `FIX-tiktok-8443-binding.md` documents as insufficient. **Fix:** call `"$PROJECT_ROOT/restart-services.sh"` and delete lines 58-66. |
| R2 | Med | **Exit status doesn't reflect failure.** `set -uo pipefail` without `-e`, and the `sudo systemctl restart` on line 59 is unchecked. A failed restart still reaches `echo "Done."` and exits with `status.sh`'s status. Any cron/CI wrapper reads success. |
| R3 | Med | **Inconsistent failure policy.** `npm install` failure is fatal (line 48); `prisma generate` failure prints a parenthetical warning and continues (line 52). A stale Prisma client means the server boots and then throws on every query — arguably *more* fatal, not less (*rule 15*). |
| R4 | Low | Only `$1` is parsed (lines 21-26). `./redeploy.sh --restart --no-pull` silently ignores the second flag. |
| R5 | Low | Header comment (line 4) and the closing log hints (lines 70-71) carry the stale `:3030 / :3033` — see §4. |

### `setup-services.sh`

Structurally the best script here. Its argument design — passing `$PWD`, `$(whoami)`, `$(command -v node)` so they evaluate *before* `sudo* — is a genuinely good idea, and `setup.md:57` explains why. Remaining gaps:

| ID | Sev | Finding |
|---|---|---|
| S1 | Med | **The unit sets no `PORT` and no `EnvironmentFile`.** `server.js` falls back to `3001` when `PORT` is unset (`databases/*/server.js:28`/`:21`), and `dotenv` reads `.env` relative to cwd — which the unit sets via `WorkingDirectory`. So correct ports depend entirely on an **untracked** `.env` existing in each service directory. The script never checks. Add a pre-flight `[ -f "$dir/.env" ]` assertion, or set `EnvironmentFile=$dir/.env` explicitly. |
| S2 | Med | **No root check.** The script writes to `/etc/systemd/system/` (line 33). Run without `sudo` it fails mid-way with a bare "Permission denied." One line fixes it: `[ "$(id -u)" -eq 0 ] \|\| { echo "run with sudo"; exit 1; }`. |
| S3 | Low | `RUN_USER` is never validated. A typo produces units that fail at start with an opaque systemd error. `id "$RUN_USER" >/dev/null` is one line. |
| S4 | Low | Unit `Description` hard-codes the stale ports (lines 59-60) — see §4. |
| S5 | Low | Line 65 `systemctl enable postgresql 2>/dev/null \|\| echo "…"` discards stderr, then asserts a cause it never checked. The message is helpful; keep it, but let the real error through. |

### `status.sh`

| ID | Sev | Finding |
|---|---|---|
| T1 | Med | **Points at a script that doesn't exist.** Line 56 tells the user `stopped (./run-prisma.sh)`. There is no `run-prisma.sh` anywhere in the repo (`git ls-files`, `find`). |
| T2 | Med | **Health check greps raw JSON text.** Line 44 `grep -q '"database":"connected"'` breaks on any whitespace or key-order change in the response. `jq -e '.database == "connected"'` is the robust form. `restart-services.sh:86` carries the identical fragile grep — same knowledge, two copies. |
| T3 | Med | **The box shears on any row containing `·`, `✓` or `✗`.** Two separate causes, confirmed by running the script: (a) `${#cell}` is a byte count under a C locale; (b) more importantly, `row()` measures with `${#cell}` (**characters**) but pads with `printf ' %-*s '`, whose width is counted in **bytes**. `·` is 2 bytes and `✓` is 3, so `active · db ✓` measures 13 chars / 16 bytes: `absorb` reserves 16 columns, `printf` believes the string already fills 16 and adds no padding. Every status cell with a mark renders ~3 columns short. Raised from Low after reproducing it — this was visible in normal output all along. |
| T4 | Low | The `""` branch at line 39 is effectively dead — `systemctl is-active` prints `inactive`/`unknown` for a missing unit and never an empty string, so it is reached only if `systemctl` itself is absent. (The `generate-ops.sh` copy adds `\|\| echo 'not-installed'`; the two have drifted — see §4.) |
| T5 | Low | `center()` line 80 assigns `text=$1` then measures `${#1}` instead of `${#text}`. Cosmetic, but it's the kind of inconsistency that survives a later rename as a bug. |

---

## 6. What's good

- **`setup-services.sh:17-20`** — resolving `node` through `readlink -f`, with a comment explaining *why* (fnm/nvm per-shell paths vanish on reboot). This is exactly the comment style the guidelines ask for: why, not what.
- **`restart-services.sh:44-59`** — `kill_stale` matches candidate processes by resolved cwd specifically so it can never touch `tailscaled` or `postgres`, and says so. Careful, well-reasoned code.
- **`restart-services.sh:88-92`** — distinguishing "up but DB down" from "no response" and *deliberately stopping* rather than restart-hammering, with the reasoning inline. Correct call.
- **`setup-services.sh:23-29`** — sanity-checking that both `server.js` files exist before touching `/etc`, with an actionable error message.

---

## 7. Suggested order

1. **C1** — one-line port fix in `status.sh`. Restores trust in the status table immediately.
2. **C2** — `PROJECT_ROOT` in `redeploy.sh` (+ the `status.sh` path that breaks with it). Makes deploys actually deploy.
3. **D1, D2** — cut the duplicated script out of `setup.md`, fix the curl commands. Stops new installs inheriting a fixed bug.
4. **§4** — extract `services.conf`. Prevents C1 from recurring.
5. **R1, R2, R3, S1, S2, T1, T2** — hardening.
6. **`generate-ops.sh`** — decide first whether it is wanted. It has no config file, no format contract for its central data structure, and no evidence of a successful run. Finishing it means implementing G1 and reusing the `status.sh` renderer rather than duplicating it. **Deleting it is a legitimate option** — nothing in the repo depends on it.

   One more reason to decide soon: it writes `$OUTPUT_DIR/status.sh` and `OUTPUT_DIR` **defaults to `.`** (line 25). Run it from `scripts/` with no second argument and it silently overwrites the working `status.sh` with the placeholder-broken version from G1. That hazard predates this review, but the stakes rose now that `status.sh` is the tool you check the box with.

---

---

## 8. Fixes applied

Everything in §7 items 1–5 has been applied. `generate-ops.sh` was **left untouched** — it needs the decision in §7 item 6 first.

### New files

| File | Purpose |
|---|---|
| `scripts/services.conf` | The service inventory — unit, port, dir, label, kind, public URL. One row per service. |
| `scripts/services.lib.sh` | Sourced by all four scripts. Exposes `REPO_ROOT`, `HOST_IP`, `FUNNEL_HOST`, `load_services`, `health_body`, `health_says_db_connected`. |

### Changes

| ID | Fix |
|---|---|
| C1 | Ports now come from `services.conf` — 8443 / 8442. Hard-coded array deleted. |
| C2 | `REPO_ROOT` derived from the library's own location (one level up from `scripts/`), so it is correct regardless of where the script sits or is called from. `status.sh` is now reached via a separate `SCRIPT_DIR`. |
| §4 | All four scripts read the inventory from `services.conf`. `restart-services.sh` filters to `kind=api`; its `ss` port pattern is built from the inventory instead of the literal `:8443\|:8442`. |
| D1 | The pasted duplicate script is gone from `setup.md`; Step 2 is now `git pull` and Step 4 runs the repo's script. |
| D2 | Verification commands corrected to `curl localhost:8443/api/health` / `:8442`, with a note on why bare `/health` 404s. |
| R1 | `redeploy.sh` delegates the restart to `restart-services.sh` instead of `systemctl restart` + `sleep 3`. |
| R2 | The restart's exit status is captured and propagated; a failed redeploy now exits 1 and prints per-unit `journalctl` hints. |
| R3 | `prisma generate` failure is now fatal, matching `npm install`. |
| R4 | All arguments are parsed, not just `$1`. |
| C2/R5 | The silent `|| continue` is now a hard `fail` — a missing project directory means the checkout and `services.conf` disagree, which is exactly what must not pass quietly. Stale `:3030 / :3033` comments removed. |
| S1/S4 | Units now set `Environment=PORT=<port>` from `services.conf`. `dotenv` does not override already-set variables, so the inventory is authoritative for the port. Setup also refuses to run if a service's `.env` is missing. |
| S2 | Root check with an actionable message. |
| S3 | `RUN_USER` validated with `id`; node path checked with `-x` after `readlink -f`. |
| S5 | `systemctl enable postgresql` no longer discards stderr. |
| T1 | The nonexistent `./run-prisma.sh` hint is gone. |
| T2 | Health matching moved to `health_says_db_connected`, a whitespace-tolerant regex shared by `status.sh` and `restart-services.sh`. **Deviation from the recommendation:** the report suggested `jq -e`. `jq` was not adopted — it would add a hard runtime dependency to the one tool you reach for when things are already broken. The regex fixes the actual fragility (whitespace) without that risk. |
| T3 | `absorb`/`row` now agree: new `pad_right` computes padding from `${#text}` and emits explicit spaces, replacing `printf '%-*s'`. `LC_ALL` defaults to `C.UTF-8` in the library. |
| T5 | `center()` measures `${#text}`, not `${#1}`. |

### Verification performed

- `bash -n` passes on all five shell files.
- `services.lib.sh` loads all four rows, skips comments, expands `{funnel}`, and resolves `REPO_ROOT` correctly.
- `status.sh` run end-to-end against stubbed `systemctl`/`curl`: renders 8443/8442, the box aligns on rows containing `·`/`✓`, and a body written as `{"database": "connected"}` (with a space) matches — the old literal grep would have reported `db ✗` for that.
- `redeploy.sh` path resolution confirmed to find `databases/{tiktok,instagram}/package.json` and both Prisma schemas; bad-flag handling exits 1.
- `setup-services.sh` root guard fires with the correct message.

**Not verified:** anything requiring `systemctl`, `sudo`, `npm`, or `git pull` — this is a Windows workstation. Run `./scripts/status.sh` on the VM first; it is read-only and will confirm C1 immediately.

### ⚠ These files must ship in ONE commit

All four scripts now begin by sourcing `scripts/services.lib.sh`. If the modified scripts are committed without the two new files, the VM's next `git pull` leaves every one of them dying on startup with `No such file or directory` — **including `restart-services.sh`, the one script currently working correctly on that box.** That would turn "status.sh reports the wrong ports" into "nothing runs."

All eight files are staged together. Do not `git pull` on the VM until they are committed and pushed as a unit.

### Pre-flight before running the new `setup-services.sh` on the VM

The units now set `Environment=PORT=<port>` from `services.conf`, and `dotenv` does not override variables that are already set — so **systemd's value now wins over `.env`**. That is the intent (the inventory becomes authoritative), but it is the same port/bind area that caused the crash-loop in `FIX-tiktok-8443-binding.md`, so confirm they agree before re-running setup:

```bash
grep -H '^PORT' databases/tiktok/.env databases/instagram/.env
```

If those read 8443 / 8442, this is a no-op change. If they read anything else, re-running setup **moves the service** — reconcile `services.conf` and `.env` first. This could not be checked here: `.env` is untracked and absent from this checkout.

Bind *address* logic is untouched and was confirmed so: `host` comes from a `hosts` list computed inside `server.js` (`databases/tiktok/server.js:87-94`), and no unit sets `HOST` or any bind variable. Only `PORT` is supplied.

### One deviation from the report's own advice

§5 T3 recommended `export LC_ALL=C.UTF-8`. It is set in `status.sh` **without** `export`, because bash re-evaluates its locale on assignment either way, and the shared library is sourced by `redeploy.sh` — exporting would have pushed the locale onto `npm install`, `npx prisma generate`, and `git pull`, and onto root's environment in `setup-services.sh`. Verified: `LC_ALL=C` → `${#"active · db ✓"}` is 16; `LC_ALL=C.UTF-8` → 13, unexported in both cases.

---

*Findings are static analysis plus targeted verification against the repo; `generate-ops.sh` was not executed end-to-end (no `jq`, no config file) and was not modified.*
