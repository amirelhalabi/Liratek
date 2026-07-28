/**
 * Auto-print-on-success (LIRA-069 W1.d) — DISABLED per owner request
 * (2026-07-28): the print dialog interrupting every payment was unwanted.
 *
 * This is kept as a stable no-op, not deleted, because every included
 * module's success handler (telecom recharge, iPick/Katsh, Whish App Bills,
 * maintenance, custom services, loto ticket sale) already calls this ONE
 * hook — a single early-return here disables the behavior everywhere without
 * touching 7 call sites. Manual reprint entry points (TransactionsViewer's
 * and each module History modal's Print button, gated by the same
 * `isReceiptableTransaction` in receiptGating.ts) are untouched — they call
 * `printServiceReceiptByTransaction` directly, not this hook.
 */
import { useCallback } from "react";
import type { ReceiptGatingFields } from "@/features/audit/receiptGating";

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
  return useCallback(async () => {
    // Disabled — see file header.
  }, []);
}
