# Implementation Plan: Send the receipt on WhatsApp

**Branch**: `main` (owner works on main) | **Ticket**: LIRA-333 | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/333-whatsapp-receipt/spec.md` (clarified 2026-10-17).

## Summary

A "Send on WhatsApp" action for saved POS sales, in two places: a non-blocking "Sale completed — RCP-n · Send on WhatsApp · Print" strip on the POS screen after Complete Sale, and the sale details window next to "Print". The action opens a free click-to-chat link (`https://wa.me/<digits>?text=<receipt>`) outside LiraTek; the cashier presses Send in WhatsApp.

The approach has three parts:

1. **One receipt description per saved sale.** A new shared builder, `buildSaleReceiptData(sale, items, shop)`, takes the saved sale as read through `getSale` + `getSaleItems`. Two renderers read it: the existing paper formatter (`formatReceipt58mm`) and a new phone-layout formatter (`formatReceiptWhatsApp`). This reconciles the checkout printout and the reprint. The saved sale gains figures that never change after the sale, all read in core: tender from the sale's own `payments` rows, gift card, and on account. These replace `sales.paid_*`, which a later debt repayment changes.
2. **One phone rule.** A new pure core util, `toWhatsAppNumber()`, implements the FR-014 table. It is exported from `browser.ts`, and `WhatsAppService` switches to it (FR-015).
3. **One "open outside LiraTek" path for both apps.** It is a dual-mode adapter function, `openExternalUrl(url)`:
   - **Desktop:** a new IPC channel `app:open-external` calls `shell.openExternal`, guarded by a host allow-list (`wa.me`, `api.whatsapp.com`).
   - **Web:** `window.open(url, "_blank")` runs synchronously inside the click handler, then the code sets `w.opener = null`. It never passes `noopener`, because that makes the call always return `null`. A `null` return is reported as "blocked" (FR-018).

The feature has no migration, no money write and no new REST write route.

## Technical Context

**Language/Version**: TypeScript 5 (strict), React 19 + Vite (frontend), Electron 31 (desktop main), Node 20 + Express (backend on Fly)

**Primary Dependencies**:
- `@liratek/core` (SalesRepository/SalesService, WhatsAppService)
- `@liratek/ui` (`useApi`)
- Electron `shell`
- No new npm dependency.

**Storage**: SQLite (SQLCipher on desktop). **No schema change.** The feature reads existing columns only:
- `sales.*`
- `transactions.client_phone`
- `clients.phone_number`
- `debt_ledger` rows with `transaction_type = 'Sale Debt'`
- `vouchers.redeemed_transaction_id`

**Testing**:
- jest for core, frontend and electron-app. Pass explicit file paths only; never run a full suite (owner rule).
- Playwright web e2e (`frontend/tests/e2e-web/`). Desktop e2e is NOT run on the owner's Mac (owner rule); the desktop path is proven by an electron-app handler unit test and CI.

**Target Platform**: Desktop app (Windows, Electron) and web app (browser on a computer or phone, Vercel + Fly).

**Project Type**: Desktop + web app over one core (dual transport).

**Performance Goals**:
- SC-001: 2 clicks and under 10 s from a completed sale to WhatsApp open.
- The click handler does no `await` before opening (popup gesture rule).

**Constraints**:
- No per-message cost, and nothing is sent in the background (FR-019, SC-006).
- The click-to-chat message length limit is unknown and is measured in task T031 (FR-011).
- Receipt dates and times are formatted on the client device (rule 27). They are never formatted on the server.

**Scale/Scope**:
- P1 is POS sales only.
- P3 covers the other receiptable types in a later ticket, reusing `isReceiptableTransaction`.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1.*

| Principle | How this plan complies | Status |
|---|---|---|
| I. One core, two transports (rule 19) | Sale data reaches both apps through the existing `getSale`/`getSaleItems` (IPC `sales:get` and REST `GET /api/sales/:id` both call `SalesService.getSale`). The added fields come from the one core repository method, so both transports gain them at once. `openExternalUrl` is a dual-mode adapter function in `backendApi.ts`. Its desktop arm uses IPC and its web arm uses `window.open`. **No REST mirror is needed: opening a link is not a data write and touches no core service.** This is a stated exception, not a rule-19 miss. | PASS |
| I. No raw `window.api` in pages (rules 2, 19, `check:transport-parity`) | The strip and the details window call `useApi().openExternalUrl`. Only `backendApi.ts` touches `window.api.app.openExternal`. | PASS |
| I. One payload per operation (rule 22) | The receipt text is built once, by `formatReceiptWhatsApp(buildSaleReceiptData(...))`. Both moments (strip and details) use the same builder. | PASS |
| I. Client-side environment (rule 27) | Date and time formatting happens in the renderer on the cashier's device. Core returns `created_at` raw. | PASS |
| I. `browser.ts` stays Node-free (rule 29) | `toWhatsAppNumber` lives in its own pure module, `utils/whatsappPhone.ts`, with no imports. `WhatsAppService` imports it, and the reverse import never happens. The `browserEntryIsNodeFree` guard test covers it. | PASS |
| II. Layer boundaries (rule 13) | The new SQL (on-account and gift-card sums) lives in `SalesRepository`. `SalesService.getSale` only passes it through. | PASS |
| III. Contracts once (rules 14, 21, 23) | A new Zod schema, `openExternalUrlSchema`, sits in `packages/core/src/validators/app.ts`. It is used by the IPC handler, and the adapter type derives from it. The `sales:get` payload is unchanged (an id), so no three-way diff is needed. | PASS |
| IV. Money integrity (rules 11, 16, 18, 20, 26) | No transaction, payment, drawer or ledger write (FR-023). A no-write guard test (T021) checks this. The FEATURE_GUIDE §13 checklist does not apply because no money moves. Rule 31 does not apply because nothing is copied. | PASS (N/A) |
| V. Data and security | Read-only SQL with `?` placeholders and `tenant_id` on every table. `app:open-external` accepts only `https:` URLs whose host is on the allow-list. Anything else is refused and logged. | PASS |
| VI. Testing (rules 15, 17, 24, 28) | Failing-first tests for the phone table, the shared receipt description (variant matrix, rule 28d) and the allow-list. The web e2e matches the sale by id and stubs `window.open`. Affected tests only. | PASS |
| VII. Code quality | Strict TS, module logger, named exports, `api` read through a ref in effects (rule 25). | PASS |
| Rule 30 release note | T033 adds a POS line to `docs/release-notes/UNRELEASED.md` (both apps). | PASS |

Post-design re-check: PASS. There are no violations, so the Complexity Tracking table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/333-whatsapp-receipt/
├── spec.md
├── plan.md            # this file
├── research.md        # Phase 0
├── data-model.md      # Phase 1
├── quickstart.md      # Phase 1
├── contracts/
│   ├── open-external.md        # IPC channel + adapter contract
│   ├── sale-receipt-read.md    # getSale additions (both transports)
│   └── whatsapp-message.md     # phone rule + message layout + length rule
└── tasks.md           # speckit-tasks output
```

### Source Code (repository root) — files this feature touches

```text
packages/core/src/
├── utils/whatsappPhone.ts                 # NEW pure toWhatsAppNumber() (FR-014/015)
├── utils/__tests__/whatsappPhone.test.ts  # NEW failing-first FR-014 table
├── validators/app.ts                      # NEW openExternalUrlSchema + OpenExternalUrlInput, WHATSAPP_HOSTS
├── validators/index.ts                    # re-export
├── browser.ts / index.ts                  # export both
├── services/WhatsAppService.ts            # drop private formatLebanonNumber → toWhatsAppNumber
├── repositories/SalesRepository.ts        # getSaleWithCustomer + sale_phone, linked_client_phone, tender_usd,
│                                          #   tender_lbp, gift_card_usd, on_account_usd (read-only)
└── repositories/__tests__/SalesRepository.receiptRead.test.ts  # NEW variant matrix

electron-app/
├── handlers/appShellHandlers.ts           # NEW app:open-external (allow-list, shell.openExternal)
├── handlers/__tests__/appShellHandlers.test.ts
├── main.ts                                # register handler
├── preload.ts                             # app.openExternal binding
└── schemas/index.ts                       # re-export openExternalUrlSchema (zod-major cast)

frontend/src/
├── api/backendApi.ts                      # openExternalUrl() — the ONLY transport branch
├── api/ElectronApiAdapter.ts              # expose it
├── types/electron.d.ts                    # app.openExternal type
├── features/sales/utils/saleReceipt.ts    # NEW buildSaleReceiptData(sale, items, shop)
├── features/sales/utils/receiptFormatter.ts  # + formatReceiptWhatsApp(); ReceiptData + gift_card_usd
├── features/sales/hooks/useSendReceiptOnWhatsApp.ts  # NEW: prefetch → sync open → errors
├── features/sales/components/SendOnWhatsAppButton.tsx # NEW (+ number prompt for walk-ins)
├── features/sales/pages/POS/components/SaleCompletedStrip.tsx # NEW FR-001 strip
├── features/sales/pages/POS/index.tsx     # show strip on success; hide on next sale start
└── features/sales/pages/POS/components/SaleDetailModal.tsx  # use buildSaleReceiptData; add button

packages/ui/src/api/types.ts               # ApiAdapter.openExternalUrl
frontend/tests/e2e-web/lira-web-0NN-whatsapp-receipt.spec.ts  # NEW (next free number at build time)
docs/release-notes/UNRELEASED.md           # POS line
```

**Structure Decision**: the existing monorepo layout. Core owns data reads and the phone rule. Electron owns the shell call. The frontend owns rendering the receipt text (client locale) and the single transport branch.

## Phasing

- **Phase A (P1, US1–US3)**: everything above. It ships as one reviewable change.
- **Phase B (P3, US4)**: a separate ticket. It reuses `SendOnWhatsAppButton` and `toWhatsAppNumber`, and gates on `isReceiptableTransaction` wherever "Print" already appears. It is not tasked here beyond one guard (FR-022).

## Risks (resolved in research.md unless marked open)

1. **The two printouts disagree** on the account portion, and also on gift cards. In addition, the reprint's "Paid" grows after a debt repayment (`_markSalesPaidFIFO`). Resolved by R1–R3: one saved-sale description built from figures that never change after the sale. The checkout pre-save preview keeps its own path because it has no receipt number. **Owner-visible effect:** the saved receipt shows the account portion as a USD amount, because that is how the debt is stored.
2. **Phone precedence:** `getSaleWithCustomer` returns the client's phone before the sale's, which is the opposite of FR-012. Resolved by R4: two new fields, with the existing `client_phone` left as it is.
3. **Desktop `window.open`** would open a LiraTek window, because there is no `setWindowOpenHandler`. Resolved by R5: an IPC `shell.openExternal` path.
4. **Message length limit is unknown.** It stays **open** until measured (T031). Shortening is designed in so that a low limit does not block the release.
5. **Refunded sales:** the reprint today ignores refunds, and WhatsApp follows the reprint (R7). This is raised for the owner and is not a blocker.
