# Quickstart: validate LIRA-365

Run only the affected test files (never full suites). Web e2e only on this Mac; no Electron.

## Core (jest, Node ABI)

| Scenario | Expect |
|---|---|
| OMT WU send $400 + $15, discount $2, cash $413 | drawer +413; OMT owed 415; one Discount_Given expense $2, books-only, `is_auto`; commission unchanged |
| Same, then void | drawer, OMT ledger and expenses all net 0 per currency |
| Discount $6 USD / 500,000 LBP; discount + waive above cap; discount on FOR / deferPayment / RECEIVE | refused |
| Exchange, Discount 50,000 LBP typed in the Discount line | same payload as Forgive today (`customer_waived_amount` 50,000); WAIVED_SHORTFALL sibling −50,000 LBP; void nets 0 |
| Voucher $50, discount $2, $48 cash | voucher face $50; expense $2; cancel refunds $48 and voids the expense; nets 0 |

## Frontend (jest, affected files only)

- The customer-pays box shows the Discount line, not a Forgive button, on Exchange and the three cash-outs.
- One variant test per page (rule 28d), walking each OMT service type and mode (walk-in, session, FOR): the payload carries `discount_amount` only where allowed; the payment total is lowered by it; field names come from the schema (rule 24).

## Web e2e

`frontend/tests/e2e-web/lira-web-0xx-discount.spec.ts`: a discounted OMT send and a discounted exchange. It asserts deltas by identity (rule 15) and saves the What's new screenshot.

## Gates

`yarn typecheck`, `yarn lint`, `yarn check:transport-parity`, `node scripts/build-release-notes.cjs --check`.
