import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  PRIMARY_CASH_DRAWER_NAMES,
  type PrimaryCashDrawerName,
} from "../constants/systemFloatDrawers.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";

export interface DrawerTopUpEntity {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  notes: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDrawerTopUpData {
  amount_usd: number;
  amount_lbp: number;
  notes?: string;
  transaction_time?: string;
  /** External (Cash In) only — top-ups in currencies other than USD/LBP that
   *  are already enabled for the General drawer (Settings → Currencies).
   *  Deliberately NOT on CreateDrawerTopUpFromDrawerData — see the CQ-3
   *  survey note on `deductBalance` below: a from-drawer transfer's debit
   *  silently no-ops on a missing source-drawer currency row, which would
   *  fabricate money for a brand-new currency. External mode has no debit
   *  side, so it's the only safe path for this. */
  extra_currencies?: Array<{ currency_code: string; amount: number }>;
}

export interface CreateDrawerTopUpFromDrawerData {
  amount_usd: number;
  amount_lbp: number;
  source_drawer: string;
  notes?: string;
  transaction_time?: string;
}

export interface SourceDrawerBalance {
  drawer_name: string;
  balance_usd: number;
  balance_lbp: number;
}

/** `PRIMARY_CASH_DRAWER_NAMES`/`PrimaryCashDrawerName` (renamed from
 *  `SYSTEM_FLOAT_DRAWER_NAMES`/`SystemFloatDrawerName` — Primary Cash Drawer
 *  plan §8.1) are the single shared definition in
 *  `constants/systemFloatDrawers.ts` (CLAUDE.md rule 14) — re-exported here
 *  (not re-declared) so existing importers of this module
 *  (`DrawerTopUpService`, `repositories/index.ts`) keep working, and so
 *  `getSourceDrawerBalances` below can report on both PCD names without a
 *  second hand-copied literal that could drift. */
export { PRIMARY_CASH_DRAWER_NAMES, type PrimaryCashDrawerName };

/**
 * @deprecated Kept ONLY so `packages/core/src/repositories/index.ts`'s
 * existing barrel export of this type (owned by a parallel agent, not this
 * file) doesn't fail to resolve — nothing in this file constructs one
 * anymore. The float-funding flow it described (`fundSystemDrawer`) is
 * replaced by the generic `transferBetweenDrawers` below (Primary Cash
 * Drawer plan §8.6); remove this stub once the barrel is updated to stop
 * exporting it.
 */
export interface CreateSystemFloatTopupData {
  targetDrawer: PrimaryCashDrawerName;
  fundingDrawer: string;
  amount_usd: number;
  amount_lbp: number;
  notes?: string;
  transaction_time?: string;
}

export const GENERAL_DRAWER = "General";
const TOPUP_METHOD = "CASH";
/** Distinguishes these legs from real payment methods (CASH/OMT/WHISH/...) —
 *  this is an internal treasury transfer between two of the shop's own
 *  drawers, not a customer tender (mirrors WALLET_EXCHANGE_METHOD in
 *  WalletExchangeRepository). Renamed from `SYSTEM_FLOAT_TOPUP` alongside
 *  `TRANSACTION_TYPES.DRAWER_TRANSFER` (Primary Cash Drawer plan §8.6). */
const DRAWER_TRANSFER_METHOD = "DRAWER_TRANSFER";

/** Input for {@link DrawerTopUpRepository.transferBetweenDrawers} (Primary
 *  Cash Drawer plan §8.6, exact shape) — a generic bidirectional cash move
 *  between any two of the shop's own drawers. `fromDrawer`/`toDrawer` are
 *  free text (like `drawer_topups.source_drawer`); the UI only ever offers
 *  General <-> the primary cash drawer, but the repository itself does not
 *  special-case drawer names (decision #13's "generic drawer<->General cash
 *  transfer" framing) — the insufficient-funds guard is the real gate. */
export interface TransferBetweenDrawersData {
  fromDrawer: string;
  toDrawer: string;
  amountUsd: number;
  amountLbp: number;
  notes?: string;
  createdBy: number;
  transactionTime?: string;
}

export class DrawerTopUpRepository extends BaseRepository<DrawerTopUpEntity> {
  constructor() {
    super("drawer_topups");
  }

  protected getColumns(): string {
    return "id, amount_usd, amount_lbp, notes, created_by, created_at, updated_at";
  }

  /**
   * Create a drawer top-up in a single transaction.
   * Inserts a drawer_topups record, creates a unified transaction row,
   * updates drawer_balances for the General drawer, and inserts payment rows.
   */
  createTopUp(
    data: CreateDrawerTopUpData,
    userId: number,
    transactionTime?: string,
  ): number {
    const txTime = transactionTime ?? data.transaction_time;
    const tenantId = getCurrentTenantId();
    return this.db.transaction(() => {
      // 1. Insert into drawer_topups
      const insertTopUp = this.db.prepare(`
        INSERT INTO drawer_topups (tenant_id, amount_usd, amount_lbp, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `);
      const result = insertTopUp.run(
        tenantId,
        data.amount_usd,
        data.amount_lbp,
        data.notes ?? null,
        userId,
        txTime ?? null,
      );
      const topUpId = Number(result.lastInsertRowid);

      // 2. Create unified transaction row
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.DRAWER_TOPUP,
        source_table: "drawer_topups",
        source_id: topUpId,
        user_id: userId,
        amount_usd: data.amount_usd,
        amount_lbp: data.amount_lbp,
        summary: `Drawer Top-Up: General${data.notes ? ` - ${data.notes}` : ""}`,
        metadata_json: {
          drawer: GENERAL_DRAWER,
          notes: data.notes ?? null,
          extra_currencies: data.extra_currencies ?? null,
        },
        transaction_time: txTime,
      });

      const note = `Drawer Top-Up${data.notes ? `: ${data.notes}` : ""}`;

      // 3. USD inflow
      if (data.amount_usd && data.amount_usd > 0) {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: TOPUP_METHOD,
          drawerName: GENERAL_DRAWER,
          currencyCode: "USD",
          amount: data.amount_usd,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: GENERAL_DRAWER,
          currencyCode: "USD",
          delta: data.amount_usd,
          tenantId,
        });
      }

      // 4. LBP inflow
      if (data.amount_lbp && data.amount_lbp > 0) {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: TOPUP_METHOD,
          drawerName: GENERAL_DRAWER,
          currencyCode: "LBP",
          amount: data.amount_lbp,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: GENERAL_DRAWER,
          currencyCode: "LBP",
          delta: data.amount_lbp,
          tenantId,
        });
      }

      // 5. Extra-currency inflows (External mode only — see
      // CreateDrawerTopUpData.extra_currencies doc). Same posting pattern as
      // the USD/LBP legs above; the breakdown was already stamped into
      // metadata_json at step 2, mirroring ExchangeRepository's use of
      // metadata_json for non-USD/LBP detail. amount_usd/amount_lbp on the
      // transaction row stay USD/LBP-only.
      for (const entry of data.extra_currencies ?? []) {
        if (!entry.amount || entry.amount <= 0) continue;
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: TOPUP_METHOD,
          drawerName: GENERAL_DRAWER,
          currencyCode: entry.currency_code,
          amount: entry.amount,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: GENERAL_DRAWER,
          currencyCode: entry.currency_code,
          delta: entry.amount,
          tenantId,
        });
      }

      return topUpId;
    })();
  }

  /**
   * Transfer funds from a source drawer to the General drawer.
   * Deducts from source, credits General, records the transfer.
   *
   * NOT the General <-> primary-cash-drawer transfer path (Primary Cash
   * Drawer plan §8.6): this method's source-drawer debit is a raw `UPDATE`
   * (see `deductBalance` below) with no `payments` row on that side, so it
   * is permanently non-reversible (`TRANSACTION_TYPES.DRAWER_TOPUP` is in
   * `NON_REVERSIBLE_TRANSACTION_TYPES` for exactly this reason). The
   * General/OMT_System/Whish_System pair now goes through
   * `transferBetweenDrawers` (below) instead, which posts BOTH legs via
   * `insertPaymentRow`/`applyDrawerDelta` and stays reversible via the
   * generic void/refund path. This method is kept for its original,
   * different use case (an arbitrary named source drawer draining into
   * General as an append-only, audit-trail-only move) — do not delete it.
   */
  createTopUpFromDrawer(
    data: CreateDrawerTopUpFromDrawerData,
    userId: number,
    transactionTime?: string,
  ): number {
    const txTime = transactionTime ?? data.transaction_time;
    const tenantId = getCurrentTenantId();
    return this.db.transaction(() => {
      // 1. Insert into drawer_topups with source_drawer
      const insertTopUp = this.db.prepare(`
        INSERT INTO drawer_topups (tenant_id, amount_usd, amount_lbp, notes, source_drawer, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `);
      const result = insertTopUp.run(
        tenantId,
        data.amount_usd,
        data.amount_lbp,
        data.notes ?? null,
        data.source_drawer,
        userId,
        txTime ?? null,
      );
      const topUpId = Number(result.lastInsertRowid);

      // 2. Create unified transaction row
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.DRAWER_TOPUP,
        source_table: "drawer_topups",
        source_id: topUpId,
        user_id: userId,
        amount_usd: data.amount_usd,
        amount_lbp: data.amount_lbp,
        summary: `Drawer Top-Up: ${data.source_drawer} → General${data.notes ? ` - ${data.notes}` : ""}`,
        metadata_json: {
          drawer: GENERAL_DRAWER,
          source_drawer: data.source_drawer,
          notes: data.notes ?? null,
        },
        transaction_time: txTime,
      });

      // CQ-3 survey note: `deductBalance` is intentionally NOT
      // `applyDrawerDelta` — a plain UPDATE that must NOT create a row for a
      // missing source drawer (this transfer debits an existing named
      // drawer, e.g. OMT_System; a typo'd/missing source must no-op, not
      // silently create a phantom negative-balance drawer).
      const deductBalance = this.db.prepare(`
        UPDATE drawer_balances
        SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
        WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?
      `);

      const note = `Drawer Transfer: ${data.source_drawer} → General${data.notes ? `: ${data.notes}` : ""}`;

      // 3. USD transfer
      if (data.amount_usd && data.amount_usd > 0) {
        deductBalance.run(data.amount_usd, data.source_drawer, "USD", tenantId);
        applyDrawerDelta(this.db, {
          drawerName: GENERAL_DRAWER,
          currencyCode: "USD",
          delta: data.amount_usd,
          tenantId,
        });
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: TOPUP_METHOD,
          drawerName: GENERAL_DRAWER,
          currencyCode: "USD",
          amount: data.amount_usd,
          note,
          createdBy: userId,
          tenantId,
        });
      }

      // 4. LBP transfer
      if (data.amount_lbp && data.amount_lbp > 0) {
        deductBalance.run(data.amount_lbp, data.source_drawer, "LBP", tenantId);
        applyDrawerDelta(this.db, {
          drawerName: GENERAL_DRAWER,
          currencyCode: "LBP",
          delta: data.amount_lbp,
          tenantId,
        });
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: TOPUP_METHOD,
          drawerName: GENERAL_DRAWER,
          currencyCode: "LBP",
          amount: data.amount_lbp,
          note,
          createdBy: userId,
          tenantId,
        });
      }

      return topUpId;
    })();
  }

  /**
   * Generic, reversible cash transfer between any two of the shop's own
   * drawers (Primary Cash Drawer plan §8.6 — signature is contract-exact:
   * one params object, `createdBy` inside it). Generalizes the old
   * `fundSystemDrawer` (owner-confirmed 2026-07-29 float model, General ->
   * OMT_System/Whish_System only) into a symmetric General <-> PCD move —
   * the UI's only exposed pair, though this method itself does not
   * special-case drawer names (decision #13's "generic drawer<->General
   * cash transfer" framing). Both the `fromDrawer` debit AND the `toDrawer`
   * credit go through `insertPaymentRow` + `applyDrawerDelta` (never the
   * raw-UPDATE pattern `createTopUpFromDrawer` uses), so this stays
   * reversible via the generic void path (rule 20) — same shape
   * `fundSystemDrawer` already had, just no longer restricted to one
   * direction or to the two PCD names on the `toDrawer` side.
   *
   * Every transfer here names a real `fromDrawer` that gets debited — unlike
   * `drawer_topups`' External Cash-In mode, there is no no-source variant,
   * because Σ drawer deltas must be 0 (this moves cash the shop already
   * owns, it never invents it). The insufficient-funds guard
   * (no balance guard — owner decision 2026-08-01, overdraw is allowed) runs
   * FIRST, per currency, inside the same `db.transaction`, before any row is
   * written (mirrors WalletExchangeRepository.createTransaction).
   */
  transferBetweenDrawers(data: TransferBetweenDrawersData): number {
    // Self-transfer guard: fromDrawer === toDrawer would still write a real
    // transactions + drawer_transfers row and two cancelling payment legs
    // even though net balance never moves — a transfer that never happened,
    // poisoning the audit trail. Enforced HERE (repository) in addition to
    // the Zod `.refine()` in validators/drawerTransfer.ts, so a caller
    // bypassing validation still cannot write this no-op row.
    if (data.fromDrawer === data.toDrawer) {
      throw new Error(
        `fromDrawer and toDrawer cannot be the same drawer ("${data.toDrawer}") — this moves no money and would only pollute the audit trail with a self-transfer`,
      );
    }

    // Amount guard: the repository must NOT trust the caller on what goes
    // into the ledger row. Validate positive-and-finite BEFORE the INSERT
    // and reject rather than silently clamp; also reject an all-zero
    // transfer (both amounts 0) as another no-op row — mirrors the
    // service-layer check but must not be the ONLY place it's enforced.
    for (const [amount, label] of [
      [data.amountUsd, "amountUsd"],
      [data.amountLbp, "amountLbp"],
    ] as const) {
      if (!Number.isFinite(amount)) {
        throw new Error(
          `${label} must be a finite number (got ${amount}) — refusing to write a transfer row with a non-finite amount`,
        );
      }
      if (amount < 0) {
        throw new Error(`${label} must not be negative (got ${amount})`);
      }
    }
    if (!(data.amountUsd > 0) && !(data.amountLbp > 0)) {
      throw new Error(
        "At least one of amountUsd or amountLbp must be greater than zero — refusing to write an all-zero no-op transfer row",
      );
    }

    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const getBalance = (drawerName: string, currencyCode: string): number => {
        const row = this.db
          .prepare(
            `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
          )
          .get(drawerName, currencyCode, tenantId) as
          | { balance: number }
          | undefined;
        return row?.balance ?? 0;
      };

      // Insufficient-funds guard (plan §8.5's structured contract, reused
      // here per task H so IPC/REST/frontend share ONE error-handling path
      // with the RECEIVE-payout guard): per-currency, checked BEFORE any row
      // is written.
      // OWNER DECISION 2026-08-01: a transfer may overdraw its source drawer.
      // Every drawer in this system can already go negative, and the owner
      // chose one consistent rule over a guard that only covered this path:
      // nothing is ever blocked, negatives are SURFACED in the transfer UI
      // (which flags a drawer in the red and pre-fills the amount that clears
      // it). The former per-currency InsufficientDrawerFundsError check that
      // stood here is deliberately gone.

      // 1. Insert into drawer_transfers
      const insertTransfer = this.db.prepare(`
        INSERT INTO drawer_transfers (tenant_id, from_drawer, to_drawer, amount_usd, amount_lbp, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `);
      const result = insertTransfer.run(
        tenantId,
        data.fromDrawer,
        data.toDrawer,
        data.amountUsd,
        data.amountLbp,
        data.notes ?? null,
        data.createdBy,
        data.transactionTime ?? null,
      );
      const transferId = Number(result.lastInsertRowid);

      // 2. Create unified transaction row — profit is always 0 (this moves
      // the shop's own cash between two of its own containers; it doesn't
      // sell anything to anyone).
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.DRAWER_TRANSFER,
        source_table: "drawer_transfers",
        source_id: transferId,
        user_id: data.createdBy,
        amount_usd: data.amountUsd,
        amount_lbp: data.amountLbp,
        profit_usd: 0,
        profit_lbp: 0,
        summary: `Drawer Transfer: ${data.fromDrawer} → ${data.toDrawer}${data.notes ? ` - ${data.notes}` : ""}`,
        metadata_json: {
          from_drawer: data.fromDrawer,
          to_drawer: data.toDrawer,
          notes: data.notes ?? null,
        },
        transaction_time: data.transactionTime,
      });

      const note = `Drawer Transfer: ${data.fromDrawer} → ${data.toDrawer}${data.notes ? `: ${data.notes}` : ""}`;

      // 3. USD leg: fromDrawer −, toDrawer +
      if (data.amountUsd > 0) {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: DRAWER_TRANSFER_METHOD,
          drawerName: data.fromDrawer,
          currencyCode: "USD",
          amount: -data.amountUsd,
          note,
          createdBy: data.createdBy,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: data.fromDrawer,
          currencyCode: "USD",
          delta: -data.amountUsd,
          tenantId,
        });

        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: DRAWER_TRANSFER_METHOD,
          drawerName: data.toDrawer,
          currencyCode: "USD",
          amount: data.amountUsd,
          note,
          createdBy: data.createdBy,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: data.toDrawer,
          currencyCode: "USD",
          delta: data.amountUsd,
          tenantId,
        });
      }

      // 4. LBP leg: fromDrawer −, toDrawer +
      if (data.amountLbp > 0) {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: DRAWER_TRANSFER_METHOD,
          drawerName: data.fromDrawer,
          currencyCode: "LBP",
          amount: -data.amountLbp,
          note,
          createdBy: data.createdBy,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: data.fromDrawer,
          currencyCode: "LBP",
          delta: -data.amountLbp,
          tenantId,
        });

        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: DRAWER_TRANSFER_METHOD,
          drawerName: data.toDrawer,
          currencyCode: "LBP",
          amount: data.amountLbp,
          note,
          createdBy: data.createdBy,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: data.toDrawer,
          currencyCode: "LBP",
          delta: data.amountLbp,
          tenantId,
        });
      }

      return transferId;
    })();
  }

  /**
   * Get primary-cash-drawer (OMT_System / Whish_System) balances for
   * transfer source selection. Un-hardcoded from a single `'OMT_System'`
   * literal (Primary Cash Drawer plan §8.6/Phase E) to both
   * `PRIMARY_CASH_DRAWER_NAMES` — Whish_System is now just as much a
   * countable cash drawer as OMT_System, and the caller must be able to
   * offer either as a transfer source/destination regardless of which
   * system is primary.
   */
  getSourceDrawerBalances(): SourceDrawerBalance[] {
    const placeholders = PRIMARY_CASH_DRAWER_NAMES.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `
      SELECT drawer_name,
        COALESCE(SUM(CASE WHEN currency_code = 'USD' THEN balance ELSE 0 END), 0) as balance_usd,
        COALESCE(SUM(CASE WHEN currency_code = 'LBP' THEN balance ELSE 0 END), 0) as balance_lbp
      FROM drawer_balances
      WHERE drawer_name IN (${placeholders}) AND tenant_id = ?
      GROUP BY drawer_name
    `,
      )
      .all(...PRIMARY_CASH_DRAWER_NAMES, getCurrentTenantId()) as SourceDrawerBalance[];
    return rows;
  }

  /**
   * Get recent top-up history ordered by most recent first.
   */
  getHistory(limit: number = 50): DrawerTopUpEntity[] {
    return this.db
      .prepare(
        `SELECT id, amount_usd, amount_lbp, notes, created_by, created_at, updated_at
         FROM drawer_topups
         WHERE tenant_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(getCurrentTenantId(), limit) as DrawerTopUpEntity[];
  }
}

// Singleton instance
let drawerTopUpRepositoryInstance: DrawerTopUpRepository | null = null;

export function getDrawerTopUpRepository(): DrawerTopUpRepository {
  if (!drawerTopUpRepositoryInstance) {
    drawerTopUpRepositoryInstance = new DrawerTopUpRepository();
  }
  return drawerTopUpRepositoryInstance;
}

export function resetDrawerTopUpRepository(): void {
  drawerTopUpRepositoryInstance = null;
}
