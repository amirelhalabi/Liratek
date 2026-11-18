# Feature Specification: Idempotent money writes (no double bookings)

**Feature Branch**: `lira-400-idempotent-writes` (worktree `.claude/worktrees/lira-400`)

**Created**: 2026-11-18

**Status**: Owner decision 2026-11-18: build fixes 1 + 3 now, in parallel agents. Skip the "in-flight body dedupe" option.

**Input**: Owner (2026-11-18): "in the debts page, sometimes the settlement is being computed twice … this shows critical issue from our system, non idempotency … cornertech is facing this multiple times." Verified on production (Corner Tech, read-only REST): client 9963 RAMI MAHMOUD(ALBEN) got two `DEBT_REPAYMENT` transactions 18982 + 18983, $350 cash, same second 14:04:14, identical payload (second's `coverage_applied.charges` empty); 18983 refunded by hand. Same the day before: client 9959, $400, 18728 + 18729 at 15:09:32. Those are the only two same-second pairs among 328 real repayments.

## Root cause (verified by reading, confirmed by the data)

1. **Debts page confirm button stays enabled while the request runs.** `frontend/src/features/debts/pages/Debts/index.tsx` renders `CounterpartySettleModal` (packages/ui) without `isSubmitting`, so a second tap during the REST round-trip sends a second request. Suppliers, Partners and `RefundMethodModal` all pass `isSubmitting`; Debts is the only user that does not. Both repay and cash-out go through the same modal and handler (`handleProcessRepayment`).
2. **No web form sends an `Idempotency-Key`.** The server has a replay guard (LIRA-289: `backend/src/middleware/idempotency.ts` `readIdempotencyKey` / `runIdempotent`, `packages/core/src/services/IdempotencyService.ts`, table `idempotency_keys`, scope `(userId, route, key)`, 24 h retention, key pattern `/^[A-Za-z0-9-]{8,128}$/`, header `idempotency-key`). Only two routes use it (`POST /api/debts/repayments`, `POST /api/services/transactions`) and nothing in `frontend/` or `packages/ui/` ever sets the header. Mobile does (`mobile/src/api/sales.ts` `newIdempotencyKey()`, one key per screen via `idemKey.current ??=`).

## Scope — two parts, three agents, one worktree

### Part A — Debts button guard (both transports)  — agent C

- `repaySubmitting` boolean state on the Debts page. Set `true` at the top of `handleProcessRepayment` (after the early validation returns, before the first `await`), `false` in `finally`. Early return when already submitting.
- Pass `isSubmitting={repaySubmitting}` to the `CounterpartySettleModal` at the repayment modal (`onConfirm={handleProcessRepayment}`). The modal already disables Confirm + Cancel and shows "Processing…" when set.
- Covers repay AND cash-out (same handler).
- **Failing-first test (rule 17):** `frontend/src/features/debts/pages/Debts/__tests__/Debts.lira401DoubleSubmit.test.tsx` — mock `addRepayment` to return a promise that resolves only when the test says so; open the repayment modal, click Confirm twice; expect `addRepayment` called ONCE and the button disabled. Run it before the fix and record the failure in the ticket. Use the stable module-level `useApi` mock (rule 25); copy the modal-opening steps from an existing Debts test (e.g. `Debts.tenderExchangeRate.test.tsx` or a lira-347 test).
- Also wire Debts' repayment + cash-out submit to the Part B key (see "Pages" below) — agent C owns every edit in `Debts/index.tsx`.

### Part B — `Idempotency-Key` on every money write (web)  — agents A (backend) + B (frontend)

**Contract (both agents code against this; do not change it without updating this spec):**

- Header: `idempotency-key` (existing constant `IDEMPOTENCY_HEADER`). Key: generated client-side, `/^[A-Za-z0-9-]{8,128}$/`.
- **Frontend key helper** — `frontend/src/shared/hooks/useIdempotencyKey.ts` (agent C creates it FIRST, in its first minutes; agent B waits for the file to exist before importing it — poll with `ls`, do not create it yourself):
  ```ts
  /** One key per "open" of a money form. New key when `active` turns true; cleared when it turns false. */
  export function useIdempotencyKey(active: boolean): string | undefined;
  export function newIdempotencyKey(): string; // `web-<base36 time>-<rand>-<rand>`, matches the server pattern
  ```
  **As built (agent C):** a third export for always-visible forms — `useIdempotencyKeyWithReset(active: boolean): { key: string | undefined; reset: () => void }`. Same rules as `useIdempotencyKey`; `reset()` issues a new key while `active` stays true. Call `reset()` ONLY after a successful submit (a failed submit keeps the key so the retry replays). `useIdempotencyKey(active)` is just `useIdempotencyKeyWithReset(active).key`.
  **And `idempotencyOpts(key: string | undefined): { idempotencyKey?: string }`** — use it to build the adapter's `opts` (`api.x(payload, idempotencyOpts(key))`): the frontend has `exactOptionalPropertyTypes`, so `{ idempotencyKey: key }` with `key: string | undefined` does NOT typecheck against `WriteOptions`.
  A page keeps the SAME key while the modal/form stays open (retry after a failed network call replays), and gets a NEW key the next time the form opens (two real payments in a row are two keys).
- **`requestJson` option** (`frontend/src/api/httpClient.ts`): `options.idempotencyKey?: string` → sent as the `idempotency-key` header when present. GET never sends it.
- **Adapter write functions** (`frontend/src/api/backendApi.ts` + `ElectronApiAdapter.ts` + `packages/ui/src/api/types.ts` `ApiAdapter`): every function in the "Routes" list below gains an optional LAST parameter `opts?: WriteOptions` where `export interface WriteOptions { idempotencyKey?: string }` (export from `packages/ui/src/api/types.ts`). The IPC branch ignores it (desktop stays as is). Payload types stay derived from core schemas (rule 21). No per-transport payload shapes (rule 22).
- **Backend**: a shared helper `backend/src/middleware/idempotency.ts` `idempotentRoute(routeName, book)` (or equivalent) so each route is ONE wrapped call: read key → `invalid` → `{ success:false, error: INVALID_IDEMPOTENCY_KEY }`; else `runIdempotent`. Audit (`auditRest`) only when `!replayed && result.success`, exactly like the two existing routes. Replayed response is byte-identical to the first (status 200 even if the first was 400? — keep whatever the existing two routes do: `res.status(result.success ? 200 : 400)` for the first; a replay returns the stored success reply with 200. Failures are not stored, so a retry after a failure re-runs — correct).
- **Routes to guard** (every money POST in `backend/src/api/`; `update-metadata` routes, `preview`/`validate` reads, activate/deactivate and inventory config are NOT money and are excluded):
  - debts: `/repayments` (done), `/cash-out`, `/account-entry`, `/credit`, `/use-credit`, `/write-off`
  - sales: `/process`, `/:id/refund`, `/:id/refund-item`, `/undo-item-refund`
  - services: `/transactions` (done), `/self-charge`
  - customServices: `/` (create), `/fulfillment`
  - recharge: `/process`, `/top-up-app`, `/top-up-from-supplier`, `/cashout-to-supplier`, `/top-up-from-partner`, `/top-up-from-client`
  - rechargeBasket: `/checkout`, `/partner-order`
  - exchange: `/transactions`; exchangeLots: `/adjust`
  - expenses: `/` (create), `/stock-use`
  - loto: `/sell`, `/fees`, `/fees/:id/pay`, `/cash-prizes`, `/cash-prizes/:id/reimburse`, `/checkpoints`, `/checkpoints/settle-batch`, `/checkpoints/:id/settle`
  - maintenance: `/jobs` (save = money when it writes debt/payment)
  - partners: `/transactions`, `/settle`, `/settle-days`, `/write-off`
  - suppliers: `/:id/ledger`, `/:id/settle`, `/:id/settle-account`, `/:id/remove-account-credit`, `/:id/cashflow`, `/:id/purchases`, `/:id/record-debt`
  - sessions: `/checkout`, `/:id/cart`, `/:id/close`, `/link-transaction`
  - closing: `/checkpoint`, `/differences/close`
  - vouchers: `/` (sell), `/:id/cancel`
  - transactions: `/:id/void`, `/:id/refund`, `/checkout-group/:groupId/void`, `/session-basket/:sessionId/void`, `/session-basket/:sessionId/refund`, `/session-basket/:sessionId/items/refund`
  - inventory: `/products/:id/stock`, `/products/:id/receive-stock` (stock intake books supplier debt)
  - *Added by owner 2026-11-18 (follow-up):*
  - drawerTopUp: `/` (top-up), `/from-drawer`, `/transfer`; drawerCashout: `/`
  - holdMoney: `/` (create hold), `/:id/collect`, `/pickups/:pickupId/void`
  - walletExchange: `/`
  - carrierLines: `/record-usage`, `/` (create)
  - resaleLines: `/:productId/write-off`, `/:productId/recharge`, `/:productId/give-back`
  - wrongNumbers: `/`, `/:id/credits`
  - sessions: `/start`
  - The authoritative list is `backend/src/api/idempotentMoneyRoutes.ts` (78 routes); the guard test fails if a listed route is missing or unwrapped.
  Route name passed to `runIdempotent` is the literal `"POST /api/<file>/<path>"` with the path pattern (e.g. `"POST /api/sales/:id/refund"`), and the scope must also include the concrete URL params — simplest: route name = `` `POST ${req.baseUrl}${req.route.path}` `` plus `req.params` serialised, or just `req.originalUrl` without query. Pick one, document it in the helper, apply everywhere.
- **Pages** (agent B, except Debts = agent C): every money form that calls one of the adapter functions above passes `{ idempotencyKey }` from `useIdempotencyKey(<modal or form open flag>)`. For a page whose form is always visible (POS checkout, Services, Recharge, OMT/Whish, Exchange, Expenses), "active" = `true` from mount, and the key must be REGENERATED after every successful submit (expose a `reset()` from the hook, or key the hook on a submit counter). Session basket cart-add and checkout included.
- **Offline replay** (`packages/core/src/offline/`): check only — the queue already has its own dedupe (`idempotency_keys` is in `offline/tables.ts`). If an offline op carries a key, pass it through the same header; if not, leave offline alone and note it in the ticket. Do not build new offline logic.

**Tests (rule 17 where provable):**
- Backend: one table-driven test `backend/src/api/__tests__/idempotency.allMoneyRoutes.api.test.ts` — for every guarded route, send the same body twice with the same key: service/repository mock called ONCE, second reply equals the first; a different key books twice; a malformed key is refused with `INVALID_IDEMPOTENCY_KEY`. Written first against the unguarded routes (expect failures = each route booking twice), then guarded.
- Backend guard: a jest guard that lists every `router.post` in the money files and fails if one in the list above is not wrapped (grep-style, like `moduleDebtTypes.guard.test.ts`).
- Frontend: `httpClient` test — header present on POST with key, absent without, absent on GET. Hook test — same key while active, new key on re-activate, undefined when inactive. One page test per form pattern (modal-open key: Debts (agent C); always-visible form: POS or Services) asserting the adapter call receives the key and a new key after success.

## Out of scope
- Desktop IPC keys (fix 1 covers desktop double-click; IPC completes in ms).
- The "in-flight body dedupe" in `requestJson` (owner: skip; it merges two legit identical payments).
- Reworking the stored-reply shape or retention.

## Release note (rule 30), `docs/release-notes/UNRELEASED.md`
- 💳 Debts: "Confirm" on a repayment or cash-out now locks while it is being saved, so a second tap can no longer book the payment twice.
- 🌐 Web app: every money entry (sales, recharges, transfers, repayments, settlements, refunds…) is now sent with a one-time ticket, so a retry or a double tap books it once.

## Decisions log
- 2026-11-18 owner: fixes 1 + 3, not 2. Parallel agents in one worktree, files partitioned: A = `backend/`; B = `frontend/src/api/`, `packages/ui/src/api/types.ts`, every page except Debts; C = `Debts/index.tsx`, `frontend/src/shared/hooks/useIdempotencyKey.ts`, Debts tests.
- Questions that come up during the build go at the bottom of this file under "Open questions", with the assumption taken, never block.

## Open questions
- (agent C) Debts uses ONE key per open of the repayment/cash-out modal, shared by both modes (the modal is either repay or cash-out per open). Assumption: a failed submit keeps the key so a retry replays; the key only changes when the modal closes and reopens. Note: a FAILED first attempt is not stored server-side, so the retry re-runs the write — correct.
- (agent C) If the operator edits the amounts after a failed submit and resubmits in the same open, the same key goes out with a different body. Assumption: fine, because failures are not stored (the server re-runs). If a first attempt SUCCEEDED but the reply was lost, the modal stays open and an edited resubmit would be replayed as the ORIGINAL payment — the safe direction (no double booking), but the operator sees the first amount. Not handled further.
- (agent C) Hook: `useIdempotencyKeyWithReset` added for always-visible forms (see Contract). Built with state + the "adjust state during render" pattern; a ref version was refused by the `react-hooks/refs` lint rule.
- (agent A) **Scope rule** — took: `POST <mount><route pattern>` plus, when the route has URL params, their values sorted by name (`"POST /api/sales/:id/refund id=42"`); a router-root route drops its slash (`"POST /api/expenses"`). Not `req.originalUrl`: a trailing slash or `%`-encoding would split one submission into two scopes. Reproduces the two LIRA-289 strings exactly, so replies stored before the deploy still replay. One implementation: `idempotencyRoute(req)` in `backend/src/middleware/idempotency.ts`.
- (agent A) **Async routes needed a core change** — `sessions /checkout`, `/:id/close`, `/link-transaction` and `recharge-basket /checkout` await, and a SQLite transaction cannot span an `await` (`runIdempotent` would throw). Took: added `IdempotencyService.runAsync` — an in-process "in flight" slot keyed by shop + user + route + key, so a second tap waits for the first and replays it. Not one transaction (check, booking, stored reply are three steps); correct because the web backend runs on exactly one machine. If that ever changes, these four routes need a DB-level claim row instead.
- (agent A) **`sales /:id/refund-item` audit** used to be written on every call, success or not (IPC parity). Took: still written on a fresh call either way, never on a replay. Question: should a refused item refund write an audit row at all?
- (agent A) **`closing /differences/reopen`** shares its handler with `/differences/close`, so it is guarded too (harmless: a replayed reopen answers the first reply).
- (agent A) **`loto /checkpoints/:id/settle`** has two branches on one path: only the money branch (`settleCheckpoint`) is guarded; the flag-only `markCheckpointAsSettled` branch is not.
- (agent A) **`suppliers /:id/purchases`** replies with the raw purchase row (no `success` key); the guard stores only `success: true` replies. Took: wrapped as `{ success: true, purchase }` inside the guard and unwrapped before sending — the wire reply is unchanged.
- (agent A) **Money-looking POSTs outside the first list** — owner 2026-11-18: guarded too (drawer-topup ×3, drawer-cashout, hold-money ×3, wallet-exchange, carrier-lines ×2, resale-lines ×3, wrong-numbers ×2, sessions /start); now in "Routes to guard" and `idempotentMoneyRoutes.ts`.
- (agent A) **Test fidelity** — the table test fakes request validation (pass-through `validateRequest` and pass-through copies of the 20 inline-parsed schemas) so one minimal body per route reaches the booking; the guard is under test, not each payload's schema. Each row also asserts the first reply succeeded, so "booked once" can never mean "rejected before booking".
- (agent A) **loto `GET /checkpoints/scheduled` creates a checkpoint on a GET** — left as is (owner); GETs never carry a key, so it is unguarded and a retried GET can create rows. Should it become a POST?
- (agent B) **Offline replay carries no header** — `packages/core/src/offline/` replays on the server through `ReplayEngine` bindings (not the REST routes) and dedupes per event with its own `DuplicateDetector`; `idempotency_keys` is only in the "not compared" table list. Took: nothing to pass through, offline left as is.
- (agent B) **`POST /api/debts/credit` has no frontend caller** (nothing in `frontend/src` or `packages/ui/src` calls it), so there is no adapter function to give `WriteOptions`. Took: nothing to wire.
- (agent B) **Unused guarded adapters** — `lotoCheckpointMarkSettled`, `lotoCheckpointSettle`, `lotoCheckpointSettleBatch`, `lotoCashPrizeMarkReimbursed`, `lotoFeesCreate`, `lotoFeesPay`, `adjustLotPosition`, `voidTransaction` got `opts` but no page calls them today. Took: adapter ready, nothing to wire.
- (agent B) **Hidden success, then an edited resubmit** — on an always-visible form, if a success reply is lost (network) and the cashier edits the form and submits again with the same key, the server replays the first reply and the edited payment is not booked. Took: accepted per the contract (key per form open / per successful submit); the cashier sees the success and the row in history.
- (agent B) **POS drafts send no key** — `processSale` with `status: "draft"` (autosave, Save draft) is re-saved under one draft id many times; a key would replay the first save and drop the later ones. Took: only the completed sale sends a key.
- (agent B) **Refund popups close after every attempt** (POS sale window, Transactions) — the key is per popup open, so a retry after a failed refund (popup reopened) gets a new key. Took: kept the existing popup behaviour; a double tap inside one popup is still one booking.
- (agent B) **`WriteOptions.idempotencyKey` is `string | undefined`** (not just optional) because the frontend uses `exactOptionalPropertyTypes`; pages pass `{ idempotencyKey: key }` straight from the hook. `idempotencyOpts()` (agent C) still works.
- (agent B) **Several calls in one submit** (Katsh bills, Financial units, session cart lines, per-row actions) add a short suffix to the key (`-b<billId>`, `-u<n>`, `-<rowId>`), stripped to `[A-Za-z0-9-]`, so two different items never share a key even on the same route.
- (agent B) **Session "Add to basket"** keeps one key AND one line id until an add succeeds (suffix `cart-<sessionId>`), so a double tap sends the same line once and shows it once; a fresh line id per tap would have made every tap a new line.
- (agent B) **16 extra routes wired on the frontend** — every one has a caller. Settings' carrier-line *edit* (`PUT`) and the line usage of other screens stay unkeyed (not on the list). `HoldMoney.methodsLoading` expects a "Cash" label but the screen now says "Cash · General" (LIRA-399 drawer labels); unrelated to this change, left red. Took: not fixed here.
