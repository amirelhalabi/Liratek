# Partner Disbursement Matrix — owner's rule vs. shipped code

**Status:** Read-only audit. No source file touched. Grounded at HEAD `1f73780` (2026-08-10).
**Owner's rule (verbatim, 2026-08-10):**

> "each partner has a system associated, any txn we do for partner in a page that is linked to that
> system, acts as **through partner**, everything else acts as **on our partner's behalf** ... in
> all cases yes we hand the customer the cash/or money via other payment methods — **we are
> paying**"

Two testable consequences:

1. **Derivation**: `partnerMode` should be computed as `transaction.system === partner.system_association ? "THROUGH" : "FOR"`, never hardcoded per form.
2. **Disbursement**: whenever the shop physically moves money to/from a customer, ONE of the shop's own drawers must move, in the real sign/currency, regardless of THROUGH/FOR.

Every claim below carries a `file:line` citation. Inferences are marked **Likely** or **Assumption**. Live-data claims were run against a **copy** of the owner's DB (`C:\Users\amir6\AppData\Local\Temp\claude\...\scratchpad\liratek_copy.db`, copied from `C:\Users\amir6\Documents\LiraTek\liratek.db` — no `-wal`/`-shm` sidecar files existed to copy), never the original file.

---

## 0. How the six repositories actually differ — read this before the tables

**Only `FinancialServiceRepository` implements THROUGH mode at all.** Its own type is
`partnerMode?: "THROUGH" | "FOR"` (`packages/core/src/repositories/FinancialServiceRepository.ts:128`).
Every other money repository's `partnerMode` type is the single literal `"FOR"` — confirmed by
reading the type declarations directly:

| Repository | `partnerMode` type | Citation |
| --- | --- | --- |
| `FinancialServiceRepository` | `"THROUGH" \| "FOR"` | `FinancialServiceRepository.ts:128` |
| `RechargeRepository` | `"FOR"` only | `RechargeRepository.ts:149` |
| `SalesRepository` | `"FOR"` only | `SalesRepository.ts:159` |
| `LotoTicketRepository` | `"FOR"` only | `LotoTicketRepository.ts:111` |
| `CustomServiceRepository` | `"FOR"` only | `CustomServiceRepository.ts:93` |
| `ExchangeRepository` | `"FOR"` only | `ExchangeRepository.ts:93` |

None of Sales/Loto/Custom Services/Exchange has a "system" concept at all (no `provider` column, no
OMT/WHISH rails) — there is nothing for the derivation rule to compare `partner.system_association`
against in those five modules, so "FOR-only" there is not a gap, it is the only mode that could ever
mean anything. **The derivation rule is only meaningful inside `FinancialServiceRepository`** (OMT,
WHISH, OMT_APP, WHISH_APP, BINANCE, iPick, Katsh).

**A second, load-bearing correction to the orchestrator's anchors:** `isForPartner` triggers an
**unconditional early return** in `FinancialServiceRepository.createTransaction`
(`:1867` `if (isForPartner) { … return { id, drawer: legacyDrawerLabel }; }` at `:2188`) that
exhaustively handles every service type (cost/price catalog, BINANCE SEND, OMT/WHISH/OMT_APP/WHISH_APP
SEND, RECEIVE for every provider, and an explicit throw for BILL). **By the time execution reaches
line 2191 or later — including the `skipGeneralDrawer`/`skipSystemDrawer` checks at `:3253-3276` the
orchestrator cited — `isForPartner` is always `false`.** `skipGeneralDrawer` (`= isForPartner`,
`:908`) is therefore **dead** at every site after `:2189`. This flips the anchor's framing: the
"FOR-partner mode" comment on the CASH-cashout branch (`:3277-3279`, *"Skipped for FOR-partner mode
(partner handles the payout, not our cash)"*) is describing an **unreachable** condition — the code
that actually executes there is gated on `skipSystemDrawer` (`= isThroughPartner`, `:909`), i.e. this
is a **THROUGH**-mode bug wearing a FOR-mode comment. That distinction is the single most important
finding in this document — see §1.2.

---

## Part A — the posting matrix

Verdict legend: **MATCHES** the owner's rule · **VIOLATES** it (money-movement) · **VIOLATES
(label-only)** — a real drawer moves correctly but the `partner_ledger.transaction_type` stamped is
wrong (no cash is misrouted, only a report/attribution string) · **NOT-REACHABLE** — the code exists
but no live path can ever execute it, cited with the specific reason.

### A.1 — FinancialServiceRepository: OMT/WHISH legacy SEND (`useSystemDrawerFlow`, no cost/price)

| # | Mode | Path | Drawer Δ | Ledger row | Code path | Verdict |
| - | - | - | - | - | - | - |
| 1 | walk-in | any drawer-affecting leg | PCD/wallet **+leg amount**, native currency, real | none | multi-leg loop, `FinancialServiceRepository.ts:2866-2890` | MATCHES (baseline) |
| 2 | THROUGH | `payments[]` legs (the shape the shipped UI sends — `Services/index.tsx:1013-1027`) | PCD/General **+leg amount**, native currency | `THROUGH_OMT_SEND`/`THROUGH_WHISH_SEND` CREDIT, `:3506-3534` | same multi-leg loop, **no `partnerId`/`isThroughPartner` check anywhere in it** (`:2866-2904`) | MATCHES — real cash arrived, a drawer moved for it. (Pre-existing tests label this a "BUG"; under the *new* rule it is correct — see §1.2.) |
| 3 | THROUGH | legacy single `paidByMethod` field, no `payments[]` | **$0 — explicitly skipped** | same `THROUGH_%` stamp still fires (`:3506-3534`, unconditional) | `if (isDrawerAffectingMethod(paidBy) && !data.partnerId) { … }`, `:3033` | **VIOLATES** — a partner_ledger row says money moved and no drawer reflects it. Reachable by any caller using the legacy field (REST/script); the shipped UI never uses this shape (MultiPaymentInput always populates `payments[]`, confirmed by `FinancialServiceRepository.forPartnerDebtDrawer.test.ts:489-539`'s own framing) |
| 4 | FOR | disbursement OUT legs (`returnLegs`) | shop's own drawer **−leg amount**, per-currency, real (`processReturnLegs`, `:1679-1718`, called at `:2187`) | `FOR_OMT_SEND`/`FOR_WHISH_SEND`/`FOR_OMT_APP_SEND`/`FOR_WHISH_APP_SEND` DEBIT per currency, `:2026-2055` | early-return FOR dispatch, `:2009-2056` | MATCHES — the shop fronts the transfer for real, its own drawer debits |

### A.2 — FinancialServiceRepository: OMT/WHISH legacy RECEIVE — the headline finding

| # | Mode | Path | Drawer Δ | Ledger row | Code path | Verdict |
| - | - | - | - | - | - | - |
| 5 | walk-in | CASH cashout | PCD/General **−payout**, real | none | `postPayoutLegs`, `:3309-3338` | MATCHES (baseline) |
| 6 | walk-in | wallet cashout (OMT/WHISH/BINANCE method) | wallet drawer **−payout**, real | none | `:3253-3269` | MATCHES (baseline) |
| 7 | **THROUGH** | CASH cashout | **$0 — skipped** (`!skipSystemDrawer && !skipGeneralDrawer`, `:3270-3276`; `skipGeneralDrawer` is dead per §0, so the live gate is `!skipSystemDrawer` alone) | `THROUGH_OMT_RECEIVE`/`THROUGH_WHISH_RECEIVE` DEBIT, `:3506-3534` (fires regardless) | legacy RECEIVE dispatch | **VIOLATES** — see below, this is *mandatory*, not an edge case |
| 8 | **THROUGH** | wallet cashout | **$0 — skipped** (`!skipSystemDrawer` alone, `:3253-3257`) | same `THROUGH_%` stamp | same | **VIOLATES**, same root cause |
| 9 | **THROUGH** | fee-on-top collection leg | **$0 — skipped** (`!skipSystemDrawer`, `:3137-3142`) | n/a | same | **VIOLATES** (revenue foregone, not cash mis-tracked, but still a real drawer that should move and doesn't) |
| 10 | THROUGH | CUSTOMER_ACCOUNT cashout | none (correct — no drawer involved) | debt credit posts normally, `:3188-3207`, **no** `skipSystemDrawer` check here | same | MATCHES |
| 11 | FOR, primary system (OMT/WHISH) | any cashout | **$0**, by design | `FOR_OMT_RECEIVE`/`FOR_WHISH_RECEIVE` CREDIT, `:2169-2176` | early-return FOR dispatch, `:2109-2155` | MATCHES, with a caveat — see §1.3 |
| 12 | FOR, wallet/secondary provider (OMT_APP/WHISH_APP/BINANCE, or secondary-system OMT/WHISH) | any cashout | wallet/service drawer **+incoming amount**, real (`:2156-2167`) | `FOR_OMT_APP_RECEIVE`/`FOR_WHISH_APP_RECEIVE`/`FOR_BINANCE_RECEIVE` CREDIT (amount − fee), `:2087-2107` | same | MATCHES |

**Why rows 7-9 are the most important finding in this document, not an edge case:** a walk-in
transaction on the shop's **secondary** system is hard-rejected unless a partner is attached
(`FinancialServiceRepository.ts:966-973`, throw text: *"… a walk-in transaction cannot be booked
directly against it; route it through a partner (set partnerId)"*), and the ONE frontend affordance
for attaching a partner without ticking "For Partner" (`Services/index.tsx:1080-1082`) hardcodes
`partnerMode: "THROUGH"`. **THROUGH mode is therefore the ONLY way to do a RECEIVE on the secondary
system at all** — it is not a rare branch, it is the mandatory path. And per the same file's own
documented mental model:

> `FinancialServiceRepository.ts:976-980`: *"The secondary SYSTEM provider can be reached THROUGH a
> partner only. FOR-partner means 'the partner's customer, OUR system' … and the entire reason a
> provider is secondary is that the shop has no account on its rails, so it cannot run anything FOR
> anyone there."*

Read literally: THROUGH means the shop is using the **partner's** real rails to serve the shop's
**own, real, walk-in customer** — the shop still hands that customer real cash out of its own till
(General/PCD) or its own wallet, then settles with the partner afterward for having used their
rails. That is exactly the owner's "in all cases we are paying" rule. The code instead treats a
THROUGH RECEIVE identically to how it treats a FOR RECEIVE (§1.3's "partner deals with their own
customer" model) — compare the RECEIVE payout-skip comment at `:3132-3136` (*"the partner handles the
payout, not our cash"*) against the file's own `:976-980` comment above: **the same file documents
two different, contradictory mental models for what a partner-attached RECEIVE means**, and the live
code implements the wrong one for THROUGH. Net effect: every time an operator does a secondary-system
RECEIVE, cash physically leaves the till (the customer really is paid) but no drawer entry reflects
it — the books drift out of sync with the safe every single time this structurally-mandatory flow
runs.

### A.3 — anchor verification (orchestrator's specific citations)

| Anchor | Verdict |
| --- | --- |
| `:908-909` `skipGeneralDrawer = isForPartner`, `skipSystemDrawer = isThroughPartner` | **Confirmed as written.** |
| `:3277-3279` CASH-cashout gated on `!skipSystemDrawer && !skipGeneralDrawer`, comment says "Skipped for FOR-partner mode" | **NOT-REACHABLE for the FOR half.** `isForPartner` cannot be `true` at `:3270` — the early return at `:1867-2188` exhaustively handles every FOR-partner RECEIVE before this line is reached. The condition's *live* half is `!skipSystemDrawer` (THROUGH) — see row 7 above, which **is** reachable and **is** a violation. The comment is simply mislabeled. |
| "the wallet-cashout branch checks only `!skipSystemDrawer`, so FOR-partner DOES debit the wallet" | **Also NOT-REACHABLE for FOR**, same reason. What IS true and live: THROUGH-partner is blocked from the wallet-cashout too (row 8) — the opposite of what the anchor's phrasing implied. |
| `FinancialServiceRepository.forPartnerDebtDrawer.test.ts:~17-19, ~489-539` — modern legs path reaches General for THROUGH, legacy single-method path skips it | **Confirmed precisely** — this is rows 2 vs 3 above. The test file calls the multi-leg behavior a "BUG"; under the *owner's new rule* it is the single-leg path that is wrong, not the multi-leg path. This is the "two paths behave differently" split the task asked to locate. |

### A.4 — FinancialServiceRepository: cost/price catalog (iPick, Katsh — provider-owned stock)

| # | Mode | Drawer Δ | Ledger row | Code path | Verdict |
| - | - | - | - | - | - |
| 13 | walk-in | provider drawer **−cost**, real (`:2196-2206`); customer legs credit cash/debt normally | none | `:2191-2350` | MATCHES (baseline) |
| 14 | THROUGH | **same** cost/price posting as walk-in (no partner gating inside this block at all) | `THROUGH_OMT_SEND`/`THROUGH_WHISH_SEND` stamped unconditionally at `:3502-3535` — **but** `providerKey` (`:3507-3510`) only maps `OMT/OMT_APP→"OMT"` and defaults everything else to `"WHISH"`, so a THROUGH iPick or Katsh sale is mislabeled `THROUGH_WHISH_SEND` | end-of-flow stamp | MATCHES on money; **VIOLATES (label-only)** on the ledger row's `transaction_type` |
| 15 | FOR | provider drawer **−cost**, real (`:1967-1978`); no legs allowed | `FOR_IPICK`/`FOR_KATSH`/`FOR_OMT_APP_SEND`/`FOR_WHISH_APP_SEND` DEBIT of `price`, `:1979` | early-return FOR dispatch, `:1943-1980` | MATCHES — **this is the live FS id=4 row**, see Part C |

### A.5 — FinancialServiceRepository: app-wallet transfer (OMT_APP / WHISH_APP, no cost/price pair)

Frontend: `OmtWhishAppTransferForm.tsx` submits via `ipcChannel: "financial:create"`
(`OmtWhishAppTransferForm.tsx:309`) — **same repository/method as OMT/WHISH**, confirming the task's
open question: there is no separate "app transfer repo," it is `FinancialServiceRepository`'s
`isAppWallet` branch (`:2360-2361`).

| # | Mode | Drawer Δ | Ledger row | Code path | Verdict |
| - | - | - | - | - | - |
| 16 | walk-in SEND | wallet **−amount**, cash **+amount+fee**, both real | none | `:2442-2548` | MATCHES |
| 17 | THROUGH SEND | **identical** to walk-in — `isBINANCE \|\| isAppWallet` branch (`:2363-2741`) has **zero** `isThroughPartner`/`skipSystemDrawer` references anywhere in it | `THROUGH_OMT_SEND`/`THROUGH_WHISH_SEND`, correctly mapped for OMT_APP/WHISH_APP (`:3507-3510` maps these two correctly) | same | MATCHES |
| 18 | FOR SEND | disbursement OUT legs debit real drawer per currency (shared with A.1 row 4, `:2009-2056`) | `FOR_OMT_APP_SEND`/`FOR_WHISH_APP_SEND` DEBIT | early-return FOR dispatch | MATCHES |
| 19 | walk-in RECEIVE | wallet **+amount**, cash **−(amount−fee)** or mode-C fee split, real | none | `:2549-2721` | MATCHES |
| 20 | THROUGH RECEIVE | **identical** to walk-in, same no-gating branch | `THROUGH_%` stamp, correct mapping | same | MATCHES |
| 21 | FOR RECEIVE | wallet **+amount**, real (`:2087-2107`, `:2156-2167`) | `FOR_OMT_APP_RECEIVE`/`FOR_WHISH_APP_RECEIVE` CREDIT (amount − fee) | early-return FOR dispatch | MATCHES |

**Note the asymmetry with A.2**: app-wallet RECEIVE (rows 19-21) correctly pays/receives real money
in every mode, including THROUGH — because this branch was never given partner-mode gating at all.
The exact same "no gating" property that causes the A.1 row-2 multi-leg SEND to (correctly, under the
new rule) credit General is what makes app-wallet THROUGH transfers correct everywhere. **Only the
legacy OMT/WHISH RECEIVE dispatch (A.2) was deliberately gated — and gated wrong.**

### A.6 — FinancialServiceRepository: BINANCE SEND/RECEIVE

Same `isBINANCE || isAppWallet` branch as A.5 — no separate code path.

| # | Mode | Drawer Δ | Ledger row | Verdict |
| - | - | - | - | - |
| 22 | walk-in SEND | Binance **−USDT**, cash **+**, real (`:2442-2548`) | none | MATCHES |
| 23 | THROUGH SEND | identical to walk-in | `THROUGH_%` stamp **mislabeled `THROUGH_WHISH_SEND`** (BINANCE isn't in the `providerKey` ternary's OMT branch, falls to WHISH default, `:3507-3510`) | MATCHES on money; **VIOLATES (label-only)** |
| 24 | FOR SEND | Binance **−USDT**, real (`:1993-2002`) | `FOR_BINANCE_SEND` DEBIT of USD price (`:2003-2008`) | MATCHES |
| 25 | walk-in RECEIVE | Binance **+USDT**, cash **−**, real | none | MATCHES |
| 26 | THROUGH RECEIVE | identical to walk-in | same mislabel as row 23 | MATCHES on money; **VIOLATES (label-only)** |
| 27 | FOR RECEIVE | Binance **+USDT**, real (`:2097-2107`, `:2156-2167`) | `FOR_BINANCE_RECEIVE` CREDIT | MATCHES |

### A.7 — RechargeRepository: Telecom (MTC/Alfa)

No THROUGH mode exists (§0) — marked N/A, not NOT-REACHABLE (the type itself excludes it, it isn't a
guarded branch that fails to fire).

| # | Mode | Drawer Δ | Ledger row | Verdict |
| - | - | - | - | - |
| 28 | walk-in | Alfa/MTC drawer **∓ real stock leg** (`telecomStockLeg`, `:912-931`), customer legs credit cash/debt | none | MATCHES |
| 29 | FOR | **same** stock leg fires unconditionally (`:912-931` — not inside any `isForPartner` guard), no customer cash taken | `FOR_RECHARGE` DEBIT of full `price`, `:951-962` | MATCHES — the real cost (shop's own carrier-line credit) genuinely leaves the shop's own drawer; there is nothing for the owner's rule to flag |
| — | THROUGH | N/A — type is `partnerMode?: "FOR"` (`:149`) | — | N/A |

Two related, non-customer-facing mechanisms exist in the same repository and are **out of scope**
for this matrix (no customer, no partner-mode dispatch): `topUpFromSupplier` (`:1362-1458`, iPick/Katsh
drawer top-up funded by a supplier, no partner concept) and `topUpFromPartner` (`:1466-1570`,
WHISH_App drawer top-up funded BY a partner — the partner is the one paying here, so correctly no
drawer debit, only a `WHISH_TOPUP` CREDIT).

### A.8 — SalesRepository (POS)

| # | Mode | Drawer Δ | Ledger row | Verdict |
| - | - | - | - | - |
| 30 | walk-in | payment legs credit cash/wallet drawers normally | none | MATCHES |
| 31 | FOR | **no drawer movement** — the "cost" here is inventory (COGS), not a cash leg; stock decrements unconditionally elsewhere, independent of partner mode | `FOR_POS` DEBIT of `final_amount`, `:836-846` | MATCHES — there is no cash event to omit |
| — | THROUGH | N/A — type is `"FOR"` only (`:159`) | — | N/A |

### A.9 — LotoTicketRepository

| # | Mode | Drawer Δ | Ledger row | Verdict |
| - | - | - | - | - |
| 32 | walk-in | ticket sale credits cash drawer normally | none | MATCHES |
| 33 | FOR | no drawer movement (no cost leg exists in this flow at sale time) | `FOR_LOTO` DEBIT of `sale_amount` (LBP), `:368-380` | MATCHES |
| — | THROUGH | N/A — type is `"FOR"` only (`:111`) | — | N/A |

### A.10 — CustomServiceRepository

| # | Mode | Drawer Δ | Ledger row | Verdict |
| - | - | - | - | - |
| 34 | walk-in | `cost_usd`/`cost_lbp` is **never** a drawer movement in this repository, partner or not — it is a profit-calculation input only (`:193-200`); price legs credit cash/debt normally | none | MATCHES (design is internally consistent, see §1.4) |
| 35 | FOR | same — cost still posts nothing (`:268-297`, explicit §2 FINAL SPEC comment: *"cost is a profit input only … must NOT post a drawer movement"*) | `FOR_CUSTOM_SERVICE` DEBIT of `price_usd`/`price_lbp` separately, `:305-330` | MATCHES — consistent with the walk-in baseline, no real cash event exists to omit |
| — | THROUGH | N/A — type is `"FOR"` only (`:93`) | — | N/A |

### A.11 — ExchangeRepository

| # | Mode | Drawer Δ | Ledger row | Verdict |
| - | - | - | - | - |
| 36 | walk-in | inflow (`fromCurrency`) **+**, outflow (`toCurrency`) **−**, both real, both General | none | MATCHES |
| 37 | FOR | inflow **skipped** (`:322`, partner owes it instead) — outflow **always posted for real**, explicit comment `:342-343`: *"Outflow: shop gives toCurrency to customer → shop drawer decreases. Real regardless of partner mode — this value genuinely leaves the till."* Split-payout legs throw for FOR (`:355-359`, forcing the single-lump fallback at `:420-439`, itself unconditional) | `FOR_EXCHANGE` DEBIT of `amountIn`, `:450-459` | MATCHES — **this is the one place in the codebase that already implements the owner's rule exactly as stated, in its own comments** |
| — | THROUGH | N/A — type is `"FOR"` only (`:93`) | — | N/A |

---

## Part B — mode derivation vs. reality

Grep for `partnerMode` across every `.tsx` in `frontend/src` (`frontend/src/**/*.tsx`) turns up
exactly one `"THROUGH"` literal in the whole frontend:

| Call site | Mode sent | Derivation used | What the owner's rule would produce |
| --- | --- | --- | --- |
| `Services/index.tsx:1081` (`selectedPartnerId` set) | `"THROUGH"` — hardcoded | None from `system_association`. Gated on `provider === partnerSystem` (`:791`) — the shop's *configured secondary system*, not the *selected partner's own* `system_association` | Coincidentally often correct **only because** today's only two partners both have `system_association = 'WHISH'` and `partnerSystem` is also always the one non-primary system (§C) |
| `Services/index.tsx:1084` (`forPartnerId` set, "For Partner" checkbox) | `"FOR"` — hardcoded | None | Correct when `provider !== partner.system_association` |
| `Exchange/index.tsx:722` | `"FOR"` — hardcoded | None | Exchange has no `system` concept — always correctly FOR (§0) |
| `CustomServices/index.tsx:347` | `"FOR"` — hardcoded | None | Same — no `system` concept |
| `Loto/index.tsx:315` | `"FOR"` — hardcoded | None | Same |
| `CheckoutModal.tsx:460` (POS) | `"FOR"` — hardcoded | None | Same |
| `TelecomForm.tsx:405` | `"FOR"` — hardcoded | None | Telecom (MTC/Alfa) has no partner-linkable "system" of its own today — always FOR is defensible |
| `CryptoForm.tsx:226` (`handleForPartnerSubmit`) | `"FOR"` — hardcoded | None | **Flag**: a Binance transfer FOR a partner whose `system_association` happens to equal a hypothetical "BINANCE" system value would, under the derivation rule, be THROUGH instead — today's schema doesn't offer "BINANCE" as a `system_association` value anyway (only OMT/WHISH are selectable per `Partners/index.tsx:294-306`, per `FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b`), so this can't currently disagree in practice |
| `OmtWhishAppTransferForm.tsx:513` | `"FOR"` — hardcoded | None | **Flag, exactly per the task's framing**: an OMT_APP/WHISH_APP transfer for a partner whose `system_association === "WHISH"` (or "OMT") should, under the derivation rule, be **THROUGH** — the code's own doc comment at `FinancialForm.tsx:148-153` confirms the OLD always-on `PartnerSelector` used to implicitly mean THROUGH for exactly this reason, before PFT-3b replaced it with the FOR-only checkbox. **This form hardcodes FOR where the rule says THROUGH is at least sometimes correct.** |
| `KatchForm.tsx:1285, 1319` | `"FOR"` — hardcoded | None | iPick/Katsh have no `system_association` value of their own (only OMT/WHISH exist as values) — FOR is defensible until the taxonomy work in §D.4 lands |
| `FinancialForm.tsx:663` | `"FOR"` — hardcoded | None | Same caveat as OmtWhishAppTransferForm — OMT/WHISH-provider items on this form could disagree with the derivation rule |

**Confirmed: nothing anywhere reads `partners.system_association` to decide `partnerMode`.**
Grepping `system_association` across `packages/core/src` (money code) returns only test files,
`PartnerRepository`'s own CRUD, and validator/type declarations — never a repository's
`createTransaction`/`createSale`/`processRecharge` money-dispatch logic. This exact conclusion was
already reached independently by a prior investigation: `docs/plans/todo_plans/FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md:219-260`
(§5b), which found the same thing by a 3-agent survey and corrected an earlier, wrong belief that
`system_association` *was* read by money code.

The ONE quasi-derivation that exists, `Services/index.tsx:514-521, 791-794`, filters which partners
appear in a selector and forces THROUGH mode when `provider === partnerSystem` — but `partnerSystem`
is a **shop-level** setting (`useShopBase()`, one non-primary system for the whole tenant), not the
**selected partner's own** `system_association` field. It only happens to look like the owner's rule
because the shop currently has exactly one non-primary system and both partners happen to be
associated with it.

---

## Part C — live data check

Copied `C:\Users\amir6\Documents\LiraTek\liratek.db` (no WAL/SHM sidecars present) to the scratchpad
and queried the copy with Python's stdlib `sqlite3` only. Live DB migration version: **152** —
matches the source repo's latest migration (`packages/core/src/db/migrations/index.ts:8176`,
`version: 152`), so this is a current, non-stale schema, not an old snapshot missing later columns.

**Schema fact worth stating plainly**: `partner_id`/`partner_mode` columns exist ONLY on
`financial_services` (added by migrations at `packages/core/src/db/migrations/index.ts:3104` and
`:3256`). `recharges`, `sales`, `loto_tickets`, `custom_services`, `exchange_transactions` have
**no** such columns — by design, not by staleness: those five repositories never persist
`partnerId`/`partnerMode` on their own row, they only use it transiently to route money and write a
`partner_ledger` row (`reference_table`/`reference_id` points back at the sale/recharge/etc.).
Confirmed via `PRAGMA table_info` on all five tables.

**Partners** (`partners` table, full contents):

| id | name | system_association |
| - | - | - |
| 1 | hwelet souria | WHISH |
| 2 | test | WHISH |

**Partner-mode activity, whole database, ever:**

- `partner_ledger`: **1 row, total**. `id=1, partner_id=2 ("test"), transaction_type='FOR_IPICK', amount=355000, currency='LBP', direction='DEBIT'`.
- `financial_services` partner-linked rows: **1**, `id=4, provider='iPick', service_type='SEND', cost=322000, price=355000, currency='LBP', partner_id=2, partner_mode='FOR'`. Every other `financial_services` row (`id=1,2,3`) has `partner_id = NULL`.
- `sales`, `loto_tickets`, `custom_services`, `exchange_transactions`: **0 rows in the entire table**, partner-linked or not — this DB has never had a Sales/Loto/Custom-Service/Exchange transaction of any kind.
- `recharges`: 3 rows, none partner-linked (confirmed — zero `partner_ledger` rows reference `recharges`).
- No `THROUGH_%` row of any kind has ever been written, by any provider.
- Partner **id=1, "hwelet souria"**, has **zero** `partner_ledger` rows — she has never been used in a real transaction in this database.

**The `payments` row for financial_services id=4** (transaction id=9): `id=10, method='iPick', drawer_name='iPick', currency_code='LBP', amount=-322000, note='Cost: iPick'`. No General leg exists for this transaction. This matches exactly the row cited in Part A.4 (§A.4 row 15) and confirms the code path in `FinancialServiceRepository.ts:1943-1980` is what actually ran.

### Do I agree with the FS #4 judgement?

**Yes.** Reasoning: this is a cost/price catalog SEND (iPick alfa credit), FOR-partner mode. There is
no walk-in customer in this transaction at all — "the customer" IS the partner (per the file's own
`:976-980` model, "FOR-partner means the partner's customer, OUR system"), and the partner pays later
via settlement, not now. The only *real* money the shop moves at transaction time is the cost (the
shop buying alfa credit from its own iPick balance) — and that is exactly what happened: `iPick`
drawer debited −322,000 LBP, no General movement. There is no "hand the customer cash" event to omit
here, because nobody is being handed cash — the price (355,000 LBP) is a receivable booked to
`partner_ledger`, settled later. The owner's rule ("we hand cash, we are paying, a drawer must move")
is satisfied by the iPick drawer moving for the real cost; it does not additionally require General
to move for a cash event that never happens in this flow. **MATCHES**, same verdict as the
orchestrator, independently re-derived.

### hwelet souria, on this data, under the derivation rule — the sharp case

Both partners' `system_association = 'WHISH'`. If the derivation rule (`transaction.system ===
partner.system_association ⇒ THROUGH`) were implemented literally today, **any WHISH or WHISH_APP
transaction attached to hwelet souria would be classified THROUGH** — and per Part A.2/A.5, THROUGH
mode on WHISH/WHISH_APP runs the transaction through the **real** `Whish_System`/`Whish_App` drawer
(rows 2, 17, 20 — no partner-mode gating suppresses it in the app-wallet branch, and where it IS
gated (legacy RECEIVE) it fails the OTHER way). The owner has separately and explicitly said hwelet
souria (a Syria remittance partner with nothing to do with Whish) **must not** touch the Whish
drawer (`FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md:238-243`, owner quote: *"7welet syria should not
affect the whish system drawer"*). **The derivation rule, implemented naively against today's data,
would do exactly the thing the owner has said must not happen** — not because the rule is wrong, but
because `system_association='WHISH'` is a lie of convenience for hwelet souria (she has no real WHISH
relationship; WHISH is simply the only non-OMT value the `system_association` dropdown currently
offers, per `Partners/index.tsx:294-306`). This is Part D's taxonomy question, made concrete.

---

## Part D — the punchline

### D.1/D.2 — VIOLATES ranked by money risk, with realized-vs-latent

| Rank | Finding | Realized or latent? | Money risk |
| - | - | - | - |
| 1 | **THROUGH-partner OMT/WHISH RECEIVE never pays the customer any cash or wallet money** (A.2 rows 7, 8) | **Latent** — 0 `partner_ledger` rows with a `THROUGH_%` type exist anywhere in the live DB (Part C); the only `financial_services` RECEIVE row (id=1) has no partner. But this path is **structurally mandatory** — it is the only way to do a secondary-system RECEIVE at all (`:966-973`) — so it will realize the first time the shop does one. | **Highest.** Every occurrence understates a real cash outflow; the till will be physically short of what the books say, silently, every time. |
| 2 | **THROUGH-partner fee-on-top RECEIVE never collects the customer's fee** (A.2 row 9) | Latent, same reason as #1 | Medium — foregone revenue, not a cash-tracking gap, but compounds with #1 on the same transaction |
| 3 | **THROUGH-partner legacy single-`paidByMethod` SEND silently skips the drawer credit** (A.1 row 3) | Latent — no `financial_services` row in the live DB was created via the legacy single-payment shape with a partner attached; the shipped UI never sends this shape | Medium — only reachable via REST/scripted callers or a future UI regression that drops back to the legacy field; the modern multi-leg path (row 2) already does this correctly for the real UI |
| 4 | **THROUGH-partner ledger mislabeling for BINANCE/iPick/Katsh** (`providerKey` defaults to `"WHISH"` for any provider that isn't OMT/OMT_APP/WHISH/WHISH_APP, `:3507-3510`) — rows 14, 23, 26 | Latent — 0 `THROUGH_%` rows exist at all | Low — no cash is misrouted, only a `partner_ledger.transaction_type` string is wrong, which corrupts partner-balance reporting/settlement-FIFO categorization (`PartnerRepository.getBalanceBreakdown` buckets by the `FOR_%`/`THROUGH_%` prefix, `PartnerRepository.ts:816-838`) if this path is ever exercised |

Nothing else in the matrix (Parts A.4-A.11) is a violation of the disbursement rule — every FOR-mode
row across cost/price, app-wallet, BINANCE, Recharge, Sales, Loto, Custom Services, and Exchange
correctly moves a real drawer for real money and correctly withholds a drawer entry only when no real
money changes hands (the partner-is-the-customer model). Exchange (A.11) is the cleanest, most
literal implementation of the owner's rule already in the codebase.

### D.3 — smallest fix per finding

1. **THROUGH RECEIVE no-payout (#1, #2)**: at `:3137-3142`, `:3253-3257`, and `:3270-3276`, drop
   `!skipSystemDrawer` from all three conditions (keep `!skipGeneralDrawer` — it is dead but harmless
   to leave, or remove it too for clarity once confirmed FOR can never reach here). This makes THROUGH
   RECEIVE behave exactly like a walk-in RECEIVE for drawer purposes, which is already correct — the
   `THROUGH_%` partner_ledger stamp at `:3506-3534` needs no change, it already fires independently of
   the drawer legs.
2. **THROUGH single-leg SEND skip (#3)**: at `:3033`, drop the `&& !data.partnerId` clause so the
   single-payment fallback matches the multi-leg loop's (correct, ungated) behavior — one-line fix,
   makes the two code paths agree instead of disagree.
3. **THROUGH ledger mislabel (#4)**: at `:3507-3510`, replace the two-armed OMT/WHISH ternary with an
   explicit map covering every provider value (`OMT`/`OMT_APP → "OMT"`, `WHISH`/`WHISH_APP → "WHISH"`,
   `BINANCE → "BINANCE"`, `iPick → "IPICK"`, `Katsh → "KATSH"`) and extend the
   `CreateLedgerEntryData.transaction_type` union (`PartnerRepository.ts:113-150`) with the missing
   `THROUGH_BINANCE_SEND/RECEIVE`, `THROUGH_IPICK_SEND`, `THROUGH_KATSH_SEND` members (mirroring the
   existing `FOR_%` members for those same providers) — this is a real-money-neutral, low-risk
   follow-up, not urgent relative to #1/#2.

### D.4 — is the provider-taxonomy work a prerequisite for the derivation rule?

**Yes — confirmed, not just Likely.** Part C's "hwelet souria" case is a direct demonstration, not a
hypothetical: with both live partners sharing `system_association = 'WHISH'` (because WHISH is
currently the *only* non-OMT value the Partners UI can assign — `Partners/index.tsx:294-306`, derived
from the two-value `BaseSystem` TS union), a literal implementation of `transaction.system ===
partner.system_association ⇒ THROUGH` cannot distinguish "this WHISH transaction genuinely runs
through hwelet souria's own WHISH-adjacent arrangement" from "this WHISH transaction runs through
test's WHISH arrangement" — worse, it actively misclassifies hwelet souria's transactions as THROUGH
on a system (WHISH) she has no real relationship with, which is precisely what the owner said must
not happen. This same conclusion — that generalizing `system_association` beyond OMT/WHISH is
"primarily a provider-taxonomy change, not a `system_association` change" — was already reached by an
earlier investigation and is recorded at
`docs/plans/todo_plans/FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md:219-290` (§5b), which also names the
concrete blocker: `financial_services.provider` is a closed 9-value `CHECK` constraint
(`electron-app/create_db.sql:618`, mirrored by a closed Zod enum in `validators/financial.ts:15-25`)
with no slot for a "SYRIA"-style system, while `partners.system_association` is unconstrained free
text that would silently accept a value meaning nothing downstream. Implementing the derivation rule
before this ships would take a *correct* rule and apply it to *wrong* input data — same failure mode
as hwelet souria today, just automated instead of manual.

---

## Assumptions and residual unknowns

- **Assumption (unverified):** the "partner deals with their own customer using their own money"
  reading of FOR-mode RECEIVE (§A.2 rows 11-12, cited from the file's own `:2109-2124` comment) is
  presented as the most coherent reading of existing code comments, but it has not been re-confirmed
  with the owner against the *new* 2026-08-10 rule specifically for RECEIVE. If the owner intends "in
  all cases" to include FOR-mode RECEIVE too, row 11 (primary-system FOR RECEIVE, currently zero
  drawer movement) would flip to VIOLATES. This is flagged, not resolved, because — unlike THROUGH —
  there genuinely is no live customer-facing cash event modeled in that branch to attach a drawer
  entry to without also changing what "FOR" means for RECEIVE.
- The BILL service type outside the cost/price flow (a pure legacy OMT/WHISH bill with no
  `cost`/`price` pair) was not traced in this pass — no live row of that shape exists, and the task's
  own anchors did not name it as a suspect. **UNKNOWN — needs runtime check** if this shape is still
  reachable from any shipped form.
- `topUpFromPartner` (RechargeRepository, WHISH_App) is real partner-linked money movement but has no
  "customer" at all (it funds the shop's own drawer, partner extends credit) — included in §A.7 for
  completeness, deliberately excluded from the violation ranking since the disbursement rule doesn't
  apply to a transaction with no customer leg.
