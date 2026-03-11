/**
 * Payment utility functions
 */

import { PAYMENT_TOLERANCE } from "@/constants/checkout";

/**
 * Calculates change due
 * @param paid - Amount paid
 * @param total - Total amount due
 * @returns Change amount (0 if underpaid)
 */
export function calculateChange(paid: number, total: number): number {
  return Math.max(0, paid - total);
}

/**
 * Calculates remaining amount to pay
 * @param paid - Amount paid
 * @param total - Total amount due
 * @returns Remaining amount (0 if overpaid)
 */
export function calculateRemaining(paid: number, total: number): number {
  return Math.max(0, total - paid);
}

/**
 * Checks if payment is complete (within tolerance)
 * @param paid - Amount paid
 * @param total - Total amount due
 * @returns true if payment is complete
 */
export function isPaymentComplete(paid: number, total: number): boolean {
  const remaining = calculateRemaining(paid, total);
  return remaining <= PAYMENT_TOLERANCE;
}

/**
 * Formats currency amount
 * @param amount - Amount to format
 * @param currency - Currency code (USD or LBP)
 * @returns Formatted currency string
 */
export function formatCurrency(
  amount: number,
  currency: "USD" | "LBP",
): string {
  if (currency === "USD") {
    return `$${amount.toFixed(2)}`;
  }
  return `${amount.toLocaleString()} LBP`;
}

/**
 * Converts LBP to USD using exchange rate
 * @param amountLBP - Amount in LBP
 * @param exchangeRate - Exchange rate (1 USD = X LBP)
 * @returns Amount in USD
 */
export function convertLBPToUSD(
  amountLBP: number,
  exchangeRate: number,
): number {
  if (exchangeRate <= 0) return 0;
  return amountLBP / exchangeRate;
}

/**
 * Converts USD to LBP using exchange rate
 * @param amountUSD - Amount in USD
 * @param exchangeRate - Exchange rate (1 USD = X LBP)
 * @returns Amount in LBP
 */
export function convertUSDtoLBP(
  amountUSD: number,
  exchangeRate: number,
): number {
  return amountUSD * exchangeRate;
}
