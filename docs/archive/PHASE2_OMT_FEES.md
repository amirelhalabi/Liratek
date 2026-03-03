# Phase 2: OMT Fee Schedule & Auto-Profit Calculation

**Date**: February 27, 2026 (Updated)
**Parent Plan**: [FINANCIAL_SERVICES_PLAN.md](FINANCIAL_SERVICES_PLAN.md) → Phase 2
**Status**: ✅ **COMPLETE** (Backend + Frontend)

**Implementation Summary:**

- ✅ Fee schedule data received and documented
- ✅ Fee calculator utility implemented (`packages/core/src/utils/omtFees.ts`)
- ✅ Database migrations added (v27: service types, v28: fee fields)
- ✅ Auto-calculation logic integrated in repository
- ✅ Validators updated with new fields and refinements
- ✅ Comprehensive tests (30+ test cases, all passing)
- ✅ TypeScript compilation: no errors (328/328 tests passing)
- ✅ Frontend UI updates complete (Services page)
- ✅ BINANCE fee checkbox implemented
- ✅ Supplier Ledger management page available (Settings)

See [OMT_FEE_CALCULATION_IMPLEMENTATION.md](OMT_FEE_CALCULATION_IMPLEMENTATION.md) for full details.

---

## 1. Overview

Each OMT service type has its own fee structure and profit calculation. The system
will auto-calculate fees and profit per transaction based on the service type and
amount, eliminating manual commission entry.

**Key principle**: The shop earns a **commission percentage** of the OMT fee charged
to the customer. The fee belongs to OMT; the shop keeps a cut.

---

## 2. OMT Service Types (8 total)

| #   | Enum Value         | UI Label            | Fee Structure | Shop Commission | Notes                                            |
| --- | ------------------ | ------------------- | ------------- | --------------- | ------------------------------------------------ |
| 1   | `INTRA`            | Intra               | Variable      | 15% of OMT fee  | Commission calculated on OMT's fee               |
| 2   | `WESTERN_UNION`    | Western Union       | Variable      | 10% of OMT fee  | Commission calculated on OMT's fee               |
| 3   | `CASH_TO_BUSINESS` | Cash to Business    | Variable      | 25% of OMT fee  | Commission calculated on OMT's fee               |
| 4   | `CASH_TO_GOV`      | Cash to Gov (Bills) | Variable      | 25% of OMT fee  | Darayeb, Water, Meliye - Commission on OMT's fee |
| 5   | `OMT_WALLET`       | OMT Wallet          | **NO FEE**    | 0%              | **Zero fees - UI alert required**                |
| 6   | `OMT_CARD`         | OMT Card            | Variable      | 10% of OMT fee  | Commission calculated on OMT's fee               |
| 7   | `OGERO_MECANIQUE`  | Ogero/Mecanique     | Variable      | 25% of OMT fee  | Commission calculated on OMT's fee               |
| 8   | `ONLINE_BROKERAGE` | Online Brokerage    | $3 flat       | 0.1%-0.4%       | UNICEF, etc. - Profit is % of cashed amount      |

### Actual Fee Structures (Provided by User)

**Important Note**: For most OMT services, **OMT determines and communicates the fee** to the shop. The shop's profit is a **percentage of that OMT fee**, not calculated independently.

**Service-Specific Details:**

1. **INTRA**: Shop earns 15% of whatever fee OMT charges
2. **WESTERN_UNION**: Shop earns 10% of OMT's calculated fee
3. **CASH_TO_BUSINESS**: Shop earns 25% of OMT's fee
4. **CASH_TO_GOV** (Bills - Darayeb, Water, Meliye): Shop earns 25% of OMT's fee
5. **OMT_WALLET**: **NO FEES** - Zero commission (UI alert required)
6. **OMT_CARD**: Shop earns 10% of OMT's fee
7. **OGERO_MECANIQUE**: Shop earns 25% of OMT's fee
8. **ONLINE_BROKERAGE** (UNICEF, etc.): Shop earns 0.1%-0.4% of cashed amount (direct percentage, not fee-based)

### Implementation Model

**For most services (1-7, except OMT_WALLET):**

- OMT communicates the fee (e.g., "This transaction has a $5 fee")
- Shop calculates profit: `profit = omtFee × commissionRate`
- Shop enters **OMT fee** in the UI, system auto-calculates commission

**For ONLINE_BROKERAGE:**

- Direct profit calculation: `profit = amount × profitRate` where rate is 0.1%-0.4%
- No separate "OMT fee" involved

**For OMT_WALLET:**

- Zero fees, zero commission
- UI shows alert: "⚠️ This transaction has no fees"

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
  INTRA = "INTRA",
  WESTERN_UNION = "WESTERN_UNION",
  CASH_TO_BUSINESS = "CASH_TO_BUSINESS",
  CASH_TO_GOV = "CASH_TO_GOV",
  OMT_WALLET = "OMT_WALLET",
  OMT_CARD = "OMT_CARD",
  OGERO_MECANIQUE = "OGERO_MECANIQUE",
  ONLINE_BROKERAGE = "ONLINE_BROKERAGE",
}

/** Fee calculation method */
export enum FeeType {
  FLAT = "FLAT", // Fixed dollar amount
  PERCENTAGE = "PERCENTAGE", // Percentage of transaction amount
  TIERED = "TIERED", // Amount-range-based lookup
  COMPOSITE = "COMPOSITE", // Base fee + percentage
}

/** A single tier in a tiered fee schedule */
export interface FeeTier {
  minAmount: number; // Inclusive lower bound
  maxAmount: number; // Inclusive upper bound (Infinity for uncapped)
  fee: number; // Fee for this range (flat $ or %)
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
    this.schedule = new Map(scheduleEntries.map((e) => [e.serviceType, e]));
  }

  /**
   * Calculate fee and profit for an OMT transaction.
   *
   * @param amount       - Transaction amount (positive)
   * @param serviceType  - OMT service type enum
   * @returns FeeCalculationResult or null if no schedule found
   */
  calculate(
    amount: number,
    serviceType: OmtServiceType,
  ): FeeCalculationResult | null {
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
 * OMT commission rates — shop's profit as % of OMT fee.
 *
 * Note: For most services, OMT determines the fee and communicates it to the shop.
 * The shop then calculates profit as: omtFee × commissionRate
 */
export const OMT_COMMISSION_RATES: Record<OmtServiceType, number> = {
  [OmtServiceType.INTRA]: 0.15, // 15% of OMT fee
  [OmtServiceType.WESTERN_UNION]: 0.1, // 10% of OMT fee
  [OmtServiceType.CASH_TO_BUSINESS]: 0.25, // 25% of OMT fee
  [OmtServiceType.CASH_TO_GOV]: 0.25, // 25% of OMT fee (bills)
  [OmtServiceType.OMT_WALLET]: 0.0, // NO FEES
  [OmtServiceType.OMT_CARD]: 0.1, // 10% of OMT fee
  [OmtServiceType.OGERO_MECANIQUE]: 0.25, // 25% of OMT fee
  [OmtServiceType.ONLINE_BROKERAGE]: 0.0, // Special case - see below
};

/**
 * Online Brokerage (UNICEF, etc.) uses direct profit calculation.
 * Profit = amount × profitRate (0.1% to 0.4% of cashed amount).
 * Default to 0.25% (0.0025), configurable per transaction.
 */
export const ONLINE_BROKERAGE_DEFAULT_RATE = 0.0025; // 0.25%
export const ONLINE_BROKERAGE_MIN_RATE = 0.001; // 0.1%
export const ONLINE_BROKERAGE_MAX_RATE = 0.004; // 0.4%

/**
 * Calculate shop commission based on OMT fee.
 *
 * @param omtServiceType - The OMT service type
 * @param omtFee - Fee charged by OMT (entered by user)
 * @returns Shop's commission (profit)
 */
export function calculateCommission(
  omtServiceType: OmtServiceType,
  omtFee: number,
): number {
  if (omtServiceType === OmtServiceType.OMT_WALLET) {
    return 0; // No fees
  }

  if (omtServiceType === OmtServiceType.ONLINE_BROKERAGE) {
    throw new Error("Use calculateOnlineBrokerageProfit for ONLINE_BROKERAGE");
  }

  const rate = OMT_COMMISSION_RATES[omtServiceType];
  return omtFee * rate;
}

/**
 * Calculate profit for Online Brokerage transactions.
 *
 * @param amount - Transaction amount
 * @param profitRate - Profit rate (0.001 to 0.004, default 0.0025)
 * @returns Shop's profit
 */
export function calculateOnlineBrokerageProfit(
  amount: number,
  profitRate: number = ONLINE_BROKERAGE_DEFAULT_RATE,
): number {
  // Clamp to valid range
  const rate = Math.max(
    ONLINE_BROKERAGE_MIN_RATE,
    Math.min(ONLINE_BROKERAGE_MAX_RATE, profitRate),
  );
  return amount * rate;
}
```

---

## 4. Integration Points

### 4.1 Backend — Auto-Calculate on Transaction

In `FinancialService.addTransaction()`:

```typescript
// UI provides: amount, omtServiceType, omtFee (user-entered from OMT system)
if (data.provider === "OMT" && data.omtServiceType) {
  if (data.omtServiceType === "OMT_WALLET") {
    data.commission = 0; // No fees
  } else if (data.omtServiceType === "ONLINE_BROKERAGE") {
    // User can override profitRate (0.1%-0.4%), or use default 0.25%
    const profitRate = data.profitRate || ONLINE_BROKERAGE_DEFAULT_RATE;
    data.commission = calculateOnlineBrokerageProfit(data.amount, profitRate);
  } else {
    // Standard: commission = omtFee × commissionRate
    data.commission = calculateCommission(data.omtServiceType, data.omtFee);
  }
}

// For BINANCE: if payFee checkbox is checked, add fee to transaction
if (data.provider === "BINANCE" && data.payFee) {
  // Use omtFee entered by user, or calculate default based on service type
  const feeToCharge =
    data.omtFee || calculateDefaultBinanceFee(data.omtServiceType);
  data.totalCharged = data.amount + feeToCharge;
  data.commission = calculateCommission(data.omtServiceType, feeToCharge);
}
```

### 4.2 Frontend — UI Changes

**For OMT Services (except OMT_WALLET and ONLINE_BROKERAGE):**

- Amount field (user enters transaction amount)
- OMT Fee field (user enters fee communicated by OMT)
- Auto-calculated commission display (read-only): `commission = omtFee × rate`
- Example: INTRA with $5 OMT fee → Shop profit: $0.75 (15%)

**For OMT_WALLET:**

- Show alert: "⚠️ This service has no fees"
- Disable commission/fee fields
- Set commission to 0

**For ONLINE_BROKERAGE:**

- Amount field (cashed amount)
- Profit rate field (default 0.25%, range 0.1%-0.4%)
- Auto-calculated profit display: `profit = amount × rate`
- Example: $800 @ 0.1% → Shop profit: $0.80

**For BINANCE:**

- Amount field
- "Charge fee to customer" checkbox
- When checked:
  - OMT Service Type dropdown appears (to determine fee calculation)
  - Fee field (editable, pre-filled with calculated fee)
  - Total charged display: `amount + fee`
  - Commission calculated same as OMT services

### 4.3 History Table

- Commission column becomes read-only (backend-calculated)
- Tooltip/breakdown showing fee type and calculation method

---

## 5. Edge Cases & Considerations

| #   | Edge Case                                      | Handling                                                              |
| --- | ---------------------------------------------- | --------------------------------------------------------------------- |
| E1  | Amount = 0 or negative                         | Reject at validator level (already handled)                           |
| E2  | Service type not in schedule                   | Return `null` — fall back to manual commission or $0                  |
| E3  | Amount falls between tier ranges (gap)         | TieredStrategy returns 0 — log warning                                |
| E4  | Amount exceeds highest tier                    | Last tier should use `maxAmount: Infinity`                            |
| E5  | Fee > amount (would make transaction negative) | Apply maxFee cap or warn user                                         |
| E6  | Commission rate varies by service type         | Each `FeeScheduleEntry` has its own `commissionRate`                  |
| E7  | Commission rate varies by amount range         | Extend FeeTier to include `commissionRate` override                   |
| E8  | LBP vs USD fees                                | `currency` field on schedule entry; amounts converted at current rate |
| E9  | Fee schedule changes over time                 | Schedule is code-defined; version via git. Future: DB-driven          |
| E10 | WHISH fees (future)                            | Same architecture — create `whishFeeSchedule.ts` when ready           |
| E11 | Rounding                                       | Always round to 2 decimals after calculation                          |
| E12 | RECEIVE (Money Out) transactions               | Fees typically only apply to SEND. Configurable per service           |
| E13 | Western Union different commission %           | Separate `commissionRate` in its schedule entry                       |

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
  Phase 2a (OMT Fee Calculation) archived - COMPLETE
