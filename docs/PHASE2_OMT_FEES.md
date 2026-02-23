# Phase 2: OMT Fee Schedule & Auto-Profit Calculation

**Date**: February 23, 2026
**Parent Plan**: [FINANCIAL_SERVICES_PLAN.md](FINANCIAL_SERVICES_PLAN.md) → Phase 2
**Status**: Planning — awaiting fee data

---

## 1. Overview

Each OMT service type has its own fee structure and profit calculation. The system
will auto-calculate fees and profit per transaction based on the service type and
amount, eliminating manual commission entry.

**Key principle**: The shop earns a **commission percentage** of the OMT fee charged
to the customer. The fee belongs to OMT; the shop keeps a cut.

---

## 2. OMT Service Types (8 total)

| # | Enum Value             | UI Label              | Fee Structure | Notes |
|---|------------------------|-----------------------|---------------|-------|
| 1 | `BILL_PAYMENT`         | Bill Payment          | TBD           |       |
| 2 | `CASH_TO_BUSINESS`     | Cash To Business      | TBD           |       |
| 3 | `MINISTRY_OF_INTERIOR` | Ministry of Interior  | TBD           |       |
| 4 | `CASH_OUT`             | Cash Out              | TBD           |       |
| 5 | `MINISTRY_OF_FINANCE`  | Ministry of Finance   | TBD           |       |
| 6 | `INTRA`                | INTRA                 | TBD           |       |
| 7 | `ONLINE_BROKERAGE`     | Online Brokerage      | TBD           |       |
| 8 | `WESTERN_UNION`        | Western Union         | TBD           |       |

### Fee Data Template (fill in per service)

For each service type, provide one of these structures:

**Option A — Flat fee:**
```
Service: MINISTRY_OF_INTERIOR
Fee: $2.00 flat (any amount)
Shop commission: 10% of fee = $0.20
```

**Option B — Percentage fee:**
```
Service: INTRA
Fee: 1.5% of amount
Shop commission: 10% of fee
```

**Option C — Tiered fee (by amount range):**
```
Service: BILL_PAYMENT
$1–$100:    fee = $1.00
$101–$500:  fee = $2.00
$501–$1000: fee = $3.00
$1000+:     fee = $5.00
Shop commission: 10% of fee
```

**Option D — Fixed fee per transaction (no amount dependency):**
```
Service: CASH_OUT
Fee: $1.50 per transaction
Shop commission: 10%
```

> **Action required**: Fill in the fee structure for each of the 8 service types above.
> The shop commission percentage may also vary per service — specify if different from 10%.

---

## 3. Code Architecture

### 3.1 File Structure

```
packages/core/src/
├── fees/
│   ├── index.ts                    # Public exports
│   ├── types.ts                    # Enums, interfaces, result types
│   ├── FeeCalculator.ts            # Main calculator (strategy dispatcher)
│   ├── strategies/
│   │   ├── FeeStrategy.ts          # Interface definition
│   │   ├── FlatFeeStrategy.ts      # Fixed fee regardless of amount
│   │   ├── PercentageFeeStrategy.ts # Fee = percentage of amount
│   │   ├── TieredFeeStrategy.ts    # Fee varies by amount range
│   │   └── CompositeFeeStrategy.ts # Combines base fee + percentage (if needed)
│   └── schedules/
│       └── omtFeeSchedule.ts       # OMT-specific fee config data (the actual numbers)
```

### 3.2 Core Types (`types.ts`)

```typescript
/** All OMT service types — mirrors DB CHECK constraint */
export enum OmtServiceType {
  BILL_PAYMENT = "BILL_PAYMENT",
  CASH_TO_BUSINESS = "CASH_TO_BUSINESS",
  MINISTRY_OF_INTERIOR = "MINISTRY_OF_INTERIOR",
  CASH_OUT = "CASH_OUT",
  MINISTRY_OF_FINANCE = "MINISTRY_OF_FINANCE",
  INTRA = "INTRA",
  ONLINE_BROKERAGE = "ONLINE_BROKERAGE",
  WESTERN_UNION = "WESTERN_UNION",
}

/** Fee calculation method */
export enum FeeType {
  FLAT = "FLAT",                 // Fixed dollar amount
  PERCENTAGE = "PERCENTAGE",     // Percentage of transaction amount
  TIERED = "TIERED",             // Amount-range-based lookup
  COMPOSITE = "COMPOSITE",       // Base fee + percentage
}

/** A single tier in a tiered fee schedule */
export interface FeeTier {
  minAmount: number;             // Inclusive lower bound
  maxAmount: number;             // Inclusive upper bound (Infinity for uncapped)
  fee: number;                   // Fee for this range (flat $ or %)
}

/** Configuration for one service type's fee schedule */
export interface FeeScheduleEntry {
  serviceType: OmtServiceType;
  feeType: FeeType;
  /** For FLAT: the fixed fee amount */
  flatFee?: number;
  /** For PERCENTAGE: the percentage (e.g., 0.015 = 1.5%) */
  percentage?: number;
  /** For TIERED: the list of tiers */
  tiers?: FeeTier[];
  /** For COMPOSITE: base + percentage */
  baseFee?: number;
  /** Shop commission rate (default 0.10 = 10%) */
  commissionRate: number;
  /** Minimum fee (floor) */
  minFee?: number;
  /** Maximum fee (cap) */
  maxFee?: number;
  /** Currency the fee is denominated in */
  currency: "USD" | "LBP";
}

/** Result of a fee/profit calculation */
export interface FeeCalculationResult {
  /** The OMT fee charged to the customer */
  fee: number;
  /** The shop's profit (commission earned from OMT) */
  profit: number;
  /** The commission rate applied */
  commissionRate: number;
  /** The service type used for calculation */
  serviceType: OmtServiceType;
  /** The transaction amount the fee was calculated on */
  amount: number;
  /** Breakdown string for UI/debugging */
  breakdown: string;
}
```

### 3.3 Strategy Interface (`FeeStrategy.ts`)

```typescript
export interface FeeStrategy {
  /**
   * Calculate the fee for a given transaction amount.
   * @param amount - Transaction amount (always positive)
   * @param entry  - The fee schedule configuration
   * @returns The fee amount (always positive)
   */
  calculateFee(amount: number, entry: FeeScheduleEntry): number;
}
```

### 3.4 Strategy Implementations

**FlatFeeStrategy** — Fixed fee regardless of amount:
```typescript
calculateFee(amount: number, entry: FeeScheduleEntry): number {
  return entry.flatFee ?? 0;
}
```

**PercentageFeeStrategy** — Fee = percentage × amount:
```typescript
calculateFee(amount: number, entry: FeeScheduleEntry): number {
  return amount * (entry.percentage ?? 0);
}
```

**TieredFeeStrategy** — Lookup by amount range:
```typescript
calculateFee(amount: number, entry: FeeScheduleEntry): number {
  const tier = entry.tiers?.find(t => amount >= t.minAmount && amount <= t.maxAmount);
  if (!tier) return 0; // Amount out of range — edge case
  return tier.fee;
}
```

**CompositeFeeStrategy** — Base fee + percentage:
```typescript
calculateFee(amount: number, entry: FeeScheduleEntry): number {
  const base = entry.baseFee ?? 0;
  const pct = amount * (entry.percentage ?? 0);
  return base + pct;
}
```

### 3.5 Main Calculator (`FeeCalculator.ts`)

```typescript
export class FeeCalculator {
  private strategies: Map<FeeType, FeeStrategy>;
  private schedule: Map<OmtServiceType, FeeScheduleEntry>;

  constructor(scheduleEntries: FeeScheduleEntry[]) {
    // Register strategies
    this.strategies = new Map([
      [FeeType.FLAT, new FlatFeeStrategy()],
      [FeeType.PERCENTAGE, new PercentageFeeStrategy()],
      [FeeType.TIERED, new TieredFeeStrategy()],
      [FeeType.COMPOSITE, new CompositeFeeStrategy()],
    ]);

    // Index schedule by service type
    this.schedule = new Map(
      scheduleEntries.map(e => [e.serviceType, e])
    );
  }

  /**
   * Calculate fee and profit for an OMT transaction.
   *
   * @param amount       - Transaction amount (positive)
   * @param serviceType  - OMT service type enum
   * @returns FeeCalculationResult or null if no schedule found
   */
  calculate(amount: number, serviceType: OmtServiceType): FeeCalculationResult | null {
    const entry = this.schedule.get(serviceType);
    if (!entry) return null;

    const strategy = this.strategies.get(entry.feeType);
    if (!strategy) return null;

    let fee = strategy.calculateFee(Math.abs(amount), entry);

    // Apply min/max caps
    if (entry.minFee !== undefined) fee = Math.max(fee, entry.minFee);
    if (entry.maxFee !== undefined) fee = Math.min(fee, entry.maxFee);

    // Round to 2 decimal places
    fee = Math.round(fee * 100) / 100;

    const profit = Math.round(fee * entry.commissionRate * 100) / 100;

    return {
      fee,
      profit,
      commissionRate: entry.commissionRate,
      serviceType,
      amount: Math.abs(amount),
      breakdown: `Fee: $${fee.toFixed(2)} (${entry.feeType}), Profit: $${profit.toFixed(2)} (${(entry.commissionRate * 100).toFixed(0)}% commission)`,
    };
  }

  /** Get the fee schedule for a specific service type */
  getSchedule(serviceType: OmtServiceType): FeeScheduleEntry | undefined {
    return this.schedule.get(serviceType);
  }

  /** Check if a service type has a fee schedule configured */
  hasSchedule(serviceType: OmtServiceType): boolean {
    return this.schedule.has(serviceType);
  }

  /** Get all configured service types */
  getConfiguredServiceTypes(): OmtServiceType[] {
    return Array.from(this.schedule.keys());
  }
}
```

### 3.6 Fee Schedule Data (`omtFeeSchedule.ts`)

This is where the actual numbers go. Example structure (placeholder data):

```typescript
import { FeeScheduleEntry, FeeType, OmtServiceType } from "../types";

/**
 * OMT fee schedule — actual fee data per service type.
 *
 * TODO: Replace placeholder values with real OMT fee schedule.
 */
export const OMT_FEE_SCHEDULE: FeeScheduleEntry[] = [
  {
    serviceType: OmtServiceType.INTRA,
    feeType: FeeType.TIERED,
    tiers: [
      // { minAmount: 1, maxAmount: 100, fee: 1.00 },
      // { minAmount: 101, maxAmount: 500, fee: 2.00 },
      // ...
    ],
    commissionRate: 0.10,  // 10%
    currency: "USD",
  },
  {
    serviceType: OmtServiceType.BILL_PAYMENT,
    feeType: FeeType.FLAT,
    flatFee: 0,            // TBD
    commissionRate: 0.10,
    currency: "USD",
  },
  {
    serviceType: OmtServiceType.CASH_TO_BUSINESS,
    feeType: FeeType.FLAT,
    flatFee: 0,            // TBD
    commissionRate: 0.10,
    currency: "USD",
  },
  {
    serviceType: OmtServiceType.MINISTRY_OF_INTERIOR,
    feeType: FeeType.FLAT,
    flatFee: 0,            // TBD
    commissionRate: 0.10,
    currency: "USD",
  },
  {
    serviceType: OmtServiceType.CASH_OUT,
    feeType: FeeType.FLAT,
    flatFee: 0,            // TBD
    commissionRate: 0.10,
    currency: "USD",
  },
  {
    serviceType: OmtServiceType.MINISTRY_OF_FINANCE,
    feeType: FeeType.FLAT,
    flatFee: 0,            // TBD
    commissionRate: 0.10,
    currency: "USD",
  },
  {
    serviceType: OmtServiceType.ONLINE_BROKERAGE,
    feeType: FeeType.FLAT,
    flatFee: 0,            // TBD
    commissionRate: 0.10,
    currency: "USD",
  },
  {
    serviceType: OmtServiceType.WESTERN_UNION,
    feeType: FeeType.FLAT,
    flatFee: 0,            // TBD — Western Union may have different commission rate
    commissionRate: 0.10,
    currency: "USD",
  },
];
```

---

## 4. Integration Points

### 4.1 Backend — Auto-Calculate on Transaction

In `FinancialService.addTransaction()`:

```typescript
// Before saving:
if (data.provider === "OMT" && data.omtServiceType) {
  const calc = feeCalculator.calculate(data.amount, data.omtServiceType);
  if (calc) {
    data.commission = calc.profit;  // Auto-set profit as commission
    // Optionally store fee in metadata for audit
  }
}
```

### 4.2 Frontend — Display Fee & Profit (Read-Only)

- Remove manual commission input field for OMT
- Add real-time fee/profit display as user types amount:
  ```
  Amount: $500     Service: INTRA
  OMT Fee: $2.00   Your Profit: $0.20
  ```
- Frontend calls a utility function (same `FeeCalculator` or a lighter version)
  to show instant preview without a server round-trip

### 4.3 History Table

- Commission column becomes read-only (backend-calculated)
- Tooltip/breakdown showing fee type and calculation method

---

## 5. Edge Cases & Considerations

| # | Edge Case | Handling |
|---|-----------|----------|
| E1 | Amount = 0 or negative | Reject at validator level (already handled) |
| E2 | Service type not in schedule | Return `null` — fall back to manual commission or $0 |
| E3 | Amount falls between tier ranges (gap) | TieredStrategy returns 0 — log warning |
| E4 | Amount exceeds highest tier | Last tier should use `maxAmount: Infinity` |
| E5 | Fee > amount (would make transaction negative) | Apply maxFee cap or warn user |
| E6 | Commission rate varies by service type | Each `FeeScheduleEntry` has its own `commissionRate` |
| E7 | Commission rate varies by amount range | Extend FeeTier to include `commissionRate` override |
| E8 | LBP vs USD fees | `currency` field on schedule entry; amounts converted at current rate |
| E9 | Fee schedule changes over time | Schedule is code-defined; version via git. Future: DB-driven |
| E10 | WHISH fees (future) | Same architecture — create `whishFeeSchedule.ts` when ready |
| E11 | Rounding | Always round to 2 decimals after calculation |
| E12 | RECEIVE (Money Out) transactions | Fees typically only apply to SEND. Configurable per service |
| E13 | Western Union different commission % | Separate `commissionRate` in its schedule entry |

---

## 6. Testing Plan

```typescript
describe("FeeCalculator", () => {
  // Per-strategy tests
  it("FlatFeeStrategy returns fixed fee regardless of amount");
  it("PercentageFeeStrategy returns correct percentage");
  it("TieredFeeStrategy finds correct tier for amount");
  it("TieredFeeStrategy returns 0 for out-of-range amount");
  it("CompositeFeeStrategy adds base + percentage");

  // Calculator tests
  it("calculates fee and profit for each service type");
  it("returns null for unknown service type");
  it("applies minFee floor");
  it("applies maxFee cap");
  it("rounds to 2 decimal places");
  it("handles zero amount gracefully");
  it("handles Infinity maxAmount in last tier");

  // Integration
  it("auto-sets commission when creating OMT transaction");
  it("does not override commission for non-OMT providers");
  it("stores fee breakdown in transaction metadata");
});
```

---

## 7. Implementation Checklist

- [ ] Create `packages/core/src/fees/types.ts` — enums and interfaces
- [ ] Create `packages/core/src/fees/strategies/FeeStrategy.ts` — interface
- [ ] Create `packages/core/src/fees/strategies/FlatFeeStrategy.ts`
- [ ] Create `packages/core/src/fees/strategies/PercentageFeeStrategy.ts`
- [ ] Create `packages/core/src/fees/strategies/TieredFeeStrategy.ts`
- [ ] Create `packages/core/src/fees/strategies/CompositeFeeStrategy.ts`
- [ ] Create `packages/core/src/fees/FeeCalculator.ts` — main calculator
- [ ] Create `packages/core/src/fees/schedules/omtFeeSchedule.ts` — fee data (**BLOCKED: awaiting fee data**)
- [ ] Create `packages/core/src/fees/index.ts` — public exports
- [ ] Write unit tests for all strategies + calculator
- [ ] Integrate into `FinancialService.addTransaction()` — auto-set commission
- [ ] Update frontend: remove manual commission, show calculated fee/profit
- [ ] Update frontend: real-time fee preview as user types amount
- [ ] Update history table: commission read-only with breakdown tooltip

---

## 8. Action Items

**From you (Amir):**
1. Fill in the fee structure for each of the 8 OMT service types in Section 2
2. Confirm the shop commission rate (is it always 10%? Or different per service?)
3. Clarify if fees apply to both SEND and RECEIVE or only SEND
4. Clarify if Western Union has a completely different fee schedule

**Once fee data is provided:**
- Implementation estimated at ~2-3 hours for backend + frontend
- All code structure is ready to receive the data
