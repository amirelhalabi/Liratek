/**
 * Partner Repository
 *
 * Handles all partners and partner_ledger table operations.
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError, NotFoundError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { paymentMethodToDrawerName } from "../utils/payments.js";
import { allocateFifo } from "../utils/fifoCoverage.js";
import { buildCounterpartyMetadata } from "../validators/counterparty.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  buildCounterpartyDiscountPosting,
} from "./moneyPosting.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface Partner {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  is_active: number;
  system_association: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerLedgerEntry {
  id: number;
  partner_id: number;
  transaction_type: string | null;
  reference_table: string | null;
  reference_id: number | null;
  amount: number;
  currency: string;
  direction: "DEBIT" | "CREDIT";
  notes: string | null;
  user_id: number | null;
  settlement_method: string | null;
  created_at: string;
  // Enriched fields from financial_services JOIN (null when reference_table != 'financial_services')
  fs_provider: string | null;
  fs_service_type: string | null;
  fs_amount: number | null;
  fs_currency: string | null;
  fs_fee: number | null;
  fs_customer: string | null;
  fs_reference_number: string | null;
  fs_phone_number: string | null;
}

export interface PartnerBalance {
  usd: number;
  lbp: number;
  usdt: number;
}

export interface PartnerBalanceBreakdown {
  usd: { for: number; through: number; other: number; total: number };
  lbp: { for: number; through: number; other: number; total: number };
  usdt: { for: number; through: number; other: number; total: number };
}

export interface LedgerFilters {
  startDate?: string;
  endDate?: string;
  type?: string;
  mode?: "FOR" | "THROUGH";
  provider?: string;
  direction?: "DEBIT" | "CREDIT";
}

// =============================================================================
// Input Types
// =============================================================================

export interface CreatePartnerData {
  name: string;
  phone?: string | null;
  notes?: string | null;
  system_association?: string | null;
}

export interface UpdatePartnerData {
  name?: string;
  phone?: string;
  notes?: string;
  is_active?: number;
  system_association?: string | null;
}

export interface CreateLedgerEntryData {
  partner_id: number;
  transaction_type?:
    | "OMT_SEND"
    | "OMT_RECEIVE"
    | "WHISH_SEND"
    | "WHISH_RECEIVE"
    | "THROUGH_OMT_SEND"
    | "THROUGH_OMT_RECEIVE"
    | "THROUGH_WHISH_SEND"
    | "THROUGH_WHISH_RECEIVE"
    | "FOR_OMT_SEND"
    | "FOR_OMT_RECEIVE"
    | "FOR_WHISH_SEND"
    | "FOR_WHISH_RECEIVE"
    | "FOR_POS"
    | "FOR_RECHARGE"
    | "FOR_KATSH"
    | "FOR_IPICK"
    | "FOR_OMT_APP_SEND"
    | "FOR_OMT_APP_RECEIVE"
    | "FOR_WHISH_APP_SEND"
    | "FOR_WHISH_APP_RECEIVE"
    | "FOR_BINANCE_SEND"
    | "FOR_BINANCE_RECEIVE"
    | "FOR_LOTO"
    | "CUSTOM_SERVICE"
    | "WHISH_TOPUP"
    | "SETTLEMENT"
    | "ADJUSTMENT"
    /** CQ-10 — the partner forgives part of what they owe (direction CREDIT,
     *  same as a SETTLEMENT) or the shop forgives part of what it owes the
     *  partner (direction DEBIT). Free-text since v127 — see
     *  partnerLedgerTypes.guard.test.ts (only polices FOR_%/THROUGH_%
     *  literals, so this union entry is the only enforcement for 'DISCOUNT'). */
    | "DISCOUNT";
  reference_table?: string;
  reference_id?: number;
  amount: number;
  currency: string;
  direction: "DEBIT" | "CREDIT";
  notes?: string;
  user_id?: number;
  settlement_method?: "CASH" | "OMT" | "WHISH" | "BINANCE" | "CLIENT_ACCOUNT";
  /** PFT-7b: force settlement FIFO coverage for a non-SETTLEMENT row (a
   *  cash-moved manual entry) — profit realizes when real money moves. */
  applyCoverage?: boolean;
  /** CQ-7: optional backdated timestamp (mirrors the caller's own
   *  `transaction_time` override, e.g. FinancialServiceRepository's FOR_%/
   *  THROUGH_% rows) — COALESCEd with CURRENT_TIMESTAMP, so omitting it keeps
   *  the existing default behavior for every other caller. */
  created_at?: string;
}

// =============================================================================
// Repository
// =============================================================================

export class PartnerRepository extends BaseRepository<Partner> {
  constructor() {
    super("partners", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, name, phone, notes, is_active, system_association, created_at, updated_at";
  }

  // ── Partners ──────────────────────────────────────────────────────────────

  create(data: CreatePartnerData): Partner {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO partners (name, phone, notes, system_association, is_active, tenant_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      const result = stmt.run(
        data.name.trim(),
        data.phone ?? null,
        data.notes ?? null,
        data.system_association ?? null,
        getCurrentTenantId(),
      );
      const id = Number(result.lastInsertRowid);
      const partner = this.getById(id);
      if (!partner) {
        throw new DatabaseError("Failed to retrieve created partner");
      }
      return partner;
    } catch (e) {
      throw new DatabaseError("Failed to create partner", { cause: e });
    }
  }

  getById(id: number): Partner | null {
    try {
      const stmt = this.db.prepare(
        `SELECT ${this.getColumns()} FROM partners WHERE id = ? AND tenant_id = ?`,
      );
      return (
        (stmt.get(id, getCurrentTenantId()) as Partner | undefined) ?? null
      );
    } catch (e) {
      throw new DatabaseError("Failed to get partner by id", { cause: e });
    }
  }

  getAll(includeInactive = false): Partner[] {
    try {
      const sql = includeInactive
        ? `SELECT ${this.getColumns()} FROM partners WHERE tenant_id = ? ORDER BY name ASC`
        : `SELECT ${this.getColumns()} FROM partners WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC`;
      return this.query<Partner>(sql, getCurrentTenantId());
    } catch (e) {
      throw new DatabaseError("Failed to get partners", { cause: e });
    }
  }

  update(id: number, data: UpdatePartnerData): Partner {
    try {
      const fields: string[] = [];
      const values: unknown[] = [];

      if (data.name !== undefined) {
        fields.push("name = ?");
        values.push(data.name.trim());
      }
      if (data.phone !== undefined) {
        fields.push("phone = ?");
        values.push(data.phone ?? null);
      }
      if (data.notes !== undefined) {
        fields.push("notes = ?");
        values.push(data.notes ?? null);
      }
      if (data.is_active !== undefined) {
        fields.push("is_active = ?");
        values.push(data.is_active);
      }
      if (data.system_association !== undefined) {
        fields.push("system_association = ?");
        values.push(data.system_association ?? null);
      }

      if (fields.length === 0) {
        const existing = this.getById(id);
        if (!existing) {
          throw new NotFoundError(`Partner with id ${id} not found`);
        }
        return existing;
      }

      fields.push("updated_at = CURRENT_TIMESTAMP");
      values.push(id);
      values.push(getCurrentTenantId());

      const stmt = this.db.prepare(
        `UPDATE partners SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      );
      stmt.run(...values);

      const updated = this.getById(id);
      if (!updated) {
        throw new NotFoundError(`Partner with id ${id} not found`);
      }
      return updated;
    } catch (e) {
      if (e instanceof NotFoundError) throw e;
      throw new DatabaseError("Failed to update partner", { cause: e });
    }
  }

  deactivate(id: number): void {
    try {
      const stmt = this.db.prepare(
        `UPDATE partners SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      );
      stmt.run(id, getCurrentTenantId());
    } catch (e) {
      throw new DatabaseError("Failed to deactivate partner", { cause: e });
    }
  }

  activate(id: number): void {
    try {
      const stmt = this.db.prepare(
        `UPDATE partners SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`,
      );
      stmt.run(id, getCurrentTenantId());
    } catch (e) {
      throw new DatabaseError("Failed to activate partner", { cause: e });
    }
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  addLedgerEntry(data: CreateLedgerEntryData): PartnerLedgerEntry {
    try {
      const tenantId = getCurrentTenantId();
      const stmt = this.db.prepare(`
        INSERT INTO partner_ledger (
          partner_id, transaction_type, reference_table, reference_id,
          amount, currency, direction, notes, user_id, settlement_method,
          tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);
      const result = stmt.run(
        data.partner_id,
        data.transaction_type ?? null,
        data.reference_table ?? null,
        data.reference_id ?? null,
        data.amount,
        data.currency,
        data.direction,
        data.notes ?? null,
        data.user_id ?? null,
        data.settlement_method ?? null,
        tenantId,
        data.created_at ?? null,
      );
      const id = Number(result.lastInsertRowid);

      // PFT-6: a SETTLEMENT pays the partner's FOR_% obligations down — apply
      // it FIFO so profit recognition (ProfitRepository partner gates) can
      // tell which source transactions the partner has actually settled.
      // PFT-7b: cash-moved manual entries (applyCoverage) count too — profit
      // realizes when real money moves; paper entries never cover.
      // CQ-10: a DISCOUNT row covers exactly like a SETTLEMENT — a forgiven
      // amount is just as real as cash for closing out a FOR_% obligation
      // (skipping this would leave the deferred profit stuck forever, the
      // exact "paper ADJUSTMENT" trap this ticket exists to avoid).
      if (
        data.transaction_type === "SETTLEMENT" ||
        data.transaction_type === "DISCOUNT" ||
        data.applyCoverage === true
      ) {
        this.applySettlementCoverage(
          data.partner_id,
          data.currency,
          data.direction,
          data.amount,
          tenantId,
        );
      }

      const entry = this.db
        .prepare(
          `SELECT id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at FROM partner_ledger WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, tenantId) as PartnerLedgerEntry | undefined;
      if (!entry) {
        throw new DatabaseError("Failed to retrieve created ledger entry");
      }
      return entry;
    } catch (e) {
      throw new DatabaseError("Failed to add partner ledger entry", {
        cause: e,
      });
    }
  }

  /**
   * PFT-6 — settlement→profit recognition (owner decision, Model A: for-
   * partner profit is real only once the partner settles).
   *
   * A SETTLEMENT row of direction D covers the partner's OPPOSITE-direction
   * FOR_% rows in the SAME currency, oldest first (FIFO), by bumping each
   * row's covered_amount (v128). ProfitRepository treats a source transaction
   * as realized only when its FOR_% rows are fully covered.
   *
   * Only SETTLEMENT rows apply coverage: FOR_%/THROUGH_% rows must never act
   * as coverage (a void's negating FOR row would otherwise "settle" its own
   * original), and manual ADJUSTMENT rows stay conservative bookkeeping (they
   * move the balance but do not realize profit).
   */
  private applySettlementCoverage(
    partnerId: number,
    currency: string,
    direction: "DEBIT" | "CREDIT",
    amount: number,
    tenantId: number,
  ): void {
    let remaining = Math.abs(amount);
    if (remaining <= 0.005) return;
    const targetDirection = direction === "CREDIT" ? "DEBIT" : "CREDIT";
    const open = this.db
      .prepare(
        `SELECT id, amount, covered_amount FROM partner_ledger
         WHERE partner_id = ? AND tenant_id = ? AND currency = ?
           AND direction = ?
           AND transaction_type LIKE 'FOR\\_%' ESCAPE '\\'
           AND covered_amount < amount - 0.005
         ORDER BY created_at ASC, id ASC`,
      )
      .all(partnerId, tenantId, currency, targetDirection) as Array<{
      id: number;
      amount: number;
      covered_amount: number;
    }>;
    const upd = this.db.prepare(
      `UPDATE partner_ledger SET covered_amount = ? WHERE id = ? AND tenant_id = ?`,
    );
    // CQ-2 — shared FIFO allocator; epsilon 0.005 matches this site's
    // original tolerance exactly (both the row-selection filter above and
    // the loop's own stop condition).
    const takes = allocateFifo(
      open.map((row) => ({
        id: row.id,
        outstanding: row.amount - row.covered_amount,
      })),
      remaining,
      0.005,
    );
    const openById = new Map<number, (typeof open)[number]>(
      open.map((row) => [row.id, row]),
    );
    for (const t of takes) {
      const row = openById.get(t.id as number)!;
      upd.run(row.covered_amount + t.take, row.id, tenantId);
    }
  }

  /**
   * PFT-6b (owner-approved 2026-07-14) — a settlement MOVES REAL MONEY: the
   * drawer follows the settlement method (CASH→General, BINANCE→Binance, …),
   * credited when the partner pays the shop (settlement CREDIT) and debited
   * when the shop pays the partner (settlement DEBIT). Writes the unified
   * PARTNER_SETTLEMENT transaction + a real payments row so the Transactions
   * viewer and checkpoints see it. PARTNER_SETTLEMENT is non-reversible
   * (rule 20 option b — the FIFO coverage stamps cannot be un-applied);
   * corrections are made with an opposite settlement.
   *
   * BINANCE settlements move the Binance drawer in USDT at the settled USD
   * figure (the same 1:1 numeric convention the Binance FOR flows use —
   * the partner ledger is always USD).
   *
   * CQ-11 (split-leg settlement) — an optional `legs` array supersedes
   * `entry.settlement_method` for MONEY MOVEMENT: instead of ONE payments
   * row + ONE drawer delta, it writes N payments rows + N drawer deltas
   * (one per leg), still inside the SAME transaction and still against the
   * SAME single partner_ledger row / single PARTNER_SETTLEMENT transaction.
   * Every leg's `currency_code` is validated upstream (schema + service) to
   * equal `entry.currency`; the BINANCE→USDT drawer-currency override is
   * preserved per leg exactly like the single-leg path. Omitting `legs`
   * keeps the original single-leg behavior byte-identical.
   */
  recordSettlementMoneyMovement(
    entry: PartnerLedgerEntry,
    userId: number,
    txnType:
      | "PARTNER_SETTLEMENT"
      | "PARTNER_PAYMENT" = TRANSACTION_TYPES.PARTNER_SETTLEMENT,
    /** CQ-10 — a bundled discount is annotated onto THIS settlement's own
     *  metadata (informational only; the money-and-profit effect lives on
     *  the separate COUNTERPARTY_DISCOUNT row `recordDiscount` posts). */
    discount?: { amount_usd: number; amount_lbp: number; reason?: string },
    /** CQ-11 — split payment legs (MultiPaymentInput). Each leg's amount is
     *  UNsigned (positive); the direction sign is derived once from
     *  `entry.direction`, same as the legacy single-leg `signed` below. */
    legs?: Array<{ method: string; currency_code: string; amount: number }>,
  ): number {
    const tenantId = getCurrentTenantId();
    const method = entry.settlement_method ?? "CASH";
    const drawerName = paymentMethodToDrawerName(method);
    const drawerCurrency = method === "BINANCE" ? "USDT" : entry.currency;
    // CREDIT settlement = partner pays the shop → money IN (+drawer).
    // DEBIT settlement = shop pays the partner → money OUT (−drawer).
    const signed =
      entry.direction === "CREDIT"
        ? Math.abs(entry.amount)
        : -Math.abs(entry.amount);

    const partner = this.getById(entry.partner_id);
    const label = partner?.name ?? `partner #${entry.partner_id}`;

    // CQ-11: the transaction's method (both the legacy top-level
    // `settlement_method` metadata key and the namespaced
    // `counterparty.method`) reflects what ACTUALLY moved money — the
    // legs' methods when present (collapsing to 'SPLIT' when they're mixed),
    // falling back to the legacy `method` when `legs` is omitted.
    const legMethods = legs ? new Set(legs.map((l) => l.method)) : null;
    const effectiveMethod = legMethods
      ? legMethods.size > 1
        ? "SPLIT"
        : (legs as Array<{ method: string }>)[0].method
      : method;

    const txn = this.db.transaction(() => {
      const txnId = getTransactionRepository().createTransaction({
        type: txnType,
        source_table: "partner_ledger",
        source_id: entry.id,
        user_id: userId,
        amount_usd: entry.currency === "USD" ? signed : 0,
        amount_lbp: entry.currency === "LBP" ? signed : 0,
        profit_usd: 0,
        profit_lbp: 0,
        client_id: null,
        summary: `${
          txnType === TRANSACTION_TYPES.PARTNER_PAYMENT
            ? "Partner payment"
            : "Partner settlement"
        }: ${
          entry.direction === "CREDIT" ? "received from" : "paid to"
        } ${label} — ${Math.abs(entry.amount)} ${entry.currency} via ${effectiveMethod}`,
        metadata_json: {
          partner_id: entry.partner_id,
          settlement_method: effectiveMethod,
          direction: entry.direction,
          // CQ-8 counterparty contract: CREDIT settlement = partner pays the
          // shop (IN); DEBIT settlement = shop pays the partner (OUT) — same
          // direction the drawer delta above (`signed`) already encodes.
          counterparty: buildCounterpartyMetadata({
            kind: "partner",
            id: entry.partner_id,
            name: label,
            flow: entry.direction === "CREDIT" ? "IN" : "OUT",
            method: effectiveMethod,
            ledgerEntryId: entry.id,
            discount: discount
              ? {
                  amount_usd: Math.abs(discount.amount_usd || 0),
                  amount_lbp: Math.abs(discount.amount_lbp || 0),
                  reason: discount.reason,
                }
              : undefined,
          }),
        },
      });

      if (legs && legs.length > 0) {
        for (const leg of legs) {
          const legDrawerName = paymentMethodToDrawerName(leg.method);
          const legDrawerCurrency =
            leg.method === "BINANCE" ? "USDT" : leg.currency_code;
          const legSigned =
            entry.direction === "CREDIT"
              ? Math.abs(leg.amount)
              : -Math.abs(leg.amount);
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: leg.method,
            drawerName: legDrawerName,
            currencyCode: legDrawerCurrency,
            amount: legSigned,
            note: `Partner settlement (${label})`,
            createdBy: userId,
            tenantId,
          });
          applyDrawerDelta(this.db, {
            drawerName: legDrawerName,
            currencyCode: legDrawerCurrency,
            delta: legSigned,
            tenantId,
          });
        }
      } else {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method,
          drawerName,
          currencyCode: drawerCurrency,
          amount: signed,
          note: `Partner settlement (${label})`,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode: drawerCurrency,
          delta: signed,
          tenantId,
        });
      }
      return txnId;
    });
    return txn();
  }

  /**
   * CQ-10 — post ONE COUNTERPARTY_DISCOUNT transaction for a partner DISCOUNT
   * ledger entry. Unlike recordSettlementMoneyMovement, this writes NO
   * payments row / drawer delta — a discount moves no cash (amount_usd/
   * amount_lbp = 0). `entry` must already have been written via
   * addLedgerEntry(transaction_type: "DISCOUNT", ...) — its own insertion
   * already triggered applySettlementCoverage.
   *
   * direction CREDIT = the shop forgives the partner's debt to it (forgiving
   * a receivable) → profit NEGATIVE, flow IN (as-if-paid). direction DEBIT =
   * the partner forgives what the shop owes them (a payable) → profit
   * POSITIVE, flow OUT.
   */
  recordDiscount(entry: PartnerLedgerEntry, userId: number): number {
    const partner = this.getById(entry.partner_id);
    const label = partner?.name ?? `partner #${entry.partner_id}`;
    const magnitude = Math.abs(entry.amount);
    // CQ-5/D1: CREDIT = the partner owed the shop, forgiven → "forgiven"
    // (flow IN, as-if-paid). DEBIT = the shop owed the partner, forgiven →
    // "received" (flow OUT) — same direction a real settlement of that sign
    // would use. The signed profit + counterparty metadata shape is now the
    // ONE shared helper every counterparty discount posts through
    // (moneyPosting.ts) — Debt/Supplier drive the SAME axis from their own
    // fixed direction.
    const posting = buildCounterpartyDiscountPosting({
      kind: "partner",
      ledgerEntryId: entry.id,
      counterpartyId: entry.partner_id,
      counterpartyName: label,
      amountUsd: entry.currency === "USD" ? magnitude : 0,
      amountLbp: entry.currency === "LBP" ? magnitude : 0,
      discountDirection: entry.direction === "CREDIT" ? "forgiven" : "received",
      extraMetadata: {
        partner_id: entry.partner_id,
        direction: entry.direction,
      },
    });

    return getTransactionRepository().createTransaction({
      type: TRANSACTION_TYPES.COUNTERPARTY_DISCOUNT,
      source_table: "partner_ledger",
      source_id: entry.id,
      user_id: userId,
      amount_usd: 0,
      amount_lbp: 0,
      profit_usd: posting.profit_usd,
      profit_lbp: posting.profit_lbp,
      client_id: null,
      summary:
        entry.direction === "CREDIT"
          ? `Discount: ${magnitude} ${entry.currency} forgiven — ${label}`
          : `Partner discount received: ${magnitude} ${entry.currency} — ${label}`,
      metadata_json: posting.metadata_json,
    });
  }

  getLedgerEntries(
    partnerId: number,
    filters?: LedgerFilters,
  ): PartnerLedgerEntry[] {
    try {
      const conditions = ["pl.partner_id = ?", "pl.tenant_id = ?"];
      const params: unknown[] = [partnerId, getCurrentTenantId()];

      if (filters?.startDate) {
        conditions.push("pl.created_at >= ?");
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        conditions.push("pl.created_at <= ?");
        params.push(filters.endDate);
      }
      if (filters?.type) {
        conditions.push("pl.transaction_type = ?");
        params.push(filters.type);
      }
      if (filters?.mode) {
        conditions.push("pl.transaction_type LIKE ?");
        params.push(`${filters.mode}_%`);
      }
      if (filters?.provider) {
        const p = filters.provider.toUpperCase();
        conditions.push(
          "(pl.transaction_type LIKE ? OR pl.transaction_type LIKE ?)",
        );
        params.push(`%_${p}_%`, `%_${p}`);
      }
      if (filters?.direction) {
        conditions.push("pl.direction = ?");
        params.push(filters.direction);
      }

      const sql = `
        SELECT
          pl.id, pl.partner_id, pl.transaction_type, pl.reference_table, pl.reference_id,
          pl.amount, pl.currency, pl.direction, pl.notes, pl.user_id, pl.settlement_method,
          pl.created_at,
          fs.provider        AS fs_provider,
          fs.service_type    AS fs_service_type,
          fs.amount          AS fs_amount,
          fs.currency        AS fs_currency,
          COALESCE(fs.omt_fee, fs.whish_fee, 0) AS fs_fee,
          CASE fs.service_type
            WHEN 'SEND'    THEN COALESCE(fs.sender_name, fs.client_name)
            WHEN 'RECEIVE' THEN COALESCE(fs.receiver_name, fs.client_name)
            ELSE fs.client_name
          END                AS fs_customer,
          fs.reference_number AS fs_reference_number,
          fs.phone_number     AS fs_phone_number
        FROM partner_ledger pl
        LEFT JOIN financial_services fs
          ON pl.reference_table = 'financial_services' AND pl.reference_id = fs.id
          AND fs.tenant_id = pl.tenant_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY pl.created_at DESC
      `;
      return this.query<PartnerLedgerEntry>(sql, ...params);
    } catch (e) {
      throw new DatabaseError("Failed to get partner ledger entries", {
        cause: e,
      });
    }
  }

  getBalanceBreakdown(partnerId: number): PartnerBalanceBreakdown {
    try {
      const row = this.db
        .prepare(
          `
          SELECT
            -- FOR mode (transaction_type starts with 'FOR_')
            COALESCE(SUM(CASE WHEN currency='USD' AND direction='DEBIT'  AND transaction_type LIKE 'FOR_%'  THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='USD' AND direction='CREDIT' AND transaction_type LIKE 'FOR_%'  THEN amount ELSE 0 END),0) AS usd_for,
            COALESCE(SUM(CASE WHEN currency='LBP' AND direction='DEBIT'  AND transaction_type LIKE 'FOR_%'  THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='LBP' AND direction='CREDIT' AND transaction_type LIKE 'FOR_%'  THEN amount ELSE 0 END),0) AS lbp_for,
            -- THROUGH mode (transaction_type starts with 'THROUGH_')
            COALESCE(SUM(CASE WHEN currency='USD' AND direction='DEBIT'  AND transaction_type LIKE 'THROUGH_%' THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='USD' AND direction='CREDIT' AND transaction_type LIKE 'THROUGH_%' THEN amount ELSE 0 END),0) AS usd_through,
            COALESCE(SUM(CASE WHEN currency='LBP' AND direction='DEBIT'  AND transaction_type LIKE 'THROUGH_%' THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='LBP' AND direction='CREDIT' AND transaction_type LIKE 'THROUGH_%' THEN amount ELSE 0 END),0) AS lbp_through,
            -- Other (settlement, adjustment, legacy types)
            COALESCE(SUM(CASE WHEN currency='USD' AND direction='DEBIT'  AND transaction_type NOT LIKE 'FOR_%' AND transaction_type NOT LIKE 'THROUGH_%' THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='USD' AND direction='CREDIT' AND transaction_type NOT LIKE 'FOR_%' AND transaction_type NOT LIKE 'THROUGH_%' THEN amount ELSE 0 END),0) AS usd_other,
            COALESCE(SUM(CASE WHEN currency='LBP' AND direction='DEBIT'  AND transaction_type NOT LIKE 'FOR_%' AND transaction_type NOT LIKE 'THROUGH_%' THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='LBP' AND direction='CREDIT' AND transaction_type NOT LIKE 'FOR_%' AND transaction_type NOT LIKE 'THROUGH_%' THEN amount ELSE 0 END),0) AS lbp_other,
            -- USDT (Binance partner transactions) — same FOR/THROUGH/other split
            COALESCE(SUM(CASE WHEN currency='USDT' AND direction='DEBIT'  AND transaction_type LIKE 'FOR_%'  THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='USDT' AND direction='CREDIT' AND transaction_type LIKE 'FOR_%'  THEN amount ELSE 0 END),0) AS usdt_for,
            COALESCE(SUM(CASE WHEN currency='USDT' AND direction='DEBIT'  AND transaction_type LIKE 'THROUGH_%' THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='USDT' AND direction='CREDIT' AND transaction_type LIKE 'THROUGH_%' THEN amount ELSE 0 END),0) AS usdt_through,
            COALESCE(SUM(CASE WHEN currency='USDT' AND direction='DEBIT'  AND transaction_type NOT LIKE 'FOR_%' AND transaction_type NOT LIKE 'THROUGH_%' THEN amount ELSE 0 END),0)
            - COALESCE(SUM(CASE WHEN currency='USDT' AND direction='CREDIT' AND transaction_type NOT LIKE 'FOR_%' AND transaction_type NOT LIKE 'THROUGH_%' THEN amount ELSE 0 END),0) AS usdt_other
          FROM partner_ledger
          WHERE partner_id = ? AND tenant_id = ?
        `,
        )
        .get(partnerId, getCurrentTenantId()) as {
        usd_for: number;
        lbp_for: number;
        usd_through: number;
        lbp_through: number;
        usd_other: number;
        lbp_other: number;
        usdt_for: number;
        usdt_through: number;
        usdt_other: number;
      };

      return {
        usd: {
          for: row.usd_for,
          through: row.usd_through,
          other: row.usd_other,
          total: row.usd_for + row.usd_through + row.usd_other,
        },
        lbp: {
          for: row.lbp_for,
          through: row.lbp_through,
          other: row.lbp_other,
          total: row.lbp_for + row.lbp_through + row.lbp_other,
        },
        usdt: {
          for: row.usdt_for,
          through: row.usdt_through,
          other: row.usdt_other,
          total: row.usdt_for + row.usdt_through + row.usdt_other,
        },
      };
    } catch (e) {
      throw new DatabaseError("Failed to get partner balance breakdown", {
        cause: e,
      });
    }
  }

  getBalance(partnerId: number): PartnerBalance {
    try {
      const row = this.db
        .prepare(
          `
          SELECT
            COALESCE(SUM(CASE WHEN currency = 'USD' AND direction = 'DEBIT'  THEN amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN currency = 'USD' AND direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS usd,
            COALESCE(SUM(CASE WHEN currency = 'LBP' AND direction = 'DEBIT'  THEN amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN currency = 'LBP' AND direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS lbp,
            COALESCE(SUM(CASE WHEN currency = 'USDT' AND direction = 'DEBIT'  THEN amount ELSE 0 END), 0)
            - COALESCE(SUM(CASE WHEN currency = 'USDT' AND direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS usdt
          FROM partner_ledger
          WHERE partner_id = ? AND tenant_id = ?
        `,
        )
        .get(partnerId, getCurrentTenantId()) as {
        usd: number;
        lbp: number;
        usdt: number;
      };

      return { usd: row.usd, lbp: row.lbp, usdt: row.usdt };
    } catch (e) {
      throw new DatabaseError("Failed to get partner balance", { cause: e });
    }
  }

  getAllBalances(includeInactive?: boolean): Array<Partner & PartnerBalance> {
    try {
      const tenantId = getCurrentTenantId();
      const filter = includeInactive
        ? "p.tenant_id = ?"
        : "p.tenant_id = ? AND p.is_active = 1";
      return this.query<Partner & PartnerBalance>(
        `
        SELECT
          p.id, p.name, p.phone, p.notes, p.is_active, p.system_association, p.created_at, p.updated_at,
          COALESCE(SUM(CASE WHEN l.currency = 'USD' AND l.direction = 'DEBIT'  THEN l.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN l.currency = 'USD' AND l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0) AS usd,
          COALESCE(SUM(CASE WHEN l.currency = 'LBP' AND l.direction = 'DEBIT'  THEN l.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN l.currency = 'LBP' AND l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0) AS lbp,
          COALESCE(SUM(CASE WHEN l.currency = 'USDT' AND l.direction = 'DEBIT'  THEN l.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN l.currency = 'USDT' AND l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0) AS usdt
        FROM partners p
        LEFT JOIN partner_ledger l ON l.partner_id = p.id AND l.tenant_id = p.tenant_id
        WHERE ${filter}
        GROUP BY p.id
        ORDER BY p.name ASC
      `,
        tenantId,
      );
    } catch (e) {
      throw new DatabaseError("Failed to get all partner balances", {
        cause: e,
      });
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let partnerRepositoryInstance: PartnerRepository | null = null;

export function getPartnerRepository(): PartnerRepository {
  if (!partnerRepositoryInstance) {
    partnerRepositoryInstance = new PartnerRepository();
  }
  return partnerRepositoryInstance;
}

export function resetPartnerRepository(): void {
  partnerRepositoryInstance = null;
}
