import type { VoucherOption } from "@liratek/ui";
import { vouchersGetAll } from "@/api/backendApi";
import { localDay } from "@/shared/utils/localDay";

/** The voucher fields this helper reads from the list envelope. */
interface VoucherListRow {
  code: string;
  amount: number;
  expiry_date: string | null;
}

/**
 * Fetch a client's redeemable (pending, non-expired) vouchers.
 * Passed to MultiPaymentInput's `fetchClientVouchers` prop so the payment form
 * can offer the client's gift cards directly instead of asking staff for a code.
 *
 * Goes through the dual-mode adapter (`vouchersGetAll` → `ipcOrHttp`), so it
 * works on desktop (IPC) AND in the web app (GET /api/vouchers) — rule 19.
 * It used to call `window.api.vouchers.getAll` directly, which left the gift
 * card list empty in the browser (LIRA-258). The client's own calendar day is
 * sent so "expired today" follows the shop's day, not the server's (rule 27).
 */
export async function fetchClientVouchers(
  clientId: number,
): Promise<VoucherOption[]> {
  const res = await vouchersGetAll({ status: "pending", clientId }, localDay());
  if (res?.success && Array.isArray(res.vouchers)) {
    return (res.vouchers as VoucherListRow[]).map((v) => ({
      code: v.code,
      amount: v.amount,
      expiryDate: v.expiry_date,
    }));
  }
  return [];
}
