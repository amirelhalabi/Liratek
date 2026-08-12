import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getFinancialServiceRepository } from "./FinancialServiceRepository.js";
import {
  TRANSACTION_TYPES,
  type TransactionType,
} from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  resolveServiceCashDrawer,
  type ServiceCashDrawerContext,
} from "../utils/payments.js";
// Primary Cash Drawer plan §8.2 (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md):
// resolveServiceCashDrawer needs the shop's base system to decide whether a
// supplier's cash leg is a primary-system leg (→ PCD) or not — reuse the one
// canonical getter rather than re-reading system_settings a third time.
import { getSettingsService } from "../services/SettingsService.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { buildCounterpartyMetadata } from "../validators/counterparty.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import { allocateProportional } from "../utils/largestRemainder.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  buildCounterpartyDiscountPosting,
} from "./moneyPosting.js";
// BILL_COMMISSION_SETTLEMENT_PLAN.md — the bills-only commission-at-settlement
// drawer top-up reuses the SAME provider→drawer map `RechargeRepository
// .topUpFromSupplier` uses (rule 14), deliberately WITHOUT that method's
// debt-booking half — see `_bookBillsCommissionDrawerTopUp`'s doc comment.
import { TOP_UP_PROVIDER_DRAWERS, isTopUpProvider } from "../constants/index.js";

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
  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D8 — per-supplier entry-mode
   * preference for a NEW-MODEL settlement batch: pre-selects the
   * Settlement UI's LUMP/RATE toggle. Null on schemas older than v150
   * (COALESCE'd to 'LUMP' in getColumns()).
   */
  commission_entry_mode: "LUMP" | "RATE";
  /** D8 — the per-unit rate used to pre-fill RATE-mode entry. Null until set. */
  commission_rate: number | null;
  /**
   * LIRA-112 (COMMISSION_AT_SETTLEMENT_PLAN.md D12, v151) — does this
   * supplier currently earn commission from the shop AT ALL? The ONE
   * data-driven gate `FinancialServiceRepository.isPendingSupplierSettlement`
   * / `pendingSettlementSql()` reads for BILL rows (rule 14) — replaces the
   * provider-name hardcode (`provider IN ('iPick', 'Katsh')`) that credited
   * iPick a commission it never earned. 1 (eligible) is the default for
   * every supplier, unchanged from v150's shipped behavior; iPick is seeded
   * to 0 by the v151 migration and `defaultCommissionConfigForProvider`.
   * COALESCE'd to 1 in getColumns() for schemas older than v151.
   */
  commission_eligible: number;
  /**
   * LIRA-112 (v151) — the currency `commission_rate` is denominated in.
   * `commission_rate` (v150) was specced in USD, but Katsh's real-world
   * rate is 20,000 LBP per bill — this column makes that explicit instead
   * of the settle screen silently assuming USD. Defaults to 'USD' (the
   * original spec assumption) for every supplier except Katsh. COALESCE'd
   * to 'USD' in getColumns() for schemas older than v151.
   */
  commission_rate_currency: "USD" | "LBP";
}

/**
 * LIRA-112 (COMMISSION_AT_SETTLEMENT_PLAN.md D12) — the ONE provider-keyed
 * default for a BRAND-NEW supplier row's commission configuration
 * (rule 14: not a provider-name `if` sprinkled across the codebase, a
 * single function every creation path calls). Owner: "i said ipick bills
 * gives us no comission, but katsh does... 20,000 LBP per bill sold...
 * ipick its not the case." iPick earns nothing, ever; Katsh earns 20,000
 * LBP/bill via RATE mode; every other provider keeps v150's shipped default
 * (eligible, LUMP, no preset rate).
 *
 * Applied at creation time only (`SupplierRepository.createSupplier`) — this
 * is what makes a BRAND-NEW tenant's iPick/Katsh suppliers correct from the
 * moment they're added (checked: `TenantRepository.seedConfig` deliberately
 * excludes the sample suppliers rows as "sample data, not config", so a
 * fresh tenant only gets a correct iPick/Katsh supplier if whatever creates
 * it — this method, today's only path — defaults it correctly). The v151
 * migration's data backfill and `create_db.sql`'s desktop fixture seed carry
 * the same literal values for existing tenants / the desktop fresh install,
 * necessarily as raw SQL (migrations/seed data can't call back into
 * application code) — kept in sync with this function by hand; this is the
 * one function every *application-code* creation path (present and future)
 * calls, so no repository ever re-derives eligibility from a provider name.
 */
export function defaultCommissionConfigForProvider(
  provider: string | null | undefined,
): {
  commission_eligible: 0 | 1;
  commission_entry_mode: "LUMP" | "RATE";
  commission_rate: number | null;
  commission_rate_currency: "USD" | "LBP";
} {
  if (provider === "iPick") {
    return {
      commission_eligible: 0,
      commission_entry_mode: "LUMP",
      commission_rate: null,
      commission_rate_currency: "USD",
    };
  }
  if (provider === "Katsh") {
    return {
      commission_eligible: 1,
      commission_entry_mode: "RATE",
      commission_rate: 20000,
      commission_rate_currency: "LBP",
    };
  }
  return {
    commission_eligible: 1,
    commission_entry_mode: "LUMP",
    commission_rate: null,
    commission_rate_currency: "USD",
  };
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
   * Net amount paid to the supplier.
   *
   * LEGACY batches (every selected row's `commission_model` = 0, EMBEDDED —
   * byte-for-byte unchanged): under the Primary Cash Drawer model
   * (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md §8.3 — supersedes PR
   * #66's float-model fee-only booking), `financial_services.supplier_owed`
   * / `supplier_ledger` TOP_UP rows are booked GROSS — principal + fee −
   * commission (`grossOwedDelta`, FinancialServiceRepository.ts) — so this
   * figure is simply the sum of the outstanding `supplier_owed` for
   * `financial_service_ids`. It must NOT be further reduced by
   * `commission_usd`/`commission_lbp` below — the shop's cut is already
   * embedded in the gross figure (it nets out to the shop's cut over a
   * SEND+RECEIVE cycle), and subtracting it again double-nets the shop's cut
   * out of the payment.
   *
   * NEW-MODEL batches (every selected row's `commission_model` = 1,
   * AT_SETTLEMENT — COMMISSION_AT_SETTLEMENT_PLAN.md D1-D9): `supplier_owed`
   * for these rows is NOT commission-adjusted (the commission is entered
   * HERE, not guessed at creation) — the caller (settlement UI) is expected
   * to compute this figure as `gross owed − commission_usd/commission_lbp`
   * (net pay). The repository trusts this figure for the money that actually
   * moves (the SETTLEMENT ledger row + `payments[]`) exactly like the legacy
   * path — what's NEW is that `settleTransactions` additionally books the
   * entered commission as its own real ledger event (see
   * `commission_usd`/`commission_lbp` below) and a `supplier_settlements` +
   * `settlement_commission_allocations` audit/reporting record (D5/D6).
   */
  amount_usd: number;
  amount_lbp: number;
  /**
   * Total commission this batch represents.
   *
   * LEGACY batches: INFORMATIONAL ONLY (audit/display), stamped onto the
   * settlement transaction's metadata. It has NO drawer or ledger effect:
   * under the GROSS model (plan §8.3) the shop's cut is already embedded in
   * `amount_usd`/`amount_lbp` (and in the TOP_UP rows being settled) via
   * `grossOwedDelta`, so there is nothing left to "fund" or "realize" here —
   * the commission simply stays behind in whichever drawer took the
   * original transaction's cash (the primary cash drawer, PCD, for the
   * shop's primary provider) as the difference between what the customer
   * paid (fee f) and what gets remitted to the provider (f − c). This field
   * drives NO separate `drawer += commission` pair or `SUPPLIER_PAYS_US`
   * ledger row for a legacy batch — that would double-count money already
   * reflected in the gross TOP_UP/SETTLEMENT pair.
   *
   * NEW-MODEL batches: MONEY-BEARING. `settleTransactions` books this exact
   * total as a `SUPPLIER_PAYS_US` supplier_ledger credit (negative = the
   * supplier owes the shop; is_auto, linked to this settlement's own ledger
   * row — never by time proximity, the LIRA-085 lesson), splits it across
   * the settled rows via largest-remainder proportional allocation
   * (`settlement_commission_allocations`, D6 — Σ = this figure exactly, per
   * currency), and snapshots the batch total onto `supplier_settlements`
   * (D5). See `entry_mode`/`commission_rate`/`commission_unit_count` below
   * for how the operator arrived at this number (RATE mode) — this field
   * always carries the FINAL money amount regardless of entry mode.
   */
  commission_usd: number;
  commission_lbp: number;
  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D8 — how the operator entered
   * `commission_usd`/`commission_lbp` for a NEW-MODEL batch: 'LUMP' (a
   * single total for the whole batch) or 'RATE' (`commission_rate` ×
   * `commission_unit_count`). Snapshotted verbatim onto `supplier_settlements`
   * for audit — ignored for LEGACY batches. Defaults to 'LUMP' when omitted.
   */
  entry_mode?: "LUMP" | "RATE";
  /** RATE mode only — the per-unit rate the operator entered (audit snapshot; see `entry_mode`). */
  commission_rate?: number;
  /** RATE mode only — the unit count (e.g. bill/transaction count) the operator entered (audit snapshot; see `entry_mode`). */
  commission_unit_count?: number;
  /**
   * @deprecated No longer used to move money. `OMT_System`/`Whish_System` IS
   * the shop's real physical cash drawer at the money-transfer counter (plan
   * §1) — but settlement still pays the net amount EXCLUSIVELY through
   * `payments[]` (real payment-method legs, resolved to the PCD when the
   * supplier is the shop's primary provider — see `settleTransactions`'s
   * `resolveServiceCashDrawer` call), never a bare named drawer. Kept
   * optional for backward-compatible typing only; any value passed here is
   * ignored.
   */
  drawer_name?: string;
  note?: string;
  created_by: number;
  /**
   * Payment-method legs the net amount is actually paid through (CASH →
   * General, wallet methods → their own drawer, …) — REQUIRED whenever
   * `amount_usd`/`amount_lbp` is nonzero (mirrors `recordSupplierCashflow`'s
   * own `payments` requirement). A settlement that nets to $0 (commission
   * alone offsets what's owed, or a bills-only batch whose principal never
   * touched the ledger — COMMISSION_AT_SETTLEMENT_PLAN.md's "bills
   * settlement note") needs no legs.
   */
  payments?: Array<{ method: string; currency_code: string; amount: number }>;
}

/**
 * COMMISSION_AT_SETTLEMENT_PLAN.md D2/D3/D4 — one `financial_services` row
 * still eligible to be settled (id exists, tenant-scoped, `settlement_id IS
 * NULL` — the exact predicate `settleTransactions`' own UPDATE applies),
 * carrying just enough to derive the batch's commission model and, for a
 * new-model batch, to write its `settlement_commission_allocations` row.
 */
interface EligibleSettlementRow {
  id: number;
  provider: string;
  service_type: string;
  commission: number;
  commission_model: number;
  currency: string;
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

  /**
   * True when the connected `suppliers` table already carries the v150 D8
   * `commission_entry_mode`/`commission_rate` columns. Same schema-drift-
   * guard shape as `_supplierLedgerHasSourceRefColumns` (checked once per
   * call — PRAGMA is cheap, this is not a hot path — rather than cached):
   * dozens of `packages/core` jest fixtures hand-roll a `suppliers` table
   * that predates this migration, and `getColumns()`'s SELECT would throw
   * `no such column` on every one of them if it referenced the columns
   * unconditionally.
   */
  private _suppliersHasCommissionPrefColumns(): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(suppliers)`).all() as {
      name: string;
    }[];
    return (
      cols.some((c) => c.name === "commission_entry_mode") &&
      cols.some((c) => c.name === "commission_rate")
    );
  }

  /**
   * LIRA-112 (v151) — same schema-drift-guard shape as
   * `_suppliersHasCommissionPrefColumns()` above, for the two columns THAT
   * migration adds (`commission_eligible`, `commission_rate_currency`).
   * Checked independently of the v150 guard: a hand-rolled jest fixture
   * could in principle carry the v150 columns without the v151 ones (they
   * were added in separate migrations), so this must not assume one implies
   * the other.
   */
  private _suppliersHasCommissionEligibilityColumns(): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(suppliers)`).all() as {
      name: string;
    }[];
    return (
      cols.some((c) => c.name === "commission_eligible") &&
      cols.some((c) => c.name === "commission_rate_currency")
    );
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  //
  // COMMISSION_AT_SETTLEMENT_PLAN.md D8 — reviewer finding #1 (FIX_FIRST):
  // `commission_entry_mode`/`commission_rate` MUST be selected here —
  // `SupplierEntity` documents them and every caller (Settlement UI's
  // LUMP/RATE pre-select, both IPC and REST via this same listSuppliers())
  // reads them off the row this method shapes. Gated on
  // `_suppliersHasCommissionPrefColumns()` (not selected unconditionally)
  // so pre-v150 connected schemas keep working. COALESCE matches the
  // interface doc's contract for pre-v150 ROWS on an upgraded schema (NULL
  // preference reads as the 'LUMP' default rather than undefined).
  //
  // LIRA-112 (v151) — `commission_eligible`/`commission_rate_currency`
  // follow the exact same pattern, gated on their own guard.
  protected getColumns(): string {
    const base =
      "id, name, contact_name, phone, note, is_active, module_key, provider, is_system, created_at";
    const prefCols = this._suppliersHasCommissionPrefColumns()
      ? ", COALESCE(commission_entry_mode, 'LUMP') AS commission_entry_mode, commission_rate"
      : "";
    const eligibilityCols = this._suppliersHasCommissionEligibilityColumns()
      ? ", COALESCE(commission_eligible, 1) AS commission_eligible, COALESCE(commission_rate_currency, 'USD') AS commission_rate_currency"
      : "";
    return `${base}${prefCols}${eligibilityCols}`;
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
      const baseParams = [
        data.name.trim(),
        data.contact_name ?? null,
        data.phone ?? null,
        data.note ?? null,
        data.module_key ?? null,
        data.provider ?? null,
        getCurrentTenantId(),
      ];

      // LIRA-112 (D12) — a BRAND-NEW supplier row's commission config
      // defaults per its provider (`defaultCommissionConfigForProvider`,
      // this file), not a hardcoded 'LUMP'/eligible=1 for every provider.
      // This is what makes a fresh tenant's iPick/Katsh suppliers correct
      // from the moment they're added (see that function's doc comment).
      // Gated on the same schema-drift guard as getColumns() — no test
      // fixture currently exercises createSupplier() against a minimal
      // schema, but staying consistent costs nothing.
      if (this._suppliersHasCommissionEligibilityColumns()) {
        const defaults = defaultCommissionConfigForProvider(data.provider);
        const stmt = this.db.prepare(`
          INSERT INTO suppliers (
            name, contact_name, phone, note, module_key, provider, is_active, tenant_id, created_at,
            commission_eligible, commission_entry_mode, commission_rate, commission_rate_currency
          )
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
        `);
        const res = stmt.run(
          ...baseParams,
          defaults.commission_eligible,
          defaults.commission_entry_mode,
          defaults.commission_rate,
          defaults.commission_rate_currency,
        );
        return { id: Number(res.lastInsertRowid) };
      }

      const stmt = this.db.prepare(`
        INSERT INTO suppliers (name, contact_name, phone, note, module_key, provider, is_active, tenant_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
      `);
      const res = stmt.run(...baseParams);
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
   * Primary Cash Drawer model (docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md
   * §1/§8.3 — supersedes PR #66's float model): `supplier_ledger` TOP_UP rows
   * for OMT/WHISH are booked GROSS (`grossOwedDelta`,
   * FinancialServiceRepository.ts) — principal + fee − commission — so the
   * shop's commission is embedded in what's owed, not carved out separately.
   * Settlement pays off that same gross figure and marks the rows settled;
   * there is no separate "realize the commission" step (no
   * `SUPPLIER_PAYS_US` credit row) — the commission simply stays behind as
   * the difference between what was collected and what's remitted.
   * `OMT_System`/`Whish_System` is no longer a provider float — it IS the
   * shop's physical primary cash drawer (PCD), so a settlement paid in CASH
   * against the shop's PRIMARY-system supplier now resolves that leg to the
   * PCD (decision #10, via `resolveServiceCashDrawer`); a non-primary
   * supplier's settlement is unaffected and keeps its existing drawer
   * (General / the method's own wallet drawer).
   *
   * COMMISSION_AT_SETTLEMENT_PLAN.md D2/D3/D4/D5/D6 — the batch's commission
   * MODEL is derived server-side from the selected rows' own
   * `commission_model` (never trusted from the caller): a batch mixing model
   * 0 (EMBEDDED, legacy) and model 1 (AT_SETTLEMENT) rows is hard-rejected
   * (D4) — entering one commission figure across rows whose payable was
   * computed two different ways would double-net the legacy rows' already-
   * embedded cut. A LEGACY batch (every row model 0, or the connected schema
   * predates migration v150) runs byte-for-byte the same steps 1-4 below as
   * before this plan. A NEW-MODEL batch (every eligible row model 1) runs
   * steps 1-4 unchanged AND an additional step 5: the real commission record
   * (D5 `supplier_settlements` + D6 `settlement_commission_allocations`,
   * largest-remainder proportional split) and the commission credit itself
   * (a `SUPPLIER_PAYS_US` ledger row).
   *
   * In a single DB transaction:
   * 1. Insert a SETTLEMENT-typed supplier_ledger entry (negative = shop
   *    paying out `amount_usd`/`amount_lbp`, the gross amount already
   *    owed — nets the ledger to 0 against the TOP_UP rows being settled)
   * 2. Mark all specified financial_services rows as is_settled = 1
   * 3. Create unified transactions row for audit trail (commission stamped
   *    as informational metadata only — no separate drawer effect for a
   *    legacy batch)
   * 4. Debit the net payment through real payment-method legs (`payments[]`,
   *    same mechanism as `recordSupplierCashflow`, resolved through
   *    `resolveServiceCashDrawer`) — never a bare named drawer (see
   *    `SettleTransactionsData.drawer_name`'s deprecation)
   * 5. NEW-MODEL batches only — book the commission (see
   *    `_bookCommissionAtSettlement`'s own doc comment)
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
    // BILL_COMMISSION_SETTLEMENT_PLAN.md (LIRA-137 Q2) — the REVERSE hazard:
    // a $0/0-LBP-owed batch (the bills-only shape — a bill's principal never
    // touches the ledger, so gross owed is structurally 0) has no
    // contractual cash amount for a payment-method leg to pay. Before this
    // guard, a forced leg here would debit a real drawer with NO matching
    // ledger/gross entry — the settlement's own SETTLEMENT row still nets to
    // $0.00/0 LBP. The frontend no longer offers a tender form for this
    // shape at all (Suppliers/index.tsx's isBillsOnlyBatch gate skips
    // rendering MultiPaymentInput entirely), but this repository is the
    // single source of truth for every caller (raw IPC/REST, a future
    // script) — reject the impossible payload here too, same tier as the
    // sibling guard above.
    if (!owesCash && data.payments?.length) {
      throw new DatabaseError(
        "Settlement has no cash owed — payment-method legs are not accepted (a bills-only commission books as a provider-drawer credit, never a cash payment)",
      );
    }
    // Reviewer finding #3 (harden) — same throw-before-try tier as the
    // mixed-model-batch guard below: reject BEFORE any write when the
    // caller's financial_service_ids don't actually belong to
    // data.supplier_id. See _verifySupplierOwnership's own doc comment.
    this._verifySupplierOwnership(
      data.financial_service_ids,
      data.supplier_id,
      getCurrentTenantId(),
    );

    // COMMISSION_AT_SETTLEMENT_PLAN.md D2/D3/D4 — resolve BEFORE the generic
    // try/catch below (same tier as the two validations above, deliberately
    // NOT wrapped into "Failed to settle transactions" — the shared contract
    // names this exact error string, so a caller pattern-matching on it must
    // see it verbatim): which of the caller's IDs are still eligible (mirrors
    // the UPDATE's own WHERE clause exactly) and their shared commission
    // model. Throws before any write if the batch is mixed.
    const { model: batchModel, rows: eligibleRows } =
      this._resolveSettlementBatchModel(
        data.financial_service_ids,
        getCurrentTenantId(),
      );
    // BILL_COMMISSION_SETTLEMENT_PLAN.md — narrow scope (owner, 2026-08-11):
    // the drawer-top-up-and-profit treatment applies ONLY when every
    // eligible row is a BILL. Today `commission_model = 1` is stamped
    // EXCLUSIVELY on BILL rows at creation (FinancialServiceRepository's own
    // comment on that stamp), so this is currently identical to
    // `batchModel === 1` — but gating on service_type too means a future
    // OMT/WHISH row that earns `commission_model = 1` (Phase 2 of
    // COMMISSION_AT_SETTLEMENT_PLAN.md, not built) automatically stays on
    // the OLD cashless SUPPLIER_PAYS_US path below until that generalisation
    // is deliberately designed and shipped (tracked as LIRA-138) — it does
    // NOT silently inherit "top up a drawer" semantics that were never
    // decided for it.
    const isBillsOnlyBatch =
      batchModel === 1 &&
      eligibleRows.length > 0 &&
      eligibleRows.every((r) => r.service_type === "BILL");

    try {
      const tenantId = getCurrentTenantId();
      // Primary Cash Drawer plan §1/§8.2 (decision #10): resolve once,
      // read-only, before the write transaction below — a settlement whose
      // supplier IS the shop's primary provider (shop_base_system) pays its
      // CASH legs out of the PCD, not General.
      const supplier = this.findById(data.supplier_id);
      const drawerCtx: ServiceCashDrawerContext = {
        provider: supplier?.provider ?? "",
        baseSystem: getSettingsService().getShopBaseSystem(),
      };
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
        // Primary Cash Drawer model (plan §8.3): NO separate "realize the
        // commission" step exists for a LEGACY/OMT-shaped batch.
        // `commission_usd`/`commission_lbp` are stamped below purely as
        // audit metadata for that shape — under the GROSS model the shop's
        // cut is already embedded in `amount_usd`/`amount_lbp` (and in the
        // TOP_UP rows being settled) via `grossOwedDelta`, so there is
        // nothing left to fund/credit here; there is no separate
        // `drawer += commission` pair or `SUPPLIER_PAYS_US` ledger row — that
        // would double-count money already reflected in the gross TOP_UP/
        // SETTLEMENT pair.
        //
        // BILL_COMMISSION_SETTLEMENT_PLAN.md — for a bills-only batch this IS
        // the money-bearing event: `_bookCommissionAtSettlement` (step 5)
        // posts the entered commission straight into the Katsh/iPick provider
        // drawer as a real payment leg on THIS SAME transaction — never a
        // supplier_ledger row (rule 20's "one obligation, one owner": there is
        // no debt for it to net against; Katsh funds it directly). It is
        // profit, entirely (owner, 2026-08-11) — stamped here via the SAME
        // `profit_usd`/`profit_lbp` mechanism every other commission-earning
        // flow in this codebase uses (FinancialServiceRepository's SEND/
        // RECEIVE commission, LotoTicketRepository's ticket commission),
        // never a bespoke field. Exactly 0 for every other batch shape
        // (byte-for-byte unchanged from before this plan).
        const settlementMethod =
          data.payments && data.payments.length > 0
            ? data.payments.length === 1
              ? data.payments[0].method
              : "SPLIT"
            : "CASH";
        // Audit-visibility fix (found while investigating LIRA-137's own e2e
        // fallout, lira-transactions-hidden-types.spec.ts): the commission
        // drawer-top-up leg `_bookBillsCommissionDrawerTopUp` posts (step 5,
        // below) targets the Katsh/iPick drawer — which
        // `TransactionRepository`'s `PROVIDER_STOCK_DRAWERS` set ALSO uses to
        // hide a bill's own creation-time cost leg from the customer-facing
        // "payment legs" subtext (rule 14, the SAME predicate). That hiding
        // rule is correct for a bill's cost leg (a walk-in customer's receipt
        // shouldn't show the shop's internal provider-stock movement) but
        // this settlement transaction has no customer at all — the provider
        // drawer credit IS the entire point of the row, not an internal
        // aside. Reusing the shared predicate therefore also hid the ONE
        // number (the commission amount) that made this row auditable:
        // amount_usd/amount_lbp are contractually 0/0 for this batch shape
        // (no bill principal is owed — see the doc comment above), and the
        // `payments` leg itself is filtered out of `row.payments` by that
        // same predicate, so nothing on the row showed how much arrived —
        // only the IN direction (cashFlow.ts). Fixed at the summary-text
        // level instead of touching the shared predicate (which also guards
        // every sale/recharge/financial-service cost leg — far too broad a
        // lever for a one-row problem): `summary` is never filtered, and
        // TransactionsViewer renders it unconditionally under the cash-flow
        // badge, so the commission is now visible in the DEFAULT table view.
        const commissionMoney = `$${data.commission_usd.toFixed(2)}${
          data.commission_lbp
            ? ` + ${data.commission_lbp.toLocaleString()} LBP`
            : ""
        }`;
        const settlementSummary = isBillsOnlyBatch
          ? `Settlement: ${data.financial_service_ids.length} txns — ${this._getSupplierName(data.supplier_id)} credited ${commissionMoney} commission (drawer top-up)`
          : `Settlement: ${data.financial_service_ids.length} txns, net $${data.amount_usd.toFixed(2)}`;
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.SUPPLIER_SETTLEMENT,
          source_table: "supplier_ledger",
          source_id: ledgerEntryId,
          user_id: data.created_by,
          amount_usd: data.amount_usd,
          amount_lbp: data.amount_lbp,
          profit_usd: isBillsOnlyBatch ? data.commission_usd : 0,
          profit_lbp: isBillsOnlyBatch ? data.commission_lbp : 0,
          summary: settlementSummary,
          metadata_json: {
            supplier_id: data.supplier_id,
            financial_service_ids: data.financial_service_ids,
            // Informational for a LEGACY batch (audit/display only); for a
            // NEW-MODEL batch these are the real money-bearing totals also
            // recorded on supplier_settlements (D5) — see doc comment above
            // and on SettleTransactionsData.commission_usd/commission_lbp.
            commission_usd: data.commission_usd,
            commission_lbp: data.commission_lbp,
            // COMMISSION_AT_SETTLEMENT_PLAN.md D3 — which model this batch
            // settled under (0 = legacy EMBEDDED, 1 = AT_SETTLEMENT); D8 —
            // how commission_usd/commission_lbp were entered for a
            // new-model batch. Purely informational (the authoritative
            // record for a new-model batch is `supplier_settlements`).
            commission_model: batchModel,
            entry_mode: data.entry_mode ?? "LUMP",
            // CQ-8 counterparty contract: a settlement pays the supplier's
            // net amount OUT of the drawer — EXCEPT a bills-only batch, where
            // the only money that moves is the commission arriving IN (the
            // provider drawer top-up, step 5). `getCashFlowDirection`
            // (frontend/src/features/audit/cashFlow.ts) reads this field for
            // the transactions-table badge, same pattern as SUPPLIER_PAYMENT.
            counterparty: buildCounterpartyMetadata({
              kind: "supplier",
              id: data.supplier_id,
              name: this._getSupplierName(data.supplier_id),
              flow: isBillsOnlyBatch ? "IN" : "OUT",
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
            // Primary Cash Drawer plan §1/§8.2 (decision #10): a CASH leg
            // paid to the shop's primary-system supplier resolves to the
            // PCD; every other supplier/method falls through unchanged.
            const drawerName = resolveServiceCashDrawer(p.method, drawerCtx);
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

        // ── 5. NEW-MODEL batches only — book the real commission ──────────
        // (D5/D6 audit/allocation record, plus EITHER the bills-only drawer
        // top-up (BILL_COMMISSION_SETTLEMENT_PLAN.md) OR the legacy
        // SUPPLIER_PAYS_US credit — see the method's own doc comment for the
        // branch). No-op for a legacy batch or an empty eligible set (e.g.
        // every selected id was already settled).
        if (batchModel === 1 && eligibleRows.length > 0) {
          this._bookCommissionAtSettlement({
            settlementLedgerId: ledgerEntryId,
            settlementTxnId: txnId,
            supplierId: data.supplier_id,
            supplierProvider: supplier?.provider ?? null,
            isBillsOnlyBatch,
            rows: eligibleRows,
            data,
            tenantId,
          });
        }

        return { id: ledgerEntryId };
      });

      return settle();
    } catch (e) {
      throw new DatabaseError("Failed to settle transactions", { cause: e });
    }
  }

  /**
   * True when the connected schema is FULLY v150-upgraded: `financial_services
   * .commission_model` AND both `supplier_settlements` and
   * `settlement_commission_allocations` all exist. Migration v150 adds all
   * three atomically (§3) — a real, fully-migrated database always has every
   * one of them together, or none. Checking all three (not just the column)
   * matters because `commission_model` CAN be stamped 1 on a new
   * `financial_services` row by `FinancialServiceRepository.createTransaction`
   * (COMMISSION_AT_SETTLEMENT_PLAN.md §3/Phase 0 — currently only BILL rows;
   * see that stamp's own comment for why OMT/WHISH stay 0 until Phase 2's
   * gross flip ships) — including on the dozens of pre-existing
   * `packages/core` jest fixtures that added the bare column (for that
   * INSERT to succeed) without also adding the two new tables (their own
   * tests never write to them). Treating "column present, tables absent" as
   * legacy — rather than attempting the new booking and throwing
   * `no such table` — mirrors the same schema-drift-guard shape as
   * `_supplierLedgerHasSourceRefColumns`: an incomplete v150 upgrade on any
   * ONE connection means "settle exactly as before this plan", never a
   * half-written commission record.
   */
  private _hasCommissionAtSettlementSchema(): boolean {
    const tableExists = (name: string): boolean =>
      !!this.db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(name);
    const cols = this.db
      .prepare(`PRAGMA table_info(financial_services)`)
      .all() as { name: string }[];
    return (
      cols.some((c) => c.name === "commission_model") &&
      tableExists("supplier_settlements") &&
      tableExists("settlement_commission_allocations")
    );
  }

  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md reviewer finding #3 (harden) —
   * `settleTransactions` must never book money against a supplier that
   * doesn't own the rows being settled. A `financial_services` row has NO
   * `supplier_id` FK — system suppliers are keyed by their `provider`
   * string instead (`FinancialServiceRepository.getUnsettledBySupplier
   * (provider)`; the Settlement UI always fetches unsettled rows by
   * `selectedSupplier.provider`) — so "belongs to `supplierId`" means "its
   * own `provider` matches that supplier's `provider`".
   *
   * Selects only `id, provider` — columns `financial_services` has had
   * since before v150 — and looks up the supplier's `provider` with a raw
   * query rather than `findById()`, so this check runs independently of
   * `_hasCommissionAtSettlementSchema()` and on every connected schema, not
   * just a fully-upgraded one. Mirrors the eligibility predicate
   * (`settlement_id IS NULL` + tenant) so it only ever flags rows the write
   * transaction would actually touch.
   *
   * Throws BEFORE any write — same tier as the mixed-model-batch guard in
   * `_resolveSettlementBatchModel` — so the message surfaces unwrapped over
   * IPC instead of being swallowed into "Failed to settle transactions".
   *
   * A supplier with no `provider` (a product supplier) can never own a
   * `financial_services` row (every row's `provider` is a non-null system
   * string), so every id in that case correctly gets rejected as foreign.
   */
  private _verifySupplierOwnership(
    financialServiceIds: number[],
    supplierId: number,
    tenantId: number,
  ): void {
    const supplierRow = this.db
      .prepare(`SELECT provider FROM suppliers WHERE id = ? AND tenant_id = ?`)
      .get(supplierId, tenantId) as { provider: string | null } | undefined;
    const supplierProvider = supplierRow?.provider ?? null;

    const placeholders = financialServiceIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT id, provider FROM financial_services
         WHERE id IN (${placeholders}) AND settlement_id IS NULL AND tenant_id = ?`,
      )
      .all(...financialServiceIds, tenantId) as {
      id: number;
      provider: string;
    }[];

    const foreign = rows.filter((r) => r.provider !== supplierProvider);
    if (foreign.length > 0) {
      throw new DatabaseError(
        `Cannot settle financial_service_ids [${foreign
          .map((r) => r.id)
          .join(", ")}] — they belong to a different supplier than ` +
          `supplier_id ${supplierId} (provider "${supplierProvider ?? "none"}")`,
      );
    }
  }

  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D2/D3/D4 — read-only, called BEFORE the
   * write transaction in `settleTransactions` (same pattern as its own
   * `supplier`/`drawerCtx` resolve): finds which of the caller's
   * `financial_service_ids` are still eligible to be settled — id exists,
   * tenant-scoped, `settlement_id IS NULL` — the EXACT predicate the UPDATE
   * inside the write transaction applies, so `rows` here is always exactly
   * the set that UPDATE will actually touch — and reads their shared
   * `commission_model`.
   *
   * Hard-rejects (D4) a batch whose eligible rows don't share ONE model —
   * entering a single commission figure across rows whose payable was
   * computed two different ways (embedded vs at-settlement) would
   * double-net the legacy rows' already-embedded cut.
   *
   * Returns `{ model: 0, rows: [] }` (the legacy no-op shape) when: the
   * connected schema isn't fully v150-upgraded
   * (`_hasCommissionAtSettlementSchema`), or no id in the caller's list is
   * currently eligible (nothing new to book either way — mirrors the
   * existing "does NOT re-settle already-settled rows" no-op).
   */
  private _resolveSettlementBatchModel(
    financialServiceIds: number[],
    tenantId: number,
  ): { model: 0 | 1; rows: EligibleSettlementRow[] } {
    if (!this._hasCommissionAtSettlementSchema()) {
      return { model: 0, rows: [] };
    }
    const placeholders = financialServiceIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT id, provider, service_type, commission, commission_model, currency
         FROM financial_services
         WHERE id IN (${placeholders}) AND settlement_id IS NULL AND tenant_id = ?`,
      )
      .all(...financialServiceIds, tenantId) as EligibleSettlementRow[];

    if (rows.length === 0) return { model: 0, rows: [] };

    const distinctModels = new Set(rows.map((r) => r.commission_model));
    if (distinctModels.size > 1) {
      throw new DatabaseError(
        "Cannot settle mixed commission-model transactions in one batch",
      );
    }
    const model: 0 | 1 = rows[0].commission_model === 1 ? 1 : 0;
    return { model, rows: model === 1 ? rows : [] };
  }

  /**
   * COMMISSION_AT_SETTLEMENT_PLAN.md D5/D6 — called ONLY for a
   * `commission_model` = 1 (AT_SETTLEMENT) batch, from inside
   * `settleTransactions`' own `db.transaction()` (step 5). Books the real
   * commission this settlement represents:
   *
   * 1. `supplier_settlements` (D5) — one row per settlement batch: the
   *    entered commission total, its per-currency gross (each eligible
   *    row's own `supplier_owed` — FinancialServiceRepository's
   *    `SUPPLIER_OWED_EXPR`, read via `findById` so this NEVER re-derives
   *    that expression, rule 14), the entry mode/rate/unit-count snapshot
   *    (D8), and the model — uniquely linked to THIS settlement's own
   *    `supplier_ledger` row via `ledger_entry_id` (never by time
   *    proximity — the LIRA-085 lesson).
   * 2. `settlement_commission_allocations` (D6) — one row per eligible
   *    `financial_services` row, per-currency share of the entered
   *    commission via largest-remainder proportional allocation
   *    (`utils/largestRemainder.ts`) so Σ = the entered commission exactly,
   *    per currency. Weighted by each row's own `supplier_owed` magnitude,
   *    bucketed by that row's OWN currency; falls back to an EQUAL split
   *    across every eligible row when a currency's total weight is 0 — the
   *    plan's "bills settlement note": a bill's principal reaches the
   *    supplier via the provider-drawer cost leg, never the ledger, so
   *    every bill row's gross weight is 0 and an equal per-bill split is
   *    the only sane default.
   * 3. The commission credit itself — the money-bearing step, which BRANCHES
   *    on `isBillsOnlyBatch` (BILL_COMMISSION_SETTLEMENT_PLAN.md, owner
   *    decision 2026-08-11):
   *
   *    - **Bills-only batch** (every eligible row is a BILL — today this is
   *      exactly Katsh; iPick is `commission_eligible = 0` so it never earns
   *      a nonzero commission here): the entered commission is a REAL
   *      top-up into the Katsh/iPick provider drawer, funded BY the
   *      provider — "Katsh owes us X, they pay it to us via top-up to our
   *      Katsh account" (owner, verbatim). Posted as a `payments` leg on
   *      THIS settlement's own transaction (`_bookBillsCommissionDrawerTopUp`)
   *      — no `supplier_ledger` row at all for this money (rule 20 "one
   *      obligation, one owner": there is no debt for it to net against).
   *      Reversal is FREE via the generic `_reversePayments` step every
   *      other transaction already gets (rule 20) — no bespoke code needed.
   *    - **Every other new-model batch** (none reachable in production
   *      today — kept for the generic `commission_model = 1` batches this
   *      file's OWN tests exercise, and for forward-compatibility with a
   *      future non-bills new-model row): unchanged from before this plan —
   *      a cashless `SUPPLIER_PAYS_US` `supplier_ledger` credit row
   *      (negative = the supplier owes the shop), `is_auto`, linked to THIS
   *      settlement's own ledger row via `source_ref_table`/`source_ref_id`
   *      — the EXACT shape `TransactionRepository`'s existing LIRA-091
   *      sibling-void cascade already scans for (`_cascadeSupplierSiblingVoid`,
   *      keyed off the SUPPLIER_SETTLEMENT transaction's own
   *      `source_table`/`source_id`, which IS this ledger row) — so voiding/
   *      refunding the settlement finds and soft-voids this row for free.
   *
   *    Both branches skip entirely when the entered commission is $0/0 LBP
   *    (nothing to credit).
   */
  private _bookCommissionAtSettlement(args: {
    settlementLedgerId: number;
    settlementTxnId: number;
    supplierId: number;
    supplierProvider: string | null;
    isBillsOnlyBatch: boolean;
    rows: EligibleSettlementRow[];
    data: SettleTransactionsData;
    tenantId: number;
  }): void {
    const {
      settlementLedgerId,
      settlementTxnId,
      supplierId,
      supplierProvider,
      isBillsOnlyBatch,
      rows,
      data,
      tenantId,
    } = args;

    // Gross (supplier_owed) per row, reused verbatim via findById() —
    // getColumns() already embeds SUPPLIER_OWED_EXPR, so this never
    // re-derives that CASE expression a second time (rule 14).
    const grossByRow = new Map<number, { gross: number; currency: string }>();
    let grossUsd = 0;
    let grossLbp = 0;
    for (const row of rows) {
      const fs = getFinancialServiceRepository().findById(row.id);
      const gross = fs?.supplier_owed ?? 0;
      const currency = row.currency === "LBP" ? "LBP" : "USD";
      grossByRow.set(row.id, { gross, currency });
      if (currency === "LBP") grossLbp += gross;
      else grossUsd += gross;
    }

    // Reviewer finding #2 (PLAUSIBLE, fixed defensively) — each currency
    // bucket's weight array must be built from ONLY the rows actually
    // denominated in that currency, not from every eligible row mapped to a
    // 0 weight when foreign. `allocateProportional`'s equal-weight fallback
    // triggers whenever ITS OWN weight array sums to 0 and then spreads the
    // total EQUALLY ACROSS EVERY ROW IN THAT ARRAY — so passing the full
    // `rows` list (with foreign-currency rows pinned to weight 0) meant a
    // batch mixing e.g. USD OMT rows with $0-gross LBP BILL rows spread the
    // LBP commission across the USD rows too the moment the LBP bucket's
    // real weights were all zero. Filtering to same-currency rows FIRST
    // means the equal-weight fallback (still needed for the bills
    // settlement note) only ever spreads across that currency's own rows;
    // `usdShareById`/`lbpShareById` default to 0 via `?? 0` below for any
    // row absent from its own currency's map (rows of the OTHER currency),
    // so no behavior changes for a single-currency batch.
    const usdRows = rows.filter(
      (r) => grossByRow.get(r.id)!.currency === "USD",
    );
    const lbpRows = rows.filter(
      (r) => grossByRow.get(r.id)!.currency === "LBP",
    );
    const usdWeights = usdRows.map((r) => ({
      id: r.id,
      weight: Math.abs(grossByRow.get(r.id)!.gross),
    }));
    const lbpWeights = lbpRows.map((r) => ({
      id: r.id,
      weight: Math.abs(grossByRow.get(r.id)!.gross),
    }));
    const usdShareById = new Map(
      allocateProportional(usdWeights, data.commission_usd, 0.01).map((s) => [
        s.id,
        s.amount,
      ]),
    );
    const lbpShareById = new Map(
      allocateProportional(lbpWeights, data.commission_lbp, 1).map((s) => [
        s.id,
        s.amount,
      ]),
    );

    // D5 — the real commission storage for this settlement batch.
    this.db
      .prepare(
        `INSERT INTO supplier_settlements
           (tenant_id, supplier_id, ledger_entry_id, gross_usd, gross_lbp,
            commission_usd, commission_lbp, entry_mode, rate, unit_count,
            model, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        tenantId,
        supplierId,
        settlementLedgerId,
        grossUsd,
        grossLbp,
        data.commission_usd,
        data.commission_lbp,
        data.entry_mode ?? "LUMP",
        data.commission_rate ?? null,
        data.commission_unit_count ?? null,
        data.created_by,
      );

    // D6 — one allocation row per settled fs row, per-currency share.
    const insertAllocation = this.db.prepare(
      `INSERT INTO settlement_commission_allocations
         (tenant_id, settlement_ledger_id, financial_service_id, service_type,
          provider, commission_usd, commission_lbp, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    );
    for (const row of rows) {
      insertAllocation.run(
        tenantId,
        settlementLedgerId,
        row.id,
        row.service_type,
        row.provider,
        usdShareById.get(row.id) ?? 0,
        lbpShareById.get(row.id) ?? 0,
      );
    }

    // The commission credit itself — see the method's own doc comment for
    // the branch.
    if (isBillsOnlyBatch) {
      this._bookBillsCommissionDrawerTopUp({
        settlementTxnId,
        supplierProvider,
        commissionUsd: data.commission_usd,
        commissionLbp: data.commission_lbp,
        createdBy: data.created_by,
        settlementLedgerId,
        tenantId,
      });
      return;
    }

    // ORIGINAL cashless-credit path — unchanged. Skipped for a $0/0-LBP
    // entered commission (nothing to credit); addLedgerEntry creates its own
    // separate hidden transaction (no drawer_name/transaction_id) and, via
    // source_ref_table/source_ref_id, is found for free by
    // TransactionRepository's existing LIRA-091 sibling-void cascade on this
    // settlement's own void/refund.
    if (
      Math.abs(data.commission_usd) > 0.005 ||
      Math.abs(data.commission_lbp) > 0.005
    ) {
      this.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "SUPPLIER_PAYS_US",
        amount_usd: -Math.abs(data.commission_usd),
        amount_lbp: -Math.abs(data.commission_lbp),
        note: `Auto: commission credit from settlement #${settlementLedgerId}`,
        created_by: data.created_by,
        is_auto: true,
        source_ref_table: "supplier_ledger",
        source_ref_id: settlementLedgerId,
      });
    }
  }

  /**
   * BILL_COMMISSION_SETTLEMENT_PLAN.md (LIRA-137) — Katsh/iPick bills-only
   * commission at settlement is a REAL top-up into the provider's OWN
   * drawer, funded BY the provider ("Katsh owes you 100,000 LBP... they pay
   * it to us via top-up to our Katsh account", owner 2026-08-11) — not a
   * `supplier_ledger` receivable.
   *
   * Deliberately does NOT reuse `RechargeRepository.topUpFromSupplier`'s
   * debt-booking half: that method books a `TOP_UP` `supplier_ledger` row
   * because the SHOP is extending its own credit line (the shop now owes the
   * supplier for the stock it just received). Here it is the OPPOSITE
   * direction — KATSH funds this top-up as a reward/commission — so the shop
   * owes nothing back for it; posting a `TOP_UP` row here would fabricate a
   * debt that was never incurred. This method therefore calls ONLY the
   * drawer-credit half (`applyDrawerDelta` + a `payments` leg on the
   * settlement's own transaction), never `addLedgerEntry`/`supplier_ledger`
   * at all — the two methods are kept apart by construction, not by a
   * runtime flag: this method has no code path that can reach
   * `supplier_ledger`.
   *
   * The leg posts on `settlementTxnId` (the SAME transaction step 3 of
   * `settleTransactions` already created) rather than a separate hidden
   * transaction — so reversal is FREE via the generic `_reversePayments`
   * step every void/refund already runs (rule 20): it mirrors every
   * `payments` row for the original transaction with the negated amount,
   * sign-agnostic, no bespoke code needed here. The transaction's own
   * `profit_usd`/`profit_lbp` (stamped by the caller, `settleTransactions`
   * step 3) net to 0 the same generic way every other transaction's profit
   * does on void (status flips to VOIDED, excluded from every ACTIVE-only
   * profit sum) or refund (the REFUND row carries `-profit_usd`/`-profit_lbp`).
   *
   * `method`/`drawerName` mirror the EXACT convention
   * `FinancialServiceRepository`'s cost/price-flow cost leg already uses for
   * a provider-drawer movement (`insertPayment.run(txnId, data.provider,
   * providerDrawer, ...)`) — the provider name IS the method, which is also
   * why `PROVIDER_STOCK_DRAWERS` (`TransactionRepository.ts`) already
   * excludes a Katsh-drawer leg from the customer-facing in/out legs
   * subtext, exactly like that cost leg.
   *
   * Skips entirely when both currencies are ~0 (nothing to credit — mirrors
   * the old SUPPLIER_PAYS_US guard it replaces for this batch shape).
   */
  private _bookBillsCommissionDrawerTopUp(args: {
    settlementTxnId: number;
    supplierProvider: string | null;
    commissionUsd: number;
    commissionLbp: number;
    createdBy: number;
    settlementLedgerId: number;
    tenantId: number;
  }): void {
    const {
      settlementTxnId,
      supplierProvider,
      commissionUsd,
      commissionLbp,
      createdBy,
      settlementLedgerId,
      tenantId,
    } = args;
    if (Math.abs(commissionUsd) <= 0.005 && Math.abs(commissionLbp) <= 0.005) {
      return;
    }
    // Defensive — every BILL row's provider is Katsh or iPick today (the
    // only two BILL-capable providers), both real top-up providers. Refuses
    // rather than silently dropping real money into nowhere if that
    // invariant is ever violated.
    if (!supplierProvider || !isTopUpProvider(supplierProvider)) {
      throw new DatabaseError(
        `Cannot book bills commission drawer top-up — provider "${supplierProvider ?? "null"}" has no configured top-up drawer`,
      );
    }
    const destDrawer = TOP_UP_PROVIDER_DRAWERS[supplierProvider];

    const post = (amount: number, currencyCode: "USD" | "LBP") => {
      if (Math.abs(amount) <= 0.005) return;
      applyDrawerDelta(this.db, {
        drawerName: destDrawer,
        currencyCode,
        delta: amount,
        tenantId,
      });
      insertPaymentRow(this.db, {
        transactionId: settlementTxnId,
        method: supplierProvider,
        drawerName: destDrawer,
        currencyCode,
        amount,
        note: `Commission from settlement #${settlementLedgerId}: +${amount} ${currencyCode} → ${destDrawer}`,
        createdBy,
        tenantId,
      });
    };
    post(commissionUsd, "USD");
    post(commissionLbp, "LBP");
  }

  /**
   * Record a direct supplier cash flow that is NOT tied to settling specific
   * transactions — paying a supplier down, or a supplier paying us back.
   *
   * Uses real payment-method legs so the cash hits the CORRECT drawer (General
   * for CASH, the wallet drawer for WHISH/OMT, etc.) — never the provider's own
   * stock drawer. When the supplier IS the shop's primary provider
   * (`shop_base_system`), a CASH leg resolves to the primary cash drawer
   * (PCD) instead of General (Primary Cash Drawer plan §1/§8.2, decision
   * #10). Works with zero pending transactions.
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
      // Primary Cash Drawer plan §1/§8.2 (decision #10) — same resolution as
      // settleTransactions, read-only before the write transaction below.
      const supplier = this.findById(data.supplier_id);
      const drawerCtx: ServiceCashDrawerContext = {
        provider: supplier?.provider ?? "",
        baseSystem: getSettingsService().getShopBaseSystem(),
      };
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
          // Primary Cash Drawer plan §1/§8.2 (decision #10): a CASH leg to
          // the shop's primary-system supplier resolves to the PCD.
          const drawerName = resolveServiceCashDrawer(p.method, drawerCtx);
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
