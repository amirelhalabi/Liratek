# Top-Up / Transfer Cash-Flow Direction Audit

**Status:** Investigation complete, no code changed. Produced for the owner's Katsh
top-up complaint ("the Katsh topup should be a green arrow down... but it really
depends... I want you to explore all the code, all the cases, and then decide
carefully").

**Trigger:** `RECHARGE_TOPUP` row (Katsh supplier top-up, 1,000,000 LBP) rendered a
red `↑` "out" even though zero cash left any drawer — `getCashFlowDirection`
(`frontend/src/features/audit/cashFlow.ts:74-91`) defaults `RECHARGE_TOPUP` to `"out"`
unless metadata carries `partnerId` or `cashPaid`, and `topUpFromSupplier`'s metadata
has neither.

---

## 1. The decision rule this audit recommends

The owner's own two examples, read together, describe a rule already half-implemented
in this codebase (`SUPPLIER_SETTLEMENT`'s commission-topup case,
`cashFlow.ts:178-203`, LIRA-137) and half-missing (everywhere else). Stated once, in
priority order:

1. **Is any real cash-equivalent drawer actually debited?** ("Real cash-equivalent" =
   General, OMT_System, Whish_System, OMT_App, Whish_App — everything the app already
   treats as customer/owner-facing money, i.e. everything **except** the four
   provider-**stock** drawers `PROVIDER_STOCK_DRAWERS = {MTC, Alfa, Katsh, iPick}`,
   `TransactionRepository.ts:150`.)
   - **No** (the increase is funded purely by a new liability — supplier credit,
     partner credit, or a provider's own commission) → **`"in"`**. An asset went up;
     nothing was paid for it. This is exactly the owner's Katsh intuition, and exactly
     what `SUPPLIER_SETTLEMENT`'s commission-topup shape already does
     (`cashFlow.ts:178-203`).
   - **Yes** → go to step 2.
2. **Does the money land in another real cash-equivalent drawer** (still inside the
   set above)? — i.e. did it stay inside the shop's own cash perimeter?
   - **Yes** → **`"both"`** ↓↑. Nothing left the business; it just moved from one of
     the shop's own cash containers to another. This is exactly the owner's second
     example ("move cash out from general and into another drawer, like OMT
     system... showcase two arrows") and exactly what `DRAWER_TRANSFER` already does
     (`cashFlow.ts:221-224`).
   - **No** (destination is a provider-**stock** drawer, or nowhere — cash leaves the
     business entirely) → **`"out"`**. This matches the existing, un-controversial
     convention that a cash-for-goods swap is one-directional (a `SALE`'s inventory
     decrease isn't badged; an `EXPENSE`'s goods received aren't badged;
     `TELECOM_CREDIT_BUYBACK` — cash out, credits acquired — is already `"out"`,
     `cashFlow.ts:210-211`) and what `DRAWER_CASHOUT` already does for cash leaving the
     business outright (`cashFlow.ts:210`).

This is a refinement of the task's Option (b): "credit-funded → in; cash-funded →
both" is right whenever the destination is itself cash-equivalent, but a cash-funded
purchase of provider **stock** (MTC/Alfa/Katsh/iPick) stays `"out"`, matching how the
rest of the app already treats buying inventory with cash.

---

## 2. Flow inventory (12 flows/shapes found)

Started from the six leads in the brief and expanded by reading every
`TRANSACTION_TYPES.*` producer that touches `drawer_balances` outside a normal
sale/service. No dedicated Binance top-up flow exists — the Binance/USDT drawer only
moves via `FINANCIAL_SERVICE` crypto SEND/RECEIVE, whose legs are already excluded from
customer-facing legs by `isInternalLegJs`'s `currency_code` and `"Crypto "` note checks
(`TransactionRepository.ts:179,182`) and whose direction is already handled by the
`FINANCIAL_SERVICE` case. Nothing further to report there.

| # | Flow (producer) | Txn type | Payment legs written | Real till cash moves? | Drawers affected | Current badge | Correct badge |
|---|---|---|---|---|---|---|---|
| 1 | `RechargeRepository.topUpApp` (`RechargeRepository.ts:442-548`) | `RECHARGE_TOPUP` | **None** — source drawer debited via raw `UPDATE` (line 513-518), dest via `applyDrawerDelta` only (521-526) | Yes — a real source drawer (operator-selected, e.g. General) is always required | source ↓, dest (OMT_App/Whish_App/iPick/Katsh/MTC/Alfa) ↑ | `"out"` (default; no `partnerId`/`cashPaid` in metadata, `cashFlow.ts:74-90`) | **Depends on destination** — `"both"` if dest is OMT_App/Whish_App (cash-equivalent); `"out"` if dest is MTC/Alfa/Katsh/iPick (stock) |
| 2 | `RechargeRepository.topUpFromSupplier` (`RechargeRepository.ts:1482-1578`) — **the owner's case** | `RECHARGE_TOPUP` | **None** at all (confirmed live, see §4) | **No** — no drawer debited anywhere; `supplier_ledger` TOP_UP liability booked instead (1533-1548) | dest (Katsh/iPick) ↑ only | `"out"` (falls through: metadata has neither `partnerId` nor `cashPaid`, only `sourceDrawer:"SUPPLIER"`, `cashFlow.ts:79-90`) | **`"in"`** |
| 3 | `RechargeRepository.topUpFromPartner` (`RechargeRepository.ts:1586-1691`) | `RECHARGE_TOPUP` | None | No — Whish_App ↑, `partner_ledger` CREDIT booked (1634-1643) | dest (Whish_App) ↑ only | `"in"` (`partnerId` present, `cashFlow.ts:85`) | **`"in"` — already correct** |
| 4 | `RechargeRepository.topUpFromClient` (`RechargeRepository.ts:1699-1819`) | `RECHARGE_TOPUP` | None (raw `UPDATE` for General, 1783-1788; `applyDrawerDelta` for Whish_App, 1792-1797) | **Yes, when `cashPaid > 0`** — General is really debited | General ↓ (by `cashPaid`), Whish_App ↑ (by `amount`) | `"in"` (`cashPaid != null`, `cashFlow.ts:85` — true even when `cashPaid > 0`) | **`"both"` when `cashPaid > 0`; `"in"` only when `cashPaid === 0`** |
| 5 | `topUpFromCustomer` (**retired**; historical rows only) — doc at `RechargeRepository.ts:1164-1166`, gated `NON_REVERSIBLE` at `transactionTypes.ts:279-289` | `MTC_TOPUP` / `ALFA_TOPUP` | None ("moves General AND the provider drawer directly with NO payments legs", `transactionTypes.ts:279-281`) | Yes — General was really debited | General ↓, MTC/Alfa (stock) ↑ | `"in"` (hardcoded group, `cashFlow.ts:69-70`) | **`"out"`** (cash-for-stock purchase) — **historical/frozen only, no new rows possible** |
| 6 | `DrawerTopUpRepository.createTopUp` — "External (Cash In)" (`DrawerTopUpRepository.ts:118-228`) | `DRAWER_TOPUP` | Yes — General credited with a real leg (160-198) | Yes — genuinely **new** money entering from outside the system | General ↑ only, nothing decreases | **no badge** (`DRAWER_TOPUP` absent from the switch → default `null`, `cashFlow.ts:225-226`) | **`"in"`** |
| 7 | `DrawerTopUpRepository.createTopUpFromDrawer` — "From Drawer" (`DrawerTopUpRepository.ts:246-344`) | `DRAWER_TOPUP` | Only the General-side leg (309-318, 330-339); source debited via raw `UPDATE` (292-296) with **no** leg — this asymmetry is *why* `DRAWER_TOPUP` is in `NON_REVERSIBLE_TRANSACTION_TYPES` (`transactionTypes.ts:290-293`) | Yes — a real source drawer (OMT_System/Whish_System, per `getSourceDrawerBalances`, `DrawerTopUpRepository.ts:559-577`) is debited | source (PCD) ↓, General ↑ | **no badge** (same as #6) | **`"both"`** |
| 8 | `DrawerTopUpRepository.transferBetweenDrawers` — "Transfer" (`DrawerTopUpRepository.ts:369-548`) | `DRAWER_TRANSFER` | Both legs, both sides (472-544) | Yes | fromDrawer ↓, toDrawer ↑ (General ↔ OMT_System/Whish_System, either direction) | `"both"` (`cashFlow.ts:223-224`) | **`"both"` — already correct** |
| 9 | `DrawerCashoutRepository.createCashout` (`DrawerCashoutRepository.ts:63-165`) | `DRAWER_CASHOUT` | Yes, General debited (124-140) | Yes — cash leaves the **business** (owner's draw), nothing anywhere increases | General ↓ only | `"out"` (`cashFlow.ts:210`) | **`"out"` — already correct** |
| 10 | `RechargeRepository.processCreditBuyback` (`RechargeRepository.ts:1218-1454`) | `TELECOM_CREDIT_BUYBACK` | Yes, payout legs via `postPayoutLegs` (1368-1396) | Yes — cash paid out for credits acquired | payout drawer ↓, MTC/Alfa (stock) ↑, shop's own carrier line credits ↑ | `"out"` (`cashFlow.ts:211`) | **`"out"` — already correct** (cash-for-stock purchase, same convention as `SALE`) |
| 11 | `FinancialServiceRepository.selfChargeTelecomItem` (`FinancialServiceRepository.ts:3865+`) | `TELECOM_SELF_CHARGE` | Provider-drawer legs only (Katsh/iPick ↓, MTC/Alfa ↑) — both sides are `PROVIDER_STOCK_DRAWERS`, filtered as internal | **No** — no cash-equivalent drawer touched at all, stock-to-stock only | Katsh/iPick (stock) ↓, MTC/Alfa (stock) ↑ | **no badge** (type absent from switch) | **no badge — already correct** (neither side is cash; not a bug) |
| 12 | `WalletExchangeRepository.createTransaction` (`WalletExchangeRepository.ts:85-197`) | `WALLET_EXCHANGE` | Both legs, same wallet drawer (159-193) | N/A — same-drawer currency conversion only | one currency ↓, other currency ↑, same drawer | `"both"` (`cashFlow.ts:222`) | **`"both"` — already correct** |

### Bonus finding (adjacent, not a top-up, same bug shape)

`ExchangeRepository.createTransaction` (`ExchangeRepository.ts:180-487`) has a
`partnerMode: "FOR"` shape (LIRA-081, PFT-R): the customer-inflow leg is **skipped**
entirely (338-359, "there is no walk-in customer handing over cash; the partner owes
it instead"), while the payout leg is **always** real regardless of partner mode
(361-362, "Real regardless of partner mode — this value genuinely leaves the till").
So a for-partner exchange has a real cash **outflow** and **no** real cash inflow
(funded by `partner_ledger` DEBIT, 469-484) — yet `EXCHANGE` is hardcoded `"both"`
unconditionally (`cashFlow.ts:221`). Per the rule in §1 this should be `"out"` for the
for-partner variant specifically. Flagged for completeness since it's the identical
"hardcoded direction ignores a debt-funded variant" root cause — not fixed or scoped
further here since the brief was top-up/transfer flows and this is a revenue-service
exchange. A normal `RECHARGE` (not `RECHARGE_TOPUP`) has the same `partnerMode: "FOR"`
shape and the same hardcoded `"in"` (`cashFlow.ts:65`) — worth a follow-up audit of
every `FOR_*` partner shape if the owner wants this closed everywhere, but that is a
materially bigger scope than this ticket.

---

## 3. Where Option (a) and Option (b) actually diverge

- **`topUpFromSupplier` (owner's case), `topUpFromPartner`:** no divergence — these
  methods have **no** cash-funded variant at all (credit is the only funding shape
  either method supports). (a) and (b) both say `"in"`. The choice is moot for these
  two; fixing the owner's bug is a pure win either way.
- **`topUpFromClient`:** **this is where they genuinely diverge.** (a) says `"in"`
  always; (b) says `"both"` whenever `cashPaid > 0` — which is the normal case (the
  whole point of "buy credits from a client" is paying them cash minus a kept fee).
  Recommend (b): the General decrease is real and the owner explicitly asked to see it.
- **`topUpApp` (only reachable destination today: OMT_App):** always cash-funded (a
  source drawer is a required field) — there is no credit-funded variant of this
  method. (a) says `"in"`; (b) says `"both"`. Recommend (b) — matches `DRAWER_TRANSFER`,
  the structurally identical flow.
- **`DRAWER_TOPUP` "From Drawer" mode:** always cash-funded (source is always a real
  named drawer). Same divergence as `topUpApp`; recommend (b)/`"both"` for the same
  reason — this literally IS a `DRAWER_TRANSFER` (General ↔ OMT_System/Whish_System)
  running through a different, non-reversible legacy code path (see §4 note below).
- **`MTC_TOPUP`/`ALFA_TOPUP` (retired):** here (b) does **not** mean "both" — the
  destination is provider stock, not cash-equivalent, so §1's step 2 routes this to
  `"out"`, not `"both"`. This is the one flow where a naive "cash-funded → both"
  reading of Option (b) would be wrong; the refined rule in §1 is needed specifically
  for this case. Moot in practice since the producing code path is retired and can
  write no new rows — flagged for historical-data awareness only.

---

## 4. Live data — what actually exists today

The owner's DB (`C:\Users\amir6\Documents\LiraTek\liratek.db`) plus its `-wal`/`-shm`
were copied to the scratchpad and queried with Python's stdlib `sqlite3` (no
better-sqlite3, no ABI risk). It is a **small, fresh test DB** — 5 `transactions` rows
total, all from 2026-08-15, clearly the owner's own manual test of the LIRA-137
bill-commission-settlement flow:

| type | count |
|---|---|
| FINANCIAL_SERVICE | 2 |
| CHECKPOINT | 1 |
| RECHARGE_TOPUP | 1 |
| SUPPLIER_SETTLEMENT | 1 |

The one `RECHARGE_TOPUP` row is exactly the owner's report:

```
id=4  RECHARGE_TOPUP  amount_lbp=1,000,000
summary: "Katsh supplier top-up → Katsh: 1000000 LBP"
metadata: {"provider":"Katsh","amount":1000000,"currency":"LBP",
           "sourceDrawer":"SUPPLIER","destDrawer":"Katsh"}
payments rows for id=4: NONE
```

`recharges` row #1 confirms `paid_by = 'SUPPLIER'`; `supplier_ledger` row #1 confirms a
`TOP_UP` liability entry (`1,000,000 LBP`) linked to `transaction_id=4`. The Katsh
drawer balance (257,925 LBP at query time, after later financial-service consumption)
corroborates the drawer really did move — via `applyDrawerDelta`, not a payment leg.
**Zero payment legs for this transaction is conclusive by itself**: every other
producer that actually debits a drawer in this codebase does so through
`insertPaymentRow`; the total absence of any row confirms no drawer anywhere was
debited for this transaction. This fully corroborates the code-level finding in row #2
of the table above.

**Every other flow in the table (rows #1, #3, #4, #5, #6, #7, #9, #10, #11, #12, plus
the bonus `EXCHANGE` finding) has zero rows in this database.** All conclusions about
those rest entirely on reading the producing code, not on observed data — flagged here
explicitly so nothing above is mistaken for a data-verified claim beyond the one
Katsh row.

---

## 5. Flags: mis-badged today, and no-badge flows

**Mis-badged (badge shown is actively wrong under the recommended rule):**
- `topUpFromSupplier` → shows `"out"`, should be `"in"` (the reported bug).
- `topUpApp` → OMT_App → shows `"out"`, should be `"both"`.
- `topUpFromClient` with `cashPaid > 0` → shows `"in"`, should be `"both"`.
- `MTC_TOPUP`/`ALFA_TOPUP` historical rows → show `"in"`, should be `"out"` (frozen,
  informational only).
- `EXCHANGE` for-partner rows → show `"both"`, should be `"out"` (bonus finding, out of
  primary scope).

**Renders no badge at all today (`getCashFlowDirection` → `null`):**
- `DRAWER_TOPUP` — **both** of its shapes (external cash-in and from-drawer transfer)
  are entirely absent from the switch statement. This is a real gap: one shape should
  be `"in"`, the other `"both"`, and today neither shows anything.
- `TELECOM_SELF_CHARGE` — also absent from the switch, but this one is **correct as
  blank**: neither drawer it touches is cash-equivalent, so no arrow is the honest
  answer, same treatment as `PARTNER_ADJUSTMENT`/`ACCOUNT_ADJUSTMENT`/
  `SUPPLIER_ADJUSTMENT`.

Note for whoever picks this up: `DrawerTopUpRepository.createTopUpFromDrawer`'s
"From Drawer" mode and `transferBetweenDrawers`'s "Transfer" mode (`to_general`
direction) now perform the **identical real-world move** (OMT_System/Whish_System →
General) through two different code paths, producing two different transaction types
with two different (and currently inconsistent) badge outcomes. `DrawerTopUpModal.tsx`
(`frontend/src/features/dashboard/components/DrawerTopUpModal.tsx:25,345-379`) exposes
both as separate modes side by side today.

---

## 6. What changes on screen (for the owner)

- **The Katsh supplier top-up** (and any future iPick supplier top-up) would flip from
  a red `↑` to a **green `↓`** — matching what the Katsh Bills commission-settlement
  row already shows today for the identical "drawer went up, no cash moved" shape.
- **A Whish App top-up "from partner"** stays a green `↓` — no visible change.
- **A Whish App top-up "from a client" that pays the client cash** would gain a
  **second arrow** (green `↓` + red `↑`) instead of a single green `↓` — this is the
  one place a real till decrease was being hidden behind a misleadingly simple "in"
  badge.
- **An OMT App top-up "from drawer"** would flip from a single red `↑` to **two
  arrows** (↓↑) — revealing that this is an internal move, not an outflow, same
  treatment the General↔OMT_System "Transfer" already gets.
- **The Dashboard's "Top Up General Drawer" modal**, both its "External (Cash In)" and
  "From Drawer" modes, would go from showing **no arrow at all** to a green `↓`
  (external) or two arrows (from drawer) respectively.
- Nothing changes for: Whish-via-partner top-ups, drawer-to-drawer Transfers,
  drawer Cash-Outs, telecom credit buy-backs, wallet USD↔LBP conversions, or
  self-charge — all already correct.
