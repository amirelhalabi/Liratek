# Quickstart: validating Phone Lines Management (LIRA-309)

These scenarios prove the spec end to end. Expected values use the spec's
example line (MTC 03 555 101, cost $15, price $25) and a rate of 89,000
LBP/USD. Assertions follow rule 15: match rows by identity, and compare
snapshots taken just before each action, never absolute totals.

## Prerequisites

- `yarn rebuild:node` (core jest and web e2e use the Node ABI). Never run
  desktop e2e on the owner's Mac (memory: no Electron on Mac).
- After core changes: `cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`.
- A "Phone Lines" category, a supplier, and one for-sale line product at
  $15/$25 with stock 1.
- An active MTC shop line with credits ≥ $5 and a valid expiry.

## Core (jest): `yarn workspace @liratek/core test resaleLine`

| # | Scenario | Expect |
|---|---|---|
| C1 | `classifyLineStatus(window=3)` at d = 4, 3, 0, −1, −5, −6, null; `window=7` at d = 8, 7 | OK, EXPIRING, EXPIRING, IN_GRACE(4), IN_GRACE(0), LOST, NO_EXPIRY; OK, EXPIRING |
| C2 | DAYS recharge, 30 days, cost $3 | product cost 18 / price 28; batch `unit_cost_usd` 18; line expiry +30 (or from today if in grace); shop line validity −30, credits −3; MTC drawer −3; 0 expense rows; transaction `LINE_RECHARGE`, profit 0 |
| C3 | Sell the C2 line at $28 | `sale_items.cost_price_snapshot_usd` = 18; sale profit $10 |
| C4 | Void C2 (before sale) | cost 15 / price 25 / batch 15; line expiry and credits restored; shop line restored; drawer delta 0 |
| C5 | Void C2 after the sale | refused: "Refund the sale of this line first." |
| C6 | Two recharges, void the first | refused (LIFO); void the second, then the first → both restore |
| C7 | CARD: iPick MTC card, cost_lbp 356,000 | iPick drawer −356,000 LBP; c = $4; line credits + card credits, expiry + validity_days |
| C8 | SHOP_LINE_CREDIT: 2 credits | shop line credits −(2 + SMS fee); MTC drawer −(2 + SMS fee); c = (2×85,000 + fee×89,000)/89,000; no `SMS_Transfer_Fee` expense |
| C10 | Each of C7–C8 voided | every drawer, line, batch and product field nets to 0 per currency |
| C11 | Manual price edit 28→27, then void C2 | price 24 (delta reversal) |
| C12 | Customer `processRecharge` on 03 555 101 (unsold for-sale line) | refused with the "line for sale" message; after the line is sold → accepted |
| C13 | Save details with a number equal to an active shop line | refused (FR-005); and the reverse on carrier-line create |
| C14 | Write off a LOST line (cost 18) | `EXPENSE_INVENTORY` expense 18; stock 0; void restores stock 1 and removes the expense |
| C15 | MTC/Alfa drawer and checkpoint totals before vs after saving details on 3 for-sale lines | unchanged (SC-005) |

Each guard test is shown failing on the pre-change code first (rule 17).

## Frontend (jest): `yarn workspace @liratek/frontend test PhoneLines lineExpiryAlerts`

- Phone Lines page renders two groups with status chips from fixed fixtures.
- `computeLineExpiryAlerts` gives a for-sale alert at d = 3, none at d = 4, a shop-line alert at d = 7, none at d = 8, red at
  d = −2, and write-off for LOST for-sale lines only.
- Recharge page: typing "+961 3 555 101" shows the banner and the
  internal-recharge panel. The customer payment section is absent.
- The `useApi` mock returns a stable reference (rule 25).

## Web e2e (`frontend/tests/e2e-web/lira-web-NNN-phone-lines.spec.ts`)

Run as `npx playwright test --config playwright.web.config.ts -g "phone lines"`.

1. Create the line product, then save its details with an expiry 2 days ahead.
   Dashboard "needs attention" lists it.
2. On Mobile Recharge, type the number in +961 form. The banner shows. Do a
   DAYS recharge of $3. Inventory shows $18/$28. Transactions shows one Line
   recharge row.
3. Void that row. Inventory shows $15/$25 again, and the shop-line credits
   delta is 0.
4. Sell the line at the POS. Profit $10 on the Profits page delta.

## Manual check on the test tenant (after deploy)

Repeat web e2e steps 1–4 on test.liratek.shop as admin, with the demo lines
from 2026-10-11 (MTC 03 555 101 is already sold, so use Alfa 70 444 202:
$12/$20).
