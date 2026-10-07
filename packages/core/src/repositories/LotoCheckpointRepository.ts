/**
 * Loto Checkpoint Repository
 *
 * Handles all database operations for loto_checkpoints and loto_settlements tables.
 * These stay together because settleCheckpoint() writes to both tables in one transaction.
 */

import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  isDrawerAffectingMethod,
  paymentMethodToDrawerName,
} from "../utils/payments.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import {
  applyDrawerDelta,
  cashierRateStamp,
  insertPaymentRow,
  reconcileLegs,
} from "./moneyPosting.js";
import { resolveLotoSupplierId } from "./LotoTicketRepository.js";

/** A settlement payment leg as both settle entry points receive it. Signed:
 *  positive = LOTO pays the shop (money in), negative = the shop pays LOTO. */
interface SettlementLeg {
  method: string;
  currency_code: string;
  amount: number;
  direction?: "IN" | "OUT";
}

/**
 * LIRA-258 G23 (POSTING_INTEGRITY_PLAN.md item 3.6): the settlement's drawer
 * legs must be the net settlement — no more, no less — before anything is
 * written. Pre-fix any amount was booked, and OUT / non-drawer legs were
 * silently skipped while the supplier balance was still zeroed in full.
 *   - every leg moves a drawer (a settlement has no customer account);
 *   - no OUT (change) legs — a settlement is one payment, one direction;
 *   - every leg points the same way as the net (negative = the shop pays);
 *   - Σ|legs| reconciles to |net| through the shared `reconcileLegs`
 *     (same tolerance/rate handling as the ticket and recharge flows).
 * No legs at all is still accepted (settling without recording a payment —
 * existing callers and the e2e settle helper rely on it).
 */
function assertSettlementLegsReconcile(
  legs: SettlementLeg[],
  netSettlement: number,
  exchangeRate: number,
  tenderExchangeRate: number | undefined,
  context: string,
): void {
  if (legs.length === 0) return;
  for (const leg of legs) {
    if (leg.direction === "OUT") {
      throw new Error(
        `${context}: change (OUT) legs are not part of a supplier settlement`,
      );
    }
    if (!isDrawerAffectingMethod(leg.method)) {
      throw new Error(
        `${context}: payment method "${leg.method}" moves no drawer — a settlement must be paid from a drawer`,
      );
    }
    if (
      leg.amount !== 0 &&
      Math.sign(leg.amount) !== Math.sign(netSettlement)
    ) {
      throw new Error(
        netSettlement < 0
          ? `${context}: payment direction does not match — the shop pays LOTO here, so every leg must be a payment out`
          : `${context}: payment direction does not match — LOTO pays the shop here, so every leg must be a payment in`,
      );
    }
  }
  reconcileLegs({
    inLegs: legs.map((l) => ({
      method: l.method,
      currencyCode: l.currency_code,
      amount: l.amount,
    })),
    expectedTotals: { usd: 0, lbp: Math.abs(netSettlement) },
    exchangeRate,
    tenderExchangeRate,
    context,
  });
}

export interface LotoCheckpoint {
  id: number;
  checkpoint_date: string;
  period_start: string;
  period_end: string;
  total_sales: number;
  total_commission: number;
  total_tickets: number;
  total_prizes: number;
  total_cash_prizes: number;
  total_cash_prizes_count: number;
  is_settled: number;
  settled_at: string | null;
  settlement_id: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface LotoCheckpointCreate {
  checkpoint_date: string;
  period_start: string;
  period_end: string;
  total_sales?: number;
  total_commission?: number;
  total_tickets?: number;
  total_prizes?: number;
  total_cash_prizes?: number;
  total_cash_prizes_count?: number;
  note?: string;
}

export interface LotoCheckpointUpdate {
  checkpoint_date?: string;
  period_start?: string;
  period_end?: string;
  total_sales?: number;
  total_commission?: number;
  total_tickets?: number;
  total_prizes?: number;
  is_settled?: number;
  settled_at?: string;
  settlement_id?: number;
  note?: string;
}

export interface LotoSettlement {
  id: number;
  settlement_date: string;
  checkpoint_ids: string; // JSON array
  total_sales: number;
  total_commission: number;
  total_cash_prizes: number;
  net_settlement: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export class LotoCheckpointRepository {
  /** Explicit override for tests only; default resolves live (§ 11.2). */
  private readonly _db?: Database.Database;

  constructor(db?: Database.Database) {
    this._db = db;
  }

  private get db(): Database.Database {
    return this._db ?? getDatabase();
  }

  createCheckpoint(data: LotoCheckpointCreate): LotoCheckpoint {
    const stmt = this.db.prepare(`
      INSERT INTO loto_checkpoints (
        tenant_id, checkpoint_date, period_start, period_end,
        total_sales, total_commission, total_tickets, total_prizes,
        total_cash_prizes, total_cash_prizes_count, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      getCurrentTenantId(),
      data.checkpoint_date,
      data.period_start,
      data.period_end,
      data.total_sales ?? 0,
      data.total_commission ?? 0,
      data.total_tickets ?? 0,
      data.total_prizes ?? 0,
      data.total_cash_prizes ?? 0,
      data.total_cash_prizes_count ?? 0,
      data.note || null,
    );

    return this.getCheckpointById(result.lastInsertRowid as number)!;
  }

  getCheckpointById(id: number): LotoCheckpoint | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints WHERE id = ? AND tenant_id = ?
    `);
    return stmt.get(id, getCurrentTenantId()) as LotoCheckpoint | null;
  }

  getCheckpointByDate(date: string): LotoCheckpoint | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints WHERE date(checkpoint_date) = date(?) AND tenant_id = ?
      ORDER BY checkpoint_date DESC
      LIMIT 1
    `);
    return stmt.get(date, getCurrentTenantId()) as LotoCheckpoint | null;
  }

  getCheckpointsByDateRange(from: string, to: string): LotoCheckpoint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints
      WHERE date(checkpoint_date) BETWEEN date(?) AND date(?) AND tenant_id = ?
      ORDER BY checkpoint_date DESC
    `);
    return stmt.all(from, to, getCurrentTenantId()) as LotoCheckpoint[];
  }

  getUnsettledCheckpoints(): LotoCheckpoint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints
      WHERE is_settled = 0 AND tenant_id = ?
      ORDER BY checkpoint_date DESC
    `);
    return stmt.all(getCurrentTenantId()) as LotoCheckpoint[];
  }

  updateCheckpoint(
    id: number,
    data: LotoCheckpointUpdate,
  ): LotoCheckpoint | null {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.checkpoint_date !== undefined) {
      fields.push("checkpoint_date = ?");
      values.push(data.checkpoint_date);
    }
    if (data.period_start !== undefined) {
      fields.push("period_start = ?");
      values.push(data.period_start);
    }
    if (data.period_end !== undefined) {
      fields.push("period_end = ?");
      values.push(data.period_end);
    }
    if (data.total_sales !== undefined) {
      fields.push("total_sales = ?");
      values.push(data.total_sales);
    }
    if (data.total_commission !== undefined) {
      fields.push("total_commission = ?");
      values.push(data.total_commission);
    }
    if (data.total_tickets !== undefined) {
      fields.push("total_tickets = ?");
      values.push(data.total_tickets);
    }
    if (data.total_prizes !== undefined) {
      fields.push("total_prizes = ?");
      values.push(data.total_prizes);
    }
    if (data.is_settled !== undefined) {
      fields.push("is_settled = ?");
      values.push(data.is_settled);
    }
    if (data.settled_at !== undefined) {
      fields.push("settled_at = ?");
      values.push(data.settled_at);
    }
    if (data.settlement_id !== undefined) {
      fields.push("settlement_id = ?");
      values.push(data.settlement_id);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) {
      return this.getCheckpointById(id);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, getCurrentTenantId());

    const stmt = this.db.prepare(`
      UPDATE loto_checkpoints SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?
    `);

    stmt.run(...values);
    return this.getCheckpointById(id);
  }

  markCheckpointAsSettled(
    id: number,
    settledAt?: string,
    settlementId?: number,
  ): LotoCheckpoint | null {
    const stmt = this.db.prepare(`
      UPDATE loto_checkpoints
      SET is_settled = 1, settled_at = ?, settlement_id = ?
      WHERE id = ? AND tenant_id = ?
    `);

    const settledDate = settledAt || new Date().toISOString();
    stmt.run(settledDate, settlementId || null, id, getCurrentTenantId());
    return this.getCheckpointById(id);
  }

  /**
   * Settle a checkpoint with full accounting:
   * 1. Create SETTLEMENT entry in supplier_ledger
   * 2. Credit commission to General drawer
   * 3. Handle net payment (either we pay LOTO or they pay us)
   * 4. Mark linked cash prizes as reimbursed
   * 5. Mark checkpoint as settled
   */
  settleCheckpoint(
    id: number,
    totalSales: number,
    totalCommission: number,
    totalPrizes: number,
    _totalCashPrizes: number, // DEPRECATED — read from checkpoint instead
    settledAt: string | undefined,
    userId: number,
    payments?: SettlementLeg[],
    /** The rate the till converted cross-currency legs at (reconciliation
     *  compares at it when present — see `reconcileLegs`). */
    tenderExchangeRate?: number,
  ): LotoCheckpoint {
    const tenantId = getCurrentTenantId();
    const settleInTxn = this.db.transaction(() => {
      const settledDate = settledAt || new Date().toISOString();

      // Read cash prizes from the checkpoint itself (authoritative source)
      const checkpoint = this.getCheckpointById(id);
      if (!checkpoint) throw new Error(`Checkpoint ${id} not found`);
      // Same guard as settleCheckpoints: a double-settle would write a second
      // SETTLEMENT ledger row and flip the Loto balance past zero.
      if (checkpoint.is_settled)
        throw new Error(`Checkpoint ${id} is already settled`);
      const totalCashPrizes = checkpoint.total_cash_prizes;

      // Calculate settlement amounts
      const shopPaysSupplier = totalSales;
      const supplierPaysShop = totalCommission + totalCashPrizes;
      const netSettlement = supplierPaysShop - shopPaysSupplier;

      // G23: legs must be the net settlement (before any write).
      assertSettlementLegsReconcile(
        payments ?? [],
        netSettlement,
        getUsdLbpSellRate(this.db),
        tenderExchangeRate,
        `Loto settlement #${id}`,
      );

      // The LOTO supplier — same lookup/create as the ticket sale (G23: the
      // old `supplierId || 1` fallback posted to whatever supplier id 1 is).
      const supplierId = resolveLotoSupplierId(this.db, tenantId);

      // 1. Create unified transaction for settlement. LOTO_SETTLEMENT stays in
      // NON_REVERSIBLE_TRANSACTION_TYPES: the checkpoint's totals and its
      // is_settled/settlement_id stamps are frozen once settled, so there is
      // no safe generic reversal. Rate (owner decision 2026-10-07): the
      // rate the Settle dialog's payment input converted at, when sent —
      // the row records what the cashier actually used; otherwise omitted →
      // the market-rate snapshot (was a hard-coded 100,000).
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.LOTO_SETTLEMENT,
        source_table: "loto_checkpoints",
        source_id: id,
        user_id: userId,
        amount_usd: 0,
        amount_lbp: netSettlement,
        ...cashierRateStamp(tenderExchangeRate),
        summary: `Loto settlement for checkpoint #${id}`,
        metadata_json: {
          total_sales: totalSales,
          total_commission: totalCommission,
          total_prizes: totalPrizes,
          total_cash_prizes: totalCashPrizes,
          shop_pays_supplier: shopPaysSupplier,
          supplier_pays_shop: supplierPaysShop,
          net_settlement: netSettlement,
        },
      });

      // 2. Create loto_settlements record
      const insertSettlement = this.db.prepare(`
        INSERT INTO loto_settlements (
          tenant_id, settlement_date, checkpoint_ids, total_sales, total_commission,
          total_cash_prizes, net_settlement, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const settlementNote = `Settled: sales=${totalSales}, commission=${totalCommission}, prizes=${totalCashPrizes}`;
      const checkpointIdsJson = JSON.stringify([id]);

      const settlementResult = insertSettlement.run(
        tenantId,
        settledDate,
        checkpointIdsJson,
        totalSales,
        totalCommission,
        totalCashPrizes,
        netSettlement,
        settlementNote,
      );

      const settlementId = settlementResult.lastInsertRowid as number;

      // 3. Create SETTLEMENT entry in supplier_ledger
      // Sign is intentionally standard-oriented (netSettlement as-is): after the
      // ticket/prize sign flip (migration v119) the pre-settlement Loto balance
      // is -netSettlement, so this row zeroes it. Do NOT negate.
      const insertLedger = this.db.prepare(`
        INSERT INTO supplier_ledger (
          tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // G23: linked to its own LOTO_SETTLEMENT transaction (was NULL).
      insertLedger.run(
        tenantId,
        supplierId,
        "SETTLEMENT",
        0,
        netSettlement,
        `Settlement for checkpoint #${id}: ${settlementNote}`,
        userId,
        txnId,
      );

      // 4. NO separate commission drawer credit. The settlement payment leg is
      // the NET amount (commission − sales, negative when the shop pays), i.e.
      // the commission is already kept back from the cash handed over — the
      // ticket sales deposited it into General at sale time. Crediting it
      // again here minted the commission a second time (full cycle drawer
      // delta was 2× commission vs the 1× stamped profit); see
      // LotoCheckpointRepository.settleDrawer.test.ts.

      // 5. Record payment legs and update drawer balances (validated and
      // reconciled above — every leg here is a drawer leg in the net's
      // direction).
      if (payments && payments.length > 0) {
        for (const p of payments) {
          if (p.amount === 0) continue;
          const drawerName = paymentMethodToDrawerName(p.method);
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: p.method,
            drawerName,
            currencyCode: p.currency_code,
            amount: p.amount,
            note: `Loto settlement #${id}`,
            createdBy: userId,
            tenantId,
          });
          applyDrawerDelta(this.db, {
            drawerName,
            currencyCode: p.currency_code,
            delta: p.amount,
            tenantId,
          });
        }
      }

      // 6. Mark linked cash prizes as reimbursed
      const markReimbursed = this.db.prepare(`
        UPDATE loto_cash_prizes
        SET is_reimbursed = 1, reimbursed_date = ?, reimbursed_in_settlement_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE checkpoint_id = ? AND is_reimbursed = 0 AND tenant_id = ?
      `);
      markReimbursed.run(settledDate, settlementId, id, tenantId);

      // 7. Mark checkpoint as settled
      const updateCheckpoint = this.db.prepare(`
        UPDATE loto_checkpoints
        SET is_settled = 1, settled_at = ?, settlement_id = ?
        WHERE id = ? AND tenant_id = ?
      `);
      updateCheckpoint.run(settledDate, settlementId, id, tenantId);

      return this.getCheckpointById(id)!;
    });

    return settleInTxn();
  }

  /**
   * Settle multiple checkpoints in one atomic operation.
   * Creates a single loto_settlements record, one drawer transaction, and marks
   * all checkpoints and their cash prizes as settled/reimbursed.
   */
  settleCheckpoints(
    checkpointIds: number[],
    totalSales: number,
    totalCommission: number,
    settledAt: string | undefined,
    userId: number,
    /** One leg (legacy) or split legs (LIRA-258: the Settle dialog's
     *  MultiPaymentInput). Positive = supplier pays us (IN), negative = we
     *  pay the supplier (OUT). A leg's `drawer_name`, when sent, is ignored
     *  for posting (G23): the drawer is the one `method` maps to. */
    payment?:
      | {
          method: string;
          drawer_name: string;
          currency_code: string;
          amount: number;
        }
      | SettlementLeg[],
    /** See settleCheckpoint's `tenderExchangeRate`. */
    tenderExchangeRate?: number,
  ): LotoCheckpoint[] {
    if (checkpointIds.length === 0)
      throw new Error("No checkpoint IDs provided");

    const legs: SettlementLeg[] = Array.isArray(payment)
      ? payment
      : payment
        ? [payment]
        : [];

    const tenantId = getCurrentTenantId();
    const settleInTxn = this.db.transaction(() => {
      const settledDate = settledAt || new Date().toISOString();

      const totalCashPrizes = checkpointIds.reduce((sum, id) => {
        const cp = this.getCheckpointById(id);
        if (!cp) throw new Error(`Checkpoint ${id} not found`);
        if (cp.is_settled)
          throw new Error(`Checkpoint ${id} is already settled`);
        return sum + cp.total_cash_prizes;
      }, 0);

      const netSettlement = totalCommission + totalCashPrizes - totalSales;

      // G23: the payment must be the net settlement (before any write).
      assertSettlementLegsReconcile(
        legs,
        netSettlement,
        getUsdLbpSellRate(this.db),
        tenderExchangeRate,
        "Loto batch settlement",
      );

      // Same LOTO supplier lookup/create as the ticket sale (no `|| 1`).
      const supplierId = resolveLotoSupplierId(this.db, tenantId);

      // 1. Create unified transaction (non-reversible; stamps the cashier's
      // rate when sent, else the market-rate snapshot: see settleCheckpoint).
      const txnRepo = getTransactionRepository();
      const txnId = txnRepo.createTransaction({
        type: TRANSACTION_TYPES.LOTO_SETTLEMENT,
        source_table: "loto_checkpoints",
        source_id: checkpointIds[checkpointIds.length - 1],
        user_id: userId,
        amount_usd: 0,
        amount_lbp: netSettlement,
        ...cashierRateStamp(tenderExchangeRate),
        summary: `Loto batch settlement for ${checkpointIds.length} checkpoint(s)`,
        metadata_json: {
          checkpoint_ids: checkpointIds,
          total_sales: totalSales,
          total_commission: totalCommission,
          total_cash_prizes: totalCashPrizes,
          net_settlement: netSettlement,
        },
      });

      // 2. Single loto_settlements record for all checkpoints
      const settlementResult = this.db
        .prepare(
          `
        INSERT INTO loto_settlements (
          tenant_id, settlement_date, checkpoint_ids, total_sales, total_commission,
          total_cash_prizes, net_settlement, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          tenantId,
          settledDate,
          JSON.stringify(checkpointIds),
          totalSales,
          totalCommission,
          totalCashPrizes,
          netSettlement,
          `Batch settlement for checkpoints [${checkpointIds.join(", ")}]: sales=${totalSales}, commission=${totalCommission}`,
        );
      const settlementId = settlementResult.lastInsertRowid as number;

      // 3. Supplier ledger entry
      // Sign intentionally standard-oriented (see settleCheckpoint): the
      // flipped ticket/prize rows sum to -netSettlement, so this zeroes them.
      this.db
        .prepare(
          `
        INSERT INTO supplier_ledger (
          tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, note, created_by, transaction_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          tenantId,
          supplierId,
          "SETTLEMENT",
          0,
          netSettlement,
          `Batch settlement for checkpoints [${checkpointIds.join(", ")}]`,
          userId,
          txnId,
        );

      // 4. NO separate commission drawer credit — same reasoning as
      // settleCheckpoint: the payment leg below is already the net
      // (commission kept back), so a standalone credit double-counts the
      // commission. See LotoCheckpointRepository.settleDrawer.test.ts.

      // 5. Record each payment leg and update its drawer (validated and
      // reconciled above — every leg is a drawer leg in the net's direction).
      for (const leg of legs) {
        if (leg.amount === 0) continue;
        const drawerName = paymentMethodToDrawerName(leg.method);
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: leg.method,
          drawerName,
          currencyCode: leg.currency_code,
          amount: leg.amount,
          note: `Loto batch settlement`,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName,
          currencyCode: leg.currency_code,
          delta: leg.amount,
          tenantId,
        });
      }

      // 6 & 7. Mark each checkpoint's cash prizes as reimbursed and checkpoint as settled
      const markReimbursed = this.db.prepare(`
        UPDATE loto_cash_prizes
        SET is_reimbursed = 1, reimbursed_date = ?, reimbursed_in_settlement_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE checkpoint_id = ? AND is_reimbursed = 0 AND tenant_id = ?
      `);
      const markSettled = this.db.prepare(`
        UPDATE loto_checkpoints
        SET is_settled = 1, settled_at = ?, settlement_id = ?
        WHERE id = ? AND tenant_id = ?
      `);

      const results: LotoCheckpoint[] = [];
      for (const cpId of checkpointIds) {
        markReimbursed.run(settledDate, settlementId, cpId, tenantId);
        markSettled.run(settledDate, settlementId, cpId, tenantId);
        results.push(this.getCheckpointById(cpId)!);
      }

      return results;
    });

    return settleInTxn();
  }

  getTotalSalesFromUnsettledCheckpoints(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(total_sales), 0) as total FROM loto_checkpoints
      WHERE is_settled = 0 AND tenant_id = ?
    `);
    const result = stmt.get(getCurrentTenantId()) as { total: number };
    return result.total;
  }

  getTotalCommissionFromUnsettledCheckpoints(): number {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(total_commission), 0) as total FROM loto_checkpoints
      WHERE is_settled = 0 AND tenant_id = ?
    `);
    const result = stmt.get(getCurrentTenantId()) as { total: number };
    return result.total;
  }

  getLastCheckpoint(): LotoCheckpoint | null {
    const stmt = this.db.prepare(`
      SELECT * FROM loto_checkpoints
      WHERE tenant_id = ?
      ORDER BY checkpoint_date DESC
      LIMIT 1
    `);
    return stmt.get(getCurrentTenantId()) as LotoCheckpoint | null;
  }

  /**
   * Delete an unsettled checkpoint. Settled checkpoints cannot be deleted.
   * Returns true if deleted, false if not found or already settled.
   */
  deleteCheckpoint(id: number): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM loto_checkpoints WHERE id = ? AND is_settled = 0 AND tenant_id = ?
    `);
    const result = stmt.run(id, getCurrentTenantId());
    return result.changes > 0;
  }

  getSettlementHistory(limit?: number): LotoSettlement[] {
    const limitClause = limit ? `LIMIT ${limit}` : "";
    const stmt = this.db.prepare(`
      SELECT * FROM loto_settlements
      WHERE tenant_id = ?
      ORDER BY settlement_date DESC, id DESC
      ${limitClause}
    `);
    return stmt.all(getCurrentTenantId()) as LotoSettlement[];
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let instance: LotoCheckpointRepository | null = null;

export function getLotoCheckpointRepository(): LotoCheckpointRepository {
  if (!instance) {
    instance = new LotoCheckpointRepository();
  }
  return instance;
}

/** Reset the singleton (for testing) */
export function resetLotoCheckpointRepository(): void {
  instance = null;
}

export default LotoCheckpointRepository;
