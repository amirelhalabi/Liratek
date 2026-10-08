# Operations — who serves what, and how to ship

One screen. For the reasoning behind any of it, `docs/DEPLOYMENT.md`; for the
architecture, `docs/plans/todo_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`.

---

## The five services

```
             browser
                │
                ▼
        ┌───────────────┐   www.liratek.shop, <slug>.liratek.shop
        │    VERCEL     │   serves the SPA (frontend/)
        └───────┬───────┘   rewrites /api, /health, /socket.io  ──┐
                │                                                 │
        ┌───────▼───────┐   DNS for liratek.shop                  │
        │  CLOUDFLARE   │   per-tenant CNAMEs (auto-created)      │
        └───────────────┘   R2 bucket: liratek-backups            │
                                                                  │
        ┌─────────────────────────────────────────────────────────▼──┐
        │  FLY.IO   app `liratek-api`, region fra, ONE machine        │
        │    backend/ (Express) + /data/liratek.db on a 3 GB volume   │
        │    LITESTREAM sidecar → R2, 1 s sync interval               │
        └─────────────────────────────────────────────────────────────┘

        GITHUB  amirelhalabi/Liratek — PUBLIC. Vercel auto-deploys the SPA
                from main; the Deploy API workflow auto-deploys the backend.
```

**Pushing to `main` ships everything.** Vercel builds the SPA;
`.github/workflows/deploy-api.yml` builds and deploys the backend to Fly and
then runs the same verifier `yarn api:deploy` runs. The manual command still
works and is still the right tool for deploying uncommitted work or re-rolling
the machine — it is no longer something you must remember.
`.github/workflows/ci.yml` also runs on every push to `main` now (lint,
typecheck, core/backend/frontend tests, build) — a separate workflow that
does not gate `deploy-api.yml`, since both fire independently off the same
push.

| I changed…                     | To ship it                                               |
| ------------------------------ | -------------------------------------------------------- |
| `frontend/`                    | `git push` — Vercel builds from `main`                   |
| `backend/` or `packages/core/` | `git push` — the Deploy API workflow runs                |
| both                           | `git push` — both pipelines run independently            |
| a migration                    | it applies on the next backend boot, i.e. on that deploy |
| something uncommitted          | `yarn api:deploy` — deploys your working tree            |

The workflow only fires for paths that end up in the image (`backend/**`,
`packages/core/**`, `fly.toml`, `package.json`, `yarn.lock`), so a docs or
frontend commit does not roll the machine. It is serialised by a
`concurrency: deploy-api` group with `cancel-in-progress: false`: one machine
holding a single-writer SQLite file must never have two deploys racing for its
lease, and cancelling a deploy midway is worse than queueing behind it.

It needs a repository secret **`FLY_API_TOKEN`**, created once with:

```bash
fly tokens create deploy -a liratek-api
```

then added under _Settings → Secrets and variables → Actions_. Without it the
workflow stops on its first step and says so.

---

## Commands

```bash
yarn api:deploy      # build remotely, deploy, THEN verify it actually came up
yarn api:verify      # the checks alone, no deploy
yarn api:logs
yarn api:status
yarn api:ssh         # shell on the machine
yarn api:secrets     # names only, never values

yarn api <anything>             # raw flyctl passthrough
yarn api scale count 1
yarn api ssh sftp put <local> /data/x.db
```

**`flyctl` is deliberately never called directly.** The installer needs
elevation to create its shortcut, so on Windows the binary exists at
`%USERPROFILE%\.fly\bin\flyctl.exe` but `fly` is _not_ on PATH — in Git Bash it
is not on PATH either way. `scripts/fly.mjs` resolves it. An agent already lost
time concluding flyctl was missing.

**Logging in is the one manual step.** `fly auth login` refuses to run in a
non-interactive shell, so do it once in your own terminal:

```powershell
& "$env:USERPROFILE\.fly\bin\flyctl.exe" auth login
```

---

## Why `api:deploy` verifies, and what it checks

`fly deploy` exiting 0 means the machine started, not that the app works. The
script therefore asserts:

1. `/health` responds
2. **`X-Forwarded-Host` still survives Vercel → Fly.** If it stops, _every_
   tenant login fails at once with a generic "invalid credentials" — a symptom
   pointing nowhere near the cause. Cheapest possible tripwire.
3. Migrations applied (boot marker)
4. Litestream is replicating — and hard-fails on `REPLICATION IS OFF`
5. **Exactly one machine.** SQLite has one writer; two machines on one volume is
   corruption, not capacity. Fly's defaults lean toward two.

Checks 3 and 4 read startup log lines, which scroll away within minutes because
the health check runs every 15 s. They are hard assertions right after a deploy
and informational in `api:verify`.

---

## Email (live since 2026-10-07)

`mail@liratek.shop` on Spacemail; app sends over SMTP (`mail.spacemail.com:465`); MX/SPF/DKIM/DMARC records live in **Cloudflare** (not Spaceship — Spaceship's DNS page is inactive by design). New domain ⇒ early mail may land in Spam (reputation, not config). **Pending: LIRA-277** — around 2026-10-21, if invites reach the Inbox, change `_dmarc` from `p=none` to `p=quarantine` (`current_sprint.md` has the exact record).

## Sign-in directory (LIRA-288)

www's "your shops" answers (email code, Continue with Google, Forgot password)
come from one platform table, `signin_directory`: one row per **confirmed
email** or **linked Google account** of an active shop user, naming the shop.
It is an **index**, not the source of truth — each shop's own `users` /
`user_identities` are — and the app updates it after every email, Google,
activation and shop change. A shop's own address never reads it, so drift can
only hide a shop from the www lists, never lock anyone out.

```bash
yarn api ssh console -C "node dist/scripts/signinDirectoryCli.js"           # dry run: JSON diff, exit 1 on any difference
yarn api ssh console -C "node dist/scripts/signinDirectoryCli.js --write"   # rebuild from every shop's records
```

Judge it by the exit code (0 = clean / rebuilt, 1 = differences or an
unreadable shop): stdout also carries the dotenv and `[MIGRATIONS]` lines
ahead of the JSON. Run the dry run after the deploy that ships it (expect zero differences — the
v200 migration back-fills it) and whenever the boot log warns `Sign-in
directory differs from the shops' records`. After the per-tenant split, run
`--write` once (the migration back-fill only sees a shared file).

## Secrets

Runtime config lives in **Fly secrets**, never in the image, never in git.
`backend/.env` is the local mirror and is gitignored.

**`.env.fly` (repo root, gitignored) is the source copy of the production
secrets it lists** (email/SMTP so far). The running app cannot read a file on
your machine, so after any edit copy it to Fly — this restarts the API
(~10–30 s):

```bash
grep -v '^#' .env.fly | grep -v '^$' | yarn api secrets import
```

The `grep`s drop comment and blank lines. Never commit `.env.fly`; the repo is
public.

```bash
yarn api:secrets                                   # list names
yarn api secrets set KEY=value                     # triggers a machine update
yarn api secrets import < file                     # bulk, values off the CLI
```

On this repo's Yarn 4, write `yarn api <args>` — `yarn api -- <args>` passes a
literal `--` to flyctl and fails.

Groups: `JWT_SECRET`/`DATABASE_KEY` · `APP_BASE_DOMAIN`/`SUPER_ADMIN_*` ·
`EMAIL_*`/`SMTP_*`/`SIGNUP_INVITE_BASE_URL` (invite emails) · `TURNSTILE_*`
(self-serve sign-up) · `CLOUDFLARE_*`/`VERCEL_*` (tenant subdomains) ·
`LITESTREAM_*` (backups).

`DATABASE_KEY` **encrypts nothing** — stock `better-sqlite3` ignores
`PRAGMA key`. It exists to satisfy `validateProductionEnv()`. At-rest cover is
Fly's encrypted volume. See `DEPLOYMENT.md` § 6.

---

## Backups

Litestream → R2 `liratek-backups`, prefix `web/liratek`, 1 s sync.
Fly's volume also snapshots daily (5 retained).

**The bucket holds `.ltx` transaction segments, not a `.db` file.** There is
nothing to download and open; `litestream restore` reassembles them. The
`0000/`–`0009/` folders are compaction levels.

Restore drill — run it periodically, because a backup nobody has restored is a
hypothesis:

```bash
yarn api:ssh
  cd /app/backend
  litestream restore -o /tmp/check.db /data/liratek.db
  node -e "const d=require('/app/node_modules/better-sqlite3');const b=new d('/tmp/check.db',{readonly:true});console.log(b.pragma('integrity_check')[0].integrity_check, b.prepare('SELECT COUNT(*) c FROM tenants').get().c)"
  rm /tmp/check.db
```

R2 is **EU-jurisdiction**: it answers only on
`https://<account>.eu.r2.cloudflarestorage.com`. The default endpoint returns
`403 AccessDenied` for the same bucket and keys — indistinguishable from a bad
credential. Check the endpoint before the token.

---

## Per-tenant database mode (not live yet)

`TENANT_DB_MODE` (`shared` default, `per-tenant`) and `TENANT_DATABASES_DIR`
are wired end to end — boot-time migration of every shop file, a Litestream
`dir` replica for the tenants directory, an empty-volume restore attempt, and
a deploy-verifier check for the per-tenant boot marker — but **nothing sets
`TENANT_DB_MODE=per-tenant` today**; production stays on `shared` until
Phase D actually splits the file. See
`docs/plans/ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.4 for
the full runbook (split tool, file layout, restore drill, rollback) when that
day comes. **Unverified**: whether `litestream restore` resolves a
`dir`-configured replica for a tenant file that does not yet exist locally
the same way it resolves the single-file `path` replica above — flagged
clearly in § 12.4, not assumed.

**Two boot-time guards protect the flip itself** (§ 12.4), so setting the env
var without having run the split doesn't take every shop down silently:

- **Safety lock.** Before installing per-tenant routing, the backend checks
  whether the platform database still holds shop data (i.e. the split never
  ran). If it does, per-tenant mode is REFUSED — the app keeps running in
  `shared` mode in every respect, logs one ERROR line
  (`Per-tenant mode REFUSED: platform database still holds shop data — run
  the Phase D split first`), and the deploy verifier hard-fails on that line.
  It never crashes the process — a crash-loop on the one Fly machine would
  itself take every shop offline.
- **Completeness check.** Once per-tenant mode IS active, the boot-time
  `"Tenant databases migrated"` line now also carries `missing` /
  `missingIds` — active/suspended tenants with no `<id>.db` file found on
  disk. `scripts/deploy-api.mjs` fails the deploy on a non-zero `missing`
  count (and on an old boot log that doesn't report `missing` at all — that
  shape predates this check and can't be trusted). Tenants mid-provision
  (`provisioning`) and stray files with no matching tenant row (orphans) are
  logged as warnings only, never a failure.

## Rollback

The cutover was one DNS record, so is the rollback: point `api.liratek.shop`
back at the Cloudflare tunnel (`DEPLOYMENT.md` § 4d). TTL is 60 s. This only
helps if something is actually listening there.

For a bad build, redeploy the previous commit — `fly releases` lists them.
