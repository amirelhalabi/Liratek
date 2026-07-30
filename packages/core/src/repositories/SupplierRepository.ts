import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import {
  TRANSACTION_TYPES,
  type TransactionType,
} from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { buildCounterpartyMetadata } from "../validators/counterparty.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  buildCounterpartyDiscountPosting,
} from "./moneyPosting.js";

export interface SupplierEntity {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  is_active: number;
  module_key: string | null;
  provider: string | null;
  is_system: number;
  created_at: string;
}

export type SupplierLedgerEntryType =
  | "TOP_UP"
  /** Sale cost consumed from a provider balance (cost/price-flow SEND). Increases
   *  what the shop owes the supplier, like TOP_UP, but labeled distinctly so it can
   *  be reconciled as a real sale cost rather than a manual top-up. */
  | "SALE_COST"
  | "PAYMENT"
  | "ADJUSTMENT"
  | "SETTLEMENT"
  | "CASH_PRIZE"
  /** The supplier paid the shop (e.g. settling an overpayment they owed us).
   *  Positive ledger amount (mirror of PAYMENT) with cash CREDITED to the
   *  payment-method drawer. */
  | "SUPPLIER_PAYS_US"
  /** CQ-10 (v131): the supplier forgives part of what the shop owes them.
   *  Negative ledger amount (mirror of PAYMENT — reduces what we owe), NO
   *  cash movement (no drawer/payments row) — see SupplierRepository's
   *  _postSupplierDiscount. */
  | "DISCOUNT";

export interface SupplierLedgerEntryEntity {
  id: number;
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_by: number | null;
  transaction_id: number | null;
  is_auto: number;
  /** 1 = soft-voided (its transaction was voided/refunded) — excluded from every balance/pool aggregate. */
  is_refunded: number;
  refunded_at: string | null;
  /** LIRA-091 (v136): back-link to the PARENT transaction's own source row
   *  (mirrors transactions.source_table/source_id) for an auto-generated
   *  sibling row — lets TransactionRepository cascade-void this row when the
   *  parent is voided/refunded. NULL for manual entries and for rows created
   *  before the migration (legacy, not backfilled). */
  source_ref_table: string | null;
  source_ref_id: number | null;
  created_at: string;
}

/**
 * Rule-14 fragment: excludes soft-voided ledger rows (their transaction was
 * voided/refunded via TransactionRepository._markSourceRefunded) from every
 * balance/pool aggregate. Flagging the ORIGINAL row is the only mechanism
 * that keeps the sign-bucketed FIFO pools correct — a compensating row of
 * either sign lands in the wrong pool.
 */
const ledgerNotRefunded = (alias = ""): string =>
  `COALESCE(${alias}is_refunded, 0) = 0`;

export interface SettleTransactionsData {
  supplier_id: number;
  /** IDs from financial_services to mark as settled */
  financial_service_ids: number[];
  /**
   * Net amount paid to the supplier. Under the OMT/WHISH float model
   * (owner-confirmed 2026-07-29), `financial_services.supplier_owed` /
   * `supplier_ledger` TOP_UP rows are booked FEE-ONLY — already net of the
   * shop's commission (`feeOwedDelta` = |fee| − |commission|,
   * FinancialServiceRepository.ts) — so this figure is simply the sum of
   * the outstanding `supplier_owed` for `financial_service_ids`. It must
   * NOT be further reduced by `commission_usd`/`commission_lbp` below — the
   * commission is already excluded from the owed figure, and subtracting it
   * again double-nets the shop's cut out of the payment (the caller's own
   * bug this settlement redesign fixes; see Suppliers/index.tsx).
   */
  amount_usd: number;
  amount_lbp: number;
  /**
   * Total commission this batch represents — INFORMATIONAL ONLY (audit/
   * display), stamped onto the settlement transaction's metadata. It has NO
   * drawer or ledger effect: under the fee-only model the shop's cut is
   * already excluded from `amount_usd`/`amount_lbp` (and from the TOP_UP
   * rows being settled), so there is nothing left to "fund" or "realize"
   * here — the commission simply falls out of General as the difference
   * between what the customer paid (fee f, at transaction time) and what
   * gets remitted to the provider (f − c, here). Pre-fix, this field drove a
   * separate `General += commission` / settle-drawer `−= commission` pair
   * plus a `SUPPLIER_PAYS_US` ledger row — both are REMOVED (they duplicated
   * money already reflected in the fee-only TOP_UP/SETTLEMENT pair).
   */
  commission_usd: number;
  commission_lbp: number;
  /**
   * @deprecated No longer used to move money. Under the float model,
   * OMT_System/Whish_System is the provider float itself, not a real cash
   * drawer — settlement now pays the net amount EXCLUSIVELY through
   * `payments[]` (real payment-method legs, same as `recordSupplierCashflow`),
   * never a bare named drawer. Kept optional for backward-compatible typing
   * only; any value passed here is ignored.
   */
  drawer_name?: string;
  note?: string;
  created_by: number;
  /**
   * Payment-method legs the net amount is actually paid through (CASH →
   * General, wallet methods → their own drawer, …) — REQUIRED whenever
   * `amount_usd`/`amount_lbp` is nonzero (mirrors `recordSupplierCashflow`'s
   * own `payments` requirement). A settlement that nets to $0 (commission
   * alone offsets what's owed) needs no legs.
   */
  payments?: Array<{ method: string; currency_code: string; amount: number }>;
}

/**
 * Pay a supplier / record a supplier paying us, using real payment-method legs
 * (MultiPaymentInput) so the CORRECT drawer is debited/credited — not the
 * provider's own stock drawer. Works with zero pending transactions to settle
 * (pure balance pay-down / receipt).
 */
/** CQ-10 — a discount/write-off amount bundled with a cashflow, or posted
 *  standalone. amount_usd/amount_lbp are the FORGIVEN amounts (always
 *  treated as positive magnitudes regardless of sign supplied). */
export interface SupplierDiscountData {
  amount_usd: number;
  amount_lbp: number;
  reason?: string;
}

export interface SupplierCashflowData {
  supplier_id: number;
  /** PAY = shop pays the supplier (cash out, ledger −). RECEIVE = supplier pays
   *  the shop (cash in, ledger +). */
  direction: "PAY" | "RECEIVE";
  /** Payment-method legs; each routes to its method's drawer. */
  payments: Array<{ method: string; currency_code: string; amount: number }>;
  note?: string;
  created_by: number;
  /** Exchange rate (1 USD = X LBP) used to convert LBP legs to USD when
   *  applying FIFO coverage to supplier_purchases. Defaults to 89 000. */
  exchange_rate?: number;
  /** CQ-10 — bundled discount: "owed X, paid Y, discount Z". ONLY valid on
   *  PAY direction (a supplier can't simultaneously pay the shop AND forgive
   *  what the shop owes them) — recordSupplierCashflow throws otherwise.
   *  Posts its OWN 'DISCOUNT' supplier_ledger row + COUNTERPARTY_DISCOUNT
   *  transaction. */
  discount?: SupplierDiscountData;
}

export interface CreateSupplierData {
  name: string;
  contact_name?: string;
  phone?: string;
  note?: string;
  module_key?: string;
  provider?: string;
}

export interface CreateSupplierLedgerEntryData {
  supplier_id: number;
  entry_type: SupplierLedgerEntryType;
  amount_usd: number;
  amount_lbp: number;
  note?: string;
  created_by: number;
  drawer_name?: string;
  is_auto?: boolean;
  /** Real payment-method leg for the PAYMENT+drawer branch's `payments` row.
   *  Defaults to "CASH" — behavior-identical for existing callers that never
   *  pass it (CQ-7: the branch used to hardcode 'CASH' unconditionally). */
  method?: string;
  /**
   * Link-mode (CQ-7): when provided, the ledger row is stamped with this
   * EXISTING transactions.id and addLedgerEntry creates NO new transaction
   * row — the caller's own flow (e.g. RechargeRepository.topUpFromSupplier,
   * LotoTicketRepository, LotoCashPrizeRepository) already created its own
   * unified transaction (and owns any drawer movement) inside the SAME
   * db.transaction(). When omitted, addLedgerEntry creates its own
   * journal transaction row, as before.
   */
  transaction_id?: number;
  /**
   * LIRA-091 (v136): stamp this auto-generated row with a back-link to the
   * PARENT transaction's own source row (e.g. `source_ref_table:
   * "financial_services", source_ref_id: <fs id>`) so TransactionRepository
   * can find and cascade-void it when the parent is voided/refunded. Only
   * meaningful for is_auto:true, separate-hidden-transaction callers
   * (FinancialServiceRepository's BILL/SEND/RECEIVE auto rows) — link-mode
   * callers (transaction_id set) already share the parent's own transaction
   * row and must NOT set this (their supplier_ledger.transaction_id already
   * points AT the parent's transaction, so stamping source_ref too would
   * make the generic cascade call _voidTransactionInternal on its own
   * in-flight parent transaction).
   */
  source_ref_table?: string;
  source_ref_id?: number;
}

export interface SupplierBalance {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
}

export class SupplierRepository extends BaseRepository<SupplierEntity> {
  constructor() {
    super("suppliers", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at";
  }

  listSuppliers(search?: string, includeInactive?: boolean): SupplierEntity[] {
    try {
      const tenantId = getCurrentTenantId();
      // Hide the SECONDARY OMT/WHISH system: it has no direct supplier relationship
      // (its obligations live in partner_ledger), so it shouldn't appear on the
      // suppliers page. The shop's base system is the only legacy system shown.
      let sql = includeInactive
        ? `SELECT ${this.getColumns()} FROM suppliers WHERE tenant_id = ?`
        : `SELECT ${this.getColumns()} FROM suppliers WHERE tenant_id = ? AND is_active = 1
             AND NOT (COALESCE(provider, '') IN ('OMT', 'WHISH')
                      AND provider <> COALESCE(
                        (SELECT value FROM system_settings WHERE key_name = 'shop_base_system' AND tenant_id = suppliers.tenant_id),
                        'OMT'))`;
      const params: (string | number)[] = [tenantId];
      if (search?.trim()) {
        sql += ` AND name LIKE ?`;
        params.push(`%${search.trim()}%`);
      }
      sql += ` ORDER BY name ASC`;
      return this.query<SupplierEntity>(sql, ...params);
    } catch (e) {
      throw new DatabaseError("Failed to list suppliers", { cause: e });
    }
  }

  createSupplier(data: CreateSupplierData): { id: number } {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO suppliers (name, contact_name, phone, note, module_key, provider, is_active, tenant_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(
        data.name.trim(),
        data.contact_name ?? null,
        data.phone ?? null,
        data.note ?? null,
        data.module_key ?? null,
        data.provider ?? null,
        getCurrentTenantId(),
      );
      return { id: Number(res.lastInsertRowid) };
    } catch (e) {
      throw new DatabaseError("Failed to create supplier", { cause: e });
    }
  }

  getByProvider(provider: string): SupplierEntity | undefined {
    try {
      const rows = this.query<SupplierEntity>(
        `SELECT ${this.getColumns()} FROM suppliers WHERE provider = ? AND is_active = 1 AND tenant_id = ? LIMIT 1`,
        provider,
        getCurrentTenantId(),
      );
      return rows[0];
    } catch (e) {
      throw new DatabaseError("Failed to get supplier by provider", {
        cause: e,
      });
    }
  }

  getByModuleKey(moduleKey: string): SupplierEntity[] {
    try {
      return this.query<SupplierEntity>(
        `SELECT ${this.getColumns()} FROM suppliers WHERE module_key = ? AND is_active = 1 AND tenant_id = ? ORDER BY name ASC`,
        moduleKey,
        getCurrentTenantId(),
      );
    } catch (e) {
      throw new DatabaseError("Failed to get suppliers by module", {
        cause: e,
      });
    }
  }

  /**
   * CQ-8: cheap supplier-name lookup for the `counterparty` metadata
   * contract. Falls back to a placeholder rather than throwing — a
   * missing/deleted supplier must never block a payment/settlement write.
   */
  private _getSupplierName(supplierId: number): string {
    const row = this.db
      .prepare(`SELECT name FROM suppliers WHERE id = ? AND tenant_id = ?`)
      .get(supplierId, getCurrentTenantId()) as { name: string } | undefined;
    return row?.name ?? `Supplier #${supplierId}`;
  }

  /**
   * True when the connected `supplier_ledger` table already carries the v136
   * source_ref_table/source_ref_id columns. `packages/core` jest specs
   * hand-roll a fresh in-memory schema per file (dozens of pre-existing
   * fixtures predate this migration); writing an INSERT that references a
   * column the connected schema doesn't have would throw — and this
   * particular INSERT is wrapped by every caller's own non-critical try/catch
   * (`FinancialServiceRepository`'s "Supplier auto-record is non-critical"),
   * so the whole ledger row would silently vanish instead of erroring loudly.
   * Checked once per call (PRAGMA is cheap; this is not a hot path) rather
   * than cached, mirroring `TransactionRepository`'s identical guard for the
   * void-cascade side of this same migration.
   */
  private _supplierLedgerHasSourceRefColumns(): boolean {
    const cols = this.db
      .prepare(`PRAGMA table_info(supplier_ledger)`)
      .all() as { name: string }[];
    return (
      cols.some((c) => c.name === "source_ref_table") &&
      cols.some((c) => c.name === "source_ref_id")
    );
  }

  addLedgerEntry(data: CreateSupplierLedgerEntryData): { id: number } {
    // CQ-7 dead corner: a drawer_name only ever makes sense on a PAYMENT row
    // (the only branch that has ever consumed it — verified against every
    // caller). Every other combo silently did nothing pre-fix; reject it
    // outright rather than resurrect the silent no-op.
    if (data.drawer_name && data.entry_type !== "PAYMENT") {
      throw new DatabaseError(
        `addLedgerEntry: drawer_name is only valid with entry_type "PAYMENT" (got "${data.entry_type}")`,
      );
    }
    // LIRA-091: link-mode (transaction_id set) means this row shares the
    // CALLER's own transaction — source_ref would make the void cascade call
    // _voidTransactionInternal on that same in-flight parent (self-void).
    // Only is_auto:true, separate-hidden-transaction callers set source_ref.
    if (data.transaction_id != null && data.source_ref_table) {
      throw new DatabaseError(
        `addLedgerEntry: source_ref_table/source_ref_id cannot be combined with link-mode (transaction_id) — link-mode rows already share the parent's own transaction`,
      );
    }

    try {
      const tenantId = getCurrentTenantId();
      // Enforce sign convention: PAYMENT amounts stored as negative
      let amountUsd = data.amount_usd || 0;
      let amountLbp = data.amount_lbp || 0;
      if (data.entry_type === "PAYMENT") {
        amountUsd = -Math.abs(amountUsd);
        amountLbp = -Math.abs(amountLbp);
      }

      const hasSourceRef = this._supplierLedgerHasSourceRefColumns();
      const stmt = hasSourceRef
        ? this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, is_auto,
          transaction_id, source_ref_table, source_ref_id, tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
        : this.db.prepare(`
        INSERT INTO supplier_ledger (
          supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, is_auto,
          transaction_id, tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const res = hasSourceRef
        ? stmt.run(
            data.supplier_id,
            data.entry_type,
            amountUsd,
            amountLbp,
            data.note ?? null,
            data.created_by,
            data.is_auto ? 1 : 0,
            data.transaction_id ?? null,
            data.source_ref_table ?? null,
            data.source_ref_id ?? null,
            tenantId,
          )
        : stmt.run(
            data.supplier_id,
            data.entry_type,
            amountUsd,
            amountLbp,
            data.note ?? null,
            data.created_by,
            data.is_auto ? 1 : 0,
            data.transaction_id ?? null,
            tenantId,
          );
      const entryId = Number(res.lastInsertRowid);

      // Link-mode (CQ-7): the caller's OWN flow already created a unified
      // transaction (and owns any drawer movement) inside the SAME
      // db.transaction() — stamp it and stop. Creating a second transaction
      // row here would double-book the same event.
      if (data.transaction_id) {
        return { id: entryId };
      }

      // If drawer_name is provided, update drawer_balances
      if (data.drawer_name) {
        // Guaranteed entry_type === "PAYMENT" by the guard above (the only
        // combo drawer_name has ever been paired with).
        // Create unified transaction row for supplier payment
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          source_table: "supplier_ledger",
          source_id: entryId,
          user_id: data.created_by,
          amount_usd: Math.abs(amountUsd),
          amount_lbp: Math.abs(amountLbp),
          summary: `Supplier Payment: $${Math.abs(amountUsd)} + ${Math.abs(amountLbp)} LBP — paid to ${this._getSupplierName(data.supplier_id)}`,
          metadata_json: {
            supplier_id: data.supplier_id,
            drawer_name: data.drawer_name,
            // CQ-8 counterparty contract: this branch is guaranteed
            // entry_type === "PAYMENT" (guard above) — the shop always pays
            // OUT of the drawer here.
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: "OUT",
              method: data.method ?? "CASH",
              ledgerEntryId: entryId,
            }),
          },
        });

        // Link supplier_ledger row to unified transaction
        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, entryId, tenantId);

        if (amountUsd)
          applyDrawerDelta(this.db, {
            drawerName: data.drawer_name,
            currencyCode: "USD",
            delta: amountUsd,
            tenantId,
          });
        if (amountLbp)
          applyDrawerDelta(this.db, {
            drawerName: data.drawer_name,
            currencyCode: "LBP",
            delta: amountLbp,
            tenantId,
          });

        // Log to payments table. `method` defaults to "CASH" (CQ-7: this
        // branch used to hardcode the literal 'CASH' regardless of how the
        // supplier was actually paid).
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: data.method ?? "CASH",
          drawerName: data.drawer_name,
          currencyCode: amountUsd ? "USD" : "LBP",
          amount: amountUsd || amountLbp,
          note: data.note || `Supplier Payment: ${data.supplier_id}`,
          createdBy: data.created_by,
          tenantId,
        });
      } else {
        // No drawer_name: still create a transaction record for EVERY entry
        // type — including PAYMENT (CQ-7 dead-corner fix: pre-fix a
        // no-drawer PAYMENT wrote a supplier_ledger row with NO transaction
        // row at all) — so it appears in the unified journal.
        const typeMap: Record<string, string> = {
          TOP_UP: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          SALE_COST: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          PAYMENT: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          // LIRA-080: a manual (no-drawer) ADJUSTMENT is a paper (no-cash)
          // supplier_ledger correction — the Suppliers-page "Add Credit / Debt"
          // toggle-OFF entry. It gets its OWN unified type so the Transactions
          // viewer renders NO cash-flow badge (getCashFlowDirection returns
          // null for SUPPLIER_ADJUSTMENT); routing it through SUPPLIER_PAYMENT
          // would paint a misleading green "in" arrow on a row where no cash
          // moved. The cash-moved counterpart never reaches here — it goes
          // through recordSupplierCashflow (→ SUPPLIER_PAYMENT). Sibling of
          // PARTNER_ADJUSTMENT/ACCOUNT_ADJUSTMENT.
          ADJUSTMENT: TRANSACTION_TYPES.SUPPLIER_ADJUSTMENT,
          SETTLEMENT: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
        };
        const txnType =
          typeMap[data.entry_type] || TRANSACTION_TYPES.SUPPLIER_PAYMENT;

        // SUPPLIER_PAYS_US through this path is a *cashless credit* — the
        // supplier owes us (e.g. the fixed commission on an iPick/Katsh bill);
        // no drawer moves. The supplier_ledger keeps the signed amount
        // (negative = credit to us, so SUM stays a valid balance), but the
        // unified journal is an event log: store a positive magnitude and flag
        // it as a credit so the UI shows money owed to us, not a negative
        // "payment". (recordSupplierCashflow handles the real cash RECEIVE.)
        const isSupplierCredit = data.entry_type === "SUPPLIER_PAYS_US";
        // PAYMENT's ledger sign is the force-negated bookkeeping convention
        // applied above, not the event's natural value — show the paid
        // magnitude, same as the drawer-based PAYMENT branch above.
        const showMagnitude = isSupplierCredit || data.entry_type === "PAYMENT";
        const journalUsd = showMagnitude ? Math.abs(amountUsd) : amountUsd;
        const journalLbp = showMagnitude ? Math.abs(amountLbp) : amountLbp;

        let summary: string;
        if (isSupplierCredit) {
          const parts: string[] = [];
          if (journalUsd) parts.push(`$${journalUsd.toLocaleString()}`);
          if (journalLbp) parts.push(`${journalLbp.toLocaleString()} LBP`);
          summary = `Supplier credit: ${parts.join(" + ") || "$0"}`;
        } else if (data.entry_type === "PAYMENT") {
          summary = `Supplier Payment: $${journalUsd} + ${journalLbp} LBP — paid to ${this._getSupplierName(data.supplier_id)}`;
        } else if (data.entry_type === "ADJUSTMENT") {
          // LIRA-080 — paper (no-cash) manual adjustment. Sign carries the
          // direction: CREDIT (+) = shop owes supplier more; DEBIT (−) =
          // reduces what we owe. Mirrors the Accounts-page paper wording.
          const isCredit = (amountUsd || amountLbp) >= 0;
          summary = `Supplier ${
            isCredit ? "Credit" : "Debit"
          } (paper, no cash moved): $${Math.abs(amountUsd)} + ${Math.abs(
            amountLbp,
          )} LBP — ${this._getSupplierName(data.supplier_id)}`;
        } else {
          summary = `Supplier ${data.entry_type}: $${amountUsd} + ${amountLbp} LBP`;
        }

        // CQ-8 counterparty contract flow: PAYMENT always pays cash OUT;
        // SUPPLIER_PAYS_US is the supplier crediting the shop (IN), even
        // when cashless; every other entry_type (TOP_UP/SALE_COST/
        // ADJUSTMENT) is a non-cash accrual — direction follows the same
        // sign the ledger itself uses ("+ = shop owes supplier" reads as the
        // supplier extending value to the shop → IN; a negative correction
        // reads the same direction as a PAYMENT → OUT).
        const counterpartyFlow: "IN" | "OUT" =
          data.entry_type === "PAYMENT"
            ? "OUT"
            : isSupplierCredit
              ? "IN"
              : (amountUsd || amountLbp) < 0
                ? "OUT"
                : "IN";

        const txnId = getTransactionRepository().createTransaction({
          type: txnType as TransactionType,
          source_table: "supplier_ledger",
          source_id: entryId,
          user_id: data.created_by,
          amount_usd: journalUsd,
          amount_lbp: journalLbp,
          summary,
          metadata_json: {
            supplier_id: data.supplier_id,
            entry_type: data.entry_type,
            ...(isSupplierCredit ? { is_credit: true } : {}),
            // No `payments` row is ever inserted on this branch (no drawer
            // moves) — method is the journal-only marker, never a real
            // payment/settlement method.
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: counterpartyFlow,
              method: "LEDGER",
              ledgerEntryId: entryId,
            }),
            // D2 (owner decision 2026-07-18): manual supplier payments show
            // on the Transactions page by default; auto-generated rows
            // (RechargeRepository/FinancialServiceRepository/Loto auto
            // supplier debt) stay behind the filter. This is the ONLY
            // addLedgerEntry branch that creates its own transaction row for
            // an is_auto:true caller (link-mode callers own their own
            // transaction's metadata and are out of this ticket's scope).
            ...(data.is_auto ? { is_auto: true } : {}),
          },
        });

        // Link supplier_ledger row to unified transaction
        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, entryId, tenantId);
      }

      return { id: entryId };
    } catch (e) {
      throw new DatabaseError("Failed to add supplier ledger entry", {
        cause: e,
      });
    }
  }

  getSupplierLedger(
    supplierId: number,
    limit = 200,
  ): SupplierLedgerEntryEntity[] {
    try {
      // LIRA-091: source_ref_table/source_ref_id only selected when present
      // (see _supplierLedgerHasSourceRefColumns) — same schema-drift guard as
      // addLedgerEntry's INSERT, so this stays safe against pre-v136 fixtures.
      const cols = this._supplierLedgerHasSourceRefColumns()
        ? "id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, source_ref_table, source_ref_id, created_at"
        : "id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id, is_auto, is_refunded, refunded_at, created_at";
      return this.query<SupplierLedgerEntryEntity>(
        `SELECT ${cols} FROM supplier_ledger WHERE supplier_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT ?`,
        supplierId,
        getCurrentTenantId(),
        limit,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get supplier ledger", {
        cause: e,
        entityId: supplierId,
      });
    }
  }

  getManualPaymentPools(supplierId: number): {
    send_pool_usd: number;
    receive_pool_usd: number;
  } {
    try {
      const row = this.db
        .prepare(
          `SELECT
            ABS(COALESCE(SUM(CASE WHEN amount_usd < 0 THEN amount_usd ELSE 0 END), 0)) as send_pool_usd,
            COALESCE(SUM(CASE WHEN amount_usd > 0 THEN amount_usd ELSE 0 END), 0) as receive_pool_usd
          FROM supplier_ledger
          WHERE supplier_id = ? AND is_auto = 0 AND tenant_id = ? AND ${ledgerNotRefunded()}`,
        )
        .get(supplierId, getCurrentTenantId()) as
        | { send_pool_usd: number; receive_pool_usd: number }
        | undefined;
      return row ?? { send_pool_usd: 0, receive_pool_usd: 0 };
    } catch (e) {
      throw new DatabaseError("Failed to get manual payment pools", {
        cause: e,
      });
    }
  }

  /**
   * Balance for product suppliers: inventory cost minus payments.
   * inventory cost = Σ(p.quantity * p.cost) for products from this supplier.
   * payments = existing supplier_ledger entries (PAYMENT stored as negative).
   * Returns only is_system = 0 suppliers that have a linked product_suppliers row.
   */
  getProductSupplierBalances(): SupplierBalance[] {
    try {
      const tenantId = getCurrentTenantId();
      return this.query<SupplierBalance>(
        `
        SELECT
          s.id as supplier_id,
          ROUND(
            COALESCE(inv.inv_usd, 0) + COALESCE(SUM(l.amount_usd), 0),
            2
          ) as total_usd,
          0 as total_lbp
        FROM suppliers s
        JOIN product_suppliers ps ON ps.supplier_id = s.id AND ps.tenant_id = s.tenant_id
        LEFT JOIN (
          SELECT ps2.supplier_id, ps2.tenant_id,
                 SUM(p.stock_quantity * p.cost_price_usd) as inv_usd
          FROM product_suppliers ps2
          JOIN products p ON LOWER(p.supplier) = LOWER(ps2.name) AND p.is_active = 1
            AND p.tenant_id = ps2.tenant_id
          WHERE ps2.supplier_id IS NOT NULL AND ps2.tenant_id = ?
          GROUP BY ps2.supplier_id, ps2.tenant_id
        ) inv ON inv.supplier_id = s.id AND inv.tenant_id = s.tenant_id
        LEFT JOIN supplier_ledger l ON l.supplier_id = s.id AND l.tenant_id = s.tenant_id AND ${ledgerNotRefunded("l.")}
        WHERE s.is_system = 0 AND s.is_active = 1 AND s.tenant_id = ?
        GROUP BY s.id
        ORDER BY s.name ASC
      `,
        tenantId,
        tenantId,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get product supplier balances", {
        cause: e,
      });
    }
  }

  getSupplierBalances(includeInactive?: boolean): SupplierBalance[] {
    try {
      const tenantId = getCurrentTenantId();
      // Hide the SECONDARY OMT/WHISH system (obligations live in partner_ledger).
      // COALESCE the NULL provider: `NULL IN (...)` is SQL NULL, and
      // `NOT (NULL AND …)` is NULL too — without it, every provider-less
      // supplier was silently dropped from the balances list (latent bug
      // caught by lira-web-015).
      const filter = includeInactive
        ? "s.tenant_id = ?"
        : `s.tenant_id = ? AND s.is_active = 1
           AND NOT (COALESCE(s.provider, '') IN ('OMT', 'WHISH')
                    AND s.provider <> COALESCE(
                      (SELECT value FROM system_settings WHERE key_name = 'shop_base_system' AND tenant_id = s.tenant_id),
                      'OMT'))`;
      return this.query<SupplierBalance>(
        `
        SELECT
          s.id as supplier_id,
          COALESCE(SUM(l.amount_usd), 0) as total_usd,
          COALESCE(SUM(l.amount_lbp), 0) as total_lbp
        FROM suppliers s
        LEFT JOIN supplier_ledger l ON l.supplier_id = s.id AND l.tenant_id = s.tenant_id AND ${ledgerNotRefunded("l.")}
        WHERE ${filter}
        GROUP BY s.id
        ORDER BY s.name ASC
      `,
        tenantId,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get supplier balances", { cause: e });
    }
  }

  /**
   * Atomically settle a batch of financial_services transactions with a supplier.
   *
   * OMT/WHISH float model (owner-confirmed 2026-07-29; replaces the old
   * "Fix C funded commission" design): `supplier_ledger` TOP_UP rows for
   * OMT/WHISH are now booked FEE-ONLY (`|fee| − |commission|` —
   * `feeOwedDelta`, FinancialServiceRepository.ts) — the shop's commission
   * is ALREADY excluded from what's owed. Settlement therefore does nothing
   * but pay off that same fee-net figure and mark the rows settled; there is
   * no separate "realize the commission" step anymore (no drawer funding,
   * no `SUPPLIER_PAYS_US` credit row) — that machinery existed only to
   * carve `c` back out of a GROSS TOP_UP (`amount + fee`), which no longer
   * exists. `OMT_System`/`Whish_System` (the provider float) is NEVER
   * touched here — it already moved by the transfer's principal at SEND/
   * RECEIVE time and settlement covers the fee split only.
   *
   * In a single DB transaction:
   * 1. Insert a SETTLEMENT-typed supplier_ledger entry (negative = shop
   *    paying out `amount_usd`/`amount_lbp`, the fee-net amount already
   *    owed — nets the ledger to 0 against the TOP_UP rows being settled)
   * 2. Mark all specified financial_services rows as is_settled = 1
   * 3. Create unified transactions row for audit trail (commission stamped
   *    as informational metadata only — no drawer effect)
   * 4. Debit the net payment through real payment-method legs (`payments[]`,
   *    same mechanism as `recordSupplierCashflow`) — never a bare named
   *    drawer (see `SettleTransactionsData.drawer_name`'s deprecation)
   */
  settleTransactions(data: SettleTransactionsData): { id: number } {
    if (!data.financial_service_ids.length) {
      throw new DatabaseError("No transactions selected for settlement");
    }
    const owesCash =
      Math.abs(data.amount_usd) > 0.005 || Math.abs(data.amount_lbp) > 0.005;
    if (owesCash && !data.payments?.length) {
      throw new DatabaseError(
        "Settlement requires at least one payment-method leg to pay the net amount owed",
      );
    }

    try {
      const tenantId = getCurrentTenantId();
      const settle = this.db.transaction(() => {
        // Timestamps are stamped by SQLite (datetime('now')) so they share the
        // 'YYYY-MM-DD HH:MM:SS' format of every CURRENT_TIMESTAMP column. A JS
        // toISOString() here ('...T...Z') string-sorts ABOVE all space-format
        // rows of the same day, pinning settlement rows to the top of every
        // ORDER BY created_at DESC list (A6).

        // ── 1. Insert SETTLEMENT ledger entry (net paid to supplier, stored negative) ──
        const netUsd = -Math.abs(data.amount_usd);
        const netLbp = -Math.abs(data.amount_lbp);
        const ledgerRes = this.db
          .prepare(
            `INSERT INTO supplier_ledger
               (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
             VALUES (?, 'SETTLEMENT', ?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            data.supplier_id,
            netUsd,
            netLbp,
            data.note ?? null,
            data.created_by,
            tenantId,
          );
        const ledgerEntryId = Number(ledgerRes.lastInsertRowid);

        // ── 2. Mark financial_services rows as settled ─────────────────────
        // Guard on settlement_id IS NULL (not is_settled = 0): OMT/WHISH commission
        // rows are is_settled = 0 while pending, but cost/price-flow SALE_COST rows are
        // is_settled = 1 at creation (profit realized immediately) yet still carry an
        // outstanding supplier debt until settlement_id is stamped here. Both share
        // settlement_id IS NULL as the "supplier debt outstanding" marker.
        const placeholders = data.financial_service_ids
          .map(() => "?")
          .join(",");
        this.db
          .prepare(
            `UPDATE financial_services
             SET is_settled = 1,
                 settled_at = datetime('now'),
                 settlement_id = ?
             WHERE id IN (${placeholders})
               AND settlement_id IS NULL
               AND tenant_id = ?`,
          )
          .run(ledgerEntryId, ...data.financial_service_ids, tenantId);

        // ── 3. Create unified transaction for audit trail ──────────────────
        // CQ-7: funneled through the single createTransaction() gate instead
        // of a raw INSERT — the row now gains the funnel's completeness
        // guards and exchange-rate snapshot (previously always NULL here).
        //
        // Float model (owner-confirmed 2026-07-29): NO separate "realize the
        // commission" step exists anymore. `commission_usd`/`commission_lbp`
        // are stamped below purely as audit metadata — under the fee-only
        // model the shop's cut is already excluded from `amount_usd`/
        // `amount_lbp` (and from the TOP_UP rows being settled), so there is
        // nothing left to fund/credit here; the old `General += commission` /
        // settle-drawer `-= commission` pair plus the `SUPPLIER_PAYS_US`
        // ledger row are REMOVED — they existed only to carve `c` back out of
        // a GROSS TOP_UP that no longer exists.
        const settlementMethod =
          data.payments && data.payments.length > 0
            ? data.payments.length === 1
              ? data.payments[0].method
              : "SPLIT"
            : "CASH";
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
          source_table: "supplier_ledger",
          source_id: ledgerEntryId,
          user_id: data.created_by,
          amount_usd: data.amount_usd,
          amount_lbp: data.amount_lbp,
          summary: `Settlement: ${data.financial_service_ids.length} txns, net $${data.amount_usd.toFixed(2)}`,
          metadata_json: {
            supplier_id: data.supplier_id,
            financial_service_ids: data.financial_service_ids,
            // Informational only (audit/display) — see doc comment above and
            // on SettleTransactionsData.commission_usd/commission_lbp.
            commission_usd: data.commission_usd,
            commission_lbp: data.commission_lbp,
            // CQ-8 counterparty contract: a settlement pays the supplier's
            // net amount OUT of the drawer.
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: "OUT",
              method: settlementMethod,
              ledgerEntryId: ledgerEntryId,
            }),
          },
        });

        // Link ledger entry to unified transaction
        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, ledgerEntryId, tenantId);

        // ── 4. Debit the net payment through real payment-method legs ─────
        // (same mechanism recordSupplierCashflow uses) — the ONLY way money
        // moves here. No bare `drawer_name` fallback: the constructor guard
        // above already refused a nonzero amount with no legs, so this loop
        // is the sole payer whenever cash actually changes hands.
        if (data.payments && data.payments.length > 0) {
          for (const p of data.payments) {
            if (!isDrawerAffectingMethod(p.method)) continue;
            const drawerName = paymentMethodToDrawerName(p.method);
            applyDrawerDelta(this.db, {
              drawerName,
              currencyCode: p.currency_code,
              delta: -Math.abs(p.amount),
              tenantId,
            });
            insertPaymentRow(this.db, {
              transactionId: txnId,
              method: p.method,
              drawerName,
              currencyCode: p.currency_code,
              amount: -Math.abs(p.amount),
              note: data.note ?? "Settlement payment",
              createdBy: data.created_by,
              tenantId,
            });
          }
        }

        return { id: ledgerEntryId };
      });

      return settle();
    } catch (e) {
      throw new DatabaseError("Failed to settle transactions", { cause: e });
    }
  }

  /**
   * Record a direct supplier cash flow that is NOT tied to settling specific
   * transactions — paying a supplier down, or a supplier paying us back.
   *
   * Uses real payment-method legs so the cash hits the CORRECT drawer (General
   * for CASH, the wallet drawer for WHISH/OMT, etc.) — never the provider's own
   * stock drawer. Works with zero pending transactions.
   *
   *   PAY     → ledger −amount (we owe less), drawer −amount (cash out)
   *   RECEIVE → ledger +amount (their debt to us settled), drawer +amount (cash in)
   */
  recordSupplierCashflow(data: SupplierCashflowData): { id: number } {
    if (!data.payments?.length) {
      throw new DatabaseError("No payment legs provided");
    }
    // CQ-10: a discount only makes sense on a PAY-direction cashflow (we owe
    // them, they forgive part of it) — RECEIVE means the supplier is paying
    // US, so "they also forgive what we owe" is a contradiction in the same
    // call. Guarded here (not just at the schema/service layer) so no caller
    // can bypass it.
    if (data.discount && data.direction !== "PAY") {
      throw new DatabaseError(
        `recordSupplierCashflow: discount is only valid on PAY-direction cashflow (got "${data.direction}")`,
      );
    }
    try {
      const tenantId = getCurrentTenantId();
      const run = this.db.transaction(() => {
        // SQLite-side timestamps — see settleTransactions (A6 ordering).
        const isPay = data.direction === "PAY";
        const entryType: SupplierLedgerEntryType = isPay
          ? "PAYMENT"
          : "SUPPLIER_PAYS_US";
        // PAY: cash out + reduce what we owe (−). RECEIVE: cash in + settle their
        // debt to us (+). Ledger and drawer share the same sign here.
        const sign = isPay ? -1 : 1;
        const rate =
          data.exchange_rate && data.exchange_rate > 0
            ? data.exchange_rate
            : 89000;

        let usd = 0;
        let lbp = 0;
        for (const p of data.payments) {
          const amt = Math.abs(p.amount);
          if (p.currency_code === "USD") usd += amt;
          else if (p.currency_code === "LBP") lbp += amt;
        }

        const ledgerRes = this.db
          .prepare(
            `INSERT INTO supplier_ledger
               (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
          )
          .run(
            data.supplier_id,
            entryType,
            sign * usd,
            sign * lbp,
            data.note ?? null,
            data.created_by,
            tenantId,
          );
        const ledgerEntryId = Number(ledgerRes.lastInsertRowid);

        const money = `$${usd.toFixed(2)}${lbp ? ` + ${lbp.toLocaleString()} LBP` : ""}`;
        // note 14 — thin-summary enrichment: append the supplier's name
        // (paid TO them vs received FROM them), after the existing prefix.
        const supplierName = this._getSupplierName(data.supplier_id);
        const summary = isPay
          ? `Supplier Payment: ${money} — paid to ${supplierName}`
          : `Supplier Payment Received: ${money} — received from ${supplierName}`;
        // CQ-7: funneled through createTransaction() instead of a raw INSERT
        // — gains the completeness guards and exchange-rate snapshot.
        const cashflowMethod =
          data.payments.length === 1 ? data.payments[0].method : "SPLIT";
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_PAYMENT,
          source_table: "supplier_ledger",
          source_id: ledgerEntryId,
          user_id: data.created_by,
          amount_usd: usd,
          amount_lbp: lbp,
          summary,
          metadata_json: {
            supplier_id: data.supplier_id,
            direction: data.direction,
            entry_type: entryType,
            // CQ-8 counterparty contract: PAY = shop pays the supplier
            // (OUT); RECEIVE = supplier pays the shop (IN). CQ-10: a bundled
            // discount is annotated onto THIS transaction's metadata
            // (informational — the money-and-profit effect lives on the
            // separate COUNTERPARTY_DISCOUNT row posted below).
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: isPay ? "OUT" : "IN",
              method: cashflowMethod,
              ledgerEntryId: ledgerEntryId,
              discount: data.discount
                ? {
                    amount_usd: Math.abs(data.discount.amount_usd || 0),
                    amount_lbp: Math.abs(data.discount.amount_lbp || 0),
                    reason: data.discount.reason,
                  }
                : undefined,
            }),
          },
        });
        this.db
          .prepare(
            `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
          )
          .run(txnId, ledgerEntryId, tenantId);

        for (const p of data.payments) {
          if (!isDrawerAffectingMethod(p.method)) continue;
          const drawerName = paymentMethodToDrawerName(p.method);
          const delta = sign * Math.abs(p.amount);
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode: p.currency_code,
            delta,
            tenantId,
          });
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: p.method,
            drawerName,
            currencyCode: p.currency_code,
            amount: delta,
            note: data.note ?? summary,
            createdBy: data.created_by,
            tenantId,
          });
        }

        // Apply FIFO coverage to supplier_purchases for PAY direction.
        // LBP legs are converted to USD at the payment's exchange rate.
        if (isPay) {
          this._applyPurchaseFifoCoverage(
            data.supplier_id,
            usd + lbp / rate,
            tenantId,
          );
        }

        // CQ-10 — bundled discount: posted AFTER the cashflow's own FIFO
        // coverage so the discount's budget only touches whatever the cash
        // portion left open (same open purchases, a second/remaining pass).
        if (
          data.discount &&
          (data.discount.amount_usd > 0 || data.discount.amount_lbp > 0)
        ) {
          this._postSupplierDiscount(
            data.supplier_id,
            data.discount,
            data.created_by,
            tenantId,
            rate,
          );
        }

        return { id: ledgerEntryId };
      });

      return run();
    } catch (e) {
      throw new DatabaseError("Failed to record supplier cashflow", {
        cause: e,
      });
    }
  }

  /**
   * Rule 14 — the ONE FIFO allocator for supplier_purchases (shared by
   * recordSupplierCashflow's PAY branch and _postSupplierDiscount; CQ-10
   * extracted this out of recordSupplierCashflow rather than pasting the
   * same allocation loop a third time). Oldest-open-first, clamped at each
   * purchase's outstanding balance. `usdEquivalent` is already converted
   * (LBP legs pre-converted by the caller at the transaction's exchange rate).
   */
  private _applyPurchaseFifoCoverage(
    supplierId: number,
    usdEquivalent: number,
    tenantId: number,
  ): void {
    if (usdEquivalent <= 0) return;
    const unpaid = this.db
      .prepare(
        `SELECT id, total_usd, paid_usd
         FROM supplier_purchases
         WHERE supplier_id = ? AND paid_usd < total_usd - 0.005 AND tenant_id = ?
         ORDER BY created_at ASC`,
      )
      .all(supplierId, tenantId) as {
      id: number;
      total_usd: number;
      paid_usd: number;
    }[];

    const updatePurchase = this.db.prepare(
      `UPDATE supplier_purchases
       SET paid_usd = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`,
    );

    // CQ-2 — shared FIFO allocator; epsilon 0 matches this site's original
    // exact tolerance (the SQL filter above already guarantees every open
    // row has more than 0.005 outstanding, so the allocator's own epsilon
    // only needs to gate the remaining-budget stop condition).
    const takes = allocateFifo(
      unpaid.map((row) => ({
        id: row.id,
        outstanding: row.total_usd - row.paid_usd,
      })),
      usdEquivalent,
      0,
    );
    const unpaidById = new Map(unpaid.map((row) => [row.id, row]));
    for (const t of takes) {
      const row = unpaidById.get(t.id as number)!;
      updatePurchase.run(
        Math.min(row.paid_usd + t.take, row.total_usd),
        row.id,
        tenantId,
      );
    }
  }

  /**
   * CQ-10 — post ONE COUNTERPARTY_DISCOUNT transaction (+ its owning
   * 'DISCOUNT' supplier_ledger row) for a supplier forgiving part of what the
   * shop owes them. Used by BOTH entry paths: bundled (called from inside
   * recordSupplierCashflow's transaction, PAY direction only) and standalone
   * (writeOffSupplierDebt, its own transaction).
   *
   * amount_usd/amount_lbp = 0 (no cash moved); profit_usd/profit_lbp =
   * POSITIVE the forgiven amount (D1: a supplier discount is a gain — the
   * shop no longer has to pay that cost).
   */
  private _postSupplierDiscount(
    supplierId: number,
    discount: SupplierDiscountData,
    createdBy: number,
    tenantId: number,
    rate = 89000,
  ): number {
    const amountUsd = Math.abs(discount.amount_usd || 0);
    const amountLbp = Math.abs(discount.amount_lbp || 0);

    const ledgerRes = this.db
      .prepare(
        `INSERT INTO supplier_ledger
           (supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, tenant_id, created_at)
         VALUES (?, 'DISCOUNT', ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        supplierId,
        -amountUsd,
        -amountLbp,
        discount.reason ?? null,
        createdBy,
        tenantId,
      );
    const ledgerEntryId = Number(ledgerRes.lastInsertRowid);

    const label = this._getSupplierName(supplierId);
    const money = `$${amountUsd.toFixed(2)}${amountLbp ? ` + ${amountLbp.toLocaleString()} LBP` : ""}`;
    // CQ-5: the signed profit + counterparty metadata shape (D1 — a supplier
    // forgiving a payable is booked "as if paid", flow OUT) is now the ONE
    // shared helper every counterparty discount posts through (moneyPosting.ts).
    const posting = buildCounterpartyDiscountPosting({
      kind: "supplier",
      ledgerEntryId,
      counterpartyId: supplierId,
      counterpartyName: label,
      amountUsd,
      amountLbp,
      discountDirection: "received",
      reason: discount.reason,
      extraMetadata: { supplier_id: supplierId, entry_type: "DISCOUNT" },
    });
    const txnId = getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.COUNTERPARTY_DISCOUNT,
      source_table: "supplier_ledger",
      source_id: ledgerEntryId,
      user_id: createdBy,
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: posting.profit_usd,
      profit_lbp: posting.profit_lbp,
      summary: `Supplier discount received: ${money} — ${label}`,
      metadata_json: posting.metadata_json,
    });

    this.db
      .prepare(
        `UPDATE supplier_ledger SET transaction_id = ? WHERE id = ? AND tenant_id = ?`,
      )
      .run(txnId, ledgerEntryId, tenantId);

    const usdEquivalent = amountUsd + amountLbp / rate;
    this._applyPurchaseFifoCoverage(supplierId, usdEquivalent, tenantId);

    return txnId;
  }

  /**
   * Per-supplier net balance (+ = shop owes supplier). Used by
   * SupplierService.writeOffSupplierDebt to validate a write-off against the
   * OUTSTANDING balance per currency — mirrors DebtRepository.getClientBalance.
   */
  getSupplierBalance(supplierId: number): {
    balance_usd: number;
    balance_lbp: number;
  } {
    const tenantId = getCurrentTenantId();
    const row = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(amount_usd), 0) as balance_usd,
          COALESCE(SUM(amount_lbp), 0) as balance_lbp
         FROM supplier_ledger
         WHERE supplier_id = ? AND tenant_id = ? AND ${ledgerNotRefunded()}`,
      )
      .get(supplierId, tenantId) as
      | { balance_usd: number; balance_lbp: number }
      | undefined;
    return {
      balance_usd: row?.balance_usd ?? 0,
      balance_lbp: row?.balance_lbp ?? 0,
    };
  }

  /**
   * CQ-10 (D4: admin-only, enforced by the caller) — standalone write-off: no
   * cashflow attached, just forgive part of what the shop owes a supplier.
   * Validation (positive amount, does not exceed the outstanding balance per
   * currency) lives in SupplierService.writeOffSupplierDebt.
   */
  writeOffSupplierDebt(data: {
    supplier_id: number;
    amount_usd: number;
    amount_lbp: number;
    reason?: string;
    created_by: number;
  }): { id: number } {
    try {
      const tenantId = getCurrentTenantId();
      const run = this.db.transaction(() => {
        const txnId = this._postSupplierDiscount(
          data.supplier_id,
          {
            amount_usd: data.amount_usd,
            amount_lbp: data.amount_lbp,
            reason: data.reason,
          },
          data.created_by,
          tenantId,
        );
        return { id: txnId };
      });
      return run();
    } catch (e) {
      throw new DatabaseError("Failed to write off supplier debt", {
        cause: e,
      });
    }
  }
}

let supplierRepositoryInstance: SupplierRepository | null = null;
export function getSupplierRepository(): SupplierRepository {
  if (!supplierRepositoryInstance)
    supplierRepositoryInstance = new SupplierRepository();
  return supplierRepositoryInstance;
}
export function resetSupplierRepository(): void {
  supplierRepositoryInstance = null;
}
