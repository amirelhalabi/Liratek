/**
 * Auto-print-on-success (LIRA-069 W1.d).
 *
 * ONE implementation, called from every included module's success handler
 * (telecom recharge, iPick/Katsh, Whish App Bills, maintenance, custom
 * services, loto ticket sale) — never a hand-rolled copy per module.
 *
 * Rules:
 *  - Gated by the SAME `isReceiptableTransaction` predicate the Transactions
 *    viewer and History-modal Print buttons use (receiptGating.ts) — no
 *    second provider list.
 *  - Skipped entirely when a customer session is active: a session-basket
 *    submit doesn't get its own receipt — the session gets ONE receipt at
 *    checkout (W1.b, SessionCheckoutModal's own Print button).
 *  - Best-effort: a failed lookup/print never throws into the caller's
 *    already-succeeded submit handler.
 */
import { useCallback } from "react";
import { useShopInfo } from "@/hooks/useShopName";
import { getTransactionBySource } from "@/api/backendApi";
import { printServiceReceiptByTransaction } from "@/shared/utils/serviceReceipt";
import {
  isReceiptableTransaction,
  type ReceiptGatingFields,
} from "@/features/audit/receiptGating";

export interface AutoPrintReceiptParams extends ReceiptGatingFields {
  /** source_table for the module row just created (e.g. "recharges",
   *  "financial_services", "maintenance", "custom_services", "loto_tickets"). */
  sourceTable: string;
  /** The just-created module row's own PK (recharges.id, financial_services.id, …). */
  sourceId: number | null | undefined;
  /** True when a customer session is active — auto-print is skipped (the
   *  session gets ONE receipt at checkout instead, W1.b). */
  hasActiveSession: boolean;
}

export type AutoPrintReceiptFn = (
  params: AutoPrintReceiptParams,
) => Promise<void>;

export function useAutoPrintReceipt(): AutoPrintReceiptFn {
  const shopInfo = useShopInfo();

  return useCallback(
    async (params: AutoPrintReceiptParams) => {
      if (params.hasActiveSession) return;
      if (params.sourceId == null) return;
      if (!isReceiptableTransaction(params)) return;

      try {
        const txn = await getTransactionBySource(
          params.sourceTable,
          params.sourceId,
        );
        const txnId = (txn as { id?: number } | null)?.id;
        if (!txnId) return;
        await printServiceReceiptByTransaction(txnId, shopInfo);
      } catch {
        // Best-effort — never block or surface an error for an already
        // successful submit just because the receipt couldn't print.
      }
    },
    [shopInfo],
  );
}
