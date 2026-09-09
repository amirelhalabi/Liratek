# Next Steps — after the Fly migration

> **Written**: 2026-09-09, at the end of the session that moved the backend off
> the owner's laptop.
> Companions: `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` (the architecture),
> `OPEN_PUBLIC_SIGNUP_PLAN.md` (signup), `docs/DEPLOYMENT.md` § 4d (runbook).

Ordered by **risk**, not by size. Item 1 is the only thing on this list that
could hurt a paying customer today.

---

## 1. Verify the DESKTOP app — highest unmanaged risk 🔴

Today's work changed **shared `@liratek/core`**, which the Electron product runs
too. The web side is verified end to end; **desktop is not verified at all.**

What reaches desktop:

| Change | Desktop impact |
| --- | --- |
| Migration **v174** (`username_case_insensitive`) | Runs on every desktop database. Renames + deactivates case-duplicate usernames. If a shop has `admin` and `Admin`, **one of them stops working** |
| `UserRepository` `USERNAME_MATCH` | Every login lookup on desktop is now `COLLATE NOCASE` |
| `SettingsService.getAllSettings()` now **throws** instead of returning `[]` | Any desktop caller that relied on the silent empty array now sees an exception |
| `BackupService` → `VACUUM INTO` + fixed `listBackups()` | The desktop backup UI is the only consumer. Behaviour changed materially |
| `create_db.sql` NOCASE indexes | Fresh desktop installs only |

**The check (owner runs it — see `CLAUDE.md`):**

```bash
yarn dev                 # rebuilds better-sqlite3 to the ELECTRON ABI + core
#   … then STOP it
cd frontend && npx playwright test --config playwright.electron.config.ts --reporter=list
```

Note the ABI: this session left `better-sqlite3` built for **Node** (the backend
and core jest). Desktop e2e fails every spec at `waitForEvent("window")` until
`yarn dev` rebuilds it — that is environmental, not a regression.

Watch specifically for: login, Settings → shop name, and the backup panel.

Also worth a deliberate manual test: **a desktop database that has both `admin`
and `Admin`** — confirm v174 retires the right one and the shop can still log
in. The survivor rule is "most sessions, ties by lowest id", which was chosen
for the web database and has never been exercised on a desktop file.

---

## 2. Small fixes found today (all cheap) 🟡

| Fix | Where | Note |
| --- | --- | --- |
| **"Last activity" is mislabelled** | `TenantRepository.listAll()` | It is `MAX(transactions.created_at)`, so a shop that logged in but sold nothing shows NULL and reads as "never seen". Relabel to "Last sale", or widen to also consider `sessions.last_activity_at` |
| **`/health/detailed` always reports `unhealthy`** | backend health route | Memory check compares heap 45/47 MB against a 42 MB threshold while RSS is 100 MB of 512 MB. Fly uses `/health` so nothing is broken — but do not wire monitoring to `/health/detailed` until fixed |
| **The `DATABASE_KEY` log line lies** | `connection.ts` + `sqlcipher.ts` | Logs `applied:true, supported:true` on a plaintext database, because stock `better-sqlite3` silently ignores `PRAGMA key` (proved by canary). Make `applySqlCipherKey` detect that the key had no effect and report `applied:false` — a security log that asserts the opposite of reality is worse than no log |
| ~~`deleteTenant` does not deprovision DNS~~ **FIXED** | `TenantProvisioningService` / `tenantDomains.ts` | Both the delete path and the slug-rename path in `backend/src/api/admin.ts` now call `deprovisionTenantDomain` (commit `b82aa523`). Three pre-fix orphans remain: `acme-shop`, `echo-co`, `foxtrot-co` — see the next row |
| Delete the three orphan subdomains | Cloudflare + Vercel | One-off cleanup — run `yarn ops:prune` (dry run by default, `--yes` to actually delete) |
| Retire the `test` tenant (id 5) when finished testing | super-admin UI | Keep it until item 3 is done — it is the only second tenant, and the split needs one |

---

## 3. The per-tenant database split — Phases A–E 🟢

Fully specified in `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 6. Not repeated
here; the ordering that matters:

- **A** tenant-aware `getDatabase()` (~1 day) — the contained one, prove it first
- **B** control-plane split (2–3 days) — **touches login and impersonation**, so
  every step gets a failing-first test
- **C** provisioning creates the tenant database; delete becomes "archive the
  file", retiring the 68-table cascade
- **D** move CornerTech and Test into per-tenant files (hours, trivial at N=2)
- **E** hosting cleanups: Cloudflare proxied + wildcard `*.liratek.shop`, which
  retires `tenantDomains.ts` per-tenant DNS *and* fixes item 2's orphan problem
  by removing per-tenant records entirely

**Backups need nothing new for this** (checked): Litestream 0.5 replicates a
directory with `dir` + `pattern` + `watch: true`, discovers a new tenant file
within seconds, and namespaces the replica by relative path — so
`/data/tenants/5.db` → `tenants/5.db/`. Switch the config at Phase D and delete
the legacy `web/liratek` prefix once a restore from the new layout is verified.

Note the ids are **1 and 5**, not 1 and 2 — ids 2–4 were consumed by deleted
probe tenants. Another argument for id-named files: they are stable, not tidy.

---

## 4. Signup friction 🟢

`OPEN_PUBLIC_SIGNUP_PLAN.md` § 2: support `#/signup?code=…` so onboarding is a
link rather than a dictated secret. Under an hour, and it likely removes the
reason to open signup at all. The three prerequisites for actually dropping the
invite code are in § 3 of that doc — **Turnstile is the minimum bar.**

---

## 5. Backups — from working to trustworthy 🟢

Live and restore-verified. What is missing is *routine*:

- **A restore drill on a schedule.** A restore proven once is proven once. Put
  it on a monthly reminder — the two commands are in
  `PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 10
- **Decide retention.** Litestream defaults are compaction levels, not a
  retention policy. Answer "how far back can we restore?" deliberately
- **Alert when replication stops.** The entrypoint logs loudly if Litestream
  exits at startup, but nothing notices if it dies an hour later. A cheap check:
  alert if the newest object under the prefix is older than N minutes
- **Encrypt before upload**, if the R2 credentials are ever considered
  at-risk — today the objects are readable by anyone holding those keys

---

## 6. Security hygiene 🟡

- **Rotate**: the R2 access key/secret, the Cloudflare API token, the Vercel
  token — all three were pasted into a chat transcript that is stored in
  plaintext on the owner's disk
- **Change the super-admin password** (it is in `backend/.env`, and was used
  over the wire during testing)
- **Real at-rest encryption** needs a SQLCipher-enabled `better-sqlite3` for both
  the container and Electron. Today's cover is Fly's encrypted volume — which is
  genuine, but it is not what the code claims (item 2)
- The **DashScope key in public git history** is a deliberate owner decision to
  leave for now (unused feature). It remains a live billable key in a public
  repository

---

## 7. Test debt 🟡

- Full **frontend** suite has not run since the `messageFrom` extraction — only
  the auth/adapter subset (8 suites, 47 tests, green)
- **Desktop e2e** — item 1
- **Web e2e** (`frontend/tests/e2e-web/`) has not run against the Fly deployment

Core is green at 295 suites / 3061 tests; backend at 56 / 761.

---

## 8. Owner's in-flight work (not touched)

A substantial **database reset** feature is uncommitted in the working tree:
`DatabaseResetService`, `DatabaseResetRepository`, `resetTables`,
`ResetDataModal`, `ResetDataPanel`, plus REST and IPC handlers.

Left entirely alone. Worth a review before it ships, because it deletes across
the 68-table FK graph — the same territory as `deleteTenantCascade`, where
`defer_foreign_keys` and the `NO ACTION` constraints decide whether a delete
fails loudly or strands financial rows. Rule 20 (reversal symmetry) applies.
