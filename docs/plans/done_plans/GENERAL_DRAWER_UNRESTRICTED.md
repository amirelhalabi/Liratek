# General Drawer — Unrestricted Currencies

**Status: ✅ SHIPPED AND PUSHED — 2026-08-29.** All phases complete, all gates green. This is a
completion record, not a plan; nothing here is outstanding. Follow-ups this work *spawned* are in
§7 and are deliberately NOT part of it.

**Created:** 2026-08-22 · **Base:** `main` @ `0eb34ba2` (v1.30.2)

## Commits

| Commit     | Date       | What                                                                          |
| ---------- | ---------- | ----------------------------------------------------------------------------- |
| `5a4df632` | 2026-08-22 | Phase 1 (core policy) + Phase 2 (the gate) + Phase 3 item 7 (Settings)        |
| `ceca680d` | 2026-08-28 | Items 8, 9, 10 + Phase 4 — the count sheet, both auto-registers, dead call    |
| `5dc343e4` | 2026-08-28 | Extra-currency cash-out — the reversal owner a review found missing (§6)      |
| `35308852` | 2026-08-28 | Owner's repo-wide format pass; also carries the web currency-provider fix (§6) |
| `526eba3f` | 2026-08-29 | e2e local-day convention fix (§6)                                             |

## Final verification (re-run on the committed HEAD, not taken from agent reports)

| Gate                  | Result                                          |
| --------------------- | ----------------------------------------------- |
| Core jest             | **234 suites / 2454 tests** — all pass          |
| Frontend jest         | **166 suites / 1275 tests** (1274 pass, 1 skip) |
| Backend jest          | 45 suites / 622 tests — all pass                |
| Typecheck             | frontend, electron-app, backend, packages/ui — clean |
| Tenant-scoping linter | 0 violations / 747 statements                   |
| Desktop e2e           | green (owner-run)                               |
| Web e2e               | green apart from a pre-existing `lira-web-010` clock bug, fixed in `526eba3f` |

Baseline before this work was 230 suites / 2435 tests.

---

## 1. The ask and the fix

**Owner, 2026-08-22:** cash-in of EUR 300 into General was rejected with _"Currency EUR is not
enabled for the General drawer."_ The Exchange module accepts **any** currency and deposits it into
General, so General should not be currency-restricted at all.

The root contradiction: `drawer_balances` is the **fact** (any currency, row created on demand by
`applyDrawerDelta`) while `currency_drawers` is a **closed allowlist** — and Exchange wrote to the
fact side while the top-up gate read the config side. General was open by construction on one path
and closed by config on another.

Two layers shipped, on different axes:

- **Acceptance** — General's currency set is now DERIVED, never configured (`isUnrestrictedDrawer`
  in `constants/drawerCurrencyPolicy.ts` is the single owner).
- **Countability** — for **every** drawer, the count sheet is `base ∪ {currencies holding a
  non-zero balance}`. A drawer's countable set is never smaller than the money it holds, so config
  drift can no longer hide cash.

`getCountableCurrenciesForDrawer` / `getCountableCurrenciesByDrawer` in `CurrencyRepository` are the
one read behind this, exposed on both transports as `currencies:countableDrawerCurrencies` and
`GET /api/currencies/countable-drawer-currencies`. `getAllDrawerCurrencies` was left unchanged on
purpose — Settings still needs the CONFIGURED allowlist for its checkbox grid.

---

## 2. Owner decisions (2026-08-22) — all honoured as written

| #   | Decision                                                                           | Rationale / consequence                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **General only** is unrestricted — OMT_System / Whish_System stay restricted       | Narrowest change. Verified to have **zero residual gap** — see §4.                                                                                                                         |
| D2  | Count sheet = **base set, plus any currency with a non-zero balance**              | You count exactly what is physically in the till; the sheet shrinks again once an exotic currency is spent to zero.                                                                        |
| D3  | **EUR stays `exchange`-only** in `currency_modules`                                | EUR can be exchanged, held, cashed in, and counted — but not tendered in POS/services. Reconfirmed by the owner 2026-08-28: tender stays USD + LBP; Binance/USDT settles 1 USDT = 1 USD; an EUR special case is possible later, other currencies are not. |
| D4  | Plan doc first, then implement                                                     | This document.                                                                                                                                                                             |
| D5  | Layer 1 applies to **all** drawers, not just General                               | Widens D1 on a **different axis**. It does not let other drawers _accept_ new currencies; it only makes money they already hold _countable_. Acceptance stays General-only.                |
| D6  | Settings shows **no General card at all**                                          | Grid = configurable drawers only, plus a footnote so the omission does not read as a missing drawer.                                                                                       |

**The principle, encoded as a named constant:**

> `currency_drawers` is a **provider** constraint. Binance genuinely only holds USDT; MTC/Alfa hold
> USD. **General is the shop's own till and is unbounded.** And separately: **a drawer's countable
> set is never smaller than the money it holds.**

---

## 3. Where the implementation diverged from this plan — read this before trusting the old text

Two things were done differently on purpose. Both were the right call and neither is a bug.

**The countable read lives in `CurrencyRepository`, NOT `ClosingRepository`.** The original plan
said `ClosingRepository`. That was wrong: every input the read needs — `getNonZeroBalancesForDrawer`,
the allowlist query, the drawer-registry union, `isUnrestrictedDrawer` — already lives in
`CurrencyRepository`, so putting it in `ClosingRepository` would have meant re-querying
`drawer_balances` and `currency_drawers` from a second repository. That is exactly the rule-14
duplication this plan argues against elsewhere. Rule 13 (no SQL in services) is satisfied either
way; rule 14 picks the home.

**Item 9 had TWO owners, not one.** The plan named only `ExchangeRepository`'s
`INSERT OR IGNORE INTO currency_drawers`. `DrawerTopUpRepository` had its own independent copy in
the `extra_currencies` loop, which the plan never mentioned — found by a reviewer, not by the plan.
Both are now gone; `ensureCurrency` was KEPT in both (currency_drawers FKs to currencies, and
`exchange_lots` needs the parent row). Lesson for the next "one owner" cleanup: grep for the
behaviour, not just the file the plan happens to name.

---

## 4. Why D1 ("General only" acceptance) has no residual gap

Audited every `applyDrawerDelta` call site whose `currencyCode` is not a `"USD"`/`"LBP"` literal.
An exotic currency can reach **only General**:

| Writer                        | Drawer                       | Currency                                                            |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `ExchangeRepository` inflow   | General — **hardcoded**      | any (`data.fromCurrency`)                                           |
| `ExchangeRepository` payout   | method-mapped                | **USD/LBP only** — split payouts hard-reject a non-USD/LBP target   |
| `DrawerTopUpRepository` extra | `GENERAL_DRAWER` — hardcoded | any                                                                 |
| `WalletExchangeRepository`    | wallet drawer                | **USD/LBP only** — `WalletExchangeService.VALID_CURRENCIES` rejects |
| Service/session/txn legs      | method-mapped                | USD/LBP tender currencies                                           |

Also `payment_methods`: **`CASH → General`**, so a cash payout leg lands in General, not the primary
cash drawer. **Re-open D1 only if** a future change lets a non-USD/LBP currency post to a cash
drawer; that change must add the drawer to `UNRESTRICTED_DRAWERS` in the same commit.

---

## 5. The bug that nearly shipped — keep this in mind on the next currency change

Item 8 was implemented, tested, and green, and it still contained the exact failure this ticket
exists to prevent.

`Checkpoint/index.tsx` took the server's correctly-computed countable set and intersected it against
`useCurrencies()`, which is an **active-only** list:

```ts
const drawerCurrencies = currencies.filter((c) => allowed.includes(c.code)); // WRONG
```

So a currency deactivated in Settings while still holding cash was reported as countable by the
server and then silently dropped by the page — money in the till with no count field, which is the
whole class item 8 was built to close. Core's `getNonZeroBalancesForDrawer` deliberately ignores
`is_active`; the client threw that away.

It is now built by **mapping** the server's codes, with a synthetic fallback entry for a code not in
the active list. Two independent reviewers found it, both by *executing* a scratch test rather than
by reading — reasoning alone had passed it.

**The generalisable lesson:** a correct server-side policy read can be silently undone by a
client-side `.filter` against a narrower list. When a server read is the authority, the client must
render it, not re-derive or re-filter it.

---

## 6. Two bugs this work exposed but did not cause

**Web currency symbols (fixed, in `35308852`).** `CurrencyProvider` was mounted ABOVE `AuthProvider`
and loaded once on mount. In web mode `GET /api/currencies` is JWT-gated, so the boot-time fetch
401ed, `currencies` stayed empty forever, and `getSymbol` fell back to the code — EVERY amount in
the web app rendered as `2050.00 USD` instead of `$2,050.00`. Desktop was unaffected (IPC needs no
JWT). Fixed by moving the provider inside `AuthProvider` and gating the load on `isAuthenticated`,
plus holding `api` in a ref so the callback identity is stable regardless of the adapter's. The
`lira-web-026` spec was the first web spec ever to assert a rendered currency symbol, which is why
this survived so long.

**e2e local-day mismatch (fixed, in `526eba3f`).** `lira-web-010` compared a UTC-derived
`toISOString().split("T")[0]` against `daily_closings.closing_date`, which the server stamps with
`localDay()`. Beirut is UTC+3, so the spec was broken for a 3-hour window every night (00:00–03:00
local) and fine the rest of the day. Two consecutive runs happened to land inside the window, which
made a clock artifact look like a regression. `seedExpense` in `e2e-electron/helpers/seed.ts` had
the same defect. Both e2e directories were swept; the other eleven `toISOString()`-derived dates are
correct as they stand.

---

## 7. Follow-ups this work spawned — NOT part of it

- **`DRAWER_TOPUP` is blanket non-reversible.** `voidTransaction`/`refundTransaction` refuse it at
  the type-level `NON_REVERSIBLE_TRANSACTION_TYPES` gate — deliberate, since extra-currency top-ups
  also write `exchange_lots` rows a generic void would never unwind. `5dc343e4` gave it a manual
  correction path (extra-currency cash-out) rather than changing the gate. Correcting a mistaken
  foreign-currency top-up still takes two manual steps: the cash-out fixes `drawer_balances` and
  `payments`, the existing admin exchange-lot adjustment fixes the lot ledger.
- **`SalesRepository.ts:820-822` uses a UTC day against an app-wide local-day convention.** IMEI
  warranty computes `(sale.transaction_time ?? new Date().toISOString()).slice(0, 10)`. The
  `lira-143`/`lira-web-023` specs currently mirror the wrong convention to stay green. Fixing it is
  a core change plus updated specs plus a jest guard — its own ticket.
- **No tsconfig covers `frontend/tests/e2e-web/`.** A bad import there is caught by nothing in
  `yarn typecheck`; verifying `526eba3f` required building a throwaway config.
- **`ProductSearch.tsx:285`** round-trips a date through local getters then `toISOString()`. Safe
  only because Beirut's offset is positive; it would drift a day on a negative-offset machine.

---

## 8. Non-goals (unchanged)

- Widening `currency_modules` (EUR as a POS/services tender) — D3. Blocked anyway on
  `reconcileLegs` / `expectedTotalIn` being USD/LBP-native.
- Unrestricting provider drawers' **acceptance** — those constraints are real (D1/D5).
- Any schema change. This was read policy throughout; no migration was added.
- **Deferred, named:** the honest long-term model is a real `drawers` table (`name`, `label`,
  `is_restricted`, `sort_order`) consolidating the five duplicated drawer lists
  (`PRIMARY_CASH_DRAWER_NAMES`, `CARRIER_DRAWER_NAMES`, `WalletDrawerName`, the static list at
  `SalesRepository.ts:1513`, the frontend's `DRAWER_LABELS`). That is a migration plus every drawer
  consumer — its own project. The `currency_drawers ∪ drawer_balances` registry union shipped in
  Phase 1 is the cheap structural fix that makes the trap harmless in the meantime.
