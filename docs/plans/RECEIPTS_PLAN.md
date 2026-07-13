# Receipts — Logo, Walk-in Customer, Service-Module Receipts (T5 + T8)

> **Created**: 2026-07-13
> **Origin**: Sprint T5 (receipt logo + editable walk-in customer) and T8
> (receipts for mobile services, recharge, maintenance, custom services, loto).
> **Owner decisions (interview 2026-07-13)**:
> - Logo: **upload in Settings**, stored in the DB (base64) — works desktop + web.
> - Receipts for **all** modules: mobile services (OMT/Whish/Katch), recharge
>   (MTC/Alfa), maintenance, custom services, loto.
> - Walk-in customer: **both** — set a name at POS checkout (prints, no client
>   record) AND rename the customer on a completed sale + reprint.
> - Trigger: **Print button after success** + reprint from history (like POS).
> **Tickets**: RCP-0 … RCP-3.

---

## Current state (investigated)

- `frontend/src/features/sales/utils/receiptFormatter.ts` — `formatReceipt58mm`
  / `formatReceipt80mm` produce monospace TEXT; `ReceiptData` is sale-shaped
  (items[], subtotal, discount, change). Unit-tested (`receiptFormatter.test.ts`).
- Print path lives INSIDE `CheckoutModal.tsx` (`printReceiptContent` +
  `receiptPrintCSS`): wraps the text in `<body><pre>…</pre></body>` and calls
  `window.api.print.silentPrint(html, printer)`, else a print-window fallback.
  POS-only today (SaleDetailModal reuses the formatter).
- Shop info: `useShopInfo()` reads `shop_name/phone/location` from settings
  (getAllSettings). Settings are dual-transport (`getSetting`/`updateSetting`/
  `getAllSettings` in backendApi + `backend/src/api/settings.ts`).
- Logo: none today. A logo is an HTML `<img>` injected above the `<pre>` — it
  does NOT go through the monospace text formatter.
- Sale `updateMetadata` allows `note` ONLY — no client edit path exists yet.

## Design principles

1. **One shared print path.** Extract the CheckoutModal print code into
   `frontend/src/shared/utils/printReceipt.ts` so every module prints
   identically (same logo, CSS, silent/fallback logic).
2. **Logo is presentation, not text.** Injected as `<img>` in the HTML wrapper;
   the text formatters are untouched by it.
3. **Receipts never touch money.** No drawers/ledgers/profit — so the money
   invariants (rules 15–20) don't apply; correctness is content + it prints.
   Guard with formatter unit tests, not money e2e.
4. **Dual-transport for the logo setting** (rule 19): the upload uses the same
   `updateSetting`/`getSetting` path that already works on both transports.

## Phases

| Ticket | Scope | Status |
| ------ | ----- | ------ |
| **RCP-0** | Logo foundation: Settings upload (base64 → `receipt_logo`), extend `useShopInfo`, shared `printReceipt` util that injects the logo; POS receipts show it | ✅ 2026-07-13 (6e694b4) |
| **RCP-1** | Walk-in customer: rename on a completed sale + reprint (checkout name-entry already worked) | ✅ 2026-07-13 (8dd83df, lira-111) |
| **RCP-2** | Generalize the receipt: a shared `buildTransactionReceipt` mapping a service transaction → receipt text (provider/service/amount/fee/client/legs) | ⬜ (T8 — needs content decision) |
| **RCP-3** | Per-module "Print receipt" button after success + reprint from history: mobile services, recharge, maintenance, custom services, loto | ⬜ (T8) |

**T5 complete (RCP-0 + RCP-1).** RCP-1 corrected mid-build: a POS sale with a
typed name auto-creates a client (lira-094), so the rename gate is
`client_id IS NULL` (truly anonymous sales) — a named sale is a client and its
rename is ignored. The checkout name-entry already flowed to the receipt, so
no checkout rebuild was needed (optional: relabel the client-search field as
"Customer name" for clarity — deferred, cosmetic).

### RCP-0 — Logo foundation

- Settings (`ShopConfig.tsx`): image upload → resize/cap size → base64 →
  `updateSetting("receipt_logo", dataUrl)`. Show a preview + a remove button.
- `useShopInfo()` gains `logo` (the data URL, or "").
- New `frontend/src/shared/utils/printReceipt.ts`: `printReceipt({ text,
  logo, printer })` — the extracted CSS + `<img>` (when logo set) + `<pre>`
  + silent/fallback. CheckoutModal + SaleDetailModal call it.
- Guard: unit test the HTML builder (logo present → `<img>`; absent → none).

### RCP-1 — Walk-in customer

- Checkout: a clearly-labeled "Customer name (optional)" field that flows to
  `client_name` on the sale + receipt WITHOUT creating a client row (the
  existing `clientSearch` free-text already does this — make it explicit and
  ensure it prints; rule 11: keep name on the unified txn row).
- Completed-sale rename (corrected after investigation + advisor):
  - There is **no `sales.client_name` column** — it's aliased from the clients
    JOIN. The walk-in name lives on the **unified transaction** (rule 11), so
    the rename's single write target is `transactions.client_name/_phone`.
    Do NOT add a sales column / migration.
  - **Gate to walk-in sales only** (`client_id IS NULL`). A client-linked
    sale's name comes from the clients record; a per-sale edit would fork the
    transaction label from the client's real name. Show the edit UI only for
    walk-ins.
  - **Read + write the same field**: extend the sale read to surface the
    transaction's client_name for walk-ins, or the edit-then-reprint prints
    the stale "Walk-in Customer". (COALESCE the transaction name in getSale.)
  - Field-picking guard: add `client_name`/`client_phone` to BOTH
    `SalesService.updateSaleMetadata` and `SalesRepository.updateMetadata`
    (+ the transaction UPDATE), and the rule-14 electron schema dup.
- Guard: e2e that a renamed walk-in sale's transaction carries the new name.

### RCP-2 — Generalized service receipt

- `buildTransactionReceipt(txn)` → `ReceiptData` for non-sale transactions:
  header (shop + logo), service line(s), amount, fee/commission, client,
  payment legs, timestamp, operator. Reuse the 58/80mm formatters (extend
  `ReceiptItem`/`ReceiptData` minimally if needed — keep POS output identical).
- Source: the unified transaction row + its payment legs (already exposed via
  `transactions.getById` / `getRecent` with legs).

### RCP-3 — Per-module print buttons + reprint

- After a successful transaction each module shows "Print receipt"; each
  module's history/detail modal gets a reprint. Modules: financial services
  (OMT/Whish/Katch), recharge (MTC/Alfa), maintenance, custom services, loto.
- All go through the shared `printReceipt` util (logo included).

## Risks / notes

- **Silent print is Electron-only** (`window.api.print.silentPrint`); web mode
  uses the print-window fallback. The shared util must keep both paths.
- **Logo size**: cap dimensions + bytes before base64 (a huge logo bloats
  every settings fetch and the print HTML). Resize on upload.
- **RCP-1 completed-sale rename** is the only money-adjacent change (rule 11
  client propagation) — the rename must reach the unified transaction row, not
  just the `sales` row, or the Transactions view + client reports diverge.
- Thermal-printer output can't be asserted in e2e; lean on formatter unit
  tests + manual verify (`/verify`) on the real print path.
