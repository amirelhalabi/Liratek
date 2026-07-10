# Sessions — Web Parity + Checkout Core Extraction Plan

**Created:** 2026-07-10
**Scope decision:** "Everything incl. checkout" (chosen 2026-07-10)
**Roadmap context:** Step 2 of `WEBAPP_MULTI_TENANT_PLAN.md` — the sessions module, following the same lift-schema→shared-service→both-transports recipe proven on sales (`fd3d29c`) and loto (`4cfa514`).
**Guarding rules:** CLAUDE.md 11/13/14/16/17/18; `docs/FEATURE_GUIDE.md` §11 (sessions), §4 (legs), §5 (CUSTOMER_ACCOUNT).

---

## 0. Why sessions is heavier than loto/sales

Two differences from the earlier modules, both established during mapping:

1. **The frontend bypasses the adapter.** `SessionContext` + the `/customer-sessions` page call `window.api.session.*` **directly** (~18 sites), not `useApi()`. Loto's page used `useApi()`, so it rode the HTTP branch for free; sessions must be migrated onto the adapter or it can never reach REST.
2. **Checkout logic is not in core.** `session:checkout` runs ~450 lines of orchestration *inside the Electron handler* (`electron-app/handlers/sessionHandlers.ts`) — DB transaction, per-item replay dispatch, profit accumulation, `recordBasketPayment`, the `customer_sessions` UPDATE. It must be extracted into a core service before it can be shared. **This is the only part that changes the desktop money path** and is isolated as WP4.

Transport model (unchanged, for reference): `page → useApi() adapter → backendApi.fn() → ipcOrHttp()`; `isElectron()` (`!!window.api`) picks IPC on desktop, HTTP (our REST routes) in a browser. Both hit the **same core service**.

---

## 1. §13 checklist — answers for the checkout money path

The read/cart endpoints (WP1) move no money. The checkout path (WP4) does; answers below, verified against the current handler:

1. **Transaction rows**: none created by checkout *itself* — each replayed cart item creates its own row via its module service (`sale`, `recharge_*`, `omt_app`/`financial_service`, `loto_ticket`, `custom_service`, `maintenance`). Checkout only (a) links each to the session (`repo.linkTransaction`, stamping the unified `transactions.id`), (b) records the ONE basket payment, (c) closes the session. `source_table`/`source_id` are per-module (unchanged).
2. **IN/OUT badge**: n/a — checkout adds no new transaction type; replayed items keep their existing badges.
3. **Payment legs**: the basket sends split + change legs in ONE payload (`payments[]`, IN default / `direction:"OUT"`). `recordBasketPayment` (core `SessionPaymentService`) already owns the ONE-loop rule — items are replayed with `deferPayment:true` so only the basket recorder posts to drawers. **Extraction must preserve `deferPayment:true` injection and must NOT re-post legs per item** (FEATURE_GUIDE §4, §11).
4. **Drawers**: handled inside `recordBasketPayment` (per-leg, per-currency) — not re-implemented; extraction keeps calling it.
5. **Client propagation** (rule 11): checkout injects session `customer_name`/resolved `client_id` into each item's `formData` before replay (the §6 "session flavor"). **Extraction must preserve the client-injection block verbatim** or lira-094 regresses.
6. **CUSTOMER_ACCOUNT**: open-debt; `recordBasketPayment` books ONE debt row for the on-account portion of the whole basket (§5, §11). Not re-implemented.
7. **Supplier/partner ledger**: per replayed module (prepaid-units etc.) — unchanged, inside each module service.
8. **Void path**: n/a for checkout (individual rows void through the Transactions table as today).
9. **Profits**: checkout accumulates per-item `profit_usd`/`profit_lbp` from `formData` and stamps session totals + `linkTransaction` profit. **Extraction must preserve the accumulation math** (lira-session-profits).
10. **Sessions**: this IS the session branch.
11. **Audit viewer**: unchanged; checkout writes an audit entry (relocated to the handler wrapper, see WP4).

**Net rule for WP4: faithful relocation, zero logic change.** Any behavioral delta is a bug, not an improvement — improvements are out of scope for this pass.

---

## 2. Work packages (ordered; each has a proof gate)

### WP1 — Backend REST route parity (SAFE, additive)
Rebuild `backend/src/api/sessions.ts` to cover the full non-checkout surface, matching IPC envelopes exactly (`{success, <key>}`, 200 + `{success:false,error}` on failure). Use the singleton pattern consistent with other routes and `getCustomerSessionRepository()` for cart ops.

Endpoints (channel → route), all calling existing core methods:
- `session:getActive` → `GET /active` → `getActiveSession`
- `session:getActiveSessions` → `GET /active-list` → `repo.getActiveSessions` *(distinct from singular `/active`)*
- `session:getDetails` / `getTransactions` → `GET /:id` → `getSessionDetails`
- `session:start` → `POST /start` → `startSession`
- `session:update` → `PUT /:id` → `updateSession`
- `session:close` → `POST /:id/close` → `closeSession`
- `session:delete` → `DELETE /:id` → `deleteSession`
- `session:list` → `GET /` → `listSessions`
- `session:today` → `GET /today` → `getTodaySessions`
- `session:todayAll` → `GET /today-all` → `getTodayAllSessions`
- `session:byDateRange` → `GET /range?from&to` → `getSessionsByDateRange`
- `session:getByCustomer` → `GET /by-customer?name&phone` → `getSessionsByCustomer`
- `session:linkTransaction` → `POST /link-transaction` → `linkTransaction*` (keep existing)
- cart: `POST /:id/cart` (add), `GET /:id/cart` (get), `DELETE /:id/cart/:itemId` (remove), `DELETE /:id/cart` (clear) → `repo.addCartItem/getCartItems/removeCartItem/clearCart`
- Role: `requireRole(["admin","staff"])` on writes, matching handlers.
- **Static-before-parameterized ordering** (like loto): `/active`, `/active-list`, `/today`, `/today-all`, `/range`, `/by-customer` MUST be declared before `/:id`.

**Proof gate WP1:** curl start → cart:add → cart:get → close, asserting the rows via sqlite. No frontend change yet.

### WP2 — Adapter functions (SAFE)
Add the missing session functions to `frontend/src/api/backendApi.ts` (`ipcOrHttp`, IPC branch = existing `getElectronApi().session.*`, HTTP branch = WP1 routes): `getActiveSessions`, `getSessionsByDateRange`, `getTodayAllSessions`, `getTodaySessions`, `getSessionsByCustomer`, `deleteSession`, cart add/get/remove/clear. Then expose them on `frontend/src/api/ElectronApiAdapter.ts` under `.session` matching the `window.api.session` shape the pages expect.

**Proof gate WP2:** typecheck; adapter `.session` surface matches the preload shape 1:1.

### WP3 — Frontend migration off `window.api.session` (MODERATE, touches desktop renderer)
Migrate `SessionContext.tsx` (~15 sites) and `CustomerSessions/index.tsx` (~3 sites) from `window.api.session.*` to `useApi().session.*`. Remove the web-mode `if (!window.api?.session) return` guards added during the broken-page pass (the adapter now handles both transports). Leave `checkout` pointing at the adapter too (wired in WP4).

**Proof gate WP3:** web — `/customer-sessions` POPULATES over REST (not just renders empty); start/cart/close work in the browser. Desktop — session specs still green (WP3 changes the desktop renderer's transport indirection but not its logic: still IPC-first via `ipcOrHttp`).

### WP4 — Checkout core extraction (MONEY-PATH, isolated commit)
1. **Lift the schema** (rule 14): move `SessionCheckoutSchema` (+ its cart-item/payment sub-schemas) from `electron-app/schemas/index.ts` to `packages/core/src/validators/session.ts` as `sessionCheckoutSchema`; re-export in electron schemas with the zod-major cast (as done for sale/loto).
2. **New core service** `packages/core/src/services/SessionCheckoutService.ts` exposing `checkout(request, { userId, username }): CheckoutResult`. Move verbatim from the handler: `processCartItem`, `processBatchCartItem`, `resolveUnifiedTransactionId`, `checkoutPaymentsToBasketLegs`, the client-injection block, the profit accumulation, the `recordBasketPayment` call, and the final session-close write. Move the checkout types (`CheckoutRequest`, `CheckoutCartItem`, `CheckoutPayment`, `ProcessedItem`, `CheckoutItemResult`) to core.
   - **Rule 13 compliance for the DB boundary**: the handler currently uses `getDatabase()` + `db.transaction()` + a raw `UPDATE customer_sessions`. In core, the service must not touch `getDatabase()` directly. Add `CustomerSessionRepository.runCheckoutTransaction(fn)` (wraps `this.db.transaction(fn)()`) and `CustomerSessionRepository.recordCheckoutClose(sessionId, totals)` (the UPDATE). The service composes: `repo.runCheckoutTransaction(() => { ...replay + link + basket payment...; repo.recordCheckoutClose(...) })`. Nested module-service calls run on the same synchronous connection inside the transaction — no behavior change.
   - Export `getSessionCheckoutService()` singleton from `services/index.ts`.
3. **Rewrite the IPC handler** `session:checkout` to a thin wrapper: `requireRole`, resolve `userId` + username, call `getSessionCheckoutService().checkout(...)`, write the audit entry, return. (Audit stays in the handler — it's Electron-session-scoped.)
4. **Add REST route** `POST /api/sessions/:id/checkout` (or `/checkout` with `sessionId` in body — match the adapter contract) calling the same core method; resolve username from `req.user`.
5. **Wire the adapter** `checkout` HTTP branch to the new route; point `SessionContext` checkout at `useApi().session.checkout`.

**Proof gate WP4 (the heavy one):**
- Repo/unit level: a core test that runs a 2-item basket checkout (one SALE + one on-account item) and asserts drawer delta posts ONCE, ONE debt row, profit stamped — the money invariants.
- Rule 17: temporarily point the handler back at its inline body (git stash the handler rewrite) and confirm the new test passes identically on both — i.e. prove the extraction is behavior-preserving, not just that the new path works.
- **Desktop re-verification**: full `env -u ELECTRON_RUN_AS_NODE yarn test:e2e` at 1 worker for the session specs — `lira-094/095/098/099`, `lira-session-*` (allocation, basket-debt, basket-payment, cashout-credit, debt-payout-signs, exchange-rate, multiple-per-day, payout, profits). Green before (baseline) and after. Known flakes (lira-093 @2workers, lira-099 paired-after-093) per memory — rerun solo.
- Web: a basket checkout over REST with a live money-delta curl/e2e assertion (drawer + debt), mirroring the loto sell proof.

### WP5 — Docs + close-out
Update `WEBAPP_MULTI_TENANT_PLAN.md` Appendix A (sessions ✅, remaining step-2 items), record any desktop quirks found, note the rule-13 cleanup done (checkout SQL now in repo). Commit WP1–WP3 together (safe) and WP4 as its own commit (money-path, revertible in isolation).

---

## 3. Files touched

| Layer | File | WP |
|---|---|---|
| Backend | `backend/src/api/sessions.ts` (rewrite) | WP1, WP4 |
| Backend | `backend/src/server.ts` (confirm mount) | WP1 |
| Core | `packages/core/src/validators/session.ts` (new) + `validators/index.ts` | WP4 |
| Core | `packages/core/src/services/SessionCheckoutService.ts` (new) + `services/index.ts` | WP4 |
| Core | `packages/core/src/repositories/CustomerSessionRepository.ts` (+2 methods) | WP4 |
| Electron | `electron-app/schemas/index.ts` (re-export cast) | WP4 |
| Electron | `electron-app/handlers/sessionHandlers.ts` (checkout → thin wrapper) | WP4 |
| Frontend | `frontend/src/api/backendApi.ts` (+session fns) | WP2 |
| Frontend | `frontend/src/api/ElectronApiAdapter.ts` (+session surface) | WP2 |
| Frontend | `frontend/src/features/sessions/context/SessionContext.tsx` | WP3 |
| Frontend | `frontend/src/features/sessions/pages/CustomerSessions/index.tsx` | WP3 |
| Tests | web e2e route walk already covers `/customer-sessions`; add basket-checkout proof | WP4 |

## 4. Risk & rollback

- **WP1–WP3** are transport plumbing: worst case is a wrong REST shape → web page shows empty/errors; desktop unaffected (IPC-first). Caught by web e2e + desktop session specs.
- **WP4** is the money-path risk, contained to one commit. Rollback = revert that commit; the handler's inline checkout returns and desktop is exactly as it is today. The rule-17 "prove behavior-preserving against the pre-extraction body" gate is the primary guard.
- No schema migration needed (no new tables/columns) — the `customer_sessions` write is a relocation, not a change. **Confirm** during WP4 that no new column is introduced.

## 5. Sequence

WP1 → WP2 → WP3 → (commit safe batch) → WP4 → desktop re-verify → (commit money-path) → WP5. Stop-and-report after the safe batch if the desktop re-verify for WP4 needs a clean checkpoint.
