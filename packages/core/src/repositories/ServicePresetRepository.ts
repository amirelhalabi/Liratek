/**
 * Service Preset Repository
 *
 * CRUD operations for reusable service templates (digital accounts, repairs, etc.).
 */

import { BaseRepository } from "./BaseRepository.js";
import { customServiceLogger } from "../utils/logger.js";
import type {
  CreateServicePresetInput,
  UpdateServicePresetInput,
} from "../validators/servicePreset.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface ServicePresetEntity {
  id: number;
  name: string;
  category: string;
  cost_usd: number;
  cost_lbp: number;
  price_usd: number;
  price_lbp: number;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Default Presets
// =============================================================================

const DEFAULT_PRESETS: Array<{
  name: string;
  category: string;
  cost_usd: number;
  price_usd: number;
}> = [
  {
    name: "Netflix Premium 1 Month",
    category: "digital_account",
    cost_usd: 7,
    price_usd: 9,
  },
  {
    name: "Netflix Standard 1 Month",
    category: "digital_account",
    cost_usd: 5,
    price_usd: 7,
  },
  {
    name: "Spotify Premium 1 Month",
    category: "digital_account",
    cost_usd: 3,
    price_usd: 5,
  },
  {
    name: "Shahid VIP 1 Month",
    category: "digital_account",
    cost_usd: 4,
    price_usd: 6,
  },
];

// =============================================================================
// Repository
// =============================================================================

export class ServicePresetRepository extends BaseRepository<ServicePresetEntity> {
  constructor() {
    super("service_presets", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, name, category, cost_usd, cost_lbp, price_usd, price_lbp, is_active, sort_order, created_at, updated_at";
  }

  /**
   * Create a new service preset.
   */
  createPreset(data: CreateServicePresetInput): ServicePresetEntity {
    const stmt = this.db.prepare(`
      INSERT INTO service_presets (name, category, cost_usd, cost_lbp, price_usd, price_lbp, is_active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      data.name,
      data.category,
      data.cost_usd ?? 0,
      data.cost_lbp ?? 0,
      data.price_usd ?? 0,
      data.price_lbp ?? 0,
      data.is_active ?? 1,
      data.sort_order ?? 0,
    );
    const id = Number(result.lastInsertRowid);
    customServiceLogger.info({ id, name: data.name }, "Service preset created");
    return this.findById(id)!;
  }

  /**
   * Get all presets, optionally filtered by category. Only active by default.
   */
  getAll(filter?: {
    category?: string;
    includeInactive?: boolean;
  }): ServicePresetEntity[] {
    let query = `SELECT ${this.getColumns()} FROM service_presets WHERE 1=1`;
    const params: unknown[] = [];

    if (!filter?.includeInactive) {
      query += ` AND is_active = 1`;
    }
    if (filter?.category) {
      query += ` AND category = ?`;
      params.push(filter.category);
    }

    query += ` ORDER BY sort_order ASC, name ASC`;
    return this.db.prepare(query).all(...params) as ServicePresetEntity[];
  }

  /**
   * Update a preset.
   */
  updatePreset(
    id: number,
    data: UpdateServicePresetInput,
  ): ServicePresetEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      fields.push("name = ?");
      values.push(data.name);
    }
    if (data.category !== undefined) {
      fields.push("category = ?");
      values.push(data.category);
    }
    if (data.cost_usd !== undefined) {
      fields.push("cost_usd = ?");
      values.push(data.cost_usd);
    }
    if (data.cost_lbp !== undefined) {
      fields.push("cost_lbp = ?");
      values.push(data.cost_lbp);
    }
    if (data.price_usd !== undefined) {
      fields.push("price_usd = ?");
      values.push(data.price_usd);
    }
    if (data.price_lbp !== undefined) {
      fields.push("price_lbp = ?");
      values.push(data.price_lbp);
    }
    if (data.is_active !== undefined) {
      fields.push("is_active = ?");
      values.push(data.is_active);
    }
    if (data.sort_order !== undefined) {
      fields.push("sort_order = ?");
      values.push(data.sort_order);
    }

    if (fields.length === 0) return existing;

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);

    this.db
      .prepare(`UPDATE service_presets SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);

    customServiceLogger.info({ id }, "Service preset updated");
    return this.findById(id);
  }

  /**
   * Delete a preset permanently.
   */
  deletePreset(id: number): boolean {
    const result = this.db
      .prepare("DELETE FROM service_presets WHERE id = ?")
      .run(id);
    if (result.changes > 0) {
      customServiceLogger.info({ id }, "Service preset deleted");
      return true;
    }
    return false;
  }

  /**
   * Seed default presets if they don't already exist.
   * Uses INSERT OR IGNORE keyed on (name, category) to avoid duplicates.
   * Safe to call on every app startup.
   */
  seedDefaults(): number {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO service_presets (name, category, cost_usd, cost_lbp, price_usd, price_lbp, sort_order)
      SELECT ?, ?, ?, 0, ?, 0, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM service_presets WHERE name = ? AND category = ?
      )
    `);

    let inserted = 0;
    for (let i = 0; i < DEFAULT_PRESETS.length; i++) {
      const p = DEFAULT_PRESETS[i];
      const result = stmt.run(
        p.name,
        p.category,
        p.cost_usd,
        p.price_usd,
        i,
        p.name,
        p.category,
      );
      if (result.changes > 0) inserted++;
    }

    if (inserted > 0) {
      customServiceLogger.info(
        { inserted, total: DEFAULT_PRESETS.length },
        "Default service presets seeded",
      );
    }
    return inserted;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ServicePresetRepository | null = null;

export function getServicePresetRepository(): ServicePresetRepository {
  if (!instance) {
    instance = new ServicePresetRepository();
  }
  return instance;
}

export function resetServicePresetRepository(): void {
  instance = null;
}
