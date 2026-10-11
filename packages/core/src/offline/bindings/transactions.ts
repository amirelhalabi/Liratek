/**
 * Offline bindings — generic void / refund (LIRA-306 US1). The same
 * `TransactionService` calls the IPC handlers and `POST /api/transactions/
 * :id/void|refund` make; a thrown business error (already voided, …) is a
 * refusal with its message.
 */
import { getTransactionService } from "../../services/TransactionService.js";
import type { OfflineBinding } from "./types.js";

const transactionsVoid: OfflineBinding = {
  channel: "transactions:void",
  run: (payload, ctx) => {
    const reversalId = getTransactionService().voidTransaction(payload.transactionId as number, ctx.actorUserId);
    return { success: true, reversalId };
  },
  mainRow: (r) => (typeof r.reversalId === "number" ? { table: "transactions", id: r.reversalId } : null),
};

interface RefundPayload {
  transactionId: number;
  refundLegs?: unknown[] | null;
  refundUnitExtras?: unknown[] | null;
  exchangeRate?: number;
  keptChange?: { kept_change_usd?: number; kept_change_lbp?: number } | null;
}

const transactionsRefund: OfflineBinding = {
  channel: "transactions:refund",
  run: (payload, ctx) => {
    const p = payload as unknown as RefundPayload;
    const refundId = getTransactionService().refundTransaction(p.transactionId, ctx.actorUserId, {
      refundLegs: (p.refundLegs ?? undefined) as never,
      refundUnitExtras: (p.refundUnitExtras ?? undefined) as never,
      exchangeRate: p.exchangeRate ?? undefined,
      keptChange: p.keptChange ? { usd: p.keptChange.kept_change_usd, lbp: p.keptChange.kept_change_lbp } : undefined,
    });
    return { success: true, refundId };
  },
  mainRow: (r) => (typeof r.refundId === "number" ? { table: "transactions", id: r.refundId } : null),
};

export const TRANSACTION_BINDINGS: readonly OfflineBinding[] = [transactionsVoid, transactionsRefund];
