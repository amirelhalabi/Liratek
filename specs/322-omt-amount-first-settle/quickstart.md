# Quickstart: validate LIRA-322

Ask the owner before running any test suite (standing preference). Desktop e2e is not run on the owner's Mac. Web e2e and jest are fine once approved.

## Automated

1. **Allocator unit tests**: every row of the table in [contracts/allocator.md](./contracts/allocator.md), plus LBP, COLLECT and covered-types scope cases.
   `yarn workspace @liratek/core test accountSettleAllocation`
2. **Repository tests** (core jest, in-memory DB), each guard seen failing first (rule 17):
   - F3: a LEGACY settlement's commission credit no longer shows in the queue.
   - F4: commission entered on the sheet is accepted.
   - USD-only settle leaves LBP rows and balance untouched.
   - $300 partial: coverage rows, remaining $54, member balance $197.
   - Second settlement $197 closes the rest; commission recognised once per transfer.
   - Owner decision 2026-10-15: $197 + $0.70 commission closes all four remaining transfers with no extra, and leaves ONE open −$0.70 credit (OMT owes the shop $0.70); the next settlement nets it first; voiding nets 0; voiding it after a later settlement used the credit is refused (`lira322CommissionToAccount`). On the live shop: pay the full gross, enter the commission, and expect the OMT card to show OMT owes you the commission.
   - Credit netting within a member and across members (both line balances move, total unchanged).
   - Mixed directions in one transaction: USD out, LBP in, change in the other currency.
   - Stale `expected_owed`: refused, nothing written.
   - Void newest first: older one refused; newest then older nets to 0 per currency on drawers, member balances, profit and allocations.
   - Legacy payload (no `per_currency`): existing suites unchanged and green.
   - Invariant property test: random settle/void sequences keep the balance equal to Σ remaining, per member and currency.
3. **Transport**: backend `suppliers.api.test.ts` and the IPC handler test take the new payload. Run the three-way key diff (schema / preload / handler) and record it in the task.
4. **Frontend jest**: AccountSettleSheet per-currency sections, the preview chips (closes / part-paid / untouched), the optional row picker, `expected_owed` sent, and the stale-error refetch. The Suppliers page hides Pay / Receive and the Commission settlement block for account members only.
5. **Web e2e**: new `frontend/tests/e2e-web/lira-web-065-omt-amount-first-settle.spec.ts` (USD-only, partial, preview, void order). Update `lira-web-035` and `lira-web-053` to the new sheet. Desktop `lira-189` updated, not run here.
6. **Gates**: `yarn typecheck`, `yarn lint`, tenant-scoping and bind-arity checks, the `browserEntryIsNodeFree` guard, the schema-equivalence check and the release-notes check.

## Manual on test.liratek.shop (after deploy)

The OMT account holds six USD transfers ($152, $101, $101, $101, $21, $21 = $497). Add two LBP sends first (e.g. 900,000 and 450,000 LBP).

1. Open Settle Account. It shows "$497.00" and "1,350,000 LBP" separately, with no merged figure.
2. Enter Cash $300 only. The preview reads: 2 close, $101 part-paid ($47 / $54 owed), $197 still owed; LBP untouched. Confirm. The card shows $197 and 1,350,000 LBP.
3. Enter Cash 900,000 LBP only. The 900,000 send closes and the 450,000 stays open.
4. On Transactions (OMT): the part-paid transfer shows "Partial $47". The counts match.
5. Void the 900,000 LBP settlement (newest): it is allowed. Try to void the $300 one after a later USD settlement: it is refused with the message naming the newer one.
6. Pay / Receive is gone for the OMT counter, OMT App and iPick, and still present on Katsh.
