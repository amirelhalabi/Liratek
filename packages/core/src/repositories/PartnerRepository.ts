/**
 * Partner Repository
 *
 * Handles all partners and partner_ledger table operations.
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";
import { DatabaseError, NotFoundError } from "../utils/errors.js";

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
}

export interface PartnerBalance {
  usd: number;
  lbp: number;
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
    | "CUSTOM_SERVICE"
    | "SETTLEMENT"
    | "ADJUSTMENT";
  reference_table?: string;
  reference_id?: number;
  amount: number;
  currency: string;
  direction: "DEBIT" | "CREDIT";
  notes?: string;
  user_id?: number;
  settlement_method?: "CASH" | "OMT" | "WHISH" | "BINANCE" | "CLIENT_ACCOUNT";
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
        INSERT INTO partners (name, phone, notes, system_association, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `);
      const result = stmt.run(
        data.name.trim(),
        data.phone ?? null,
        data.notes ?? null,
        data.system_association ?? null,
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
        `SELECT ${this.getColumns()} FROM partners WHERE id = ?`,
      );
      return (stmt.get(id) as Partner | undefined) ?? null;
    } catch (e) {
      throw new DatabaseError("Failed to get partner by id", { cause: e });
    }
  }

  getAll(includeInactive = false): Partner[] {
    try {
      const sql = includeInactive
        ? `SELECT ${this.getColumns()} FROM partners ORDER BY name ASC`
        : `SELECT ${this.getColumns()} FROM partners WHERE is_active = 1 ORDER BY name ASC`;
      return this.query<Partner>(sql);
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

      const stmt = this.db.prepare(
        `UPDATE partners SET ${fields.join(", ")} WHERE id = ?`,
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
        `UPDATE partners SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      );
      stmt.run(id);
    } catch (e) {
      throw new DatabaseError("Failed to deactivate partner", { cause: e });
    }
  }

  activate(id: number): void {
    try {
      const stmt = this.db.prepare(
        `UPDATE partners SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      );
      stmt.run(id);
    } catch (e) {
      throw new DatabaseError("Failed to activate partner", { cause: e });
    }
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  addLedgerEntry(data: CreateLedgerEntryData): PartnerLedgerEntry {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO partner_ledger (
          partner_id, transaction_type, reference_table, reference_id,
          amount, currency, direction, notes, user_id, settlement_method,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
      );
      const id = Number(result.lastInsertRowid);
      const entry = this.db
        .prepare(
          `SELECT id, partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, notes, user_id, settlement_method, created_at FROM partner_ledger WHERE id = ?`,
        )
        .get(id) as PartnerLedgerEntry | undefined;
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

  getLedgerEntries(
    partnerId: number,
    filters?: { startDate?: string; endDate?: string; type?: string },
  ): PartnerLedgerEntry[] {
    try {
      const conditions = ["partner_id = ?"];
      const params: unknown[] = [partnerId];

      if (filters?.startDate) {
        conditions.push("created_at >= ?");
        params.push(filters.startDate);
      }
      if (filters?.endDate) {
        conditions.push("created_at <= ?");
        params.push(filters.endDate);
      }
      if (filters?.type) {
        conditions.push("transaction_type = ?");
        params.push(filters.type);
      }

      const sql = `
        SELECT id, partner_id, transaction_type, reference_table, reference_id,
               amount, currency, direction, notes, user_id, settlement_method, created_at
        FROM partner_ledger
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
      `;
      return this.query<PartnerLedgerEntry>(sql, ...params);
    } catch (e) {
      throw new DatabaseError("Failed to get partner ledger entries", {
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
            - COALESCE(SUM(CASE WHEN currency = 'LBP' AND direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS lbp
          FROM partner_ledger
          WHERE partner_id = ?
        `,
        )
        .get(partnerId) as { usd: number; lbp: number };

      return { usd: row.usd, lbp: row.lbp };
    } catch (e) {
      throw new DatabaseError("Failed to get partner balance", { cause: e });
    }
  }

  getAllBalances(includeInactive?: boolean): Array<Partner & PartnerBalance> {
    try {
      const filter = includeInactive ? "1=1" : "p.is_active = 1";
      return this.query<Partner & PartnerBalance>(`
        SELECT
          p.id, p.name, p.phone, p.notes, p.is_active, p.system_association, p.created_at, p.updated_at,
          COALESCE(SUM(CASE WHEN l.currency = 'USD' AND l.direction = 'DEBIT'  THEN l.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN l.currency = 'USD' AND l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0) AS usd,
          COALESCE(SUM(CASE WHEN l.currency = 'LBP' AND l.direction = 'DEBIT'  THEN l.amount ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN l.currency = 'LBP' AND l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0) AS lbp
        FROM partners p
        LEFT JOIN partner_ledger l ON l.partner_id = p.id
        WHERE ${filter}
        GROUP BY p.id
        ORDER BY p.name ASC
      `);
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
