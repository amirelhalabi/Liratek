# Quickstart: validate LIRA-296

Write every test first and see it fail before implementing (rule 17). Every money test asserts
**deltas**, never row position (rule 15).

## P1 — automated

| Area | Proof |
|---|---|
| Receipt number | Checkout and a reprint print the same `RCP-<sale id>`. `parseReceiptNumber` accepts `RCP-12`, `rcp12` and `12`, and rejects other input. |
| Default resolution | A category default of 1 month applies to a product with no length of its own. A product's own length wins over the category. A length edited at the till wins over both and stamps `warranty_set_by`. NULL everywhere means no warranty. |
| Search | One sale finds the same line by customer name, phone, receipt number, product, and an IMEI. A walk-in sale is found by receipt number. A partly refunded line shows covered = quantity − refunded. A fully refunded line shows VOID. Today's date comes from the client: a sale made at 02:59 Beirut time is covered on the right day. |
| Status helper | `warrantyState` gives the same answer as the old `computeWarrantyStatus` and `getWarrantyState` on their existing test cases, plus the override precedence. |
| Receipt terms | Terms print only when at least one line has a warranty: on the 58mm and 80mm receipts, and on the service receipt. |
| Dual transport | Desktop: the IPC handler is validated. Web: the route returns an envelope identical to IPC. |
| SF-1 today's sales | For a past day, the web route and IPC return the same sales (today the web returns today's). |
| SF-2 date range | `getSalesByDateRange` returns the same rows on desktop (IPC) and web (REST). |
| SF-3 receipt header | The header prints under the shop name on 58mm, 80mm and service receipts when set; nothing prints when it is empty. |
| Web e2e | `lira-web-0NN-warranty-lookup`: sell an accessory with a category default, search by receipt and by phone, open the sale and see "Covered until". |

## P2 — automated

| Area | Proof |
|---|---|
| Refund claim | The sale's profit reverses (as today). Stock does NOT go up. A `defective_items` row is HELD at FIFO cost. A `WARRANTY_COST` row of −cost is written. Drawers move by the refund legs only. |
| Replace claim | Stock goes down by 1 through FIFO with the `warranty_claim_id` owner. The replacement unit is SOLD with `override_until` = the original end date. A `WARRANTY_COST` row of −cost is written. The original sale is unchanged. |
| Repair claim | A job with price 0 is linked to the claim. At delivery, the parts cost appears in WARRANTY and not in MAINTENANCE. |
| Void claim | Every ledger nets to 0, per currency, for each action. Failing-first (rule 20). |
| Guards | `NOT_COVERED` without an override; the override needs admin and a reason; `ALREADY_CLAIMED`; `OUT_OF_STOCK`; staff can't REPLACE or REFUND. |
| Profits | The WARRANTY row equals the sum of `WARRANTY_COST` rows. Net profit includes it. |
| `is_auto` | `WARRANTY_COST` rows are hidden from the default Transactions view and shown by their type filter (rule 26). |
| Repair warranty | Stamped at Delivered_Paid from the client day, printed, and found by the search. |

## P3 — automated

| Area | Proof |
|---|---|
| Serials | The label follows the category. BLOCK refuses a sale with `SERIAL_REQUIRED`; WARN passes with a warning. |
| Supplier return | CREDITED: the supplier balance moves by the credit, and `WARRANTY_COST` +credit. REPLACED: the unit is back IN_STOCK, and +cost. REJECTED: no money moves. Voiding the claim refuses `DEFECTIVE_ALREADY_SENT`. |
| Report | Counts and costs equal the sums of the underlying rows. |

## Manual (production, after each phase ships)

1. **P1:**
   - Set Accessories to 1 month and sell a charger to a named customer.
   - Search the customer's phone number: the charger is found, "Covered until".
   - Reprint: the receipt number is the same as at checkout, and the terms text prints.
2. **P2:**
   - Run a Replace claim on the charger. Profits shows a "Warranty cost" equal to its cost. The sale is unchanged.
   - Void the claim; everything returns to how it was.
3. **P3:**
   - Send the faulty charger to its supplier and record a credit. The warranty cost goes down by the credit.

## Gates (each phase)

- `yarn typecheck`, `yarn lint`
- `check:tenant-scoping`, `check:bind-arity`, `check:schema-equivalence`
- release-notes check
- `node scripts/run-tests.mjs`
- `yarn build`
- the full web e2e

Desktop e2e is run on Windows or in CI, never on this Mac.
