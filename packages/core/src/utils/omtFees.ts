/**
 * OMT Fee Calculation Utilities
 *
 * Handles commission calculation for different OMT service types.
 * Most services: shop earns % of OMT's fee (auto-looked-up from fee tables or user-entered).
 * Online Brokerage: shop earns % of transaction amount.
 *
 * Fee tables (amount → OMT fee):
 *   - INTRA: tiered USD fee schedule
 *   - WESTERN_UNION: tiered USD fee schedule
 */

export type OmtServiceType =
  | "INTRA"
  | "WESTERN_UNION"
  | "CASH_TO_BUSINESS"
  | "CASH_TO_GOV"
  | "OMT_WALLET"
  | "OMT_CARD"
  | "OGERO_MECANIQUE"
  | "ONLINE_BROKERAGE";

/**
 * Commission rates: shop's profit as % of OMT fee charged by OMT
 */
export const OMT_COMMISSION_RATES: Record<OmtServiceType, number> = {
  INTRA: 0.1, // 10% of OMT fee
  WESTERN_UNION: 0.1, // 10% of OMT fee
  CASH_TO_BUSINESS: 0.25, // 25% of OMT fee
  CASH_TO_GOV: 0.25, // 25% of OMT fee (bills: darayeb, water, meliye)
  OMT_WALLET: 0.001, // 0.1% of transfer amount (no fee to customer)
  OMT_CARD: 0.1, // 10% of OMT fee
  OGERO_MECANIQUE: 0.25, // 25% of OMT fee
  ONLINE_BROKERAGE: 0.0, // Flat $3 per transaction (special case)
};

// =============================================================================
// Fee Lookup Tables (amount → OMT fee in USD)
// =============================================================================

interface FeeTier {
  /** Upper bound (inclusive). Use Infinity for the last tier. */
  maxAmount: number;
  fee: number;
}

/**
 * INTRA fee schedule (USD amounts → OMT fee in USD)
 */
export const INTRA_FEE_TIERS: FeeTier[] = [
  { maxAmount: 100, fee: 1 },
  { maxAmount: 150, fee: 2 },
  { maxAmount: 200, fee: 3 },
  { maxAmount: 250, fee: 4 },
  { maxAmount: 300, fee: 5 },
  { maxAmount: 400, fee: 6 },
  { maxAmount: 500, fee: 7 },
  { maxAmount: 1000, fee: 8 },
  { maxAmount: 2000, fee: 12 },
  { maxAmount: 3000, fee: 18 },
  { maxAmount: 4000, fee: 25 },
  { maxAmount: 5000, fee: 35 },
];

/**
 * INTRA LBP fee calculation.
 * - Amounts up to 5,000,000 LBP: flat 50,000 LBP fee
 * - Above 5,000,000: +10,000 LBP per additional 1,000,000 LBP bracket
 * - Max amount: 50,000,000 LBP
 *
 * Formula: max(50000, ceil(amount / 1,000,000) * 10,000)
 */
export const INTRA_LBP_MAX_AMOUNT = 50_000_000;

export function lookupIntraLbpFee(amount: number): number | null {
  if (amount <= 0 || amount > INTRA_LBP_MAX_AMOUNT) return null;
  return Math.max(50_000, Math.ceil(amount / 1_000_000) * 10_000);
}

/**
 * Western Union fee schedule (USD amounts → OMT fee in USD)
 */
export const WESTERN_UNION_FEE_TIERS: FeeTier[] = [
  { maxAmount: 50, fee: 5 },
  { maxAmount: 200, fee: 10 },
  { maxAmount: 500, fee: 15 },
  { maxAmount: 1000, fee: 20 },
  { maxAmount: 2000, fee: 35 },
  { maxAmount: 3000, fee: 70 },
  { maxAmount: 7500, fee: 100 },
];

/**
 * Online Brokerage profit rates (% of cashed amount)
 */
export const ONLINE_BROKERAGE_DEFAULT_RATE = 0.0025; // 0.25%
export const ONLINE_BROKERAGE_MIN_RATE = 0.001; // 0.1%
export const ONLINE_BROKERAGE_MAX_RATE = 0.004; // 0.4%

/**
 * Look up the OMT fee for a given service type and transaction amount.
 *
 * Uses the defined fee tier tables for INTRA and WESTERN_UNION.
 * Returns null for service types that don't have a fee table (fee must be entered manually).
 *
 * @param omtServiceType - The OMT service type
 * @param amount - Transaction amount
 * @param currency - Currency code ("USD" or "LBP"), defaults to "USD"
 * @returns The OMT fee, or null if no table is available for this service type
 *
 * @example
 * lookupOmtFee("INTRA", 100)              // Returns 1   ($1 fee for $1–$100)
 * lookupOmtFee("INTRA", 150)              // Returns 2   ($2 fee for $101–$150)
 * lookupOmtFee("INTRA", 3000000, "LBP")   // Returns 50000 (LBP 50,000 for up to 5M)
 * lookupOmtFee("WESTERN_UNION", 100)      // Returns 10  ($10 fee for $50.01–$200)
 * lookupOmtFee("CASH_TO_BUSINESS", 200)   // Returns null (no table)
 */
export function lookupOmtFee(
  omtServiceType: OmtServiceType,
  amount: number,
  currency: string = "USD",
): number | null {
  if (currency === "LBP") {
    // Only INTRA supports LBP fee lookup
    if (omtServiceType === "INTRA") {
      return lookupIntraLbpFee(amount);
    }
    // Western Union is USD only; other types have no fee table
    return null;
  }

  let tiers: Array<{ maxAmount: number; fee: number }> | null = null;

  if (omtServiceType === "INTRA") {
    tiers = INTRA_FEE_TIERS;
  } else if (omtServiceType === "WESTERN_UNION") {
    tiers = WESTERN_UNION_FEE_TIERS;
  }

  if (!tiers) return null;

  // Find the first tier whose maxAmount >= amount
  const tier = tiers.find((t) => amount <= t.maxAmount);
  return tier ? tier.fee : null; // null if amount exceeds the table's max
}

/**
 * Calculate shop commission based on OMT fee.
 *
 * @param omtServiceType - The OMT service type
 * @param omtFee - Fee charged by OMT (from fee table or user-entered)
 * @returns Shop's commission (profit)
 *
 * @example
 * calculateCommission("INTRA", 1.00)          // Returns 0.10 (10% of $1)
 * calculateCommission("CASH_TO_BUSINESS", 10.00)  // Returns 2.50 (25% of $10)
 */
export function calculateCommission(
  omtServiceType: OmtServiceType,
  omtFee: number,
  amount?: number,
): number {
  if (omtServiceType === "OMT_WALLET") {
    // OMT Wallet: no fee to customer, shop earns 0.1% of transfer amount
    const transferAmount = amount ?? 0;
    return Number((transferAmount * 0.001).toFixed(4));
  }

  if (omtServiceType === "ONLINE_BROKERAGE") {
    // Flat $3 per transaction
    return 3;
  }

  const rate = OMT_COMMISSION_RATES[omtServiceType];
  // Use 4 decimal places to preserve small commissions (e.g. $0.10 on $1 fee)
  return Number((omtFee * rate).toFixed(4));
}

/**
 * Calculate profit for Online Brokerage (UNICEF, etc.) transactions.
 * Profit is calculated as a percentage of the cashed amount.
 *
 * @param amount - Transaction amount (cashed amount)
 * @param profitRate - Profit rate (0.001 to 0.004), defaults to 0.0025 (0.25%)
 * @returns Shop's profit
 *
 * @example
 * calculateOnlineBrokerageProfit(800, 0.001)  // Returns 0.80 (0.1% of $800)
 * calculateOnlineBrokerageProfit(1000)        // Returns 2.50 (0.25% of $1000)
 */
export function calculateOnlineBrokerageProfit(
  amount: number,
  profitRate: number = ONLINE_BROKERAGE_DEFAULT_RATE,
): number {
  // Clamp rate to valid range
  const rate = Math.max(
    ONLINE_BROKERAGE_MIN_RATE,
    Math.min(ONLINE_BROKERAGE_MAX_RATE, profitRate),
  );

  return Number((amount * rate).toFixed(2));
}

/**
 * Check if a service type requires OMT fee input.
 *
 * @param omtServiceType - The OMT service type
 * @returns true if OMT fee field should be shown
 */
export function requiresOmtFeeInput(omtServiceType: OmtServiceType): boolean {
  return (
    omtServiceType !== "OMT_WALLET" && omtServiceType !== "ONLINE_BROKERAGE"
  );
}

/**
 * Check if a service type has zero fees.
 *
 * @param omtServiceType - The OMT service type
 * @returns true if service has no fees
 */
export function hasZeroFees(omtServiceType: OmtServiceType): boolean {
  return omtServiceType === "OMT_WALLET";
}

/**
 * Get commission rate for display purposes.
 *
 * @param omtServiceType - The OMT service type
 * @returns Commission rate as a percentage string (e.g., "15%")
 */
export function getCommissionRateDisplay(
  omtServiceType: OmtServiceType,
): string {
  const rate = OMT_COMMISSION_RATES[omtServiceType];
  return `${(rate * 100).toFixed(0)}%`;
}
