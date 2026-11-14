# LIRA-391 — Split payout books the whole payout to the customer's account

**Status:** owner "go" 2026-11-14. Bug fix + sweep, no Spec Kit lifecycle (fix, not a feature).
**Reported by:** owner, Corner Tech tenant, 2026-11-13 (row #17877, Binance cash-out, Maysam Halawi).

## Problem

A Binance cash-out of 533.06 USDT with a $5 fee deducted (payout $528.06) paid out as
**$200 Customer Account + $328.06 Whish Wallet** booked:

- client account credit **−528.06** (the whole payout), not −200;
- **no Whish leg** at all: `Whish_App` drawer untouched, no payment row;
- the row's payment snapshot shows both lines, so the Transactions list shows what was typed,
  not what was booked.

Reproduced on the test tenant 2026-11-14: txn #16902 (fs 1913, client 9948). Same payload with
the flag removed, txn #16905 (fs 1914, client 9950), booked correctly: Binance +533.06 USDT,
`Whish_App` −328.06 USD, account credit −200.

## Cause (verified by run)

1. **Page:** `frontend/src/features/recharge/pages/Recharge/index.tsx` keeps `cryptoPaidBy`,
   updated only when the sheet has exactly ONE line (`onPaymentLinesChange`, ~line 2639).
   Picking a client seeds one Customer Account line, so `cryptoPaidBy = CUSTOMER_ACCOUNT`.
   Adding a second line never resets it. Submit derives
   `cashoutMethod = cryptoPaidBy === "CUSTOMER_ACCOUNT" ? "CUSTOMER_ACCOUNT" : "CASH"`
   (~line 1777) and sends it NEXT TO the split `payments[]`.
2. **Core:** `FinancialServiceRepository` Binance RECEIVE checks
   `cashoutMethod === "CUSTOMER_ACCOUNT"` BEFORE reading the legs (~line 4857): credits the whole
   `payoutAmount` to the account, skips the per-leg loop AND `reconcileLegs`. Legs silently
   ignored. Same shape in the OMT App / Whish App RECEIVE branch (~line 5574) and in
   `OmtWhishAppTransferForm.tsx` (~line 1455, `setCashoutMethod(lines[0].method)` at one line,
   always sent on RECEIVE).

The bug shape is generic: **a single-method flag sent next to structured legs, and a server
branch that trusts the flag before the legs.** Any flow with that shape has the same hole.

## Owner decisions (2026-11-14)

- D1. Fix BOTH layers: core fence + page derivation, for the Binance cash-out AND the OMT App /
  Whish App cash-out, plus a sweep of every other flow with the same shape.
- D2. Corner Tech row #17877 is already refunded (refund row #17881); they re-enter it after the
  fix deploys. No data surgery.
- D3. A "Whish Wallet" payout leg debits the `Whish_App` drawer (same wallet a Whish App send
  debits), no Whish provider fee booked on it — unchanged, this is how it books today when the
  flag is absent.
- D4. Test-tenant repro rows #16902 / #16905 stay unless the owner asks for a refund.

## Requirements

- FR-1 **Core fence, one rule.** When a create payload carries payout/payment legs
  (`payments[]` with at least one leg), the lump method flags (`cashoutMethod`, `paidByMethod`,
  and any sibling the sweep finds) are NOT used to route money. Legs are booked per leg through
  the existing per-leg loops (account leg → ledger credit, drawer leg → its drawer). The flag may
  still be stored for display / details. One shared predicate (rule 14), applied at every site
  the sweep lists; no site keeps its own copy of the check.
- FR-2 **Contradiction refused, not guessed.** If the flag names a method and the legs disagree
  (flag `CUSTOMER_ACCOUNT`, legs contain a non-account leg, or the reverse), the server ignores
  the flag (per FR-1). Do not throw: the stale flag is what every shipped page sends today, and
  the legs are the operator's actual choice. Legacy callers with NO legs keep the flag path
  unchanged.
- FR-3 **Page derivation, one helper.** Every page that remembers "the" method from a one-line
  sheet derives it instead from the current lines through ONE helper (e.g.
  `lumpMethodOf(lines)`: the method only when every line shares it, else `undefined`), and
  sends the lump flag only when the helper returns one. Known sites (grep
  `lines.length === 1`): `Recharge/index.tsx` (Binance), `OmtWhishAppTransferForm.tsx`,
  `FinancialForm.tsx`, `KatshForm.tsx`, `TelecomForm.tsx`, `Services/index.tsx`,
  `utils/paymentUtils.ts`. The kept-change / round-up gates that read `cryptoPaidBy` move to the
  same derivation.
- FR-4 **Sweep (rule 28d), table-driven variant test in core.** For EVERY money-out flow, build
  the payload exactly as its screen builds it, with the split "Customer Account first, then
  Cash or Whish" (the order that trips the stale flag), run it through the real service on a
  real DB, and assert per currency: ledger credit = the account line, drawer leg = the other
  line, `reconcileLegs` ran (an unbalanced split throws). Flows: Binance cash-out, OMT App /
  Whish App cash-out, OMT / Whish system RECEIVE, Katsh / iPick RECEIVE, loto prize payout
  (`LotoTicketRepository`, 4 flag sites), partner recharge order
  (`RechargePartnerOrderService`, 1 site), exchange payout, debt repayment, session checkout
  payout, maintenance, vouchers, partner / supplier settle. A flow with no lump flag still gets
  its row (it documents the sweep).
- FR-5 **Guard.** A jest guard fails any `lines.length === 1` method setter in `frontend/src`
  outside the helper (style of `constants/__tests__/moduleDebtTypes.guard.test.ts`).
- FR-6 **Web e2e.** One spec per cash-out form (Binance; OMT App / Whish App) doing the split
  through the real sheet, then asserting booked payment rows
  (`GET /api/services/transactions/:id/payments`) and the client ledger
  (`GET /api/debts/clients/:id/history`) — never the snapshot.
- FR-7 **Refund symmetry (rule 20).** Refunding a fixed split cash-out nets every touched
  ledger to 0 per currency (Binance USDT, `Whish_App` USD, `General` USD, client ledger).
- FR-8 Both transports (rule 19): IPC and REST send the same payload; offline replay unchanged.

## Out of scope

- Whish provider fee on a Whish Wallet payout leg (D3).
- The Transactions list showing the snapshot (what was typed) rather than booked legs — a
  separate display question; the fix makes the two agree.

## Acceptance

1. Core variant test fails first on every flow that has the hole (at least Binance cash-out and
   OMT App / Whish App cash-out), passes after.
2. Page tests: Binance and OMT/Whish app cash-out send no `cashoutMethod` with a split, send
   `CUSTOMER_ACCOUNT` with a single account line, `CASH`-equivalent with a single cash line.
3. Web e2e per FR-6 green on a fresh web DB.
4. Gates: core build + sync, `yarn typecheck`, `yarn lint`, `yarn check:transport-parity`,
   `yarn check:tenant-scoping`, `yarn check:bind-arity`, full core suite `--maxWorkers=2`,
   affected frontend / backend suites.
5. Release note (rule 30): bullet under Mobile Recharge / OMT-Whish, no What's new card (no
   new UI). Wording: "Paying out a cash-out in several ways (part to the customer's account,
   part cash or wallet) now books each part where it belongs; before, the whole amount went to
   the account."

## Build notes (LIRA-391 build, 2026-11-14)

- N1. Branch labels: the OMT App / Whish App cash-out shares the Binance wallet RECEIVE block
  (`isAppWallet || isBINANCE`); the branch at ~5574 is the system OMT / WHISH RECEIVE (Services
  page). Both had the hole and both are fenced; see research.md R1.
- N2. `LotoTicketRepository` (legs already read before `payment_method`), `LotoCashPrizeRepository`
  (always cash, no flag) and `RechargePartnerOrderService` (the flag is a refusal) are not routing
  holes; they keep their code and get sweep rows that document it.
- N3. Assumption (proceeding): a stale flag on the system RECEIVE that names a wallet (`WHISH`)
  next to a split is the same hole and is fenced the same way; a payout whose lines all share one
  method keeps today's kept-change / round-up refusals.

- N4. Consequence of FR-1, changed in an existing test
  (`FinancialServiceRepository.appWalletTransfer.test.ts`): a Whish App LBP cash-out
  (20,000,000 LBP) paid out with ONE account line typed in USD ($222.22) now credits the
  account $222.22 USD (the line's own currency, like every payout leg) instead of
  20,000,000 LBP (the payout's currency, which the stale flag used to book). See Q2.

## Open questions for the owner (none blocking)

- Q1. Should the Transactions list read booked legs instead of the typed snapshot for payout
  rows, so a future mismatch is visible?
- Q2. A payout line put on the customer's account in another currency than the payout (USD
  line on an LBP cash-out) is now credited in the line's currency. Assumption (proceeding):
  that is right, since it is what the cashier typed and how cash / wallet lines already book.
