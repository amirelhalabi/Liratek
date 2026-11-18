# Feature Specification: Payment method fee

**Feature Branch**: `400-payment-method-fee` (work on `main`, owner commits)

**Created**: 2026-11-18

**Status**: Phase 1 built 2026-11-18 (see `current_sprint.md` › LIRA-400)

**Input**: Owner decisions 2026-11-18 (decision page v4, memory `project-payment-method-fee.md`): "A fee the customer pays for paying with a wallet method (OMT wallet, Whish, Binance, any non-cash method), kept by the shop as profit."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Charge a fee on a wallet payment at the POS (Priority: P1)

A customer buys a $10 charger and pays with Whish. The shop charges $1 for paying by Whish. The cashier taps **+ fee** at the end of the Whish line, types 1, and confirms. Whish receives $11. The sale is still a $10 sale; the $1 is shop profit under "Payment method fees".

**Why this priority**: the POS is where most wallet payments happen; it is the MVP.

**Independent Test**: POS sale $10 paid Whish with a $1 fee → Whish drawer +$11, General untouched, Profits shows the $1 under Payment method fees (Whish) and the sale's own margin unchanged.

**Acceptance Scenarios**:

1. **Given** a $10 cart and one Whish line, **When** the cashier taps + fee and types 1, **Then** the summary shows Total Amount $10, a "Payment method fee" line $1, Paid $11, no change due.
2. **Given** the same sale saved, **When** the owner opens Profits, **Then** the "Payment Method Fees" line shows $1 (by method: Whish $1) and the POS line's profit is the sale margin only.
3. **Given** a cash line, **Then** no + fee button appears and the line layout is exactly as today.
4. **Given** a split $5 Whish (+$0.50 fee) + 450,000 LBP OMT (+45,000 LBP fee), **Then** Whish +$5.50, OMT_App +495,000 LBP, Profits fee line $0.50 and 45,000 LBP.

---

### User Story 2 - Void and refund (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the $10 + $1 Whish sale, **When** it is voided (bookkeeping undo), **Then** Whish nets to 0 and the fee line nets to 0 (the sale never happened).
2. **Given** the same sale, **When** it is refunded (full, or one item), **Then** the customer gets back the price only ($10, or the item's share); Whish keeps +$1 and Profits keeps the $1 fee.

---

### User Story 3 - Telecom recharge with a fee (Priority: P2)

MTC/Alfa credit or days paid with a wallet: the same + fee button in the payment sheet; the fee goes to the wallet drawer and the Payment method fees line.

### User Story 4 - Debt repayment with a fee (Priority: P2)

A client repays $50 by Whish and the shop charges $1. The debt drops by $50 only; Whish +$51; fee line +$1.

### Edge Cases

- Fee on a cash, Customer Account or Gift Card line, or on a change (OUT) line → refused by the server on both apps.
- Fee larger than the line's amount, or negative → refused (the fee box shows red above the amount).
- Line removed or switched to cash → its fee is cleared.
- Overpay/change/extra-to-account/discount → computed on the price only; the fee never becomes change.
- POS "add to session" (basket) → no payment lines, no fee button. POS checkout while a customer session is open → no fee button either (the sale is linked to the session, whose refund paths are phase 2).
- Recharge buy-back, For Partner, session-cart mode and Debts cash-out → no fee button.
- Binance USD line → drawer posts in USDT as today; the fee is reported in USD (same as every Binance figure).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A money-in payment line whose method is a wallet (drawer-affecting, drawer other than General) MAY carry a fee typed by the cashier, in that line's currency. No rate, no default, no setting, nothing pre-filled.
- **FR-002**: Cash-family lines (drawer General), Customer Account, Gift Card, change/return (OUT) lines, payouts and refund hand-backs NEVER carry a fee. The server refuses any such fee on both transports with a clear message.
- **FR-003**: 0 ≤ fee ≤ line amount, enforced by the server on both transports (shared rule `legFeeShapeError`). On screen the fee box never takes a negative number and turns red when the fee is above the line's amount; the server refuses the save.
- **FR-004**: UI: a "+ fee" button at the right end of wallet lines only; the method box shrinks to make room; tapping turns the button into a fee box in the same spot, with an ✕ to clear it. Cash lines keep today's exact full-width layout. Off by default (opt-in per form).
- **FR-005**: Totals: Total Amount = price. A separate "Payment method fee" line in the summary when any fee > 0. Paid = price + fee. Discount, change, overpay, extra-to-account and kept change work on the price only.
- **FR-006**: The fee goes into the line method's own drawer (Whish_App, OMT_App, Binance…), never General.
- **FR-007**: Profit: the fee is profit in the line's own currency (LBP fee → LBP), reported in the existing "Payment Method Fees" line on Profits (Overview card with a by-method breakdown, By Module row, By Date, By User, By Client, drill-down), OUTSIDE each module's margin.
- **FR-008**: Void reverses the fee in the drawer and removes it from profit. Refund (full or per item) KEEPS the fee in the drawer and in profit.
- **FR-009**: Debt repayment: a wallet line may carry a fee; the debt reduction never includes it.
- **FR-010**: Desktop and web behave identically (same schema, same service).

### Key Entities

- **Payment leg** (`payments` row): gains `fee_amount` — the part of `amount` that is the payment-method fee (0 for every existing row).

## Settled design (from reading the code, 2026-11-18)

1. **Migration v233** (last entry was v232 `hold_money_voided`): `ALTER TABLE payments ADD COLUMN fee_amount REAL NOT NULL DEFAULT 0`; `down()` drops it; `create_db.sql` updated (rule 10).
2. **Storage — `payments.amount` stays the WHOLE drawer movement (price part + fee); `fee_amount` is the fee part inside it.** The alternative (amount = price, fee posted only to `drawer_balances`) would break every reader that rebuilds or reconciles drawers from `SUM(payments.amount)`: `ClosingRepository` (~:367 rebuilds `drawer_balances` from payments, ~:319 and ~:1342 expectations) and `checkpointResolution.ts` (~:280). With this model those stay correct for free. The cost: every reader that treats a leg's `amount` as "what the customer paid toward the price" uses the price part `amount − fee_amount` — ONE helper, `priceOnlyLegRow`, idempotent (returns `fee_amount: 0`).
3. **The leg carries the fee as its own field; `line.amount` still pays the price.** Allocation, change, overpay, kept change, `reconcileLegs`, `allocateRepayment` and `partitionLegs` see the price-only amount, untouched. The fee is added only at the posting call (`insertPaymentRow` amount + fee, `feeAmount`; `applyDrawerDelta` amount + fee).
4. **Reversal (rule 20)** — the generic path owns it: `_reversePayments` reads `fee_amount`; void mirrors `−amount` and `−fee_amount`; refund mirrors `−(amount − fee)` with fee 0. `overridableNetByCurrency`, `paymentRowsToLegs` and `SalesRepository._itemRefundLegRows` read the price part, so refund previews, override validation and per-item refunds never hand the fee back. The Transactions-page leg (`TransactionPaymentLeg`) gains an optional `fee_amount`, and the refund modal's net subtracts it.
5. **Profit — ONE derivation: not stamped on `transactions.profit_*`; read from `payments`.** Recognized when `p.fee_amount > 0` AND the leg's transaction is `status = 'ACTIVE'` AND `reverses_id IS NULL`, dated by the transaction's `created_at`, bucketed `LBP → lbp`, `USD/USDT → usd`. Void marks the original VOIDED → fee drops out of its own day. Refund leaves the original ACTIVE and negates only the profit stamp (which never held the fee) → fee kept. One SQL fragment, folded into the existing PM_FEE source in summary, By Module, By Date, By User, By Client and the drill-down, so `yarn profits:audit` view-agreement still holds. Deviation from the memory note ("stamped on the transaction"): stamping would make every refund remove the fee (the generic refund negates the stamp) and double-count beside a fees line.
6. **Eligibility + caps once, in a leaf module** `packages/core/src/utils/legFee.ts` (reachable from `browser.ts`, no Node built-ins, rule 29): `isLegFeeEligible({ method, drawerName, affectsDrawer })`, `legFeeError(...)`. The screen passes its payment-method list; the server passes the DB-backed lookup. Pure checks (≥ 0, ≤ amount, not OUT, not CUSTOMER_ACCOUNT/GIFT_CARD) also run in each schema's refine; the drawer-based cash-family check runs in the repository (needs the method table).
7. **Schema keys follow each schema's casing (rule 24)**: sale leg `fee_amount` (snake_case `salePaymentLegSchema`), recharge leg `feeAmount`, repayment leg `feeAmount` (camelCase). Deviation from the memory note's "one `fee_amount` everywhere": CLAUDE.md casing rules win.
8. **`MultiPaymentInput` prop `lineFees`** (off by default), mutually exclusive with `showPmFee` (the old Services rate fee) — with both, `lineFees` is ignored. `PaymentLine` gains `fee?: number`. `toSnakeLegs`/`toCamelLegs` carry it.
9. **Opt-in per screen**: POS `CheckoutModal` only when a new prop `allowLineFees` is passed (POS only; Maintenance also uses CheckoutModal and is phase 2). `PaymentSheet` gets the same opt-in; only TelecomForm passes it (not FS/Katsh/Crypto/Exchange/Alfa Gift). Debts: repay mode only, not cash-out.
10. **Old rate-based fee untouched**: Services SEND split (`multiPmFeeApplies`, `showPmFee`) still stores `financial_services.payment_method_fee` + a PM_FEE audit leg. No recharge flow passes `showPmFee` today (checked: TelecomForm, CardGridPayView, CryptoForm, KatshForm, OmtWhishAppTransferForm, FinancialForm, Exchange all leave it off). FS repositories are not touched in phase 1, so the two fees can never describe the same money.
11. **Dual transport**: no new channel. `sales:process` / `POST /api/sales/process`, `recharge:process` / `POST /api/recharge/process`, `debt:add-repayment` / `POST /api/debts/repayments` already share the core schemas; the offline bindings call the same services. Preload `data` types and `electron.d.ts` leg types gain the fee field (rule 12).

## Phase 2 (NOT built — listed for the owner)

Sessions (basket checkout), custom services, maintenance, exchange, voucher sale, OMT/Whish transfer page migration off the old rate fee, receipts and WhatsApp receipt fee line (`getCustomerFacingLegs` still shows the full leg amount), Transactions export Fee column, closing expectation wording (the expectation already includes fees because `amount` holds them — check, likely nothing to build), phone app.

## Success Criteria *(mandatory)*

- **SC-001**: Create → void nets to 0 in every drawer and in profit, per currency (guard test).
- **SC-002**: Create → refund leaves the wallet drawer and profit each up by exactly the fee (guard test).
- **SC-003**: A fee on a cash / account / gift card / OUT line, or above the line amount, is refused on both transports (guard test through the real schema + service).
- **SC-004**: Profits views agree (By Module = By Date = By User = summary gross) with fees present.
- **SC-005**: A cashier can add a fee to a wallet line in two taps (tap + fee, type).

## Assumptions

- Fee recognition is immediate (cash already in the wallet) even when the rest of the sale is on account and its margin waits for payment.
- Alfa Gift direct sale (CardGridPayView) is not a "telecom recharge" for phase 1.

## Open questions for the owner (proceeded on the most probable reading)

1. **One Profits line**: the new fees are folded into the existing "Payment Method Fees" line (which already holds the OMT/Whish transfer page's rate fee) with a by-method breakdown, instead of a second line with the same name. Say if you want them separate.
2. **Alfa Gift**: no + fee on the Alfa Gift sale for now (it goes through a different screen). Add it in phase 2?
3. **Fee shown on the Transactions row**: the wallet leg shows the full amount received (e.g. Whish $11); the fee is not called out separately on the row until the phase 2 export/receipt work.
