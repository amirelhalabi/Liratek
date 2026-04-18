import { ipcMain } from "electron";
import { getTransactionService, getReportingService } from "@liratek/core";
import type { TransactionFilters } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";

export function registerTransactionHandlers(): void {
  const txnService = getTransactionService();

  // ==================== READ ====================

  /**
   * Get recent transactions with optional filters.
   * Replaces `activity:get-recent` for unified transaction view.
   */
  ipcMain.handle(
    "transactions:get-recent",
    (_e, limit?: number, filters?: TransactionFilters) => {
      return txnService.getRecent(limit, filters);
    },
  );

  /** Get a single transaction by ID */
  ipcMain.handle("transactions:get-by-id", (_e, id: number) => {
    return txnService.getById(id);
  });

  /** Get transactions for a specific client */
  ipcMain.handle(
    "transactions:get-by-client",
    (_e, clientId: number, limit?: number) => {
      return txnService.getByClientId(clientId, limit);
    },
  );

  /** Get transactions in a date range */
  ipcMain.handle(
    "transactions:get-by-date-range",
    (_e, from: string, to: string, type?: string) => {
      return txnService.getByDateRange(
        from,
        to,
        type as Parameters<typeof txnService.getByDateRange>[2],
      );
    },
  );

  // ==================== ACCOUNTING ====================

  /** Void a transaction (marks as VOIDED + creates reversal) */
  ipcMain.handle("transactions:void", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");
      const userId = auth.userId ?? 1;
      const reversalId = txnService.voidTransaction(id, userId);
      audit(e.sender.id, {
        action: "void",
        entity_type: "transaction",
        entity_id: String(id),
        summary: `Voided transaction #${id}`,
        metadata: { reversalId },
      });
      return { success: true, reversalId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  /** Refund a transaction (creates refund row, original stays ACTIVE) */
  ipcMain.handle("transactions:refund", (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");
      const userId = auth.userId ?? 1;
      const refundId = txnService.refundTransaction(id, userId);
      audit(e.sender.id, {
        action: "refund",
        entity_type: "transaction",
        entity_id: String(id),
        summary: `Refunded transaction #${id}`,
        metadata: { refundId },
      });
      return { success: true, refundId };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // ==================== ANALYTICS ====================

  /** Daily summary for a given date */
  ipcMain.handle("transactions:daily-summary", (_e, date: string) => {
    return txnService.getDailySummary(date);
  });

  /** Debt aging buckets for a client */
  ipcMain.handle("transactions:debt-aging", (_e, clientId: number) => {
    return txnService.getClientDebtAging(clientId);
  });

  /** All clients with overdue debts */
  ipcMain.handle("transactions:overdue-debts", () => {
    return txnService.getOverdueDebts();
  });

  /** Revenue breakdown by module/type for a date range */
  ipcMain.handle(
    "transactions:revenue-by-type",
    (_e, from: string, to: string) => {
      return txnService.getRevenueByType(from, to);
    },
  );

  /** Revenue breakdown by user for a date range */
  ipcMain.handle(
    "transactions:revenue-by-user",
    (_e, from: string, to: string) => {
      return txnService.getRevenueByUser(from, to);
    },
  );

  // ==================== REPORTING ====================

  const reportingService = getReportingService();

  /** Daily summaries for a date range (multi-day) */
  ipcMain.handle("reports:daily-summaries", (_e, from: string, to: string) => {
    return reportingService.getDailySummaries(from, to);
  });

  /** Full client transaction history with running balance + debt aging */
  ipcMain.handle(
    "reports:client-history",
    (_e, clientId: number, limit?: number) => {
      return reportingService.getClientHistory(clientId, limit);
    },
  );

  /** Revenue by module/type for a date range */
  ipcMain.handle(
    "reports:revenue-by-module",
    (_e, from: string, to: string) => {
      return reportingService.getRevenueByModule(from, to);
    },
  );

  /** All overdue debts */
  ipcMain.handle("reports:overdue-debts", () => {
    return reportingService.getOverdueDebts();
  });
}
