import type { OmtCoveredType } from "../utils/omtCoveredTypes.js";
import type {
  SupplierArchiveInput,
  SupplierDayRangeInput,
} from "../validators/supplier.js";
import { toSqliteUtc } from "../utils/requestNow.js";
import { LOTO_PAY_MOVED_MESSAGE } from "../utils/settlesByDay.js";
import {
  getSupplierRepository,
  getProductSupplierRepository,
  getSupplierPurchaseRepository,
  getStockBatchRepository,
  type CreateSupplierData,
  type CreateSupplierLedgerEntryData,
  type SettleTransactionsData,
  type SupplierCashflowData,
  type SupplierEntity,
  type SupplierLedgerEntryEntity,
  type SupplierBalance,
  type ProductSupplierItem,
  type SupplierPurchase,
  type CreateSupplierPurchaseData,
} from "../repositories/index.js";
// OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187/188) — imported directly from
// SupplierRepository.js rather than the repositories/index.js barrel: this
// lane owns SupplierRepository.ts/SupplierService.ts only, not the shared
// barrel (see CROSS_LANE_REQUESTS in this ticket's build report) — it should
// still re-export these for other callers (e.g. IPC/REST handlers) to import
// the conventional way.
import type {
  AccountBalance,
  AccountDayDetailRow,
  AccountExpectedStatement,
  AccountLedgerEntry,
  AccountUnsettledRow,
  RemoveAccountCreditData,
  SettleAccountRequest,
  UpdateSupplierAccountLinkData,
} from "../repositories/SupplierRepository.js";
import { toErrorString } from "../utils/errors.js";

export interface SupplierResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class SupplierService {
  private repo = getSupplierRepository();

  listSuppliers(search?: string, includeInactive?: boolean): SupplierEntity[] {
    return this.repo.listSuppliers(search, includeInactive);
  }

  getSupplierBalances(includeInactive?: boolean): SupplierBalance[] {
    return this.repo.getSupplierBalances(includeInactive);
  }

  getProductSupplierBalances(): SupplierBalance[] {
    return this.repo.getProductSupplierBalances();
  }

  // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187/188) — thin pass-throughs
  // (rule 13: no SQL here, the repository owns every query).
  getAccountBalances(): AccountBalance[] {
    return this.repo.getAccountBalances();
  }

  getAccountLedger(
    accountSupplierId: number,
    limit?: number,
    // LIRA-343 T033a — optional shop-day range (supplierDayRangeSchema).
    range?: SupplierDayRangeInput,
  ): AccountLedgerEntry[] {
    return this.repo.getAccountLedger(accountSupplierId, limit, range);
  }

  getAccountUnsettled(accountSupplierId: number): AccountUnsettledRow[] {
    return this.repo.getAccountUnsettled(accountSupplierId);
  }

  /**
   * LIRA-343 (contracts/calendar-reads.md §1) — every account row whose
   * shop day falls in `month` (`YYYY-MM`), settled or not. The repository
   * is asked for a UTC window of the month ± 1 day (so a row near midnight
   * whose shop day is in the month is never cut off by the zone offset),
   * then rows are kept by their `shop_day`. Pure arithmetic on the
   * argument, UTC getters only — nothing read from the host (rule 27).
   */
  getAccountMonthRows(
    accountSupplierId: number,
    month: string,
  ): AccountUnsettledRow[] {
    const [y, m] = month.split("-").map(Number);
    // Day 0 of month m (0-based m-1) = last day of the previous month;
    // day 2 of the next month = (last day + 2) — the exclusive upper bound.
    const fromUtc = utcStamp(Date.UTC(y, m - 1, 0));
    const toUtc = utcStamp(Date.UTC(y, m, 2));
    return this.repo
      .getAccountRows(accountSupplierId, { fromUtc, toUtc })
      .filter((r) => r.shop_day.startsWith(month));
  }

  /**
   * LIRA-343 (contracts/calendar-reads.md §3) — what is behind one shop day
   * (`YYYY-MM-DD`): the day's rows, who paid each one, and the "added after
   * settlement" tag. Thin pass-through (rule 13): the repository owns the
   * window and every query.
   */
  getAccountDayDetail(
    accountSupplierId: number,
    shopDay: string,
  ): AccountDayDetailRow[] {
    return this.repo.getAccountDayDetail(accountSupplierId, shopDay);
  }

  // LIRA-255 — "check against OMT's statement" panel (rule 13: thin
  // pass-through, same as the three reads above). LIRA-256: optional
  // covered OMT commission types (undefined = all types).
  getAccountExpectedStatement(
    accountSupplierId: number,
    coveredTypes?: OmtCoveredType[],
    /** 2026-10-27 — the shop's day OMT's SMS covers (inclusive); absent =
     *  everything open (unchanged). */
    upToDay?: string,
  ): AccountExpectedStatement {
    return this.repo.getAccountExpectedStatement(
      accountSupplierId,
      coveredTypes,
      upToDay,
    );
  }

  /**
   * SUPPLIER_STOCK_INTAKE_PLAN.md — informational "Stock on hand" line on the
   * Suppliers page: SUM(quantity_remaining * unit_cost_usd) per supplier,
   * from the cost-batch ledger. Deliberately NOT part of the debt balance
   * (getProductSupplierBalances) — that money question was already answered
   * and settled at intake time; this is display-only current stock value.
   * Rule 13: delegates straight to the repository, no SQL here.
   */
  getProductSupplierStockValue(): {
    supplier_id: number;
    stock_value_usd: number;
  }[] {
    return getStockBatchRepository().getStockValueBySupplier();
  }

  getProductItems(supplierId: number): ProductSupplierItem[] {
    return getProductSupplierRepository().getProductItems(supplierId);
  }

  getSupplierLedger(
    supplierId: number,
    limit?: number,
  ): SupplierLedgerEntryEntity[] {
    return this.repo.getSupplierLedger(supplierId, limit);
  }

  /**
   * LIRA-087 — record a supplier debt without any product line yet (rule
   * 13: no SQL here, the repository owns the write + its own validation).
   */
  recordDebt(data: {
    supplier_id: number;
    amount_usd: number;
    amount_lbp: number;
    note?: string | null;
    created_by: number;
  }): { success: boolean; ledgerEntryId?: number; transactionId?: number; error?: string } {
    try {
      const result = this.repo.recordDebt(data);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: toErrorString(error) };
    }
  }

  /** LIRA-087 — the picker list for stock intake's "attach to a recorded
   *  debt" flow. Rule 13: thin pass-through. */
  getOpenRecordedDebts(supplierId: number): SupplierLedgerEntryEntity[] {
    return this.repo.getOpenRecordedDebts(supplierId);
  }

  getByProvider(provider: string): SupplierEntity | undefined {
    return this.repo.getByProvider(provider);
  }

  getByModuleKey(moduleKey: string): SupplierEntity[] {
    return this.repo.getByModuleKey(moduleKey);
  }

  createSupplier(data: CreateSupplierData): SupplierResult {
    try {
      if (!data.name?.trim())
        return { success: false, error: "Supplier name is required" };
      const res = this.repo.createSupplier(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — thin pass-through (rule
   * 13): every data-dependent invariant (self-parent, chain depth, parent
   * existence/tenant/active, orphaned unsettled rows) lives in the
   * repository, next to the SQL it protects. Only presence-checked here.
   */
  updateSupplierAccountLink(
    data: UpdateSupplierAccountLinkData,
  ): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      if (data.account_supplier_id === undefined)
        return { success: false, error: "account_supplier_id is required" };
      const res = this.repo.updateAccountLink(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /** LIRA-362 — archive/unarchive; every rule lives in the repository. */
  setSupplierArchived(data: SupplierArchiveInput): SupplierResult {
    try {
      if (data.archived) this.repo.archiveSupplier(data.supplier_id);
      else this.repo.unarchiveSupplier(data.supplier_id);
      return { success: true, id: data.supplier_id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  addLedgerEntry(
    data: Omit<CreateSupplierLedgerEntryData, "created_at"> & {
      drawer_name?: string;
      /** LIRA-352 — "Set custom time" (ISO), paper entries only. */
      transaction_time?: string;
    },
  ): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      const { transaction_time, ...entry } = data;
      const timeError = transactionTimeError(transaction_time);
      if (timeError) return { success: false, error: timeError };
      // A dated entry is paper only: a cash entry is a cashflow, which
      // dates its drawer legs and resolves checkpoints (rule 23 reverse —
      // the key is used or refused, never ignored).
      if (transaction_time && entry.drawer_name)
        return {
          success: false,
          error:
            "A custom time is only for entries that move no cash. Record a cash entry as a payment.",
        };
      // `created_at` is a server-side field: a manual entry is "now" unless
      // the operator set a custom time (LIRA-352).
      const res = this.repo.addLedgerEntry({
        ...entry,
        created_at: transaction_time ? toSqliteUtc(transaction_time) : undefined,
      });
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * Atomically settle a batch of financial_services transactions with a supplier.
   * Marks transactions as settled, credits commission to General, debits net payment from drawer.
   */
  settleTransactions(data: SettleTransactionsData): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      if (!data.financial_service_ids?.length)
        return {
          success: false,
          error: "No transactions selected for settlement",
        };
      if (data.amount_usd < 0 || data.amount_lbp < 0)
        return {
          success: false,
          error: "Settlement amounts cannot be negative",
        };
      const res = this.repo.settleTransactions(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, CONTRACT_W2.md §2.1) — thin
   * pass-through (rule 13): validation of the money fields themselves
   * (direction cross-check, per-member commission scoping, etc.) lives in
   * the repository, next to the SQL it protects.
   */
  settleAccount(data: SettleAccountRequest): SupplierResult {
    try {
      if (!data.account_supplier_id)
        return { success: false, error: "account_supplier_id is required" };
      // LIRA-322 — the amount-first path (per_currency): the repository
      // decides what the money covers, inside its own write transaction;
      // the selections/amount checks below belong to the legacy path only.
      if (data.per_currency !== undefined) {
        const timeError = transactionTimeError(data.transaction_time);
        if (timeError) return { success: false, error: timeError };
        // LIRA-345 (S1) — only suppliers on the day calendar settle here
        // (the OMT account, Katsh, active Whish, product suppliers); Loto
        // keeps its checkpoints. The ONE rule: `settlesByDay`.
        if (!this.repo.settlesByDay(data.account_supplier_id))
          return {
            success: false,
            error:
              "This supplier is not settled from the day calendar — use its own settle screen.",
          };
        if (!data.expected_owed)
          return {
            success: false,
            error:
              "The settle sheet did not send what it showed as owed — reopen it and try again.",
          };
        const res = this.repo.settleAccount(data);
        return { success: true, id: res.id };
      }
      const {
        direction,
        selections,
        amount_usd,
        amount_lbp,
        commission_usd,
        commission_lbp,
      } = data;
      if (!selections?.length)
        return {
          success: false,
          error: "No rows selected for account settlement",
        };
      if (
        direction === undefined ||
        amount_usd === undefined ||
        amount_lbp === undefined ||
        commission_usd === undefined ||
        commission_lbp === undefined
      )
        return {
          success: false,
          error:
            "direction, amount_usd, amount_lbp, commission_usd and commission_lbp are required",
        };
      if (amount_usd < 0 || amount_lbp < 0)
        return {
          success: false,
          error: "Settlement amounts cannot be negative",
        };
      const res = this.repo.settleAccount({
        ...data,
        direction,
        selections,
        amount_usd,
        amount_lbp,
        commission_usd,
        commission_lbp,
      });
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * LIRA-344 — "Remove credit" on the OMT Settle Account sheet: close one
   * open account credit OMT will not accept and book it as an expense (no
   * drawer). Thin pass-through (rule 13): every check lives in the
   * repository, inside its own write transaction, next to the rows it
   * protects. Returns the anchor ledger id (`id`) and the settlement
   * transaction id (the one to void to undo it).
   */
  removeAccountCredit(
    data: RemoveAccountCreditData,
  ): SupplierResult & { transaction_id?: number; expense_id?: number } {
    try {
      if (!data.account_supplier_id)
        return { success: false, error: "account_supplier_id is required" };
      if (!data.ledger_row_id)
        return { success: false, error: "ledger_row_id is required" };
      const res = this.repo.removeAccountCredit(data);
      return {
        success: true,
        id: res.id,
        transaction_id: res.transaction_id,
        expense_id: res.expense_id,
      };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  createPurchase(
    data: CreateSupplierPurchaseData,
  ): SupplierPurchase | { success: false; error: string } {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      if (data.total_usd <= 0)
        return { success: false, error: "Amount must be greater than 0" };
      return getSupplierPurchaseRepository().create(data);
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  getSupplierPurchases(supplierId: number): SupplierPurchase[] {
    return getSupplierPurchaseRepository().getBySupplier(supplierId);
  }

  /**
   * Pay a supplier down / record a supplier paying us, via payment-method legs.
   * Routes cash to the correct drawer and works with zero pending transactions.
   */
  recordSupplierCashflow(data: SupplierCashflowData): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      // LIRA-351: Loto is paid only from Settle Account (tied to its days);
      // its old Pay / Receive and the cash side of Add Credit / Debt go.
      if (this.repo.findById(data.supplier_id)?.provider === "LOTO")
        return { success: false, error: LOTO_PAY_MOVED_MESSAGE };
      if (!data.payments?.length)
        return {
          success: false,
          error: "At least one payment leg is required",
        };
      const timeError = transactionTimeError(data.transaction_time);
      if (timeError) return { success: false, error: timeError };
      const res = this.repo.recordSupplierCashflow(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  // D8 (owner decision, SUPPLIER_STOCK_INTAKE_PLAN.md): writeOffSupplierDebt
  // (standalone write-off with no cashflow attached) was REMOVED. The
  // bundled Pay-form discount (recordSupplierCashflow's PAY-direction
  // branch → postSupplierBundledDiscount) is the only supported forgive-a-payable
  // path now. See BUILD_CONTRACT.md handoffs for every caller that still
  // references the removed method.
}

/** "Set custom time" — the ONE check every supplier form shares (rule 14):
 *  a valid instant, not in the future. `null` when fine or absent. */
function transactionTimeError(time: string | undefined): string | null {
  if (!time) return null;
  const at = new Date(time);
  if (isNaN(at.getTime())) return "Invalid transaction_time format";
  if (at > new Date()) return "transaction_time cannot be in the future";
  return null;
}

/** `YYYY-MM-DD 00:00:00` for a UTC midnight epoch (the format `created_at`
 *  is stored in), built from UTC getters only. */
function utcStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 00:00:00`;
}

let supplierServiceInstance: SupplierService | null = null;
export function getSupplierService(): SupplierService {
  if (!supplierServiceInstance) supplierServiceInstance = new SupplierService();
  return supplierServiceInstance;
}
export function resetSupplierService(): void {
  supplierServiceInstance = null;
}
