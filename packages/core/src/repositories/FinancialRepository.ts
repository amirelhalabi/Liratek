/**
 * Financial Repository
 *
 * Handles cross-table financial aggregation for P&L and Commissions.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError } from "../utils/errors.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

export class FinancialRepository extends BaseRepository<{ id: number }> {
  constructor() {
    super("sales", { softDelete: false }); // Base table doesn't matter much for aggregations
  }

  // Override getColumns() - This repository uses aggregations, not direct selects
  protected getColumns(): string {
    return "id"; // Minimal since this repo only does aggregations
  }

  /**
   * Get list of all drawer names from drawer_balances
   */
  getDrawerNames(): string[] {
    try {
      const rows = this.db
        .prepare(
          `SELECT DISTINCT drawer_name FROM drawer_balances WHERE tenant_id = ? ORDER BY drawer_name`,
        )
        .all(getCurrentTenantId()) as { drawer_name: string }[];
      return rows.map((r) => r.drawer_name);
    } catch (error) {
      throw new DatabaseError("Failed to get drawer names", { cause: error });
    }
  }
}

let financialRepositoryInstance: FinancialRepository | null = null;

export function getFinancialRepository(): FinancialRepository {
  if (!financialRepositoryInstance) {
    financialRepositoryInstance = new FinancialRepository();
  }
  return financialRepositoryInstance;
}
