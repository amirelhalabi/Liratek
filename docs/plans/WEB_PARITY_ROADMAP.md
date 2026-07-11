# Web-Parity Roadmap — living status & reference

**Purpose:** the single tracker for making every LiraTek module work in the **browser** (over REST), not just Electron (over IPC). This is the *execution* companion to the exploratory `WEBAPP_MULTI_TENANT_PLAN.md`. Update the status columns here as modules land.

**Last updated:** 2026-07-11 · **Branch of record:** `feat/multi-tenant-shared-db` (== `main` tip `ce45a2e`, v1.29.4 — the web-parity work and the multi-tenant work are now unified on this branch).

---

## 1. The model (why this works at all)

One React frontend, two transports, chosen automatically by environment:

```
page → useApi() adapter → backendApi.fn() → ipcOrHttp()
   → isElectron() (== !!window.api)?  IPC: window.api.*  (desktop)
                                      HTTP: /api/* REST   (browser)
both land on the SAME @liratek/core service/repository
```

A module "works in the browser" when: (a) a REST route exists mirroring its IPC handler, (b) the frontend calls it through `useApi()`/the adapter (not `window.api.*` directly), and (c) both transports feed the same core logic. **Tenant scoping is automatic** as long as a REST route uses `authenticateJWT` (which wraps the request in `runWithTenant`) and repos extend `BaseRepository`; desktop uses the fixed tenant context from `initFixedTenantContext(1)` at boot.

---

## 2. Four-phase roadmap — status

| Phase | Goal | Status |
|---|---|---|
| **1. Fix broken pages** | Every page renders (not crash) in a browser | ✅ Done (`c7bf8b4`) |
| **2. REST parity per money module** | Each module reachable + wired over REST | 🟡 In progress — sales/loto/sessions done; ~7 modules remain (§3) |
| **3. `window.api`→REST shim** | Let the ~50 IPC-driven desktop specs run over HTTP | 🔴 Not started |
| **4. Unify the suites** | Run all ~148 specs against BOTH transports | 🔴 Not started |

---

## 3. Step 2 — per-module status

**Done** (the three hardest, each with a dedicated proof):

| Module | Commit | Notes |
|---|---|---|
| POS sales | `fd3d29c` | shared `saleProcessSchema` in core; `POST /api/sales/process` |
| Loto | `4cfa514` | 7 schemas → core; `backend/src/api/loto.ts` (~28 routes) |
| Sessions (browse+cart+checkout) | `1dcef64` + `a13d768` | checkout orchestration extracted to core `SessionCheckoutService`; see `SESSIONS_WEB_PARITY_PLAN.md` |
| Hold money | `0eb9a52` | `holdMoneyCreateSchema` → core; `backend/src/api/holdMoney.ts` (list/active/create/collect); proof `lira-web-003` |
| Service presets | `6472d91` | config CRUD (no money); schemas already in core; `backend/src/api/servicePresets.ts`; proof `lira-web-004` |
| Audit log (read) | `40e4c5d` | read-only; `backend/src/api/audit.ts` (search/recent/by-entity); core AuditService already present; proof `lira-web-005`. NOTE: distinct from `/api/activity`; the viewer uses the `audit` trail |
| Drawer top-ups | `104e9e1` | `backend/src/api/drawerTopUp.ts` (source-drawers/history/create/from-drawer); no schema/core change; proof `lira-web-006` |
| Debts cash-out + account-entry | `919cb7e` | lifted debtCashOut/debtAccountEntry schemas; `/api/debts/{clients/:id/balance,cash-out,account-entry}`; Debts page fully dual-mode; proof `lira-web-007`. (getDebtors/history/repayment/summary were already dual-mode) |
| Voucher codes (gift cards) | `ce10670` | lifted `VoucherCreateSchema` → core (rule 14, cast re-export in electron); `backend/src/api/vouchers.ts` (create/get-all/validate/cancel; cancel admin-only); `vouchers` adapter namespace + `createClient` exposed on the adapter; Vouchers page migrated off `window.api.vouchers.*`/`window.api.clients.*`; proof `lira-web-009`. Money path (redeemByCode) stays internal to parent sale/session txns — not exposed. Same desktop-ABI caveat as partners. |
| Partners (config + partner_ledger) | `6338f6f` | new `partner.ts` validators (no `userId` — injected from JWT; `transactionType` = full repo union); `backend/src/api/partners.ts` (all 11 channels); `partners` adapter namespace (reads raw, writes enveloped); migrated Partners page + **shared** PartnerSelector + Services + Checkpoint; proof `lira-web-008` (create → DEBIT ledger → settle → **page-level** getAllBalances round-trip through the adapter). ⚠️ Desktop harness NOT re-run to green — shared better-sqlite3 was at Node ABI (parallel-agent contention), so all desktop specs incl. partners-unrelated `app.spec` failed at Electron window-launch (environmental, not a regression). |

**Pending** (verified 2026-07-11: no REST route yet; page still calls `window.api.*` directly):

| Module | REST route | Web-broken page(s) | Size |
|---|---|---|---|
| debts `addCredit` | ❌ (debts route exists; no add-credit endpoint) | Debts page | S |
| closing / checkpoint | ❌ | `closing/pages/Checkpoint` | M |

**Suggested order:** debts addCredit → closing/checkpoint, then move to phase 3.

> **Desktop e2e verification note (2026-07-11):** the shared checkout's `better-sqlite3`
> ABI is contended by a parallel agent that needs Node ABI (127) for backend/core jest;
> desktop e2e needs Electron ABI (125). While that contention is live, desktop specs may
> fail wholesale at `fixtures.ts:203` (`waitForEvent "window"` timeout) — this is the DB
> failing to load in the Electron main process, NOT a code regression. Confirm by probing
> the binary: `node -e "require('better-sqlite3')"` LOADS under Node → wrong ABI for desktop.
> Frontend-only `window.api.X` → `useApi().X` migrations route to the identical `window.api`
> call in Electron, so they are transparent by construction on desktop; the meaningful
> new risk (adapter unwrap-key bugs) is caught by a page-level web round-trip instead.

---

## 4. The proven recipe (per module)

Followed for sales/loto/sessions; reuse verbatim. **This is money-path work — load the `new-money-feature` skill and read `docs/FEATURE_GUIDE.md` first (rule 18).**

1. **Map** the surface: the module's IPC handler channels + Zod schemas (`electron-app/`), the frontend adapter/page usage, and the core service/repo methods it calls.
2. **Lift the write-path Zod schema(s)** from `electron-app/schemas/index.ts` into `packages/core/src/validators/<module>.ts`; re-export from `electron-app/schemas` with the zod-major cast (see §6). Export from `packages/core/src/validators/index.ts`.
3. **Add the REST route** `backend/src/api/<module>.ts` — IPC-identical envelopes (`{ success, <key> }`, HTTP 200 even on failure), `authenticateJWT` + `requireRole(...)` matching the handler, static paths before `/:id`. Mount in `backend/src/server.ts`. Calls the SAME core service.
4. **Adapter:** add dual-mode `ipcOrHttp` functions to `frontend/src/api/backendApi.ts`; expose them on `ElectronApiAdapter.ts` (nested namespace if the page expects one); add to the `ApiAdapter` type in `packages/ui/src/api/types.ts`.
5. **Migrate the page(s)** from `window.api.<module>.*` to `useApi().<module>.*`; drop any web-mode `if (!window.api...) return` guards.
6. **If the handler holds business orchestration** (not just a thin service call — the sessions-checkout case), extract it into a core service first (rule 13: DB access stays in repos), then point both transports at it.
7. **Prove** (§7).
8. **Build/sync** (§6), typecheck + lint, commit. If it touches the money path in a non-trivial way, commit it in isolation so it reverts cleanly.

---

## 5. Cross-cutting build/sync (after ANY core change)

1. `cd packages/core && npm run build`
2. Sync the real copy: `rm -rf node_modules/@liratek/core/dist && cp -R packages/core/dist node_modules/@liratek/core/dist` (Windows: the `xcopy` in CLAUDE.md).
3. If `electron-app/` source changed: `cd electron-app && npm run build` (harness/app loads compiled `dist`, not source).
4. `@liratek/ui` is source-consumed (vite/tsconfig alias) — no build.

---

## 6. Gotchas that cost real time (don't rediscover)

- **better-sqlite3 ABI is NOT portable.** `NODE_MODULE_VERSION 127` (Node, from `rebuild:node`) vs `125` (Electron). `yarn test:e2e:web` runs `rebuild:node` and silently flips it — the next desktop run then fails EVERY spec with `waitForEvent "window"` timeout (looks like a code bug; it's the DB failing to load). **`yarn rebuild:native` before desktop e2e / `yarn dev`; `rebuild:node` before web e2e / core jest.** `yarn dev:web` (commit `8204808`) is the web dev command; `yarn dev` stays desktop-only.
- **zod major mismatch:** core types against **zod 4**, electron/backend against **zod 3**. Reuse the cast pattern: electron `export const X = coreSchema as unknown as z.ZodSchema<CoreInput>`; backend a local `SafeParseable<T>` structural cast (see `backend/src/api/loto.ts`, `sessions.ts`).
- **Envelope parity:** REST returns `{ success, <key> }` with HTTP **200 even on failure** (`{success:false,error}`) to match IPC — the adapter branches on `result.success`, not status code. Don't "fix" to 4xx.
- **Tenant context:** new REST routes MUST use `authenticateJWT` (→ `runWithTenant`); new repos MUST extend `BaseRepository`. `tenantContext.ts` is fail-closed — a money write with no tenant context throws.
- **Adapter path:** most feature pages call `window.api.*` directly and must be migrated to `useApi()`; a few already use `useApi()`. Check per page.

---

## 7. Proof standard (per module)

- **Live money-delta** over REST (curl or an e2e spec): assert the drawer/ledger/debt delta and that the row was journaled with correct `tenant_id` — mirror the loto-sell / session-checkout proofs.
- **Rule 15:** delta + identity assertions, never "newest row" / absolute totals (the e2e DB accumulates).
- **Rule 17:** any regression/guard test must be shown to FAIL on the pre-fix code before it counts.
- **Both transports:** web e2e (`yarn test:e2e:web`) green; desktop specs for the module green (`yarn rebuild:native` first). Keep `frontend/tests/e2e-web/lira-web-*` extended as modules land.

---

## 8. Related plan docs

- `SESSIONS_WEB_PARITY_PLAN.md` — sessions, ✅ complete (the extraction pattern-setter).
- `POS_STOCK_OVERSELL_GUARD_PLAN.md` — 🔴 open; a separate concurrency/inventory correctness bug (not web-parity), live in v1.29.4.
- `WEBAPP_MULTI_TENANT_PLAN.md` — the exploratory options doc + Appendix A history.
- `MULTI_TENANT_IMPLEMENTATION_PLAN.md` — the shared-DB + `tenant_id` decisions (already implemented on this branch).
- `SESSION_WEB_PARITY_MERGE_HANDOFF.md` — ⚠️ **obsolete** (the merge it describes already happened via `0a79495`); safe to delete.

## 9. Deferred / hygiene backlog (from the audits, verify before relying)

- Rotate the committed `DASHSCOPE_API_KEY` in `backend/.env.dev`; fix/remove corrupted `backend/.env.prod`.
- Verify the desktop DB is actually SQLCipher-encrypted (stock better-sqlite3 prebuilds don't bundle the codec; key is optional — may be plaintext).
- Loto quirks: session-cart cash-prize channel `loto:cashPrize:create` ≠ registered `loto:cash-prize:create`; `CheckpointHistory.tsx` raw `window.api.loto.updateMetadata` (web-broken); `GET /checkpoints/scheduled` creates over GET.
- `lira-073` export spec: `#transfer-amount` seeding form doesn't open in web mode (excluded from the web suite).
- Align zod major versions across workspaces (removes the cast pattern).
- **REST action routes don't WRITE audit entries.** Only the Electron IPC handlers call `audit(...)`; the REST routes (loto/sessions/holdMoney/servicePresets/sales/…) don't. The audit VIEWER reads over REST (commit `40e4c5d`), but web-mode actions currently leave no audit trail. Decide: a shared audit hook in core, or per-route audit calls, when audit coverage of the web transport is needed.
