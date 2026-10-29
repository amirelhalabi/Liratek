import { ipcMain } from "electron";
import {
  getSupplierService,
  getFinancialService,
  describeSettleAccountForAudit,
  type OmtCoveredTypesInput,
  type SupplierDayRangeInput,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  SupplierCreateSchema,
  SupplierLedgerEntrySchema,
  SupplierSettleSchema,
  SupplierSettleAccountSchema,
  RemoveAccountCreditSchema,
  SupplierCashflowSchema,
  SupplierPurchaseCreateSchema,
  SupplierAccountLinkSchema,
  SupplierArchiveSchema,
  SupplierRecordDebtSchema,
  AccountExpectedStatementParamsSchema,
  AccountMonthSchema,
  AccountDaySchema,
  SupplierDayRangeSchema,
  validatePayload,
} from "../schemas/index.js";

/**
 * LIRA-343 T033a — the optional shop-day range (last argument) of the
 * supplier Transactions reads, checked with the shared core schema (rule
 * 14). Absent → undefined (unchanged read). These are RAW-shape reads, so an
 * invalid range THROWS (the invoke promise rejects), like month-rows.
 */
function parseDayRange(
  range: unknown,
): SupplierDayRangeInput | undefined {
  if (range === undefined || range === null) return undefined;
  const v = validatePayload(SupplierDayRangeSchema, range);
  if (!v.ok) throw new Error(v.error);
  return v.data;
}

export function registerSupplierHandlers(): void {
  const service = getSupplierService();

  ipcMain.handle(
    "suppliers:list",
    (_e, search?: string, includeInactive?: boolean) => {
      return service.listSuppliers(search, includeInactive);
    },
  );

  ipcMain.handle("suppliers:balances", (_e, includeInactive?: boolean) => {
    return service.getSupplierBalances(includeInactive);
  });

  ipcMain.handle(
    "suppliers:ledger",
    (_e, supplierId: number, limit?: number) => {
      return service.getSupplierLedger(supplierId, limit);
    },
  );

  // ── OMT open-credit account (LIRA-188) ──────────────────────────────────
  // Read-only rollups over the account parent + its children
  // (suppliers.account_supplier_id, LIRA-187). Same no-role-gate treatment
  // as the reads above — every renderer that can reach the IPC bridge is an
  // authenticated app session.

  /** Per-currency balances for every account parent, rolled up with its
   *  children (LIRA-188 §2.4 AccountBalance[]). */
  ipcMain.handle("suppliers:account-balances", () => {
    return service.getAccountBalances();
  });

  /** Unioned ledger rows across an account's parent + children, newest
   *  first, each row carrying which member it came from. */
  ipcMain.handle(
    "suppliers:account-ledger",
    (_e, accountSupplierId: number, limit?: number, range?: unknown) => {
      return service.getAccountLedger(
        accountSupplierId,
        limit,
        parseDayRange(range),
      );
    },
  );

  /** LIRA-343 T033a — an account parent's Transactions window: every
   *  member's financial_services rows, newest first, optional shop-day
   *  range. Same no-role-gate treatment as account-ledger. */
  ipcMain.handle(
    "suppliers:account-transactions",
    (_e, accountSupplierId: number, limit?: number, range?: unknown) => {
      return getFinancialService().getAllByAccount(
        accountSupplierId,
        limit,
        parseDayRange(range),
      );
    },
  );

  /** Unioned unsettled rows (financial_services + raw supplier_ledger,
   *  plan §9.3) across an account's parent + children. */
  ipcMain.handle(
    "suppliers:account-unsettled",
    (_e, accountSupplierId: number) => {
      return service.getAccountUnsettled(accountSupplierId);
    },
  );

  /** LIRA-343 (contracts/calendar-reads.md §1) — every account row whose
   *  shop day falls in `month` (YYYY-MM), settled or not: feeds the settle
   *  calendar. Same no-role-gate treatment as account-unsettled. RAW-shape
   *  read (the renderer expects the rows array, never an envelope), so an
   *  invalid month THROWS — the invoke promise rejects. */
  ipcMain.handle(
    "suppliers:account-month-rows",
    (_e, accountSupplierId: number, month: unknown) => {
      const v = validatePayload(AccountMonthSchema, { month });
      if (!v.ok) throw new Error(v.error);
      return service.getAccountMonthRows(accountSupplierId, v.data.month);
    },
  );

  /** LIRA-343 (contracts/calendar-reads.md §3) — what is behind one shop
   *  day (YYYY-MM-DD): the day's rows, who paid each one, and the "added
   *  after settlement" tag. Same no-role-gate treatment as
   *  account-unsettled; RAW rows array, so an invalid day THROWS. */
  ipcMain.handle(
    "suppliers:account-day-detail",
    (_e, accountSupplierId: number, shopDay: unknown) => {
      const v = validatePayload(AccountDaySchema, { day: shopDay });
      if (!v.ok) throw new Error(v.error);
      return service.getAccountDayDetail(accountSupplierId, v.data.day);
    },
  );

  /** LIRA-255 — "check against OMT's statement" panel: gross owed (from
   *  the account balances above) minus unsettled commission, in OMT's own
   *  sign convention. Read-only, same no-role-gate treatment. */
  // LIRA-256 — optional 2nd argument: the OMT commission types the
  // statement covers (undefined = all types). Validated with the shared
  // core schema. This is a RAW-shape read (the renderer expects a
  // statement, never an envelope), so an invalid value THROWS — the invoke
  // promise rejects and the query enters its error state.
  // 2026-10-27 (owner option B) — optional 3rd argument: the shop's day
  // (YYYY-MM-DD, the CLIENT's, rule 27) the statement covers, inclusive.
  // Both arguments go through ONE shared core schema with the REST route
  // (rule 14); an invalid value THROWS, same as above.
  ipcMain.handle(
    "suppliers:account-expected-statement",
    (
      _e,
      accountSupplierId: number,
      coveredTypes?: unknown,
      upToDay?: unknown,
    ) => {
      const v = validatePayload(AccountExpectedStatementParamsSchema, {
        covered: coveredTypes,
        up_to_day: upToDay,
      });
      if (!v.ok) throw new Error(v.error);
      const covered: OmtCoveredTypesInput | undefined = v.data.covered;
      return v.data.up_to_day === undefined
        ? service.getAccountExpectedStatement(accountSupplierId, covered)
        : service.getAccountExpectedStatement(
            accountSupplierId,
            covered,
            v.data.up_to_day,
          );
    },
  );

  ipcMain.handle("suppliers:create", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierCreateSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.createSupplier(v.data);
    audit(e.sender.id, {
      action: "create",
      entity_type: "supplier",
      summary: `Created supplier "${v.data.name}"`,
      metadata: {
        name: v.data.name,
        module_key: v.data.module_key,
        provider: v.data.provider,
      },
    });
    return result;
  });

  // LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — set/clear a supplier's
  // account parent. Admin-only: this column reshapes what every
  // balance/settlement rollup groups by (getAccountBalances/
  // getAccountLedger/getAccountUnsettled), so it gets the same role gate as
  // every other supplier WRITE below, not the no-gate treatment the reads
  // above get.
  ipcMain.handle("suppliers:update-account-link", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierAccountLinkSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.updateSupplierAccountLink(v.data);
    audit(e.sender.id, {
      action: "update",
      entity_type: "supplier_account_link",
      summary:
        v.data.account_supplier_id === null
          ? `Detached supplier #${v.data.supplier_id} from its account`
          : `Parented supplier #${v.data.supplier_id} under account #${v.data.account_supplier_id}`,
      metadata: {
        supplier_id: v.data.supplier_id,
        account_supplier_id: v.data.account_supplier_id,
      },
    });
    return result;
  });

  // LIRA-362 — archive/unarchive a supplier. Admin-only, like every other
  // supplier write here; the repository refuses one that still owes money.
  ipcMain.handle("suppliers:set-archived", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierArchiveSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.setSupplierArchived(v.data);
    if (result.success) {
      audit(e.sender.id, {
        action: "update",
        entity_type: "supplier",
        entity_id: String(v.data.supplier_id),
        summary: `${v.data.archived ? "Archived" : "Unarchived"} supplier #${v.data.supplier_id}`,
        metadata: { archived: v.data.archived },
      });
    }
    return result;
  });

  ipcMain.handle("suppliers:add-ledger-entry", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierLedgerEntrySchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.addLedgerEntry({
      ...v.data,
      created_by: auth.userId,
    });
    audit(e.sender.id, {
      action: "create",
      entity_type: "supplier_ledger",
      summary: `Supplier ledger ${v.data.entry_type}: $${v.data.amount_usd} + ${v.data.amount_lbp} LBP`,
      metadata: {
        supplier_id: v.data.supplier_id,
        entry_type: v.data.entry_type,
      },
    });
    return result;
  });

  // ── Settlement handlers ────────────────────────────────────────────────────

  /** Get unsettled transactions for a provider (e.g. "OMT") */
  ipcMain.handle("suppliers:unsettled-transactions", (_e, provider: string) => {
    return getFinancialService().getUnsettledByProvider(provider);
  });

  /** Get all transactions for a provider (history tab) */
  ipcMain.handle(
    "suppliers:all-transactions",
    (_e, provider: string, limit?: number, range?: unknown) => {
      return getFinancialService().getAllByProvider(
        provider,
        limit,
        parseDayRange(range),
      );
    },
  );

  /** Get per-provider unsettled summary (for dashboard + profits page) */
  ipcMain.handle("suppliers:unsettled-summary", () => {
    return getFinancialService().getUnsettledSummary();
  });

  /** Settle a batch of transactions with a supplier (admin only) */
  ipcMain.handle("suppliers:settle-transactions", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierSettleSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.settleTransactions({
      ...v.data,
      created_by: auth.userId,
    });
    audit(e.sender.id, {
      action: "settle",
      entity_type: "supplier_settlement",
      summary: `Settled ${v.data.financial_service_ids.length} transactions for supplier #${v.data.supplier_id}`,
      metadata: {
        supplier_id: v.data.supplier_id,
        count: v.data.financial_service_ids.length,
      },
    });
    return result;
  });

  // ── OMT open-credit account settlement (LIRA-189) ──────────────────────
  // One payment across the account parent + its children (counter / OMT App
  // / iPick, LIRA-187/188). The repository re-validates every selected id
  // against account membership — the client's selection is never trusted.

  /** Settle the OMT open-credit account as ONE transaction (admin only) */
  ipcMain.handle("suppliers:settle-account", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierSettleAccountSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.settleAccount({
      ...v.data,
      created_by: auth.userId,
    });
    // LIRA-322 — one description for both payload shapes (legacy whole-row
    // and amount-first per_currency), shared with the REST route; audited
    // only when the settlement was actually written.
    if (result.success) {
      audit(e.sender.id, {
        action: "settle",
        entity_type: "supplier_account_settlement",
        ...describeSettleAccountForAudit(v.data),
      });
    }
    return result;
  });

  // ── LIRA-344 — Remove credit (admin only) ──────────────────────────────
  // Closes one open OMT account credit OMT will not accept and books it as
  // an expense (no drawer). The repository re-reads the open queue: the
  // row's membership, scope and amount are never trusted from the client.
  ipcMain.handle("suppliers:remove-account-credit", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(RemoveAccountCreditSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.removeAccountCredit({
      ...v.data,
      created_by: auth.userId,
    });
    if (result.success) {
      audit(e.sender.id, {
        action: "remove_credit",
        entity_type: "supplier_account_settlement",
        entity_id: String(result.transaction_id ?? result.id ?? ""),
        summary: `Removed OMT credit row #${v.data.ledger_row_id} on account #${v.data.account_supplier_id}: ${v.data.reason}`,
        metadata: {
          account_supplier_id: v.data.account_supplier_id,
          ledger_row_id: v.data.ledger_row_id,
          removed: v.data.expected_remaining,
        },
      });
    }
    return result;
  });

  /** Product supplier balances: inventory cost minus payments */
  ipcMain.handle("suppliers:product-balances", () => {
    return service.getProductSupplierBalances();
  });

  /** Inventory items for a product supplier (name, qty, cost, total) */
  ipcMain.handle("suppliers:product-items", (_e, supplierId: number) => {
    return service.getProductItems(supplierId);
  });

  /** Get all purchase records for a product supplier */
  ipcMain.handle("suppliers:purchases", (_e, supplierId: number) => {
    return service.getSupplierPurchases(supplierId);
  });

  /** Log a delivery batch for a product supplier (admin only) */
  ipcMain.handle("suppliers:purchase-create", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierPurchaseCreateSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.createPurchase({
      ...v.data,
      created_by: auth.userId,
    });
    audit(e.sender.id, {
      action: "create",
      entity_type: "supplier_purchase",
      summary: `Logged purchase of $${v.data.total_usd.toFixed(2)} for supplier #${v.data.supplier_id}`,
      metadata: {
        supplier_id: v.data.supplier_id,
        total_usd: v.data.total_usd,
      },
    });
    return result;
  });

  /** LIRA-087 (migration v189) — record a supplier debt without a product
   *  line yet (admin only, same actor convention as every other
   *  money-writing supplier handler). */
  ipcMain.handle("suppliers:record-debt", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierRecordDebtSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.recordDebt({
      ...v.data,
      created_by: auth.userId,
    });
    if (result.success) {
      audit(e.sender.id, {
        action: "create",
        entity_type: "supplier_ledger",
        entity_id: String(result.ledgerEntryId ?? ""),
        summary: `Recorded debt for supplier #${v.data.supplier_id}: $${v.data.amount_usd.toFixed(2)} + ${v.data.amount_lbp.toLocaleString()} LBP`,
        metadata: {
          supplier_id: v.data.supplier_id,
          amount_usd: v.data.amount_usd,
          amount_lbp: v.data.amount_lbp,
        },
      });
    }
    return result;
  });

  /** LIRA-087 — picker list for stock intake's "attach to a recorded debt"
   *  flow. Same no-role-gate treatment as every other read channel in this
   *  file (every renderer that can reach the IPC bridge is an authenticated
   *  app session). */
  ipcMain.handle("suppliers:open-recorded-debts", (_e, supplierId: number) => {
    return service.getOpenRecordedDebts(supplierId);
  });

  /** Pay a supplier / record a supplier paying us, via payment-method legs (admin only) */
  ipcMain.handle("suppliers:record-cashflow", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierCashflowSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.recordSupplierCashflow({
      ...v.data,
      created_by: auth.userId,
    });
    audit(e.sender.id, {
      action: v.data.direction === "PAY" ? "pay" : "receive",
      entity_type: "supplier_cashflow",
      summary: `Supplier #${v.data.supplier_id} ${v.data.direction === "PAY" ? "paid" : "paid us"} (${v.data.payments.length} leg${v.data.payments.length === 1 ? "" : "s"})`,
      metadata: {
        supplier_id: v.data.supplier_id,
        direction: v.data.direction,
      },
    });
    return result;
  });

  // NOTE: the standalone `suppliers:write-off` channel (CQ-10) was REMOVED
  // (owner decision D8, SUPPLIER_STOCK_INTAKE_PLAN.md) —
  // SupplierService.writeOffSupplierDebt no longer exists. The bundled
  // Pay-form discount on `suppliers:record-cashflow` above is the surviving
  // forgiveness path.

  /** Event-based product-supplier stock value: SUM(quantity_remaining *
   *  unit_cost_usd) per supplier over open batches (StockBatchRepository).
   *  Read-only, same no-auth-gate treatment as `suppliers:product-balances`
   *  above — every renderer that can reach the IPC bridge is an
   *  authenticated app session. */
  ipcMain.handle("suppliers:product-stock-value", () => {
    return service.getProductSupplierStockValue();
  });
}
