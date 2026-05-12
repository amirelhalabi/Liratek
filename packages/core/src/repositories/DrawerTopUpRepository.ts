import { BaseRepository } from "./BaseRepository.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

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

const GENERAL_DRAWER = "General";
const TOPUP_METHOD = "CASH";

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
    return this.db.transaction(() => {
      // 1. Insert into drawer_topups
      const insertTopUp = this.db.prepare(`
        INSERT INTO drawer_topups (amount_usd, amount_lbp, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `);
      const result = insertTopUp.run(
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
        },
        transaction_time: txTime,
      });

      // 3. Prepare UPSERT and payment statements
      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      const insertPayment = this.db.prepare(`
        INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const note = `Drawer Top-Up${data.notes ? `: ${data.notes}` : ""}`;

      // 4. USD inflow
      if (data.amount_usd && data.amount_usd > 0) {
        insertPayment.run(
          txnId,
          TOPUP_METHOD,
          GENERAL_DRAWER,
          "USD",
          data.amount_usd,
          note,
          userId,
        );
        upsertBalance.run(GENERAL_DRAWER, "USD", data.amount_usd);
      }

      // 5. LBP inflow
      if (data.amount_lbp && data.amount_lbp > 0) {
        insertPayment.run(
          txnId,
          TOPUP_METHOD,
          GENERAL_DRAWER,
          "LBP",
          data.amount_lbp,
          note,
          userId,
        );
        upsertBalance.run(GENERAL_DRAWER, "LBP", data.amount_lbp);
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
    return this.db.transaction(() => {
      // 1. Insert into drawer_topups with source_drawer
      const insertTopUp = this.db.prepare(`
        INSERT INTO drawer_topups (amount_usd, amount_lbp, notes, source_drawer, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `);
      const result = insertTopUp.run(
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

      // 3. Prepare statements
      const upsertBalance = this.db.prepare(`
        INSERT INTO drawer_balances (drawer_name, currency_code, balance)
        VALUES (?, ?, ?)
        ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
          balance = drawer_balances.balance + excluded.balance,
          updated_at = CURRENT_TIMESTAMP
      `);

      const deductBalance = this.db.prepare(`
        UPDATE drawer_balances
        SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
        WHERE drawer_name = ? AND currency_code = ?
      `);

      const insertPayment = this.db.prepare(`
        INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const note = `Drawer Transfer: ${data.source_drawer} → General${data.notes ? `: ${data.notes}` : ""}`;

      // 4. USD transfer
      if (data.amount_usd && data.amount_usd > 0) {
        deductBalance.run(data.amount_usd, data.source_drawer, "USD");
        upsertBalance.run(GENERAL_DRAWER, "USD", data.amount_usd);
        insertPayment.run(
          txnId,
          TOPUP_METHOD,
          GENERAL_DRAWER,
          "USD",
          data.amount_usd,
          note,
          userId,
        );
      }

      // 5. LBP transfer
      if (data.amount_lbp && data.amount_lbp > 0) {
        deductBalance.run(data.amount_lbp, data.source_drawer, "LBP");
        upsertBalance.run(GENERAL_DRAWER, "LBP", data.amount_lbp);
        insertPayment.run(
          txnId,
          TOPUP_METHOD,
          GENERAL_DRAWER,
          "LBP",
          data.amount_lbp,
          note,
          userId,
        );
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
      WHERE drawer_name = 'OMT_System'
      GROUP BY drawer_name
    `,
      )
      .all() as SourceDrawerBalance[];
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
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as DrawerTopUpEntity[];
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
