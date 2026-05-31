import type { VoucherOption } from "@liratek/ui";

/**
 * Fetch a client's redeemable (pending, non-expired) vouchers.
 * Passed to MultiPaymentInput's `fetchClientVouchers` prop so the payment form
 * can offer the client's gift cards directly instead of asking staff for a code.
 */
export async function fetchClientVouchers(
  clientId: number,
): Promise<VoucherOption[]> {
  const res = await window.api.vouchers.getAll({
    status: "pending",
    clientId,
  });
  if (res.success && res.vouchers) {
    return res.vouchers.map((v) => ({
      code: v.code,
      amount: v.amount,
      expiryDate: v.expiry_date,
    }));
  }
  return [];
}
