# Transport-parity audit — finding the rest of the Settle Debt class

> **Status: Phases 1–2 done; every §6.4 and §6.6 item closed except the
> rule-17 proofs. UNCOMMITTED, UNCHECKED (2026-09-12).** The sweep landed in
> 43 files (now staged); the follow-up batch added 23 more plus 14 new test
> files. **Nothing has been run** — no typecheck, lint, jest or e2e (owner
> runs those), so every rule-17 failing-first proof is outstanding and no
> guard test here counts as a guard yet. §6 is the desktop-regression code
> review, done by reading only; §6.4 records the four planned follow-ups
> (including a correction to one item's stated rationale, which was wrong)
> and §6.6 everything else found while auditing — among it a loto
> checkpoint/ticket id collision that was silently writing notes onto
> unrelated tickets.
>
> **Phases 3 and 4 remain, and are the plan's actual deliverable**
> (`scripts/check-transport-parity.mjs`, §2). They are deliberately NOT
> started: 23 changed files and 14 test files are unverified, and phase 3
> alone touches 31 `any`-typed adapter functions while phase 4 touches 19
> components. Verify and commit this batch first. Written 2026-09-12,
> straight out of the Settle Debt failure ("Invalid input: expected number,
> received undefined") and the actor-trust gap found while explaining it.
> Companions: `CLAUDE.md` rule 19, `WEB_PARITY_ROADMAP.md` (which modules are
> reachable over REST at all — a different question from whether they are
> reachable _correctly_).

---

## 0. Why this exists

One owner-reported bug on one money modal turned up three distinct defects in
the same short call path. None was exotic; all three are the kind a reader
skims past. The question this plan answers is **how many more of each are
there**, and the honest answer today is that nobody knows.

What makes them worth hunting as a group is that they share a failure
signature: **the desktop build is fine, so nothing looks broken until a web
customer hits it.** Desktop has been the product for most of this codebase's
life, and web parity was added module by module — so every one of these is a
place where the second transport was wired by hand and the hand slipped.

Surface, measured 2026-09-12:

| Thing                                                  | Count |
| ------------------------------------------------------ | ----- |
| Route files under `backend/src/api/`                   | 46    |
| Write routes (POST/PUT/PATCH/DELETE)                   | 158   |
| Adapter functions typed `any` in `backendApi.ts`       | 31    |
| Components still holding a `window.api` transport gate | 19    |

---

## 1. The three defect classes, with their signatures

### Class A — payload shape drift (the reported bug)

A component writes its payload **twice**, once per transport, and the copies
disagree:

```js
window.api
  ? addRepayment({ clientId, amountUSD, amountLBP, userId })
  : addRepayment({ client_id, amount_usd, amount_lbp, user_id });
```

Both routes validate against the SAME Zod schema, which speaks camelCase, so
the web copy lost `clientId` and every browser repayment was refused.

Three things had to line up, and all three are still true elsewhere:

1. the component chose its shape from `window.api`, so the two copies were
   never compared against each other;
2. the adapter function is typed `payload: any`, so TypeScript checked
   nothing at the call site;
3. **Zod strips unknown keys silently** — `client_id: 42` raised no
   "unexpected field" complaint, so only the _absence_ of `clientId`
   surfaced, and only as a type error naming a field the operator never saw.

**Signature to hunt:** a `window.api ? … : …` (or `if (window.api)`) gate in a
page/component where the two branches construct object literals.

**Sharpest sub-case:** a field that has a `.default()` in the schema. In the
reported bug `amountUSD`/`amountLBP` defaulted to `0`, so their snake_case
twins failed _silently into zeroes_ rather than erroring. `clientId` has no
default, which is the only reason this surfaced as an error instead of a
**$0 repayment booked against the wrong client**. Any drifted field whose
schema entry carries `.default()` is a silent-corruption candidate, not an
error candidate — grep those first.

### Class B — actor taken from the body instead of the JWT

Rule 19(c) requires REST to inject `userId`/actor from the token. The
repayment route passed `req.body` straight to the service, so a crafted
request could stamp any user id onto a money record. Not privilege
escalation — but the audit trail and "who took this payment" both read that
field, which is precisely what they exist to establish.

The tell that it was a miss rather than a decision: **five of the six
actor-carrying routes in the same file did it correctly**, all spreading
`{ ...req.body, userId }`. One was skipped.

**Signature to hunt:** a write route whose service call receives `req.body`
without an actor spread, where the corresponding IPC handler overrides the
actor from `requireRole(...)`'s result. The IPC side is the reference
implementation — desktop has consistently done this right.

### Class C — silently doing nothing on the web

An Electron-only API reached through optional chaining, so the browser path
no-ops without error:

```js
if (window.api?.display?.setZoomFactor) window.api.display.setZoomFactor(scale);
if (!window.api) return; // loadServiceDebtDetails — clicking the row does nothing
```

UI Scale saved the value, re-rendered the control as selected, and changed
nothing. A setting that _looks_ like it worked is worse than one that is
missing: the operator re-picks it, concludes the app is broken, and files no
bug because there is nothing to report.

**Signature to hunt:** `window.api?.` with optional chaining, and early
returns guarded on `!window.api`, inside `frontend/src/`.

**Judgement required, and this is the part a script cannot do:** some of
these are _correct_. A backup-directory picker or an app updater has no web
equivalent and should be absent, not ported — see the Diagnostics tab, which
was deliberately hidden on web rather than given REST routes it should never
have. The audit must separate "desktop-only by nature" from "desktop-only by
omission", and only the second is a bug.

---

## 2. What to build — a static guard, not a one-time sweep

This repo already has the right shape for this: `scripts/check-*.mjs`, run in
CI (`check:tenant-scoping`, `check:bind-arity` both run in `ci.yml`). A sweep
finds today's instances; a checked-in guard stops tomorrow's. Given all three
classes are mechanically detectable, the guard is the deliverable and the
sweep is what you get for free on its first run.

Proposed `scripts/check-transport-parity.mjs`, three independent rules so any
one can be adopted without the others:

| Rule   | Flags                                                                                                            | False-positive risk                                                     |
| ------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **A1** | A `window.api ? … : …` gate in `frontend/src/**` whose branches contain object literals                          | Low — this pattern has no legitimate use; the adapter exists for it     |
| **B1** | A write route in `backend/src/api/**` calling a service with bare `req.body` where the IPC twin injects an actor | Medium — needs the IPC handler paired by channel name                   |
| **C1** | `window.api?.` or `!window.api` early-return in `frontend/src/**`                                                | **High** — the desktop-only-by-nature cases are legitimate and numerous |

C1 therefore ships with an **allowlist** carrying a one-line reason per entry
("no web equivalent: Electron file dialog"). The allowlist is the useful
artifact — it converts an ambiguous grep result into a reviewed decision, and
a new unexplained entry becomes a CI failure rather than a discovery two
months later.

---

## 3. Order

| Phase | Work                                                                                                  | Why here                                                                                                                         |
| ----- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Rule A1 + fix what it finds                                                                           | Same class as the reported bug; these are live, silent, and money-adjacent                                                       |
| **2** | Rule B1 + fix what it finds                                                                           | Bounded (158 write routes, IPC handlers as the reference), and it is an integrity property                                       |
| **3** | Type the adapter — replace `payload: any` with `z.input<typeof schema>` on money-path functions first | Removes the _enabling condition_ for class A. With this in place A1 becomes a belt-and-braces check rather than the only defence |
| **4** | Rule C1 + build the allowlist                                                                         | Largest surface (19 components), highest judgement content, lowest severity — a visible no-op, not a wrong number                |

Phase 3 is the one worth arguing for even if the others slip. `any` at the
adapter boundary is why a field-name typo in a money payload reached a
customer instead of failing to compile.

---

## 4. Known instances already found (start here)

Fixed in `7d2bd697` and its follow-up — listed so the guard can be validated
against known-true positives:

- **A**: `Debts/index.tsx` repayment payload (camelCase vs snake_case) — FIXED
- **B**: `POST /api/debts/repayments` actor from body — FIXED
- **C**: UI Scale on web (`setZoomFactor` optional chain) — FIXED

Open, found while reading, not yet fixed:

- **C**: `Debts/index.tsx` `loadServiceDebtDetails` opens with
  `if (!window.api) return;` — clicking a service-backed debt row does nothing
  in the browser, with no error.
- **A (latent)**: four more `window.api ? … : …` gates in `Debts/index.tsx`
  alone (`getDebtors`, `getClientHistory`, `getClientBalance`, and the
  service-detail block). These currently _work_ — both branches agree — which
  is exactly why they are worth removing before they drift the way the
  repayment one did.

A good first test of the guard: run it against the commit _before_
`7d2bd697` and confirm it flags all three fixed instances.

---

## 5. Explicitly out of scope

- **Whether a module is reachable over REST at all** — that is
  `WEB_PARITY_ROADMAP.md`'s job. This plan assumes the route exists and asks
  whether it behaves identically.
- **Rewriting Zod to reject unknown keys** (`.strict()`). It would have caught
  class A loudly, but it changes validation behaviour on 158 routes at once
  and would reject payloads that legitimately carry extra fields today. If it
  is ever wanted, it belongs in its own plan with its own blast-radius
  measurement — not smuggled in here.

---

## 6. Code review — desktop regression risk (2026-09-12)

**Verdict: no desktop regression found in the 43 files. Three deliberate
behaviour changes on desktop, all bug fixes; four follow-ups; one class of
thing I could not verify by reading.** Desktop is the reference product, so
the review question for every migrated call site was narrow: _does the
adapter's IPC branch invoke the same `window.api.<x>.<y>` with the same
arguments the component passed before?_ Where the answer was "same call,
same args" the site is listed but not discussed.

Method: `git diff` of every uncommitted file, cross-read against
`electron-app/preload.ts`, the IPC handlers, `InventoryService`,
`ProductRepository`, `FinancialService`, `ApiProvider`, and `adapter.ts`.
**No `yarn`/`tsc`/`eslint`/`jest` was run** (owner's instruction) — see §6.5
for what that leaves open.

### 6.1 The seam every migration now crosses

Every migrated site went from `window.api.a.b(args)` to
`useApi().fn(args)` → `backendApi.fn` → `ipcOrHttp(ipc, http)`. Three
properties of that seam decide whether desktop can change, and all three
check out:

| Property                                              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Where                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `useApi()` returns a **stable** reference             | Yes — `backendApiAdapter` is a module-level singleton (`new ElectronApiAdapter()` once in `frontend/src/api/adapter.ts:9`), passed to `<ApiProvider adapter=…>` in `App.tsx:441`. So adding `api` to a `useEffect` dependency array (ProductSearch, twice) cannot re-fire the effect.                                                                                                                                                                                                                                    | `adapter.ts`, `ApiProvider.tsx` |
| The IPC branch is a **passthrough**                   | Yes for all 18 new/changed `backendApi` fns — each IPC branch is `getElectronApi().<ns>.<fn>(sameArgs)`; two reads add a `?? []` / `Array.isArray` guard on the way back (`getProductSuppliersFull`, `getCategories`), which only matters if IPC returned a non-array, which it never does.                                                                                                                                                                                                                              | `backendApi.ts` diff            |
| Every preload binding the IPC branch names **exists** | Yes — verified line-by-line in `preload.ts`: `inventory.{getProductSuppliersFull,createProductSupplier,updateProductSupplier,deleteProductSupplier,getProductByBarcode,getCategories,batchUpdate}`, `sales.{refund,refundItem,updateMetadata,getTodaysSales(date)}`, `expenses.updateMetadata`, `omt.{getById,getPaymentsByTransaction}`, `financial.updateMetadata`, `transactions.getCashFlowByDate`, `customServices.updateMetadata`, `loto.updateMetadata`, `whatsapp.sendMessage`. No new IPC channel was invented. | `preload.ts`                    |

One pre-existing property of the seam is worth knowing, not fixing here:
`ipcOrHttp` catches an IPC throw and **falls back to HTTP** (`backendApi.ts:44-49`).
A site that used to see an IPC rejection in its own `catch` will now see an
HTTP failure instead (on desktop, a fetch to a relative `/api/...` URL). Same
outcome — the operation fails — different error text. Not new to this sweep;
every existing `ipcOrHttp` fn already behaves this way.

### 6.2 Deliberate behaviour changes on desktop (all fixes, none regressions)

**(a) Financial-service metadata edit: `customer_name` → `client_name`.**
Five sites (`CryptoForm`, `FinancialForm`, `KatchForm`,
`OmtWhishAppTransferForm`, `Services/index.tsx`) plus `preload.ts:~310` and
`electron.d.ts:1075`. _Certain:_ the IPC handler
`financial:update-metadata` (`omtHandlers.ts:97-135`) reads `data.client_name`
and has never read `customer_name`; `preload` forwards the whole object
untouched; `FinancialService.updateFinancialServiceMetadata` takes
`client_name`. So on desktop, before this change, the name field of every
"edit history row" on OMT/Whish/iPick/Katsh/Binance was **silently dropped**
— phone and note saved, name did not. After: name saves. This is a fix
that has been latent on desktop the whole time; the sweep found it because
the REST schema had to name the field. Zero remaining `customer_name:` writers
against this channel in `frontend/src` (grep-verified).

**(b) Inventory batch-edit: `unit` no longer sent.** `ProductList.tsx`
`handleBatchUpdate`. The agent's claim ("neither the IPC handler nor the
service ever read it") is _Certain_, verified at three layers:
`BatchUpdateSchema` (`electron-app/schemas/index.ts:236-241`) has no `unit`
key and Zod strips unknown keys; the handler (`inventoryHandlers.ts:280-284`)
forwards only `category`/`min_stock_level`/`supplier`; `InventoryService.
batchUpdateProducts` (`:376-400`) and `ProductRepository.batchUpdateProducts`
(`:919+`) have no `unit` branch. Desktop dropped `unit` before and drops it
now. **Not a regression — but see follow-up 6.4(1): the modal still renders a
"unit" input that has never done anything.**

**(c) `getTodaysSales` adapter now forwards `date`.**
`ElectronApiAdapter.getTodaysSales = (date?) => …`. Callers that pass no
argument (Dashboard) now invoke `sales:get-todays-sales` with `undefined`
instead of no arg — the handler signature is `(_e, date?: string)`, so
identical. `ProductSearch` used to call `window.api.sales.getTodaysSales(
selectedDate)` directly and now gets the same call through the adapter. Same
IPC, same args.

### 6.3 Per-file notes (only where there is something to say)

| File                                                                                             | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Risk |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `Debts/index.tsx` — `handleRepaymentSuccess`                                                     | The `if (window.api) {…} else {…}` was collapsed to `balRes = await api.getClientBalance(); if (balRes.success && balRes.data) {…} else { getClientDebtTotal }`. **Semantic shift on the failure path only:** before, a failed balance lookup on desktop left `stillOpen = true` (client stays selected); now it falls through to the USD-converted `getClientDebtTotal() > 0.01`. Happy path unchanged. Arguably better; noting it because it is the one place a branch's _meaning_ moved, not just its transport. | Low  |
| `Debts/index.tsx` — `loadServiceDebtDetails`                                                     | `getTransactionById` / `getFinancialServiceById` / `getPaymentsByTransaction` IPC branches call `transactions.getById`, `omt.getById`, `omt.getPaymentsByTransaction` — the exact three calls the old code made.                                                                                                                                                                                                                                                                                                    | None |
| `SaleDetailModal.tsx`                                                                            | Newly calls `useApi()` — fine, it renders under `ApiProvider` (everything under `HashRouter` does). `getSale`/`getSaleItems`/`refundSale`/`refundSaleItem`/`updateSaleMetadata`/`getAllSettings` IPC branches are all passthroughs to the calls it made before. `refundSaleItem(saleId, item.id, quantity)` → preload `refundItem(saleId, saleItemId, refundQuantity)` — same positional order.                                                                                                                     | None |
| `ProductSearch.tsx`                                                                              | `api` in two dep arrays — safe (§6.1 stable ref). `as unknown as TodaySale[]` casts are honest: the adapter's return type is Dashboard's narrower `RecentSale`, the runtime payload is the same rows it always was.                                                                                                                                                                                                                                                                                                 | None |
| `CustomServices/index.tsx` — item search                                                         | `api.getProducts(query)` → adapter → `backendApi.getProducts(query, undefined)` → IPC `inventory.getProducts(query, undefined)` → handler takes the `filters === undefined` branch → `service.getProducts(search)`. Same as the old one-arg call.                                                                                                                                                                                                                                                                   | None |
| `CustomServices/index.tsx`, `PresetManagerModal.tsx`                                             | `if (!window.api?.servicePresets) return;` removed. On desktop the gate was always truthy, so no change.                                                                                                                                                                                                                                                                                                                                                                                                            | None |
| `ClientForm.tsx`                                                                                 | WhatsApp guard removed; `api.sendWhatsAppMessage(phone, msg)` → IPC `whatsapp.sendMessage(phone, msg)` — same. REST twin (`backend/src/api/whatsapp.ts`, new) is web-only.                                                                                                                                                                                                                                                                                                                                          | None |
| `ensureClient.ts`, `useSaveAsClient.ts`, `CustomerSessionButton.tsx`, `SessionCheckoutModal.tsx` | `createClient` IPC branch is a bare passthrough (`backendApi.ts:441-443`); `getClients(search)` → `clients.getAll(search)`. `useSaveAsClient` dropped a `Parameters<typeof window.api.clients.create>[0]` cast — `createClient` takes `any`, so nothing to satisfy.                                                                                                                                                                                                                                                 | None |
| `CategoriesManager.tsx`                                                                          | Four supplier CRUD calls — passthroughs. `setSuppliers(data ?? [])` unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                      | None |
| `ProductForm.tsx`                                                                                | `getCategories` / `getProductByBarcode` — passthroughs; the surrounding fallback/`catch` logic that made the old optional-chaining harmless is untouched. Silent-print and `fixFocus` branches correctly left as desktop-only.                                                                                                                                                                                                                                                                                      | None |
| `CashReportModal.tsx`, both `HistoryModal.tsx`, `CheckpointHistory.tsx`                          | Passthroughs. `CashReportModal` and the two HistoryModals import from `backendApi` directly rather than `useApi()` — consistent with their neighbours (`refundTransaction`, `getTransactionBySource` were already imported that way), so a style note, not a rule-19 miss.                                                                                                                                                                                                                                          | None |
| `packages/core/src/validators/*.ts` (6 files)                                                    | **Additive only** — six new schemas, no existing schema touched. `electron-app/schemas/index.ts` is not in the diff, so the IPC handlers keep validating against what they validated against before; desktop is unaffected even after a core rebuild.                                                                                                                                                                                                                                                               | None |
| `packages/ui/src/api/types.ts`, `ElectronApiAdapter.ts`, `backendApi.ts`                         | Checked for duplicate `export` names, duplicate class members, and duplicate keys in the `ApiAdapter` type — none (the one thing that would have broken _both_ builds at compile time).                                                                                                                                                                                                                                                                                                                             | None |
| `backend/src/api/*.ts`, `server.ts`, `whatsapp.ts`                                               | Web-only. Not desktop-relevant; skimmed only for actor/role lines — `userId`/`editedBy` come from `req.user` everywhere.                                                                                                                                                                                                                                                                                                                                                                                            | n/a  |

### 6.4 Follow-ups surfaced by the review — ALL FOUR IMPLEMENTED 2026-09-12

Implemented by four parallel agents, reviewed by the orchestrator, **not yet
run** (see §6.6). File ownership was partitioned so no two agents shared a
file; `electron-app/schemas/index.ts` was split by region (existing
`BatchUpdateSchema` block vs end-of-file append) and verified intact
afterwards.

1. **Dead `unit` input in the batch-edit modal — WIRED, not removed.**
   `products.unit` is a real nullable TEXT column (`create_db.sql:301`) and
   the Excel-import path already writes it, so the capability was worth
   keeping. Now flows end-to-end exactly as `supplier` does:
   `ProductRepository.batchUpdateProducts` (SET clause) →
   `InventoryService.batchUpdateProducts` (type + `hasField` guard, so a
   unit-only edit is no longer refused as "No fields to update") →
   `batchUpdateProductsSchema` (`unit: z.string().max(50).optional()
.nullable()`) → IPC handler + REST route → `BatchUpdateProductsPayload` →
   `ApiAdapter` → the restored line in `ProductList.tsx`.
2. **`inventory:batch-update` role gate — CLOSED on both transports.**
   `requireRole(e.sender.id, ["admin","staff"])` added to the IPC handler,
   copying `inventory:delete-product`'s exact shape (the `_event` parameter
   had to be renamed since the audit call needs it too);
   `requireRole(["admin","staff"])` added to the REST route ahead of
   `validateRequest`. Verified the route file has a router-level
   `authenticateJWT` (`backend/src/api/inventory.ts:32`), without which
   `requireRole` reads an undefined `req.user`.
3. **The six schemas now bind BOTH transports.** Five IPC handlers
   (`sales`/`expenses`/`financial`/`custom-services`/`loto` update-metadata)
   now `requireRole` → `validatePayload(<core schema>)` → forward `v.data`;
   `electron-app/schemas/index.ts` re-exports each with the zod-major cast.
   The electron-local `BatchUpdateSchema` was replaced by a direct re-export
   of the core schema, paying down the rule-14 duplicate the sweep had
   flagged in its own doc comment — verified that the consolidation preserved
   the non-empty-`ids` rule (`batchDeleteProductIdsSchema` is `.min(1)`).
   Two caps were raised on evidence rather than taste: custom-service `note`
   500→1000 (its own create-schema sibling allows 1000 and the form sets
   `maxLength={1000}`, so editing an existing long note would have been
   refused) and the three `financial` phone fields 30→50 (matching every
   other phone field in the codebase; no DB or UI constraint backed 30).
4. **Loto role parity — REST widened to match desktop.**
   `POST /update-metadata` moved to sit between `router.use(authenticateJWT)`
   and `router.use(requireRole(["admin"]))`, carrying its own
   `requireRole(["admin","staff"])`. A per-route gate could not have loosened
   the router-level one — the blanket gate rejects first — so relocation was
   the only fix. The file-header comment claiming "all endpoints are
   admin-only" was rewritten, as was the stale comment at the old location.
   Note: this route already validated against the core schema via `loto.ts`'s
   own local `parse(...)` helper (`updateMetadataSchema` at line 152 is
   `lotoUpdateMetadataSchema` under an alias), so rule 14 was never violated
   here and no `validateRequest` middleware was added.

   > **⚠ This item's stated rationale was wrong, and the correction matters
   > more than the fix.** FU4 was justified as "staff can edit a ticket note
   > on desktop and get refused on web". There is no such UI: after §6.6's
   > checkpoint fix, `api.loto.updateMetadata` has **zero production callers**
   > in `frontend/src` (grep returns only its own definition, the adapter
   > wiring, one test, and comments). The only thing that had ever called the
   > channel was `CheckpointHistory.tsx` — and it was editing _checkpoints_,
   > against a ticket-keyed channel, which is the §6.6 bug. So FU4 widened
   > access on a route nothing calls. The change is not wrong — the channel is
   > now role-consistent and validated across both transports — but it fixed a
   > parity gap no user could reach, and the "staff are blocked on web"
   > symptom that motivated it never existed. Recorded rather than quietly
   > tidied, because the plan's own §4 warns that a confident, dated,
   > file-cited claim can still have examined the wrong thing.

**One find was larger than the brief predicted.** `category` was not merely
missing from `customServiceUpdateMetadataSchema` — the IPC handler never
forwarded it either, and the REST route hand-picks its fields rather than
spreading, so a schema fix alone would not have repaired the web path. The
field was being dropped on **both** transports at the handler layer,
independently of Zod, even though `CustomServiceService` and
`CustomServiceRepository` have always accepted and persisted it. Schema,
handler and route are all fixed.

Two adjacent defects were closed in the same batch:

- `frontend/src/types/electron.d.ts:639` declared the `batchUpdate` payload's
  supplier field as `supplier_id?: number | null` while every other layer
  uses `supplier?: string | null` (rule 12). Dormant — nothing calls
  `window.api.inventory.batchUpdate` directly — but now corrected.
- The REST `custom-services/update-metadata` `category` forwarding above.

### 6.5 What reading cannot establish — for the owner's check run

_Assumption (unverified):_ the batch **type-checks**. Every new adapter fn,
class member and type key was checked for name collisions and for the
`getElectronApi(): any` escape hatch, so the _shape_ of the change is sound;
but 1,472 inserted lines with zero `tsc` is still an assumption. The three
things `yarn typecheck` will actually adjudicate:

- `useSaveAsClient.ts`: `results.some((c) => c.full_name…)` now infers `c`
  from `getClients`'s untyped return — should be `any`, so it compiles, but
  it _lost_ the `Client` typing the old `window.api.clients.getAll` gave it.
- `ProductList.tsx`: `Parameters<typeof api.batchUpdateProducts>[0]` as the
  payload type, then conditional property assignment — fine under strict
  mode only if all three assigned keys exist on the type (they do).
- `SaleDetailModal.tsx`: `window.api?.display?.fixFocus?.()` on a
  `window.api` that `electron.d.ts` may declare non-optional — an
  unnecessary-chaining lint at most, and the identical expression already
  lives in `ProductList.tsx`.

Then, in this order: `yarn workspace @liratek/core build && node
scripts/sync-core.cjs` (**eight** validator files changed once the §6.4 work
is counted — `product`, `customService` and `financial` were edited again),
`yarn typecheck`, `yarn lint`, jest, **desktop e2e before web e2e** (web's
`rebuild:node` breaks the desktop ABI). Note that the §6.4 work edited
`electron-app/` source (`schemas/index.ts` + five handlers), so `yarn dev`
must rebuild `electron-app/dist` before any desktop e2e run or the OLD
compiled handlers execute and the changes are silently ignored.

Two desktop e2e paths are worth watching specifically:

- whichever spec edits a financial-service history row's name — the only
  place §6.2(a) changes what the database ends up holding;
- any spec exercising the five `update-metadata` channels, which are now
  Zod-validated on desktop for the first time. A spec sending a field the
  schema omits will newly fail — and that failure would be **correct**,
  pointing at a key-set gap the §6.4 comparison missed.

### 6.6 Everything else found while auditing — all closed but one

Every item below is resolved except the rule-17 proofs, which only a test run
can discharge. Two were found by reading rather than by the plan's own
defect classes, and one of those (the checkpoint/ticket id collision) was
more severe than anything in §6.4.

**Rule 17 debt — the whole batch, and the ONLY item here nobody can close
from the keyboard.** Fourteen new test files were written and **none were
run** (owner's instruction). Per rule 17 a guard test proves nothing until it
has been shown to FAIL on the pre-fix code. Each file carries a comment
naming its own failing-first procedure; that proof is owed before any of them
counts as a guard:

```
backend/src/api/__tests__/customServicesUpdateMetadata.api.test.ts
backend/src/api/__tests__/lotoUpdateMetadataRoles.api.test.ts
frontend/src/features/loto/components/__tests__/CheckpointHistory.checkpointNoteEdit.test.tsx
electron-app/handlers/__tests__/customServiceHandlers.updateMetadataValidation.test.ts
electron-app/handlers/__tests__/dbHandlers.updateExpenseMetadataValidation.test.ts
electron-app/handlers/__tests__/inventoryHandlers.batchUpdateRoleGate.test.ts
electron-app/handlers/__tests__/inventoryHandlers.categorySupplierRoleGate.test.ts
electron-app/handlers/__tests__/lotoHandlers.checkpointUpdateValidation.test.ts
electron-app/handlers/__tests__/lotoHandlers.updateMetadataValidation.test.ts
electron-app/handlers/__tests__/omtHandlers.updateMetadataValidation.test.ts
electron-app/handlers/__tests__/salesHandlers.updateMetadataValidation.test.ts
packages/core/src/services/__tests__/InventoryService.batchUpdateUnit.test.ts
packages/core/src/validators/__tests__/batchUpdateProducts.schema.test.ts
packages/core/src/validators/__tests__/lotoCheckpointUpdate.schema.test.ts
```

**A cross-table id bug in loto checkpoints — FIXED 2026-09-12.** Not a member
of this plan's three classes and not caused by the sweep, but found while
auditing it, and more severe than anything in §6.4:

`CheckpointHistory.tsx:75-84` edits a **checkpoint's** note — `startEdit(
checkpoint)` sets `editingId = checkpoint.id` (a `loto_checkpoints` row id),
and `handleSaveEdit` calls `api.loto.updateMetadata({ id: editingId, note })`.
That channel reaches `LotoService.updateLotoMetadata`, which at
`LotoService.ts:1111` does `this.ticketRepo.getTicketById(id)` — the
`loto_tickets` table. Both tables are `INTEGER PRIMARY KEY AUTOINCREMENT`
from 1, so ids collide routinely. The result:

- when a ticket shares the id, the note is written onto **an unrelated loto
  ticket**, and the audit row records an edit to a `loto_ticket`;
- otherwise it returns "Loto ticket not found".

Either way the checkpoint's note never saves, and `loto_checkpoints` does
have its own `note TEXT` column — so the UI's intent is legitimate and only
its target is wrong. The correct path already exists and is already
dual-transport: `api.loto.checkpoint.update(id, { note })` →
`lotoCheckpointUpdate` (`backendApi.ts:5844`) → IPC `loto.checkpoint.update`
/ REST `PUT /api/loto/checkpoints/:id`.

**Fixed** by swapping `handleSaveEdit` onto that channel. Verified the whole
road before editing rather than trusting the one-line diagnosis:
`LotoCheckpointUpdate` carries `note?: string`
(`LotoCheckpointRepository.ts:62`) and the repository persists it via an
`if (data.note !== undefined)` branch — without that, the fix would merely
have relocated the silent drop. The component reads only `result.success` and
`result.error`, both of which exist on the checkpoint channel's
`{success, checkpoint?, error?}` envelope, so no other adjustment was needed.
The dead `...(editNoteValue !== undefined && …)` spread went too
(`editNoteValue` is `useState("")` and is never `undefined`).

Guarded by `CheckpointHistory.checkpointNoteEdit.test.tsx`, whose load-bearing
assertion is the **negative** one — `api.loto.updateMetadata` is NOT called.
A test that merely asserted "a save happened" would have passed on the buggy
code, which is the whole trap.

_Accepted consequence:_ `loto:checkpoint:update` is `["admin"]` while
`loto:update-metadata` was `["admin","staff"]`, so editing a checkpoint note
is now admin-only on both transports. No working capability was lost — the
staff path either failed or corrupted a ticket — and the destination channel
is correctly admin-gated because it can also rewrite `total_sales`,
`total_commission`, `is_settled` and `settlement_id`. **Do not widen it to
staff**; if staff must edit checkpoint notes, that wants a dedicated
note-only checkpoint channel, not a looser gate on this one.

Three doc comments in `backendApi.ts`, `ElectronApiAdapter.ts` and
`packages/ui/src/api/types.ts` described `lotoUpdateMetadata` as "the
Checkpoint History modal's inline edit" — the exact misattribution that
produced the bug, sitting in the three files a reader would consult. All
three now say it edits a TICKET's note, name the checkpoint channel as the
right destination for checkpoints, and record that the function has no UI
caller.

**`loto:update-metadata` is an orphaned channel — RESOLVED as "keep",
2026-09-12.** With `CheckpointHistory` corrected, nothing in `frontend/src`
calls it, yet it has a live IPC handler, a REST route (both touched by §6.4
items 3 and 4), an adapter fn, an `ApiAdapter` entry and a core Zod schema.
Decision: **keep it.** It is a coherent ticket-note channel that a future
ticket-history edit UI would want, it is now consistent and validated on both
transports, and it costs nothing dormant — whereas deleting it is a six-file
removal across both transports that would discard the §6.4 work just done on
it. The three doc comments above now say plainly that it has no UI caller, so
the next reader is not misled into thinking it is load-bearing. This is a
closed decision, not a deferral.

**`PUT /api/loto/checkpoints/:id` had no schema — FIXED 2026-09-12.** It
passed `req.body` straight into `LotoService.updateCheckpoint`, as did its IPC
twin `loto:checkpoint:update` with its raw `data: any`. Both admin-gated, so
this was a validation gap rather than an authz hole — but it was the only
checkpoint write with no schema, and the fix above put the Checkpoint History
note edit onto that very path.

`lotoCheckpointUpdateSchema` now lives in `packages/core/src/validators/
loto.ts`, is re-exported through `electron-app/schemas/index.ts` with the
zod-major cast, and guards **both** transports — `validatePayload` in the IPC
handler, the file-local `parse(...)` helper in the REST route (that file's own
convention; it does not use `validateRequest`).

The strip-trap was the whole risk here, since this schema stands in front of
money fields a settlement depends on. It covers all eleven
`LotoCheckpointUpdate` fields, and a caller sweep across `frontend/src`,
`backend`, `electron-app` **and both e2e suites** found exactly one caller in
the entire codebase — `CheckpointHistory.tsx`, sending `{ note }` only. No
e2e spec touches the channel. The handler test asserts a full payload reaches
the service field-for-field, which is the assertion that would catch a future
strip regression.

_One latent tightening worth knowing:_ the totals are typed
`z.number().nonnegative()`, a constraint that did not exist before. Nothing
sends them today, so there is no live risk — but a future correction flow
needing a negative adjustment through this channel would be rejected, and the
error would point at the schema rather than at the caller.

**Ungated category and product-supplier writes — FIXED 2026-09-12.** §6.4(2)
closed `inventory:batch-update`; reading its neighbours showed the whole
category/supplier region of `inventoryHandlers.ts` (~lines 500-615) contained
**zero** `requireRole` calls, and the REST twins were equally open. So any
authenticated user, of any role, could create, rename or delete a product
category or supplier on either transport.

Six **write** channels now carry `["admin","staff"]`, matching every other
write in the file, on both transports: `create`/`update`/`delete` for
categories (REST `/categories` POST, `/categories/:id` PUT + DELETE) and for
product-suppliers (REST `/product-suppliers` POST, `/product-suppliers/:id`
PUT + DELETE).

**The four READ channels stay deliberately ungated** —
`inventory:get-categories`, `get-categories-full`, `get-product-suppliers`,
`get-product-suppliers-full` and their REST twins. This corrects an earlier
draft of this section, which wrongly listed `get-categories` among the gaps:
it is a read, it matches `inventory:get-products` and the file's read
convention, and it feeds the product form's dropdowns — gating it would break
that form for lower-privileged users. The handler file now carries an explicit
comment marking the read/write asymmetry as intentional.

`["admin","staff"]` rather than admin-only because these channels were open to
_everyone_, so this is the minimal tightening that restores consistency, and
staff legitimately manage categories from the Settings UI
(`CategoriesManager.tsx`) — admin-only would have removed a capability staff
use today.

This also closes the **"ungated category routes"** item carried since
LIRA-143: the six above were the only ungated write surfaces found across
`inventoryHandlers.ts` and `backend/src/api/inventory.ts`.

**Ungated inventory handlers beyond batch-update.** §6.4(2) closed
`inventory:batch-update` because it was in scope. Reading its neighbours,
`inventory:get-categories`, `create-category`, `delete-category` and the
three `product-supplier` CRUD handlers also appear to carry no `requireRole`,
and their REST twins mirror that. This overlaps the "ungated category routes"
item already open from LIRA-143 — it wants one deliberate pass over that
whole file rather than another one-off.
