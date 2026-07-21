/**
 * Carrier Line Repository (LIRA W6.a)
 *
 * Shop-owned alfa/mtc SIM lines: remaining credits + validity expiry date.
 * Informational only — no drawer legs, no checkout/closing involvement.
 * `validity_expires_at` stores a DATE (YYYY-MM-DD); days-remaining is
 * derived by the caller at render time so the figure never goes stale.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

// =============================================================================
// Entity Types
// =============================================================================

export type CarrierKey = "alfa" | "mtc";

export interface CarrierLineEntity {
  id: number;
  carrier: CarrierKey;
  phone_number: string;
  label: string | null;
  credits: number;
  validity_expires_at: string | null;
  notes: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCarrierLineData {
  carrier: CarrierKey;
  phone_number: string;
  label?: string | null;
  credits?: number;
  validity_expires_at?: string | null;
  notes?: string | null;
}

export interface UpdateCarrierLineData {
  carrier?: CarrierKey;
  phone_number?: string;
  label?: string | null;
  credits?: number;
  validity_expires_at?: string | null;
  notes?: string | null;
  is_active?: number;
}

/** The Recharge-tab inline quick-update: credits and/or a new expiry. */
export interface UpdateBalanceData {
  credits?: number;
  validity_expires_at?: string | null;
}

// =============================================================================
// Repository
// =============================================================================

export class CarrierLineRepository extends BaseRepository<CarrierLineEntity> {
  constructor() {
    super("carrier_lines");
  }

  protected getColumns(): string {
    return "id, carrier, phone_number, label, credits, validity_expires_at, notes, is_active, created_at, updated_at";
  }

  /** Active lines for one carrier — the Recharge-tab compact panel. */
  getActiveByCarrier(carrier: CarrierKey): CarrierLineEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_lines
         WHERE carrier = ? AND is_active = 1 AND tenant_id = ?
         ORDER BY phone_number`,
      )
      .all(carrier, getCurrentTenantId()) as CarrierLineEntity[];
  }

  /** All active lines, every carrier. */
  getAllActive(): CarrierLineEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_lines
         WHERE is_active = 1 AND tenant_id = ?
         ORDER BY carrier, phone_number`,
      )
      .all(getCurrentTenantId()) as CarrierLineEntity[];
  }

  /** Every line including archived (is_active = 0) — the Settings manager. */
  getAllIncludingInactive(): CarrierLineEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM carrier_lines
         WHERE tenant_id = ?
         ORDER BY carrier, phone_number`,
      )
      .all(getCurrentTenantId()) as CarrierLineEntity[];
  }

  getById(id: number): CarrierLineEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM carrier_lines WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, getCurrentTenantId()) as CarrierLineEntity | undefined) ?? null
    );
  }

  createLine(data: CreateCarrierLineData): CarrierLineEntity {
    const stmt = this.db.prepare(`
      INSERT INTO carrier_lines
        (tenant_id, carrier, phone_number, label, credits, validity_expires_at, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(
      getCurrentTenantId(),
      data.carrier,
      data.phone_number,
      data.label ?? null,
      data.credits ?? 0,
      data.validity_expires_at ?? null,
      data.notes ?? null,
    );
    return this.getById(result.lastInsertRowid as number)!;
  }

  updateLine(
    id: number,
    data: UpdateCarrierLineData,
  ): CarrierLineEntity | null {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (data.carrier !== undefined) {
      sets.push("carrier = ?");
      values.push(data.carrier);
    }
    if (data.phone_number !== undefined) {
      sets.push("phone_number = ?");
      values.push(data.phone_number);
    }
    if (data.label !== undefined) {
      sets.push("label = ?");
      values.push(data.label);
    }
    if (data.credits !== undefined) {
      sets.push("credits = ?");
      values.push(data.credits);
    }
    if (data.validity_expires_at !== undefined) {
      sets.push("validity_expires_at = ?");
      values.push(data.validity_expires_at);
    }
    if (data.notes !== undefined) {
      sets.push("notes = ?");
      values.push(data.notes);
    }
    if (data.is_active !== undefined) {
      sets.push("is_active = ?");
      values.push(data.is_active);
    }

    if (sets.length === 0) return this.getById(id);

    sets.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id, getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE carrier_lines SET ${sets.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.getById(id);
  }

  /** The Recharge-tab inline quick-update: credits and/or a new expiry date. */
  updateBalance(id: number, data: UpdateBalanceData): CarrierLineEntity | null {
    return this.updateLine(id, data);
  }

  /** Toggle active/archived status. */
  toggleActive(id: number): CarrierLineEntity | null {
    this.db
      .prepare(
        `UPDATE carrier_lines
         SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(id, getCurrentTenantId());
    return this.getById(id);
  }

  /** Archive (soft — sets is_active = 0). Lines are never hard-deleted. */
  archive(id: number): CarrierLineEntity | null {
    return this.updateLine(id, { is_active: 0 });
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: CarrierLineRepository | null = null;

export function getCarrierLineRepository(): CarrierLineRepository {
  if (!instance) {
    instance = new CarrierLineRepository();
  }
  return instance;
}

export function resetCarrierLineRepository(): void {
  instance = null;
}
