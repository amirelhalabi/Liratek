/**
 * Payment Method Repository
 *
 * Handles all CRUD operations for the `payment_methods` table,
 * which stores configurable payment methods and their drawer mappings.
 */

import { getDatabase } from "../db/connection.js";
import type Database from "better-sqlite3";

// =============================================================================
// Entity Types
// =============================================================================

export interface PaymentMethodEntity {
  id: number;
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer: number; // 0 or 1
  sort_order: number;
  is_active: number; // 0 or 1
  is_system: number; // 0 or 1
  created_at: string;
}

export interface CreatePaymentMethodData {
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer?: number;
  sort_order?: number;
}

export interface UpdatePaymentMethodData {
  label?: string;
  drawer_name?: string;
  affects_drawer?: number;
  is_active?: number;
  sort_order?: number;
}

// =============================================================================
// Payment Method Repository Class
// =============================================================================

const COLUMNS =
  "id, code, label, drawer_name, affects_drawer, sort_order, is_active, is_system, created_at";

export class PaymentMethodRepository {
  private db: Database.Database;

  constructor() {
    this.db = getDatabase();
  }

  /** Get all payment methods ordered by sort_order */
  getAll(): PaymentMethodEntity[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM payment_methods ORDER BY sort_order`)
      .all() as PaymentMethodEntity[];
  }

  /** Get only active payment methods */
  getActive(): PaymentMethodEntity[] {
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM payment_methods WHERE is_active = 1 ORDER BY sort_order`,
      )
      .all() as PaymentMethodEntity[];
  }

  /** Get a single payment method by code */
  getByCode(code: string): PaymentMethodEntity | undefined {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM payment_methods WHERE code = ?`)
      .get(code) as PaymentMethodEntity | undefined;
  }

  /** Get a single payment method by id */
  getById(id: number): PaymentMethodEntity | undefined {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM payment_methods WHERE id = ?`)
      .get(id) as PaymentMethodEntity | undefined;
  }

  /** Create a new payment method */
  create(data: CreatePaymentMethodData): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      // Get next sort_order if not provided
      const sortOrder =
        data.sort_order ??
        (
          this.db
            .prepare(
              `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM payment_methods`,
            )
            .get() as { next: number }
        ).next;

      const result = this.db
        .prepare(
          `INSERT INTO payment_methods (code, label, drawer_name, affects_drawer, sort_order)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          data.code.toUpperCase(),
          data.label,
          data.drawer_name,
          data.affects_drawer ?? 1,
          sortOrder,
        );

      return { success: true, id: result.lastInsertRowid as number };
    } catch (error: any) {
      if (error.message?.includes("UNIQUE constraint")) {
        return {
          success: false,
          error: `Payment method code '${data.code}' already exists`,
        };
      }
      return { success: false, error: error.message ?? String(error) };
    }
  }

  /** Update an existing payment method */
  update(
    id: number,
    data: UpdatePaymentMethodData,
  ): { success: boolean; error?: string } {
    const method = this.getById(id);
    if (!method) {
      return { success: false, error: "Payment method not found" };
    }

    // System methods: only label and is_active can be changed
    const setClauses: string[] = [];
    const params: any[] = [];

    if (data.label !== undefined) {
      setClauses.push("label = ?");
      params.push(data.label);
    }
    if (data.is_active !== undefined) {
      setClauses.push("is_active = ?");
      params.push(data.is_active);
    }

    // Non-system methods can also update drawer_name, affects_drawer, sort_order
    if (method.is_system === 0) {
      if (data.drawer_name !== undefined) {
        setClauses.push("drawer_name = ?");
        params.push(data.drawer_name);
      }
      if (data.affects_drawer !== undefined) {
        setClauses.push("affects_drawer = ?");
        params.push(data.affects_drawer);
      }
    }

    if (data.sort_order !== undefined) {
      setClauses.push("sort_order = ?");
      params.push(data.sort_order);
    }

    if (setClauses.length === 0) {
      return { success: true };
    }

    params.push(id);
    this.db
      .prepare(
        `UPDATE payment_methods SET ${setClauses.join(", ")} WHERE id = ?`,
      )
      .run(...params);

    return { success: true };
  }

  /** Delete a payment method (only non-system methods) */
  delete(id: number): { success: boolean; error?: string } {
    const method = this.getById(id);
    if (!method) {
      return { success: false, error: "Payment method not found" };
    }
    if (method.is_system === 1) {
      return { success: false, error: "Cannot delete system payment method" };
    }

    this.db.prepare(`DELETE FROM payment_methods WHERE id = ?`).run(id);
    return { success: true };
  }

  /** Reorder payment methods */
  reorder(ids: number[]): { success: boolean; error?: string } {
    try {
      this.db.transaction(() => {
        const stmt = this.db.prepare(
          `UPDATE payment_methods SET sort_order = ? WHERE id = ?`,
        );
        for (let i = 0; i < ids.length; i++) {
          stmt.run(i, ids[i]);
        }
      })();
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message ?? String(error) };
    }
  }

  /** Resolve a method code to its drawer name */
  resolveDrawerName(code: string): string {
    const method = this.getByCode(code);
    return method?.drawer_name ?? "General";
  }

  /** Check if a method affects a drawer (i.e., not DEBT) */
  isDrawerAffecting(code: string): boolean {
    const method = this.getByCode(code);
    return method?.affects_drawer === 1;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let paymentMethodRepositoryInstance: PaymentMethodRepository | null = null;

export function getPaymentMethodRepository(): PaymentMethodRepository {
  if (!paymentMethodRepositoryInstance) {
    paymentMethodRepositoryInstance = new PaymentMethodRepository();
  }
  return paymentMethodRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetPaymentMethodRepository(): void {
  paymentMethodRepositoryInstance = null;
}
