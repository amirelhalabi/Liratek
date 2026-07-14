# Whish App RECEIVE — fee/payout fix plan

**Date:** 2026-07-11 · **Status:** implemented · **Scope:** WHISH_APP RECEIVE only

## Implementation summary

- Fee/amount math extracted to a pure helper: `frontend/src/features/recharge/utils/omtWhishAppFees.ts` (`calculateOmtWhishAppFees`), consumed by `OmtWhishAppTransferForm.tsx`. Guarded by `omtWhishAppFees.test.ts` — 4 of 5 RECEIVE-fee cases were proven to fail against the pre-fix formula (rule 17) before being restored.
- `shopProfit` = full fee (was fee × 10%); `walletAmount` (sent as `data.amount`) now correctly grosses up/nets down per the `includingFees` toggle; `totalAmount` now means the cash payout for Whish App RECEIVE (was the wallet gross) — this also fixed the session-cart net-cash effect and `linkTransaction` amounts, which previously would have paid the customer $101 instead of $99/$100.
- Manual fee field can now be explicitly zeroed (`onChange` no longer collapses "0" to "" and falls back to auto-fee).
- Core: `FinancialServiceRepository.ts` now persists `whish_fee` for `WHISH_APP` (was stored `NULL`); no money-loop changes were needed — the existing Binance-style branch was already correct given properly-shaped inputs.
- Core tests added to `FinancialServiceRepository.appWalletTransfer.test.ts`: full-fee RECEIVE (the lira-100 repro) and zero-fee RECEIVE, both passing; `whish_fee` persistence verified.
- Verified: `yarn typecheck` (clean), `yarn lint` (0 errors, pre-existing warnings only), full frontend test suite (38 suites/312 tests green), full backend/core test suite (588 core tests green; backend has 2 pre-existing failures in `SalesService.test.ts` and `wp5_wp6_admin_tenant.api.test.ts` — confirmed via `git stash` to reproduce identically without this change, unrelated to Whish App).
- **2026-07-11 follow-up — OMT App RECEIVE brought onto the same contract.** `LEFT_TO_DO.md` §"C4/C5 app-transfer fee split" (decided 2026-07-04) already called for "the fee is fully the shop's" for BOTH OMT App and Whish App; OMT App's manual fee was stored (`omt_fee`) but had zero effect on the wallet amount or profit. Fixed by generalizing `calculateOmtWhishAppFees`'s gate from `isWhishAppReceive` to `isAppWalletReceive` (any RECEIVE on this form) — OMT App has no auto-fee and no "fee included" toggle, so it only ever hits the "fee charged on top" branch, but that branch now correctly grosses up the wallet inflow and stamps the full fee as profit. UI: the wallet/fee/payout breakdown box now also renders for OMT App RECEIVE (checkbox itself stays Whish-App-only). New E2E baseline **`lira-101-app-wallet-receive-fee-ui.spec.ts`** (6 UI-driven cases, both providers) proves this end-to-end; the OMT-App-with-fee case was proven to fail against the pre-fix formula first (rule 17). Repo needed zero changes (the shared `isAppWallet` branch already handled OMT_APP generically) — added one repo-level test for coverage parity.
- Not done (per owner's answers): no data migration/repair for existing bad rows (owner will void & re-enter); Whish App SEND manual-fee handling and the RECEIVE `cashoutMethod` plumbing gap remain open follow-ups below.

## The bug

Real transaction (11 Jul, 15:00): entered amount **100 USD**, toggle "fee not included", auto fee **$1**.
The payout leg posted **−$99.90** (`out: $99.9`) — the customer was short-changed/over-paid vs every
possible correct reading, and the Cash drawer is booked $0.90 below physical reality.

**Root cause:** the form computes `shopProfit = fee × 0.1` ($0.10) and sends it as `commission`,
while the full fee travels separately as `whishFee`. The app-wallet branch of
`FinancialServiceRepository.create()` then uses **commission as the customer fee**:

- `fee = Math.abs(calculatedCommission)` — `FinancialServiceRepository.ts:970`
- `payoutAmount = cryptoAmount - fee` → 100 − 0.1 = **99.9** — `FinancialServiceRepository.ts:1117`
- `data.whishFee` is never consulted, and `whish_fee` is stored **NULL** for WHISH_APP
  (the `storedWhishFee` gate at `:481-486` only matches provider `WHISH`).

The conflation is harmless for Binance (there the whole fee IS the commission) but wrong for
Whish App, where the form sent only 10% of the fee as commission.

## Agreed spec (owner interview, 2026-07-11)

1. **The shop keeps the entire Whish App RECEIVE fee, and the full fee is the transaction's
   profit.** The old "10% of fee" profit rule is wrong for Whish App. (No settlement tracking
   needed — nothing is owed to Whish.)
2. **Fee is optional.** When cleared/absent: no fee, payout = full amount, profit = 0.
3. **Auto fee = flat 1% of the entered amount** (USD only). Manual override stays. The classic
   WHISH tier table does NOT apply to the App.
4. **Toggle semantics for RECEIVE** (entered = 100, fee = $1 = 1% of entered amount in both modes):
   - **Fee included:** wallet inflow = **100**, customer takes **99** (payout = amount − fee).
   - **Fee NOT included:** customer takes **100**, wallet inflow = **101** (payout = amount).
5. **OMT_APP:** out of scope — owner will review its fee mechanics separately.
6. **Existing bad rows:** code fix only, no migration. Owner voids & re-enters the affected
   transaction(s) after the fix ships.

## Target contract (align Whish App with the Binance convention)

For the app-wallet/Binance branch of `FinancialServiceRepository.create()`:

> `data.amount` = **gross wallet inflow** · `commission` = **full customer fee (after any fee
> discount)** · wallet drawer +amount · customer payout = amount − commission.

Binance already complies (CryptoForm pre-adjusts amount to the wallet inflow and sends the full
fee as commission). The fix is to bring the Whish App form onto the same contract — the repo's
payout formula then becomes numerically correct without changing the money loop.

Consequence to be aware of: a **fee discount now reaches the customer as cash** (commission =
fee − discount ⇒ payout = amount − (fee − discount)). This is the only internally consistent
reading — profit, drawers, and payout all agree — and matches Binance behavior.

## Changes

### 1. Frontend — `frontend/src/features/recharge/components/OmtWhishAppTransferForm.tsx`

| #   | What                                                                                                                      | Today (buggy)                                                | Target                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| a   | `shopProfit` for WHISH_APP RECEIVE (`:155-158`)                                                                           | `providerFee * 0.1`                                          | `providerFee` (full fee)                                                               |
| b   | `amount` sent — both direct submit (`:246`) and session `formData.amount` (`:210`)                                        | `includingFees ? parsed − fee : parsed`                      | `includingFees ? parsed : parsed + fee` (wallet inflow) — RECEIVE only, SEND unchanged |
| c   | Session cart `amount` for RECEIVE (`:204`, currently `−totalAmount` = −(amount+fee) → basket would pay the customer $101) | `−totalAmount`                                               | `−payout` = `−(includingFees ? parsed − fee : parsed)`                                 |
| d   | `linkTransaction` after direct submit (`:274-277`)                                                                        | `amountUsd: totalAmount`, `profitUsd: shopProfit − discount` | `amountUsd: payout`, `profitUsd: max(0, fee − discount)`                               |
| e   | Fee clearability (`:139-140`) — typing `0` currently falls back to the auto fee, so a no-fee receive is impossible        | `parseFloat(manualFee \|\| "0") > 0 ? … : autoFee`           | `manualFee !== "" ? (parseFloat(manualFee) \|\| 0) : autoFee`                          |
| f   | Summary/receipt labels                                                                                                    | shows amount+fee as "total"                                  | show **wallet inflow** and **customer receives** lines per the new spec                |

### 2. Core — `packages/core/src/repositories/FinancialServiceRepository.ts`

- **Persist `whish_fee` for WHISH_APP** (`:481-486`): extend the gate to
  `WHISH → data.whishFee ?? lookupWhishFee(amount)` (unchanged) **or**
  `WHISH_APP → data.whishFee ?? null` (no tier fallback — fee is optional, App rule is 1%
  computed in the form). Needed for display, audit, and the void path.
- **Document the branch contract** (comments at `:960-970` and `:1110-1118`): amount = gross
  wallet inflow, commission = full customer fee, payout = amount − commission. No math change.
- Rebuild + sync core (`npm run build` + copy to `node_modules/@liratek/core/dist`).

### 3. Dual-transport check (rule 19) — verify, likely no change

- `packages/core/src/validators/financial.ts`: confirm `whishFee` + `includingFees` are accepted
  for WHISH_APP payloads.
- `backend/src/api/` financial route: confirm it forwards `whishFee`/`includingFees` untouched
  (same core service, so the fix applies to web mode automatically).

## Tests (rule 17 — every guard must first FAIL on the buggy code)

1. **Repo tests** — extend `FinancialServiceRepository.appWalletTransfer.test.ts`:
   - WHISH_APP RECEIVE `{amount: 100, commission: 1, whishFee: 1}` → Whish_App +100,
     Cash −99, `whish_fee` stored = 1, profit = 1, COMMISSION row present with 0 delta.
   - Zero-fee RECEIVE → Cash −100, no COMMISSION row, profit 0.
   - Update the existing `:305` case ("General −(20 − commission)") to the new contract wording.
   - `whish_fee` persistence test fails on pre-fix code (stored NULL) — that's the rule-17 proof
     for the core change.
2. **Form contract tests** (the bug lives in the form, so this is the primary rule-17 guard) —
   unit-test the submit payload / cart item (extract the fee math into a pure helper if needed):
   - included, entered 100 → `amount: 100`, `commission: 1`, cart `−99`
   - not included, entered 100 → `amount: 101`, `commission: 1`, cart `−100`
   - manualFee `"0"` → fee 0, `commission: 0`
     Run against the current code first: they must fail with `amount 99/100`, `commission 0.1`,
     cart `−100/−101`.
3. **E2E (desktop)** — extend the recharge lira-\* spec: Whish App receive 100 (fee included),
   assert by identity (WHISH_APP + RECEIVE) and **drawer deltas** (Whish_App +100, Cash −99)
   per rule 15. Then void → deltas reversed.

## Verification checklist

- [ ] `cd packages/core && npm run build` + sync `node_modules/@liratek/core/dist`
- [ ] `yarn typecheck` · `yarn lint`
- [ ] `yarn workspace @liratek/backend test` · `yarn workspace @liratek/frontend test`
- [ ] Manual smoke (`yarn dev`): receive 100 in both toggle states → txn legs + drawer deltas
      match the spec table; void restores drawers
- [ ] Web mode unaffected (`yarn test:e2e:web`) — adapter signature untouched

## Out of scope / follow-ups (flagged during investigation)

- ~~**OMT_APP RECEIVE** fee mechanics — owner reviewing separately.~~ Fixed 2026-07-11 — see the
  implementation summary above and `lira-101-app-wallet-receive-fee-ui.spec.ts`.
- **Whish App SEND with a manual fee** — the money path collects `amount + commission(0)` and
  ignores the fee, while the form displays amount + fee as the total. Same conflation family;
  decide the SEND fee rule later.
- **RECEIVE payout method** — the repo pays out via `data.cashoutMethod || "CASH"` but this form
  never sends `cashoutMethod`, so non-cash payout selections silently hit the Cash drawer.
- **The 15:00 transaction** — void & re-enter (as "fee included") after the fix ships.
