/**
 * Currency Repository
 * 
 * Handles all currencies table operations.
 */

import { BaseRepository } from './BaseRepository';

// =============================================================================
// Entity Types
// =============================================================================

export interface CurrencyEntity {
  id: number;
  code: string;
  name: string;
  is_active: number;
}

export interface CreateCurrencyData {
  code: string;
  name: string;
}

export interface UpdateCurrencyData {
  code?: string;
  name?: string;
  is_active?: number;
}

// =============================================================================
// Currency Repository Class
// =============================================================================

export class CurrencyRepository extends BaseRepository<CurrencyEntity> {
  constructor() {
    super('currencies', { softDelete: false });
  }

  /**
   * Get all currencies
   */
  findAllCurrencies(): CurrencyEntity[] {
    const stmt = this.db.prepare(
      'SELECT id, code, name, is_active FROM currencies ORDER BY code ASC'
    );
    return stmt.all() as CurrencyEntity[];
  }

  /**
   * Create a new currency
   */
  createCurrency(data: CreateCurrencyData): { id: number } {
    const stmt = this.db.prepare(
      'INSERT INTO currencies (code, name, is_active) VALUES (?, ?, 1)'
    );
    const result = stmt.run(data.code.toUpperCase(), data.name);
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Update a currency
   */
  updateCurrency(id: number, data: UpdateCurrencyData): boolean {
    const current = this.findById(id);
    if (!current) return false;

    const code = (data.code ?? current.code).toUpperCase();
    const name = data.name ?? current.name;
    const isActive = data.is_active ?? current.is_active;

    this.db.prepare(
      'UPDATE currencies SET code = ?, name = ?, is_active = ? WHERE id = ?'
    ).run(code, name, isActive, id);
    
    return true;
  }

  /**
   * Delete a currency
   */
  deleteCurrency(id: number): void {
    this.db.prepare('DELETE FROM currencies WHERE id = ?').run(id);
  }

  /**
   * Check if currency code exists
   */
  codeExists(code: string, excludeId?: number): boolean {
    let query = 'SELECT 1 FROM currencies WHERE code = ?';
    const params: (string | number)[] = [code.toUpperCase()];
    
    if (excludeId) {
      query += ' AND id != ?';
      params.push(excludeId);
    }
    
    return !!this.db.prepare(query).get(...params);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let currencyRepositoryInstance: CurrencyRepository | null = null;

export function getCurrencyRepository(): CurrencyRepository {
  if (!currencyRepositoryInstance) {
    currencyRepositoryInstance = new CurrencyRepository();
  }
  return currencyRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetCurrencyRepository(): void {
  currencyRepositoryInstance = null;
}
