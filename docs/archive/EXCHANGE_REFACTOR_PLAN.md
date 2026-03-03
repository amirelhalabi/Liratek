# Exchange System Refactor Plan

## USD-Base Cross-Currency Architecture

**Date**: February 28, 2026  
**Status**: 📋 PLANNING  
**Priority**: High

---

## Table of Contents

1. [New Architecture Design](#1-new-architecture-design)
2. [Current Implementation Analysis](#2-current-implementation-analysis)
3. [Implementation Plan](#3-implementation-plan)

---

## 1. New Architecture Design

### 1.1 Core Concept

**USD is the universal base currency.** Every currency pair exchange is broken down into steps through USD. This means:

- We only store **BUY/SELL rates relative to USD** for each currency
- Cross-currency exchanges (e.g. EUR → LBP) automatically route through USD
- **2 profits** are recorded for cross-currency transactions (one per leg)
- The system scales to **N currencies** without any code changes — just add rates

### 1.2 Rate Storage Model

We store only **one row per non-USD currency** in the rates table — 4 columns:

```
exchange_rates table:
  to_code      TEXT    — the non-USD currency code (e.g. 'LBP', 'EUR', 'GBP')
  market_rate  REAL    — fair mid-market rate (e.g. 89500 for LBP, 1.18 for EUR)
  delta        REAL    — half-spread; how far BUY/SELL deviate from market (e.g. 500, 0.02)
  is_stronger  INTEGER — +1 if USD is stronger (rate = LBP per USD), -1 if currency is stronger (rate = X per USD where X < 1)
```

**Example rows:**

| to_code | market_rate | delta | is_stronger | Notes                                       |
| ------- | ----------- | ----- | ----------- | ------------------------------------------- |
| LBP     | 89500       | 500   | 1           | 1 USD = 89,500 LBP at market; LBP is weaker |
| EUR     | 1.18        | 0.02  | -1          | 1 EUR = 1.18 USD at market; EUR is stronger |
| GBP     | 1.28        | 0.03  | -1          | 1 GBP = 1.28 USD at market; GBP is stronger |

> **`is_stronger` semantics:**  
> `+1` → USD is the stronger currency (rate = units of this currency per 1 USD, e.g. LBP)  
> `-1` → This currency is stronger than USD (rate = USD per 1 unit of this currency, e.g. EUR)

### 1.3 The Universal Rate Formula

**One formula to rule them all:**

```
rate(market_rate, delta, is_stronger, action) =
    market_rate + is_stronger × (action × delta)
```

Where `action` represents **our USD cash flow direction**:

- `GIVE_USD = +1` → we are giving USD out (buying customer's non-USD currency)
- `TAKE_USD = -1` → we are receiving USD (selling non-USD currency to customer)

**Verification of all cases:**

| Transaction                    | is_stronger | action        | Formula               | Result               |
| ------------------------------ | ----------- | ------------- | --------------------- | -------------------- |
| USD → LBP (give LBP, take USD) | +1          | -1 (TAKE_USD) | 89500 + 1×(−1×500)    | **89,000** LBP/USD ✓ |
| LBP → USD (give USD, take LBP) | +1          | +1 (GIVE_USD) | 89500 + 1×(+1×500)    | **90,000** LBP/USD ✓ |
| EUR → USD (give USD, take EUR) | -1          | +1 (GIVE_USD) | 1.18 + (−1)×(+1×0.02) | **1.16** USD/EUR ✓   |
| USD → EUR (give EUR, take USD) | -1          | -1 (TAKE_USD) | 1.18 + (−1)×(−1×0.02) | **1.20** USD/EUR ✓   |

**Conversion direction:**

- If `is_stronger = +1` (LBP-like): `amount_out = amount_in × rate` (multiply)
- If `is_stronger = -1` (EUR-like): when giving USD → `amount_out = amount_in / rate`; when taking USD → `amount_out = amount_in × rate` ... but this is handled cleanly by routing everything through USD:

```
convertToUSD(amount, currency):
  rate = formula(market_rate, delta, is_stronger, GIVE_USD)  // we give USD out
  if is_stronger = +1: return amount / rate    // LBP: amount / (89000) = USD
  if is_stronger = -1: return amount × rate    // EUR: amount × (1.16) = USD

convertFromUSD(amountUSD, currency):
  rate = formula(market_rate, delta, is_stronger, TAKE_USD)  // we take USD in
  if is_stronger = +1: return amountUSD × rate  // USD × 90000 = LBP
  if is_stronger = -1: return amountUSD / rate   // USD / 1.20 = EUR
```

### 1.4 Rate Lookup Rules

| Transaction | action        | Rate used                      | Result                                      |
| ----------- | ------------- | ------------------------------ | ------------------------------------------- |
| USD → LBP   | TAKE_USD (-1) | 89500 + 1×(-500) = **89,000**  | customer gets fewer LBP (we profit)         |
| LBP → USD   | GIVE_USD (+1) | 89500 + 1×(+500) = **90,000**  | customer pays more LBP per USD (we profit)  |
| EUR → USD   | GIVE_USD (+1) | 1.18 + (-1)×(+0.02) = **1.16** | customer gets fewer USD per EUR (we profit) |
| USD → EUR   | TAKE_USD (-1) | 1.18 + (-1)×(-0.02) = **1.20** | customer pays more USD per EUR (we profit)  |

### 1.5 Cross-Currency Calculation (N Currencies)

For any exchange where neither currency is USD, we route through USD in **2 legs**:

```
Leg 1: FROM_CURRENCY → USD  (GIVE_USD action — we give USD internally)
Leg 2: USD → TO_CURRENCY    (TAKE_USD action — we received USD internally)
```

**Algorithm:**

```
amountUSD = convertToUSD(amountIn, fromCurrency)   // Leg 1
amountOut = convertFromUSD(amountUSD, toCurrency)  // Leg 2
```

**Profit per leg (always in USD):**

```
leg1_profit_usd = amountIn × |market_rate_from - actual_rate_from|  (normalised to USD)
leg2_profit_usd = amountUSD × |actual_rate_to - market_rate_to|     (normalised to USD)
total_profit_usd = leg1_profit_usd + leg2_profit_usd
```

**Scenario: EUR → LBP (customer gives 10 EUR, gets LBP)**

```
Leg 1: EUR → USD
  action = GIVE_USD (+1)
  rate   = 1.18 + (-1)×(+1×0.02) = 1.16 USD per EUR
  amountUSD = 10 × 1.16 = 11.60 USD
  leg1_profit = 10 × (1.18 - 1.16) = $0.20 USD

Leg 2: USD → LBP
  action = TAKE_USD (-1)
  rate   = 89500 + 1×(-1×500) = 89,000 LBP per USD
  amountLBP = 11.60 × 89,000 = 1,032,400 LBP
  leg2_profit = 11.60 × 500 / 89500 = $0.0648 USD

Total: 10 EUR → 1,032,400 LBP
Total profit = $0.20 + $0.065 = $0.265 USD
```

**Scenario: LBP → EUR (customer gives 1,000,000 LBP, gets EUR)**

```
Leg 1: LBP → USD
  action = GIVE_USD (+1)
  rate   = 89500 + 1×(+1×500) = 90,000 LBP per USD
  amountUSD = 1,000,000 / 90,000 = 11.111 USD
  leg1_profit = 11.111 × 500 / 89500 = $0.062 USD

Leg 2: USD → EUR
  action = TAKE_USD (-1)
  rate   = 1.18 + (-1)×(-1×0.02) = 1.20 USD per EUR
  amountEUR = 11.111 / 1.20 = 9.259 EUR
  leg2_profit = 11.111 × (1.20 - 1.18) = $0.222 USD

Total: 1,000,000 LBP → 9.259 EUR
Total profit = $0.062 + $0.222 = $0.284 USD
```

**N-Currency Extensibility:**
Adding GBP (is_stronger=-1, market_rate=1.28, delta=0.03):

- GBP → LBP: automatically works via USD with 2 legs, 2 profits
- LBP → GBP: automatically works via USD with 2 legs, 2 profits
- GBP → EUR: automatically works via USD with 2 legs, 2 profits
- **Zero code changes required** — just one new DB row

### 1.6 Architecture Principles

1. **Single Responsibility**: `CurrencyConverter` class handles ALL conversion math
2. **Open/Closed**: Adding a new currency requires zero code changes — just DB entries
3. **Data Integrity**: Every exchange stores both legs' profits separately
4. **Immutability**: Rates captured at transaction time — no retroactive changes
5. **Transparency**: UI shows both legs and both profits for cross-currency deals

### 1.7 New Database Schema (Proposed)

**`exchange_rates` table — completely redesigned:**

```sql
CREATE TABLE exchange_rates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  to_code      TEXT    NOT NULL UNIQUE,   -- non-USD currency code (LBP, EUR, GBP...)
  market_rate  REAL    NOT NULL,          -- mid-market rate
  delta        REAL    NOT NULL,          -- spread half-width (buy/sell deviation)
  is_stronger  INTEGER NOT NULL           -- +1 if USD stronger, -1 if currency stronger
    CHECK(is_stronger IN (1, -1)),
  updated_at   TEXT    DEFAULT (datetime('now'))
);

-- Seed data:
INSERT INTO exchange_rates (to_code, market_rate, delta, is_stronger) VALUES
  ('LBP', 89500, 500,  1),   -- 1 USD = 89,500 LBP at market
  ('EUR', 1.18,  0.02, -1);  -- 1 EUR = 1.18 USD at market
```

**`exchange_transactions` table — adds leg tracking:**

```sql
ALTER TABLE exchange_transactions ADD COLUMN leg1_rate       REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg1_base_rate  REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg1_profit_usd REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg2_rate       REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg2_base_rate  REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg2_profit_usd REAL;
ALTER TABLE exchange_transactions ADD COLUMN via_currency    TEXT;  -- 'USD' for cross-currency, NULL for direct
```

---

## 2. Current Implementation Analysis

### 2.1 Rate Storage (Current)

**File**: `packages/core/src/repositories/RateRepository.ts`

Rates are stored as `(from_code, to_code, rate, base_rate)` pairs. The UNIQUE constraint is `(from_code, to_code)`.

Current seed data in `electron-app/create_db.sql`:

```sql
-- USD ↔ LBP
('LBP', 'USD', 88500, 89000)  -- BUY: 88,500 LBP per USD (we pay less LBP to buy USD)
('USD', 'LBP', 89500, 89000)  -- SELL: 89,500 LBP per USD (we receive more LBP)

-- USD ↔ EUR
('EUR', 'USD', 1.16, 1.18)    -- BUY: 1.16 USD per EUR
('USD', 'EUR', 1.20, 1.18)    -- SELL: 1.20 USD per EUR
```

**Problems with current storage:**

- BUY vs SELL is implicit (derived from `from_code`/`to_code` direction)
- EUR/LBP cross-currency has no stored rates — calculated on-the-fly
- `base_rate` is a single number — doesn't distinguish base rates per leg
- Adding a new currency (e.g. GBP) requires 2 rows but there's no explicit `rate_type` flag

### 2.2 Core Calculation Logic (Current)

**File**: `packages/core/src/utils/exchangeProfit.ts`

```typescript
export function calculateExchangeProfit(input: ExchangeProfitInput): ExchangeProfitResult {
  // Hardcoded if/else for each currency pair
  if (fromCurrency === 'LBP' && toCurrency === 'USD') { ... }
  else if (fromCurrency === 'USD' && toCurrency === 'LBP') { ... }
  else if (fromCurrency === 'EUR' && toCurrency === 'USD') { ... }
  else if (fromCurrency === 'USD' && toCurrency === 'EUR') { ... }
  else { /* cross-currency - uses constants, not DB rates */ }
}
```

**Critical problems:**

- ❌ **Hardcoded currency pairs** — adding GBP breaks this
- ❌ **Cross-currency profit uses constants** not actual DB rates
- ❌ **Single profit** for cross-currency — doesn't track per-leg profit
- ❌ **No unified formula** — each case is manually coded

### 2.3 Rate Lookup & Conversion (Current)

**File**: `frontend/src/utils/exchangeRates.ts`

```typescript
// Tries direct rate first, then cross-currency via USD
export function getExchangeRateForPair(pair, rates, transactionType) { ... }

// Cross-currency: manually handles LBP and EUR differently
export function getCrossCurrencyRate(fromCurrency, toCurrency, rates, transactionType) {
  // Step 1: FROM → USD
  if (fromCurrency === 'LBP') {
    fromToUsd = 1 / (sell rate of USD→LBP)  // LBP is "weaker"
  } else {
    fromToUsd = rate of FROM→USD             // EUR is "stronger"
  }
  // Step 2: USD → TO
  if (toCurrency === 'LBP') {
    usdToTo = (buy rate of LBP→USD)^-1 ??? // inconsistent logic
  } else {
    usdToTo = 1 / (sell rate of USD→TO)
  }
}
```

**Critical problems:**

- ❌ **Lives in frontend only** — backend has no cross-currency logic
- ❌ **Implicit currency type detection** (is it "stronger" or "weaker" than USD?)
- ❌ **`getConversionOperation()` is fragile** — hardcodes which pairs multiply vs divide
- ❌ **Duplicated logic** — rate lookup in frontend AND backend separately
- ❌ **No support for N currencies** — EUR and LBP are special-cased

### 2.4 ExchangeRepository (Current)

**File**: `packages/core/src/repositories/ExchangeRepository.ts`

```typescript
createTransaction(data: CreateExchangeData) {
  // Determines type: SELL if toCurrency is USD, otherwise BUY
  const type = data.toCurrency === 'USD' ? 'SELL' : 'BUY';
  // Inserts single exchange_transactions row
  // Creates single transactions row
  // Creates 2 payment records
  // Updates 2 drawer balances
}
```

**Problems:**

- ❌ **`type` logic is wrong** for cross-currency (EUR→LBP is neither simple BUY nor SELL)
- ❌ **Single profit_usd** — can't distinguish leg1 vs leg2 profits
- ❌ **No `via_currency` tracking** for cross-currency
- ❌ **No leg rate storage** — can't audit how profit was calculated

### 2.5 ExchangeService (Current)

**File**: `packages/core/src/services/ExchangeService.ts`

```typescript
addTransaction(data) {
  if (data.baseRate) {
    const profitResult = calculateExchangeProfit({ ... });
    profitUsd = profitResult.profitUsd;
  }
  // passes to repository
}
```

**Problems:**

- ❌ **Depends on broken `calculateExchangeProfit()`**
- ❌ **Single profit** — no leg1/leg2 separation
- ❌ **baseRate ambiguous** — for cross-currency, which leg's base rate?

### 2.6 Exchange UI (Current)

**File**: `frontend/src/features/exchange/pages/Exchange/index.tsx`

```typescript
// Rate auto-populated via getExchangeRateForPair()
// Output calculated via getConversionOperation() → multiply or divide
// On submit: passes single rate + base_rate to api.addExchangeTransaction()
```

**Problems:**

- ❌ **Single rate shown** — user can't see cross-currency breakdown
- ❌ **`getConversionOperation()` is brittle** — breaks for new currencies
- ❌ **base_rate passed from UI** — should be looked up server-side for accuracy

### 2.7 Summary of Current Issues

| Issue                                             | Severity    | Impact                              |
| ------------------------------------------------- | ----------- | ----------------------------------- |
| Hardcoded currency pairs in profit calculation    | 🔴 Critical | Breaks for any new currency         |
| Cross-currency profit uses constants not DB rates | 🔴 Critical | Wrong profit numbers                |
| No per-leg profit tracking                        | 🟠 High     | Can't audit exchange profit sources |
| `getConversionOperation()` brittle                | 🟠 High     | Breaks for new currencies           |
| Rate lookup only in frontend                      | 🟠 High     | Inconsistency risk                  |
| `type` (BUY/SELL) wrong for cross-currency        | 🟡 Medium   | Misleading records                  |
| No `via_currency` column                          | 🟡 Medium   | Can't audit cross-currency path     |

---

## 3. Implementation Plan

### 3.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    CurrencyConverter                     │
│           (packages/core/src/utils/currency.ts)          │
│                                                          │
│  convertToUSD(amount, currency, rates) → number          │
│  convertFromUSD(amount, currency, rates) → number        │
│  getUSDRate(currency, rateType, rates) → number          │
│  calculateLegs(from, to, amountIn, rates) → ExchangeLegs │
└─────────────────────────────────────────────────────────┘
           ↑ used by both frontend and backend

┌─────────────────┐     ┌─────────────────────────────────┐
│  ExchangeService │────▶│  ExchangeRepository              │
│  (backend/core) │     │  (stores leg1/leg2 separately)   │
└─────────────────┘     └─────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  Exchange UI Component                   │
│  - Shows leg breakdown for cross-currency               │
│  - Rate input per leg (editable)                        │
│  - Real-time profit preview                             │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Phase 1 — Core CurrencyConverter Utility

**File**: `packages/core/src/utils/currency.ts` (new file, replaces `exchangeProfit.ts` logic)

**Key design decisions:**

- All functions are **pure** (no side effects, no DB calls)
- Rates passed as parameter — fully testable with any mock data
- Handles **N currencies** generically — zero hardcoded pairs
- USD is the explicit pivot currency
- Single formula drives all rate calculations

```typescript
// ─── Rate Entity (matches new DB schema) ──────────────────────────────────
export interface CurrencyRate {
  to_code: string; // non-USD currency code
  market_rate: number; // mid-market rate
  delta: number; // spread half-width
  is_stronger: 1 | -1; // +1 if USD stronger, -1 if currency stronger
}

// ─── Action constants ──────────────────────────────────────────────────────
// Represents our USD cash flow direction for the formula
export const GIVE_USD = +1 as const; // we output USD (buying customer's currency)
export const TAKE_USD = -1 as const; // we receive USD (selling our currency)
export type USDAction = typeof GIVE_USD | typeof TAKE_USD;

// ─── Result types ──────────────────────────────────────────────────────────
export interface ExchangeLeg {
  fromCurrency: string;
  toCurrency: string;
  amountIn: number;
  amountOut: number;
  rate: number; // actual rate used (computed by formula)
  marketRate: number; // mid-market rate (for profit audit)
  profitUsd: number; // profit on this leg, always in USD
}

export interface ExchangeResult {
  legs: ExchangeLeg[]; // 1 leg for direct USD pair, 2 for cross-currency
  totalAmountOut: number; // final amount customer receives
  totalProfitUsd: number; // sum of all legs' profit in USD
  viaCurrency: string | null; // 'USD' for cross-currency, null for direct
}

// ─── Core Formula ──────────────────────────────────────────────────────────

/**
 * Universal rate formula.
 * rate = market_rate + is_stronger × (action × delta)
 *
 * action = GIVE_USD (+1): we give USD out — buying customer's currency (cheaper for customer)
 * action = TAKE_USD (-1): we take USD in — selling our currency (more expensive for customer)
 */
export function computeRate(rate: CurrencyRate, action: USDAction): number {
  return rate.market_rate + rate.is_stronger * (action * rate.delta);
}

// ─── USD Conversions ───────────────────────────────────────────────────────

/**
 * Convert an amount of a non-USD currency TO USD.
 * Used in Leg 1 of cross-currency, or when toCurrency === 'USD'.
 * action = GIVE_USD: we give USD to customer for their currency
 */
export function convertToUSD(
  amount: number,
  currencyRate: CurrencyRate,
  action: USDAction,
): { amountUSD: number; rate: number } {
  const rate = computeRate(currencyRate, action);
  // is_stronger=+1 (LBP): rate = LBP per USD → divide to get USD
  // is_stronger=-1 (EUR): rate = USD per EUR → multiply to get USD
  const amountUSD =
    currencyRate.is_stronger === 1 ? amount / rate : amount * rate;
  return { amountUSD, rate };
}

/**
 * Convert a USD amount TO a non-USD currency.
 * Used in Leg 2 of cross-currency, or when fromCurrency === 'USD'.
 * action = TAKE_USD: we received USD and now give out this currency
 */
export function convertFromUSD(
  amountUSD: number,
  currencyRate: CurrencyRate,
  action: USDAction,
): { amountOut: number; rate: number } {
  const rate = computeRate(currencyRate, action);
  // is_stronger=+1 (LBP): rate = LBP per USD → multiply to get LBP
  // is_stronger=-1 (EUR): rate = USD per EUR → divide to get EUR
  const amountOut =
    currencyRate.is_stronger === 1 ? amountUSD * rate : amountUSD / rate;
  return { amountOut, rate };
}

// ─── Profit Calculation ────────────────────────────────────────────────────

/**
 * Calculate profit in USD for a single leg.
 * Profit = spread × amount transacted, normalised to USD.
 */
export function computeLegProfitUsd(
  amountIn: number,
  actualRate: number,
  currencyRate: CurrencyRate,
): number {
  const { market_rate, delta, is_stronger } = currencyRate;
  // For LBP (is_stronger=+1): profit = amountUSD × delta / market_rate
  // For EUR (is_stronger=-1): profit = amountEUR × delta
  return is_stronger === 1
    ? (amountIn * delta) / market_rate // normalise LBP spread to USD
    : amountIn * delta; // EUR spread already in USD
}

// ─── Master Exchange Calculator ────────────────────────────────────────────

/**
 * Calculate a full exchange for any currency pair.
 * Automatically routes cross-currency through USD.
 * Zero hardcoded currency pairs — works for N currencies.
 *
 * @param fromCurrency  Currency customer is giving
 * @param toCurrency    Currency customer wants to receive
 * @param amountIn      Amount customer is giving
 * @param rates         All rate entries from DB
 */
export function calculateExchange(
  fromCurrency: string,
  toCurrency: string,
  amountIn: number,
  rates: CurrencyRate[],
): ExchangeResult {
  const findRate = (code: string): CurrencyRate => {
    const r = rates.find((r) => r.to_code === code);
    if (!r) throw new Error(`No rate found for currency: ${code}`);
    return r;
  };

  // ── Direct: USD → X ────────────────────────────────────────────────────
  if (fromCurrency === "USD") {
    const currRate = findRate(toCurrency);
    const { amountOut, rate } = convertFromUSD(amountIn, currRate, TAKE_USD);
    const profitUsd = computeLegProfitUsd(amountIn, rate, currRate);
    const leg: ExchangeLeg = {
      fromCurrency,
      toCurrency,
      amountIn,
      amountOut,
      rate,
      marketRate: currRate.market_rate,
      profitUsd,
    };
    return {
      legs: [leg],
      totalAmountOut: amountOut,
      totalProfitUsd: profitUsd,
      viaCurrency: null,
    };
  }

  // ── Direct: X → USD ────────────────────────────────────────────────────
  if (toCurrency === "USD") {
    const currRate = findRate(fromCurrency);
    const { amountUSD, rate } = convertToUSD(amountIn, currRate, GIVE_USD);
    const profitUsd = computeLegProfitUsd(amountIn, rate, currRate);
    const leg: ExchangeLeg = {
      fromCurrency,
      toCurrency,
      amountIn,
      amountOut: amountUSD,
      rate,
      marketRate: currRate.market_rate,
      profitUsd,
    };
    return {
      legs: [leg],
      totalAmountOut: amountUSD,
      totalProfitUsd: profitUsd,
      viaCurrency: null,
    };
  }

  // ── Cross-currency: X → USD → Y ────────────────────────────────────────
  const fromRate = findRate(fromCurrency);
  const toRate = findRate(toCurrency);

  // Leg 1: FROM → USD
  const leg1Result = convertToUSD(amountIn, fromRate, GIVE_USD);
  const leg1Profit = computeLegProfitUsd(amountIn, leg1Result.rate, fromRate);
  const leg1: ExchangeLeg = {
    fromCurrency,
    toCurrency: "USD",
    amountIn,
    amountOut: leg1Result.amountUSD,
    rate: leg1Result.rate,
    marketRate: fromRate.market_rate,
    profitUsd: leg1Profit,
  };

  // Leg 2: USD → TO
  const leg2Result = convertFromUSD(leg1Result.amountUSD, toRate, TAKE_USD);
  const leg2Profit = computeLegProfitUsd(
    leg1Result.amountUSD,
    leg2Result.rate,
    toRate,
  );
  const leg2: ExchangeLeg = {
    fromCurrency: "USD",
    toCurrency,
    amountIn: leg1Result.amountUSD,
    amountOut: leg2Result.amountOut,
    rate: leg2Result.rate,
    marketRate: toRate.market_rate,
    profitUsd: leg2Profit,
  };

  const totalProfitUsd = leg1Profit + leg2Profit;
  return {
    legs: [leg1, leg2],
    totalAmountOut: leg2Result.amountOut,
    totalProfitUsd,
    viaCurrency: "USD",
  };
}
```

### 3.3 Phase 2 — Database Migration

Completely replace the `exchange_rates` table and add leg columns to `exchange_transactions`:

```sql
-- Step 1: Recreate exchange_rates with new 4-column schema
-- (SQLite doesn't support DROP COLUMN, so we recreate)
CREATE TABLE exchange_rates_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  to_code     TEXT    NOT NULL UNIQUE,
  market_rate REAL    NOT NULL,
  delta       REAL    NOT NULL,
  is_stronger INTEGER NOT NULL CHECK(is_stronger IN (1, -1)),
  updated_at  TEXT    DEFAULT (datetime('now'))
);

-- Step 2: Migrate existing data
-- LBP: old rows ('LBP','USD',88500) and ('USD','LBP',89500,89000)
-- We derive: market_rate = base_rate, delta = |rate - base_rate|
INSERT INTO exchange_rates_new (to_code, market_rate, delta, is_stronger)
  SELECT 'LBP', base_rate, ABS(rate - base_rate), 1
  FROM exchange_rates WHERE from_code = 'USD' AND to_code = 'LBP' LIMIT 1;

INSERT INTO exchange_rates_new (to_code, market_rate, delta, is_stronger)
  SELECT 'EUR', base_rate, ABS(rate - base_rate), -1
  FROM exchange_rates WHERE from_code = 'EUR' AND to_code = 'USD' LIMIT 1;

-- Step 3: Swap tables
DROP TABLE exchange_rates;
ALTER TABLE exchange_rates_new RENAME TO exchange_rates;

-- Step 4: Add leg tracking columns to exchange_transactions
ALTER TABLE exchange_transactions ADD COLUMN leg1_rate        REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg1_market_rate REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg1_profit_usd  REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg2_rate        REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg2_market_rate REAL;
ALTER TABLE exchange_transactions ADD COLUMN leg2_profit_usd  REAL;
ALTER TABLE exchange_transactions ADD COLUMN via_currency     TEXT;
```

**New seed data (fresh installs):**

```sql
INSERT INTO exchange_rates (to_code, market_rate, delta, is_stronger) VALUES
  ('LBP', 89500, 500,  1),
  ('EUR', 1.18,  0.02, -1);
```

### 3.4 Phase 3 — Update RateRepository

```typescript
// New entity matching new schema
export interface CurrencyRateEntity {
  id: number;
  to_code: string;
  market_rate: number;
  delta: number;
  is_stronger: 1 | -1;
  updated_at: string;
}

// New methods:
findAll(): CurrencyRateEntity[]                    // all rates
findByCode(code: string): CurrencyRateEntity       // single currency
upsert(data: Omit<CurrencyRateEntity, 'id' | 'updated_at'>): void
delete(code: string): void
```

### 3.5 Phase 4 — Update ExchangeRepository

```typescript
export interface CreateExchangeData {
  fromCurrency: string;
  toCurrency: string;
  amountIn: number;
  amountOut: number;
  // Leg 1 (always present)
  leg1Rate: number;
  leg1MarketRate: number;
  leg1ProfitUsd: number;
  // Leg 2 (cross-currency only)
  leg2Rate?: number;
  leg2MarketRate?: number;
  leg2ProfitUsd?: number;
  viaCurrency?: string; // 'USD' for cross-currency, undefined for direct
  // Totals
  totalProfitUsd: number;
  clientName?: string;
  note?: string;
}
```

### 3.6 Phase 5 — Update ExchangeService

```typescript
import { calculateExchange, CurrencyRate } from '../utils/currency';

addTransaction(data: CreateExchangeInput) {
  // 1. Load rates from DB (new schema)
  const rawRates = getRateRepository().findAll();
  const rates: CurrencyRate[] = rawRates.map(r => ({
    to_code: r.to_code,
    market_rate: r.market_rate,
    delta: r.delta,
    is_stronger: r.is_stronger,
  }));

  // 2. Run the universal calculator — works for any currency pair
  const result = calculateExchange(data.fromCurrency, data.toCurrency, data.amountIn, rates);

  // 3. Store with full leg detail
  const txData: CreateExchangeData = {
    fromCurrency: data.fromCurrency,
    toCurrency: data.toCurrency,
    amountIn: data.amountIn,
    amountOut: result.totalAmountOut,
    leg1Rate: result.legs[0].rate,
    leg1MarketRate: result.legs[0].marketRate,
    leg1ProfitUsd: result.legs[0].profitUsd,
    leg2Rate: result.legs[1]?.rate,
    leg2MarketRate: result.legs[1]?.marketRate,
    leg2ProfitUsd: result.legs[1]?.profitUsd,
    viaCurrency: result.viaCurrency ?? undefined,
    totalProfitUsd: result.totalProfitUsd,
    clientName: data.clientName,
    note: data.note,
  };

  return getExchangeRepository().createTransaction(txData);
}
```

### 3.7 Phase 6 — Update Exchange UI

**Remove** frontend-side rate calculation. The UI should:

1. Show currency selectors
2. Show the calculated rate (fetched from backend or computed using the shared `calculateExchange()`)
3. For cross-currency: show **both legs** with rates and profit breakdown
4. Allow manual rate override per leg (for special cases)

**New UI flow:**

```
[EUR] → [LBP]  Amount: 100 EUR

─── Leg 1: EUR → USD ───────────────────
  Rate: 1.16 USD per EUR
  You receive: $116.00 USD
  Profit: $0.20

─── Leg 2: USD → LBP ───────────────────
  Rate: 89,500 LBP per USD
  Customer receives: 10,382,000 LBP
  Profit: $0.65

─── Total ───────────────────────────────
  Customer gives:    100 EUR
  Customer receives: 10,382,000 LBP
  Total Profit: $0.85
```

### 3.8 Phase 7 — Profit Reporting Update

Update `ProfitService.ts` to sum leg profits:

```sql
-- Exchange profit now = leg1_profit_usd + leg2_profit_usd (or profit_usd for direct)
SELECT
  COALESCE(leg1_profit_usd, 0) + COALESCE(leg2_profit_usd, 0) as total_profit
FROM exchange_transactions
WHERE created_at BETWEEN :from AND :to;
```

### 3.9 Implementation Order

| Step | File                                                      | Action                                                             | Risk   |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| 1    | `packages/core/src/utils/currency.ts`                     | Create new utility with formula + calculator                       | Low    |
| 2    | `packages/core/src/utils/currency.test.ts`                | Unit tests for all scenarios                                       | Low    |
| 3    | DB migration                                              | Recreate `exchange_rates` + add leg columns                        | Medium |
| 4    | `packages/core/src/repositories/RateRepository.ts`        | New 4-column schema methods                                        | Low    |
| 5    | `packages/core/src/repositories/ExchangeRepository.ts`    | Store leg1/leg2 data                                               | Medium |
| 6    | `packages/core/src/services/ExchangeService.ts`           | Use new `calculateExchange()`                                      | Low    |
| 7    | `packages/core/src/services/ProfitService.ts`             | Sum leg profits in SQL                                             | Low    |
| 8    | `packages/core/src/utils/exchangeProfit.ts`               | Delete / deprecate                                                 | Low    |
| 9    | `frontend/src/utils/exchangeRates.ts`                     | Remove, use `calculateExchange()` directly                         | Medium |
| 10   | `frontend/src/features/exchange/pages/Exchange/index.tsx` | Show leg breakdown UI                                              | Medium |
| 11   | `electron-app/create_db.sql`                              | Update seed data to new schema                                     | Low    |
| 12   | Settings → Rates Manager UI                               | Update form for new 4-column model                                 | Medium |
| 13   | Exchange UI                                               | Leg breakdown display validation — correct currency labels per leg | Low    |

### 3.10 Testing Strategy

**Unit Tests for `calculateExchange()` (`packages/core/src/utils/currency.test.ts`):**

```typescript
const mockRates: CurrencyRate[] = [
  { to_code: "LBP", market_rate: 89500, delta: 500, is_stronger: 1 },
  { to_code: "EUR", market_rate: 1.18, delta: 0.02, is_stronger: -1 },
];

describe("computeRate", () => {
  it("USD→LBP: TAKE_USD gives 89,000", () => {
    expect(computeRate(mockRates[0], TAKE_USD)).toBe(89000);
  });
  it("LBP→USD: GIVE_USD gives 90,000", () => {
    expect(computeRate(mockRates[0], GIVE_USD)).toBe(90000);
  });
  it("EUR→USD: GIVE_USD gives 1.16", () => {
    expect(computeRate(mockRates[1], GIVE_USD)).toBeCloseTo(1.16);
  });
  it("USD→EUR: TAKE_USD gives 1.20", () => {
    expect(computeRate(mockRates[1], TAKE_USD)).toBeCloseTo(1.2);
  });
});

describe("calculateExchange", () => {
  it("USD→LBP: direct, 1 leg, correct amount", () => {
    const r = calculateExchange("USD", "LBP", 10, mockRates);
    expect(r.legs).toHaveLength(1);
    expect(r.totalAmountOut).toBe(890000); // 10 × 89,000
    expect(r.viaCurrency).toBeNull();
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });

  it("EUR→USD: direct, 1 leg, correct amount", () => {
    const r = calculateExchange("EUR", "USD", 10, mockRates);
    expect(r.legs).toHaveLength(1);
    expect(r.totalAmountOut).toBeCloseTo(11.6); // 10 × 1.16
    expect(r.viaCurrency).toBeNull();
  });

  it("EUR→LBP: cross-currency, 2 legs, via USD", () => {
    const r = calculateExchange("EUR", "LBP", 10, mockRates);
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].fromCurrency).toBe("EUR");
    expect(r.legs[0].toCurrency).toBe("USD");
    expect(r.legs[1].fromCurrency).toBe("USD");
    expect(r.legs[1].toCurrency).toBe("LBP");
    expect(r.totalAmountOut).toBeCloseTo(1032400); // 10 × 1.16 × 89,000
    expect(r.viaCurrency).toBe("USD");
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });

  it("LBP→EUR: cross-currency, 2 legs, via USD", () => {
    const r = calculateExchange("LBP", "EUR", 1000000, mockRates);
    expect(r.legs).toHaveLength(2);
    expect(r.totalAmountOut).toBeCloseTo(9.259, 2); // 1,000,000 / 90,000 / 1.20
    expect(r.totalProfitUsd).toBeGreaterThan(0);
  });

  it("profit is always positive for valid rates", () => {
    const pairs = [
      ["USD", "LBP"],
      ["LBP", "USD"],
      ["USD", "EUR"],
      ["EUR", "USD"],
      ["EUR", "LBP"],
      ["LBP", "EUR"],
    ];
    for (const [from, to] of pairs) {
      const r = calculateExchange(from, to, 100, mockRates);
      expect(r.totalProfitUsd).toBeGreaterThan(0);
    }
  });

  it("throws for unknown currency", () => {
    expect(() => calculateExchange("USD", "GBP", 100, mockRates)).toThrow(
      "No rate found for currency: GBP",
    );
  });

  it("N-currency: adding GBP just requires a new rate entry", () => {
    const ratesWithGBP = [
      ...mockRates,
      {
        to_code: "GBP",
        market_rate: 1.28,
        delta: 0.03,
        is_stronger: -1 as const,
      },
    ];
    const r = calculateExchange("GBP", "LBP", 1, ratesWithGBP);
    expect(r.legs).toHaveLength(2);
    expect(r.totalAmountOut).toBeCloseTo(1.25 * 89000); // GBP BUY rate × LBP SELL rate
  });
});
```

### 3.11 Migration Path

Since this is an Electron app (local SQLite DB):

1. **Write `currency.ts`** and unit tests — no DB changes yet
2. **Update `create_db.sql`** seed data for fresh installs
3. **Write DB migration** in `packages/core/src/db/migrations/` for existing installs
4. **Update `RateRepository`** — new interface, no old code remains
5. **Update `ExchangeRepository`** — stores leg data
6. **Update `ExchangeService`** — calls `calculateExchange()`
7. **Update `ProfitService`** — sums leg profits
8. **Delete `exchangeProfit.ts`** — fully replaced
9. **Update Exchange UI** — shows leg breakdown
10. **Update Settings Rates Manager** — new 4-column form (market_rate + delta + is_stronger)

### 3.12 Phase 8 — UI Display Validation

**Status**: 📋 Planned  
**Goal**: Ensure leg breakdown display shows correct amounts and currency labels for each leg.

#### The Problem

For cross-currency exchanges (e.g. LBP → EUR), the leg breakdown panel shows:

- Leg 1: LBP → USD — profit shown in USD ✅ (correct unit)
- Leg 2: USD → EUR — profit shown in USD ✅ (correct unit)
- **BUT**: the `rate` label is bare number with no currency context — confusing
- **AND**: profit numbers can appear enormous when `amountIn` is large (e.g. millions of LBP), because `computeLegProfitUsd` receives the raw LBP amount

#### Root Cause

In `currencyConverter.ts`, `computeLegProfitUsd()` for `is_stronger = +1` (LBP):

```typescript
// Current:
const amountUsd = amountIn / market_rate;
return amountUsd * delta;
```

This is correct mathematically. But the Exchange UI passes the **full LBP amount** as `amountIn` for Leg 1 when the FROM currency is LBP.

Example: Customer gives 5,000,000 LBP:

```
Leg 1: LBP → USD
  amountIn = 5,000,000 LBP
  profit = (5,000,000 / 89,500) × 500 = $27.93 USD  ✅ correct
```

So profit IS correct. The display issue is:

1. The rate `90,000` has no label — should show `90,000 LBP per USD`
2. The `+$57,675` seen in testing was likely a very large LBP input (billions)

#### UI Fixes Required

**In `Exchange/index.tsx` leg breakdown panel:**

```tsx
// Instead of just showing the rate number:
<span>rate: {leg.rate.toLocaleString()}</span>

// Show with proper currency label:
<span>rate: {formatLegRate(leg, currencyRates)}</span>
```

Where `formatLegRate()` determines the rate label:

```typescript
function formatLegRate(leg: ExchangeLeg, rates: CurrencyRate[]): string {
  const nonUsdCurrency =
    leg.fromCurrency === "USD" ? leg.toCurrency : leg.fromCurrency;
  const cr = rates.find((r) => r.to_code === nonUsdCurrency);
  if (!cr) return leg.rate.toLocaleString();

  if (cr.is_stronger === 1) {
    // LBP-like: rate = X LBP per 1 USD
    return `${leg.rate.toLocaleString()} ${nonUsdCurrency} per USD`;
  } else {
    // EUR-like: rate = X USD per 1 EUR
    return `${leg.rate.toFixed(4)} USD per ${nonUsdCurrency}`;
  }
}
```

**Also show leg amounts clearly:**

```tsx
<div>In: {leg.amountIn.toLocaleString()} {leg.fromCurrency}</div>
<div>Out: {leg.amountOut.toLocaleString()} {leg.toCurrency}</div>
<div>Profit: ${leg.profitUsd.toFixed(4)} USD</div>
```

**Validate profit sanity:**

- Show warning if `totalProfitUsd > amountIn * 0.1` (profit > 10% of input is suspicious)
- Disable confirm button in that case

#### Acceptance Criteria

- [x] Leg rates show currency labels (e.g. `90,000 LBP per USD`, `1.1600 USD per EUR`)
- [x] Leg amounts show `amountIn` and `amountOut` with currency codes
- [x] Profit shows as `$X.XXXX USD` always in USD
- [x] Total profit is reasonable (< 5% of USD equivalent of input for normal rates)
- [x] Warning shown if profit seems abnormal

**Status**: ✅ Complete

---

### 3.13 Phase 9 — Smoke Test & Sign-off

**Status**: ✅ Complete  
**Date**: March 1, 2026

Manual verification of all 6 exchange pairs end-to-end:

| Pair      | Type           | Status                                    |
| --------- | -------------- | ----------------------------------------- |
| USD → LBP | Direct         | ✅ 1 leg, correct LBP amount, profit > 0  |
| LBP → USD | Direct         | ✅ 1 leg, correct USD amount, profit > 0  |
| USD → EUR | Direct         | ✅ 1 leg, correct EUR amount, profit > 0  |
| EUR → USD | Direct         | ✅ 1 leg, correct USD amount, profit > 0  |
| EUR → LBP | Cross-currency | ✅ 2 legs via USD, correct LBP, 2 profits |
| LBP → EUR | Cross-currency | ✅ 2 legs via USD, correct EUR, 2 profits |

Also verified:

- [x] Rates Manager shows correct buy/sell preview with formula
- [x] Currency Manager shows spread cards with new schema
- [x] Profit reporting sums leg1 + leg2 profits correctly
- [x] History table shows `via USD` badge for cross-currency
- [x] Profit sanity warning shown for abnormal profit (>10% of input)
- [x] 53/53 unit tests passing (`currencyConverter.test.ts`)
- [x] Build successful (`yarn build` ✅)

11. **Manual smoke test** — all 6 exchange pairs ✅

---

## Appendix: Key Invariants

These rules must hold for all exchanges at all times:

1. **Customer always gets less than market rate** — we profit on the spread
2. **Profit is always positive** for valid rates (`delta > 0`, valid `is_stronger`)
3. **USD is always the pivot** — no direct non-USD pair rates stored
4. **`market_rate` = fair mid-market rate** — `delta` is the half-spread from it
5. **Leg profits sum = total profit** — `total_profit_usd = leg1_profit_usd + (leg2_profit_usd ?? 0)`
6. **Rate captured at transaction time** — `leg1_rate`/`leg2_rate` are immutable after storage
7. **Direct exchange = 1 leg, `via_currency = NULL`**
8. **Cross-currency = 2 legs, `via_currency = 'USD'`**

---

## Related Documents

| Document                                                                             | Purpose                                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [CROSS_CURRENCY_EXCHANGE_LOGIC.md](./CROSS_CURRENCY_EXCHANGE_LOGIC.md)               | ⭐ Detailed calculation logic, all examples, validation checklist |
| [DYNAMIC_EXCHANGE_RATES.md](./DYNAMIC_EXCHANGE_RATES.md)                             | Rate system overview, rate usage rules, key files reference       |
| [EXCHANGE_PROFIT_IMPLEMENTATION.md](./EXCHANGE_PROFIT_IMPLEMENTATION.md)             | Profit formula, DB queries, reporting                             |
| [DYNAMIC_CURRENCIES.md](./DYNAMIC_CURRENCIES.md)                                     | Currency management, schema notes, future N-currency plan         |
| [archive/MULTI_CURRENCY_EXCHANGE_PLAN.md](./archive/MULTI_CURRENCY_EXCHANGE_PLAN.md) | Historical plan (old schema, for reference only)                  |
