/**
 * Bill denominations available in the shop
 */

export const LBP_DENOMINATIONS = [5000, 10000, 20000, 50000, 100000] as const;
export const USD_DENOMINATIONS = [1, 5, 10, 20, 50, 100] as const;

/**
 * Round amount UP to nearest payable denomination
 * Used for change calculation and debt breakdown
 */
export function roundToNearestDenomination(
  amount: number,
  denominations: readonly number[],
): number {
  if (amount <= 0) return 0;

  // Find the smallest denomination that is >= amount
  for (const denom of denominations) {
    if (amount <= denom) {
      return denom;
    }
  }

  // If amount is larger than largest denomination, round up to nearest multiple
  const largest = denominations[denominations.length - 1];
  return Math.ceil(amount / largest) * largest;
}

/**
 * Round LBP amount up to nearest payable bill
 * Example: 57,380 -> 60,000 (rounds up to 10,000 + 50,000 combination)
 */
export function roundLBPUp(amount: number): number {
  if (amount <= 0) return 0;

  // Round up to nearest 5,000 (smallest denomination)
  return Math.ceil(amount / 5000) * 5000;
}

/**
 * Round USD amount up to nearest payable bill/coin
 * Example: $57.64 -> $58 (rounds up to nearest $1)
 */
export function roundUSDUp(amount: number): number {
  if (amount <= 0) return 0;

  // Round up to nearest $1 (smallest denomination)
  return Math.ceil(amount);
}
