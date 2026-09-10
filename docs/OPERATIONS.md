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

| I changed… | To ship it |
| --- | --- |
| `frontend/` | `git push` — Vercel builds from `main` |
| `backend/` or `packages/core/` | `git push` — the Deploy API workflow runs |
| both | `git push` — both pipelines run independently |
| a migration | it applies on the next backend boot, i.e. on that deploy |
| something uncommitted | `yarn api:deploy` — deploys your working tree |

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

then added under *Settings → Secrets and variables → Actions*. Without it the
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

yarn api -- <anything>          # raw flyctl passthrough
yarn api -- scale count 1
yarn api -- ssh sftp put <local> /data/x.db
```

**`flyctl` is deliberately never called directly.** The installer needs
elevation to create its shortcut, so on Windows the binary exists at
`%USERPROFILE%\.fly\bin\flyctl.exe` but `fly` is *not* on PATH — in Git Bash it
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
2. **`X-Forwarded-Host` still survives Vercel → Fly.** If it stops, *every*
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

## Secrets

Runtime config lives in **Fly secrets**, never in the image, never in git.
`backend/.env` is the local mirror and is gitignored.

```bash
yarn api:secrets                                   # list names
yarn api -- secrets set KEY=value                  # triggers a machine update
yarn api -- secrets import < file                  # bulk, values off the CLI
```

Groups: `JWT_SECRET`/`DATABASE_KEY` · `APP_BASE_DOMAIN`/`SIGNUP_INVITE_CODE`/
`SUPER_ADMIN_*` · `CLOUDFLARE_*`/`VERCEL_*` (tenant subdomains) ·
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

## Rollback

The cutover was one DNS record, so is the rollback: point `api.liratek.shop`
back at the Cloudflare tunnel (`DEPLOYMENT.md` § 4d). TTL is 60 s. This only
helps if something is actually listening there.

For a bad build, redeploy the previous commit — `fly releases` lists them.
