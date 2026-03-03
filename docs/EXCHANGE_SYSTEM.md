# Exchange System — Complete Technical Reference

**Last Updated**: March 1, 2026  
**Status**: ✅ Production Ready  
**Supported Currencies**: USD (base), LBP, EUR — extensible to N currencies

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Rate Storage Model](#2-rate-storage-model)
3. [Universal Rate Formula](#3-universal-rate-formula)
4. [Conversion Logic](#4-conversion-logic)
5. [Cross-Currency Exchanges](#5-cross-currency-exchanges)
6. [Profit Calculation](#6-profit-calculation)
7. [Database Schema](#7-database-schema)
8. [Adding New Currencies](#8-adding-new-currencies)
9. [UI — Exchange Module](#9-ui--exchange-module)
10. [Drawer Balances](#10-drawer-balances)
11. [Key Files Reference](#11-key-files-reference)
12. [Validation Checklist](#12-validation-checklist)

---

## 1. Architecture Overview

**USD is the universal base/pivot currency.** Every exchange routes through USD:

- **Direct exchanges** (X ↔ USD): 1 leg, 1 profit
- **Cross-currency exchanges** (X ↔ Y, neither is USD): 2 legs via USD, 2 profits

No rates between non-USD pairs are stored — everything is derived from each currency's rate vs USD. Adding a new currency requires **one DB row and zero code changes**.

```
Customer gives EUR → Leg 1: EUR→USD → Leg 2: USD→LBP → Customer gets LBP
                     profit 1           profit 2
```

**Core implementation**: `packages/core/src/utils/currencyConverter.ts`

---

## 2. Rate Storage Model

One row per non-USD currency in `exchange_rates`:

| Column        | Type        | Description                                                                                                                |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| `to_code`     | TEXT UNIQUE | Non-USD currency code (e.g. `LBP`, `EUR`, `GBP`)                                                                           |
| `market_rate` | REAL        | Fair mid-market rate                                                                                                       |
| `delta`       | REAL        | Half-spread — buy/sell rates deviate from market by this amount                                                            |
| `is_stronger` | INTEGER     | `+1` if USD is stronger (rate = units per 1 USD, e.g. LBP); `-1` if currency is stronger (rate = USD per 1 unit, e.g. EUR) |

**Example rows:**

| to_code | market_rate | delta | is_stronger | Meaning                                            |
| ------- | ----------- | ----- | ----------- | -------------------------------------------------- |
| LBP     | 89500       | 500   | 1           | 1 USD = 89,500 LBP at market; buy/sell spread ±500 |
| EUR     | 1.18        | 0.02  | -1          | 1 EUR = 1.18 USD at market; buy/sell spread ±0.02  |

---

## 3. Universal Rate Formula

```
rate = market_rate + is_stronger × (action × delta)
```

**`action`** represents our USD cash flow direction:

- `GIVE_USD = +1` — we give USD out (buying customer's non-USD currency)
- `TAKE_USD = -1` — we receive USD in (selling our non-USD currency to customer)

### Truth Table — All Direct Pairs

| Transaction                    | is_stronger | action        | Calculation           | Effective Rate     |
| ------------------------------ | ----------- | ------------- | --------------------- | ------------------ |
| USD → LBP (give LBP, take USD) | +1          | TAKE_USD (-1) | 89500 + 1×(−1×500)    | **89,000** LBP/USD |
| LBP → USD (give USD, take LBP) | +1          | GIVE_USD (+1) | 89500 + 1×(+1×500)    | **90,000** LBP/USD |
| EUR → USD (give USD, take EUR) | -1          | GIVE_USD (+1) | 1.18 + (−1)×(+1×0.02) | **1.16** USD/EUR   |
| USD → EUR (give EUR, take USD) | -1          | TAKE_USD (-1) | 1.18 + (−1)×(−1×0.02) | **1.20** USD/EUR   |

Every result is less favourable than market for the customer — the business always profits on the spread.

---

## 4. Conversion Logic

### convertToUSD — From non-USD → USD

```typescript
// action = GIVE_USD (+1): we give USD to customer for their currency
rate = market_rate + is_stronger × (+1 × delta)

// LBP (is_stronger=+1): divide by rate
amountUSD = amount / rate    // e.g. 90,000 LBP ÷ 90,000 = 1 USD

// EUR (is_stronger=-1): multiply by rate
amountUSD = amount × rate    // e.g. 10 EUR × 1.16 = 11.6 USD
```

### convertFromUSD — From USD → non-USD

```typescript
// action = TAKE_USD (-1): we receive USD and give out this currency
rate = market_rate + is_stronger × (-1 × delta)

// LBP (is_stronger=+1): multiply by rate
amountOut = amountUSD × rate    // e.g. 1 USD × 89,000 = 89,000 LBP

// EUR (is_stronger=-1): divide by rate
amountOut = amountUSD / rate    // e.g. 1.20 USD ÷ 1.20 = 1 EUR
```

---

## 5. Cross-Currency Exchanges

For any pair where neither currency is USD, we route through USD in 2 legs:

```
Leg 1: FROM_CURRENCY → USD  (GIVE_USD action)
Leg 2: USD → TO_CURRENCY    (TAKE_USD action)
```

### Example: EUR → LBP (customer gives 10 EUR, wants LBP)

```
Leg 1: EUR → USD
  action = GIVE_USD (+1)
  rate   = 1.18 + (−1)×(+1×0.02) = 1.16 USD/EUR
  amountUSD = 10 × 1.16 = 11.60 USD
  leg1_profit = 10 × 0.02 = $0.20 USD

Leg 2: USD → LBP
  action = TAKE_USD (-1)
  rate   = 89500 + 1×(−1×500) = 89,000 LBP/USD
  amountLBP = 11.60 × 89,000 = 1,032,400 LBP
  leg2_profit = 11.60 × 500 / 89,500 = $0.065 USD

Total: 10 EUR → 1,032,400 LBP | Total profit: $0.265 USD
via_currency: 'USD'
```

### Example: LBP → EUR (customer gives 1,000,000 LBP, wants EUR)

```
Leg 1: LBP → USD
  rate      = 89500 + 1×(+1×500) = 90,000 LBP/USD
  amountUSD = 1,000,000 / 90,000 = 11.111 USD
  leg1_profit = 11.111 × 500 / 89,500 = $0.062 USD

Leg 2: USD → EUR
  rate      = 1.18 + (−1)×(−1×0.02) = 1.20 USD/EUR
  amountEUR = 11.111 / 1.20 = 9.259 EUR
  leg2_profit = 11.111 × 0.02 = $0.222 USD

Total: 1,000,000 LBP → 9.259 EUR | Total profit: $0.284 USD
```

---

## 6. Profit Calculation

Profit is always in USD, calculated per leg:

### LBP-like currencies (`is_stronger = +1`)

```
profit_usd = amount_usd_transacted × delta / market_rate
           = (amountIn / market_rate) × delta
```

### EUR-like currencies (`is_stronger = -1`)

```
profit_usd = amount_in_currency × delta
```

### Cross-currency total

```
total_profit_usd = leg1_profit_usd + leg2_profit_usd
```

**Key invariants:**

- Profit is always `> 0` when `delta > 0` and rates are valid
- `total_profit_usd = leg1_profit_usd + (leg2_profit_usd ?? 0)`
- Rate captured at transaction time is immutable (stored in `leg1_rate`/`leg2_rate`)

### Profit SQL Queries

```sql
-- Daily exchange profit (v30+ schema)
SELECT
  SUM(COALESCE(leg1_profit_usd, 0) + COALESCE(leg2_profit_usd, 0)) AS profit_usd,
  COUNT(*) AS count
FROM exchange_transactions
WHERE DATE(created_at, 'localtime') = DATE('now', 'localtime');

-- Profit by currency pair
SELECT
  from_currency, to_currency,
  COUNT(*) AS count,
  SUM(COALESCE(leg1_profit_usd, 0) + COALESCE(leg2_profit_usd, 0)) AS profit_usd
FROM exchange_transactions
GROUP BY from_currency, to_currency
ORDER BY profit_usd DESC;
```

---

## 7. Database Schema

### exchange_rates (v30)

```sql
CREATE TABLE exchange_rates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  to_code     TEXT    NOT NULL UNIQUE,
  market_rate REAL    NOT NULL,
  delta       REAL    NOT NULL DEFAULT 0,
  is_stronger INTEGER NOT NULL DEFAULT 1 CHECK(is_stronger IN (1, -1)),
  updated_at  TEXT    DEFAULT (datetime('now'))
);

-- Seed data:
INSERT INTO exchange_rates (to_code, market_rate, delta, is_stronger) VALUES
  ('LBP', 89500, 500,  1),
  ('EUR', 1.18,  0.02, -1);
```

### exchange_transactions (v30 — leg tracking columns)

```sql
-- Core columns (all versions)
id, type, from_currency, to_currency, amount_in, amount_out
rate, base_rate, profit_usd  -- legacy backward-compat columns

-- Leg tracking (v30+)
leg1_rate        REAL    -- actual rate used for leg 1
leg1_market_rate REAL    -- market rate for leg 1 (audit)
leg1_profit_usd  REAL    -- profit on leg 1 in USD
leg2_rate        REAL    -- actual rate for leg 2 (cross-currency only)
leg2_market_rate REAL    -- market rate for leg 2
leg2_profit_usd  REAL    -- profit on leg 2 in USD
via_currency     TEXT    -- 'USD' for cross-currency, NULL for direct
```

---

## 8. Adding New Currencies

Adding GBP (or any currency) requires **one DB row and zero code changes**:

```sql
-- GBP is stronger than USD (1 GBP = 1.28 USD at market)
INSERT INTO exchange_rates (to_code, market_rate, delta, is_stronger)
VALUES ('GBP', 1.28, 0.03, -1);
```

This immediately enables:

- ✅ GBP ↔ USD (direct, 1 leg)
- ✅ GBP ↔ LBP (cross-currency via USD, 2 legs, 2 profits)
- ✅ GBP ↔ EUR (cross-currency via USD, 2 legs, 2 profits)

**`is_stronger` guide:**

- `+1` — Weaker than USD (rate = units per 1 USD): LBP, TRY, SYP
- `-1` — Stronger than USD (rate = USD per 1 unit): EUR, GBP, CHF

In Settings → Rates Manager: enter `to_code`, `market_rate`, `delta`, and strength.

---

## 9. UI — Exchange Module

**File**: `frontend/src/features/exchange/pages/Exchange/index.tsx`

### Features

- Currency selectors for FROM and TO (all active currencies)
- Swap button to reverse the pair
- **Editable rate inputs** per leg — user can override for special/custom rates
  - Override is per-transaction only — never saved to DB
  - Amber highlight when custom rate is active
  - `↺` reset button to restore DB default
- **Cross-currency leg breakdown** panel (amber border):
  - Shows Leg 1 and Leg 2 with rates, amounts, and per-leg profit
  - Rate label includes currency units (e.g. `89,000 LBP per USD`)
- **Direct exchange**: single editable rate with live profit preview
- **Profit sanity warning**: shown if profit > 10% of input (amber banner, blocks submit)
- Client name field (optional, pre-filled from active session)
- History table with `via USD` badge for cross-currency transactions

### Rate Calculation Flow

```
1. Load rates from DB (getRates())
2. calculateExchange(from, to, amount, rates) → ExchangeResult
3. User may override leg rate(s) via input fields
4. applyCustomRates(baseResult) → effectiveResult
5. On confirm: send effectiveResult leg data to backend
```

### Settings → Rates Manager

**File**: `frontend/src/features/settings/pages/Settings/RatesManager.tsx`

- Add/edit/delete currency rates using new 4-column model
- Live buy/sell/spread preview when editing
- Spread cards showing effective buy and sell rates per currency

---

## 10. Drawer Balances

The `drawer_balances` table tracks actual currency balances per drawer. Exchange transactions automatically update balances:

- **Outflow**: customer gives `fromCurrency` → `drawer_balances` decremented
- **Inflow**: customer receives `toCurrency` → `drawer_balances` incremented

The Dashboard shows **all currencies with non-zero balance** automatically — EUR, GBP, or any currency appears as soon as a transaction involving it occurs.

---

## 11. Key Files Reference

| File                                                                | Purpose                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/core/src/utils/currencyConverter.ts`                      | ⭐ Core formula, `calculateExchange()`, profit calculation |
| `packages/core/src/utils/__tests__/currencyConverter.test.ts`       | 53 unit tests covering all pairs                           |
| `packages/core/src/repositories/RateRepository.ts`                  | Rate DB access (4-column schema)                           |
| `packages/core/src/repositories/ExchangeRepository.ts`              | Exchange transaction storage with leg tracking             |
| `packages/core/src/services/ExchangeService.ts`                     | Orchestrates calculation → storage                         |
| `packages/core/src/services/ProfitService.ts`                       | Aggregates leg profits for reporting                       |
| `packages/core/src/db/migrations/index.ts`                          | Migration v30: new schema                                  |
| `electron-app/handlers/rateHandlers.ts`                             | IPC handlers for rate CRUD                                 |
| `electron-app/handlers/exchangeHandlers.ts`                         | IPC handlers for exchange transactions                     |
| `electron-app/create_db.sql`                                        | Fresh DB schema + seed rates                               |
| `frontend/src/features/exchange/pages/Exchange/index.tsx`           | Exchange UI with custom rate override                      |
| `frontend/src/features/settings/pages/Settings/RatesManager.tsx`    | Rate management UI                                         |
| `frontend/src/features/settings/pages/Settings/CurrencyManager.tsx` | Currency management UI                                     |
| `frontend/src/features/dashboard/pages/Dashboard.tsx`               | Drawer balance display                                     |
| `packages/core/src/browser.ts`                                      | Browser-safe entry point for frontend imports              |

---

## 12. Validation Checklist

Before any exchange is processed:

- [ ] Both currencies exist in the system
- [ ] Rate row exists for all non-USD currencies involved
- [ ] `delta > 0` (spread must be positive)
- [ ] `market_rate > 0`
- [ ] `is_stronger` is exactly `1` or `-1`
- [ ] `amountIn > 0`
- [ ] Calculated `profit_usd > 0` (sanity check)
- [ ] Profit < 10% of input USD equivalent (warn if exceeded)

**UI Display Validation:**

- [x] Leg rates show currency labels (e.g. `89,000 LBP per USD`, `1.16 USD per EUR`)
- [x] Leg amounts show from/to currency codes
- [x] Profit always labeled in USD
- [x] Warning shown if profit > 10% of input

---

## Archive

Historical planning documents are preserved in `docs/archive/`:

- `MULTI_CURRENCY_EXCHANGE_PLAN.md` — original multi-currency planning (old schema)
- `EXCHANGE_HISTORY.md` — all refactor plans, sprint notes, phase completions

_See also: `docs/DATABASE_MIGRATIONS.md` for migration v30 details._
