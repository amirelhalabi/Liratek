/**
 * WHISH Fee Calculation Utilities
 *
 * Handles commission calculation for WHISH money transfer service.
 * The shop earns 10% of the WHISH fee charged per transaction.
 *
 * Fee table (amount USD → WHISH fee USD):
 *   $1–$100      → $1
 *   $101–$200    → $2
 *   $201–$300    → $3
 *   $301–$1,000  → $5
 *   $1,001–$2,000 → $10
 *   $2,001–$3,000 → $15
 *   $3,001–$4,000 → $20
 *   $4,001–$5,000 → $25
 */

// =============================================================================
// Fee Lookup Table
// =============================================================================

interface FeeTier {
  /** Upper bound (inclusive) */
  maxAmount: number;
  fee: number;
}

/**
 * WHISH fee schedule (USD amounts → WHISH fee in USD)
 */
export const WHISH_FEE_TIERS: FeeTier[] = [
  { maxAmount: 100, fee: 1 },
  { maxAmount: 200, fee: 2 },
  { maxAmount: 300, fee: 3 },
  { maxAmount: 1000, fee: 5 },
  { maxAmount: 2000, fee: 10 },
  { maxAmount: 3000, fee: 15 },
  { maxAmount: 4000, fee: 20 },
  { maxAmount: 5000, fee: 25 },
];

/**
 * Shop commission rate: 10% of WHISH fee
 */
export const WHISH_COMMISSION_RATE = 0.1;

/**
 * Look up the WHISH fee for a given transaction amount.
 *
 * @param amount - Transaction amount in USD
 * @returns The WHISH fee in USD, or null if amount exceeds the table's max ($5,000)
 *
 * @example
 * lookupWhishFee(100)   // Returns 1   ($1 fee for $1–$100)
 * lookupWhishFee(150)   // Returns 2   ($2 fee for $101–$200)
 * lookupWhishFee(500)   // Returns 5   ($5 fee for $301–$1,000)
 * lookupWhishFee(5001)  // Returns null (exceeds table)
 */
export function lookupWhishFee(amount: number): number | null {
  const tier = WHISH_FEE_TIERS.find((t) => amount <= t.maxAmount);
  return tier ? tier.fee : null;
}

/**
 * Calculate shop commission for a WHISH transaction.
 *
 * Commission = whishFee × WHISH_COMMISSION_RATE (10%)
 * Uses 4 decimal places to preserve small commissions.
 *
 * @param whishFee - Fee charged by WHISH (from table or user-entered)
 * @returns Shop commission amount in USD
 *
 * @example
 * calculateWhishCommission(1)   // Returns 0.1   (10% of $1)
 * calculateWhishCommission(5)   // Returns 0.5   (10% of $5)
 * calculateWhishCommission(25)  // Returns 2.5   (10% of $25)
 */
export function calculateWhishCommission(whishFee: number): number {
  return Number((whishFee * WHISH_COMMISSION_RATE).toFixed(4));
}
