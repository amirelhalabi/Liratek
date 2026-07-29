import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  SYSTEM_FLOAT_DRAWER_NAMES,
  type SystemFloatDrawerName,
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

/** The only two spendable-float drawers this flow may credit (owner-confirmed
 *  2026-07-29 float model) — never General, never an arbitrary drawer name.
 *  Enforced again here at the repository layer (not just the Zod schema) so
 *  a caller bypassing validation still cannot invent money in an arbitrary
 *  drawer.
 *
 *  `SYSTEM_FLOAT_DRAWER_NAMES`/`SystemFloatDrawerName` are the single shared
 *  definition in `constants/systemFloatDrawers.ts` (CLAUDE.md rule 14) —
 *  re-exported here (not re-declared) so existing importers of this module
 *  (`DrawerTopUpService`, `repositories/index.ts`) keep working, and so
 *  `validators/systemFloatTopup.ts` can derive its `z.enum([...])` from the
 *  SAME list instead of a second hand-copied literal that could drift. */
export { SYSTEM_FLOAT_DRAWER_NAMES, type SystemFloatDrawerName };

const SYSTEM_FLOAT_DRAWERS: ReadonlySet<string> = new Set<SystemFloatDrawerName>(
  SYSTEM_FLOAT_DRAWER_NAMES,
);

export interface CreateSystemFloatTopupData {
  targetDrawer: SystemFloatDrawerName;
  /** Any drawer holding a spendable balance (default "General", but e.g.
   *  "Binance" is valid too) — free text like drawer_topups.source_drawer,
   *  validated at the service layer, no CHECK constraint (drawers are
   *  dynamic). */
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
 *  WalletExchangeRepository). */
const SYSTEM_FLOAT_TOPUP_METHOD = "SYSTEM_FLOAT_TOPUP";

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
   * Fund the OMT_System / Whish_System spendable float (owner-confirmed
   * 2026-07-29 float model) — the mirror image of `createTopUpFromDrawer`
   * (General ⇄ System instead of System ⇄ General), but deliberately does
   * NOT copy that method's asymmetric-legs pattern: both the funding-drawer
   * debit AND the target-drawer credit go through `insertPaymentRow` +
   * `applyDrawerDelta`, so this stays reversible via the generic void path
   * (see TRANSACTION_TYPES.SYSTEM_FLOAT_TOPUP doc — DRAWER_TOPUP's
   * from-drawer mode used a raw, non-payments-tracked debit and is
   * permanently non-reversible for exactly that reason).
   *
   * Every top-up here names a real funding drawer that gets debited — unlike
   * drawer_topups' External Cash-In mode, there is no no-source variant,
   * because Σ drawer deltas must be 0 (this moves cash the shop already
   * owns, it never invents it). The insufficient-funds guard runs FIRST,
   * per currency, inside the same db.transaction, before any row is written
   * (mirrors WalletExchangeRepository.createTransaction).
   */
  fundSystemDrawer(data: CreateSystemFloatTopupData, userId: number): number {
    if (!SYSTEM_FLOAT_DRAWERS.has(data.targetDrawer)) {
      throw new Error(
        `Invalid target drawer "${data.targetDrawer}" — must be one of: ${Array.from(SYSTEM_FLOAT_DRAWERS).join(", ")}`,
      );
    }

    // Self-funding guard (finding A): fundingDrawer === targetDrawer would
    // still write a real transactions + system_float_topups row and two
    // cancelling payment legs even though net balance never moves — a
    // transfer that never happened, poisoning the audit trail. Enforced HERE
    // (repository) in addition to the Zod `.refine()` in
    // validators/systemFloatTopup.ts, so a caller bypassing validation still
    // cannot write this no-op row.
    if (data.fundingDrawer === data.targetDrawer) {
      throw new Error(
        `fundingDrawer and targetDrawer cannot be the same drawer ("${data.targetDrawer}") — this moves no money and would only pollute the audit trail with a self-transfer`,
      );
    }

    // Amount guard (finding B): the repository must NOT trust the caller on
    // what goes into the ledger row. Before this fix only the LEG-posting
    // `if (data.amount_usd && data.amount_usd > 0)` blocks below gated
    // whether a payment leg / drawer delta was applied — a direct call
    // bypassing Zod (a future handler forgetting validatePayload, a
    // migration script, a test seed) with e.g. `amount_usd: -Infinity` moved
    // no money but still wrote `-Infinity` verbatim into
    // `system_float_topups.amount_usd` / `transactions.amount_usd`,
    // poisoning any future SUM() into -Infinity/NaN. Validate
    // positive-and-finite BEFORE the INSERT and reject rather than silently
    // clamp; also reject an all-zero top-up (both amounts 0) as another
    // no-op row — mirrors the service-layer check but must not be the ONLY
    // place it's enforced.
    for (const [amount, label] of [
      [data.amount_usd, "amount_usd"],
      [data.amount_lbp, "amount_lbp"],
    ] as const) {
      if (!Number.isFinite(amount)) {
        throw new Error(
          `${label} must be a finite number (got ${amount}) — refusing to write a top-up row with a non-finite amount`,
        );
      }
      if (amount < 0) {
        throw new Error(
          `${label} must not be negative (got ${amount})`,
        );
      }
    }
    if (!(data.amount_usd > 0) && !(data.amount_lbp > 0)) {
      throw new Error(
        "At least one of amount_usd or amount_lbp must be greater than zero — refusing to write an all-zero no-op top-up row",
      );
    }

    const txTime = data.transaction_time;
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

      const fmt = (n: number, currency: "USD" | "LBP") =>
        currency === "LBP"
          ? `${Math.round(n).toLocaleString()} LBP`
          : `$${n.toFixed(2)}`;

      if (data.amount_usd && data.amount_usd > 0) {
        const available = getBalance(data.fundingDrawer, "USD");
        if (data.amount_usd > available) {
          throw new Error(
            `Insufficient USD balance in ${data.fundingDrawer}: requested ${fmt(data.amount_usd, "USD")}, available ${fmt(available, "USD")}`,
          );
        }
      }
      if (data.amount_lbp && data.amount_lbp > 0) {
        const available = getBalance(data.fundingDrawer, "LBP");
        if (data.amount_lbp > available) {
          throw new Error(
            `Insufficient LBP balance in ${data.fundingDrawer}: requested ${fmt(data.amount_lbp, "LBP")}, available ${fmt(available, "LBP")}`,
          );
        }
      }

      // 1. Insert into system_float_topups
      const insertTopUp = this.db.prepare(`
        INSERT INTO system_float_topups (tenant_id, target_drawer, funding_drawer, amount_usd, amount_lbp, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `);
      const result = insertTopUp.run(
        tenantId,
        data.targetDrawer,
        data.fundingDrawer,
        data.amount_usd,
        data.amount_lbp,
        data.notes ?? null,
        userId,
        txTime ?? null,
      );
      const topUpId = Number(result.lastInsertRowid);

      // 2. Create unified transaction row — profit is always 0 (this moves
      // the shop's own cash between two of its own containers; it doesn't
      // sell anything to anyone).
      const targetLabel = data.targetDrawer.replace("_", " ");
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.SYSTEM_FLOAT_TOPUP,
        source_table: "system_float_topups",
        source_id: topUpId,
        user_id: userId,
        amount_usd: data.amount_usd,
        amount_lbp: data.amount_lbp,
        profit_usd: 0,
        profit_lbp: 0,
        summary: `Fund ${targetLabel}: ${data.fundingDrawer} → ${targetLabel}${data.notes ? ` - ${data.notes}` : ""}`,
        metadata_json: {
          funding_drawer: data.fundingDrawer,
          target_drawer: data.targetDrawer,
          notes: data.notes ?? null,
        },
        transaction_time: txTime,
      });

      const note = `Fund ${targetLabel} float${data.notes ? `: ${data.notes}` : ""} (from ${data.fundingDrawer})`;

      // 3. USD leg: funding drawer −, target drawer +
      if (data.amount_usd && data.amount_usd > 0) {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: SYSTEM_FLOAT_TOPUP_METHOD,
          drawerName: data.fundingDrawer,
          currencyCode: "USD",
          amount: -data.amount_usd,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: data.fundingDrawer,
          currencyCode: "USD",
          delta: -data.amount_usd,
          tenantId,
        });

        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: SYSTEM_FLOAT_TOPUP_METHOD,
          drawerName: data.targetDrawer,
          currencyCode: "USD",
          amount: data.amount_usd,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: data.targetDrawer,
          currencyCode: "USD",
          delta: data.amount_usd,
          tenantId,
        });
      }

      // 4. LBP leg: funding drawer −, target drawer +
      if (data.amount_lbp && data.amount_lbp > 0) {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: SYSTEM_FLOAT_TOPUP_METHOD,
          drawerName: data.fundingDrawer,
          currencyCode: "LBP",
          amount: -data.amount_lbp,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: data.fundingDrawer,
          currencyCode: "LBP",
          delta: -data.amount_lbp,
          tenantId,
        });

        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: SYSTEM_FLOAT_TOPUP_METHOD,
          drawerName: data.targetDrawer,
          currencyCode: "LBP",
          amount: data.amount_lbp,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: data.targetDrawer,
          currencyCode: "LBP",
          delta: data.amount_lbp,
          tenantId,
        });
      }

      return topUpId;
    })();
  }

  /**
   * Get OMT_System drawer balances for transfer source selection.
   */
  getSourceDrawerBalances(): SourceDrawerBalance[] {
    const rows = this.db
      .prepare(
        `
      SELECT drawer_name,
        COALESCE(SUM(CASE WHEN currency_code = 'USD' THEN balance ELSE 0 END), 0) as balance_usd,
        COALESCE(SUM(CASE WHEN currency_code = 'LBP' THEN balance ELSE 0 END), 0) as balance_lbp
      FROM drawer_balances
      WHERE drawer_name = 'OMT_System' AND tenant_id = ?
      GROUP BY drawer_name
    `,
      )
      .all(getCurrentTenantId()) as SourceDrawerBalance[];
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
