# Web (browser) E2E suite

Runs LiraTek as a **real browser client**: Vite serves the frontend on port
**5174**, the Express backend (`backend/`) serves `/api/*` on port **3101**
against a dedicated SQLite file, and pages authenticate over HTTP + JWT.
No Electron, no IPC.

```bash
yarn test:e2e:web        # from the repo root (handles the native-module ABI)
```

## Isolation from the Electron suite

| | Electron suite (`test:e2e`) | Web suite (`test:e2e:web`) |
|---|---|---|
| Config | `playwright.electron.config.ts` | `playwright.web.config.ts` |
| Specs | `tests/e2e-electron/` | `tests/e2e-web/` |
| Frontend | vite :5173 | vite :5174 |
| Data path | Electron IPC (`window.api`) | REST `/api/*` on :3101 |
| Database | per-worker Electron test DB | `test-results/e2e-web/phone_shop.web.db` |
| Native ABI | Electron (`yarn dev` flow) | Node (`yarn rebuild:node`) |

Nothing in this suite touches the Electron config, specs, or DBs — the two
suites can evolve independently. They cannot **run simultaneously** in one
checkout only because `better-sqlite3` is compiled for one ABI at a time.

## Conventions

- The DB **accumulates across runs** (same model as the Electron suite):
  match rows by identity and assert deltas, never absolute totals or
  "newest row". Delete `frontend/test-results/e2e-web/` for a clean slate.
- Always import `test`/`expect` from `./fixtures` — the fixture injects
  `__LIRATEK_BACKEND_URL` so pages talk to this suite's backend instead of
  the default `127.0.0.1:3000`.
- Login helper: `loginAsAdmin(page)` (admin / admin123, seeded by
  `global-setup.ts`).
- Only test pages that work in web mode. The broken-page backlog lives in
  `docs/plans/WEBAPP_MULTI_TENANT_PLAN.md` Appendix A — extend
  `CLEAN_ROUTES` in `lira-web-001` as pages get fixed.

## Reusing desktop specs (the `web-shared` project)

The desktop suite's `fixtures.ts` and `helpers/seed.ts` are dual-mode: when
`E2E_MODE=web` (set by `playwright.web.config.ts`), `appPage` is a logged-in
browser page and seeds go over REST — the SAME spec files run unchanged.

To enable more desktop specs in web mode, edit `playwright.web.config.ts`:
add the file to `SHARED_DESKTOP_SPECS` and its runnable test titles to
`SHARED_DESKTOP_GREP`. Two blockers to check first:
1. The spec must only visit web-working pages (Appendix A list).
2. It must not call `window.api.*` via `page.evaluate` — ~50 of the 53
   desktop files do, to seed/verify money state over IPC. Those need either
   REST equivalents or a future web-mode `window.api` shim.
