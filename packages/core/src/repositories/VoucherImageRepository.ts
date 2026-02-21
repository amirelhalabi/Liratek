/**
 * Voucher Image Repository
 *
 * Stores per-item image associations for mobileServices.json items.
 * Shop owners photograph physical voucher cards and map them to items.
 */

import { BaseRepository } from "./BaseRepository.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface VoucherImageEntity {
  id: number;
  provider: string;
  category: string;
  item_key: string;
  image_path: string;
  created_at: string;
}

// =============================================================================
// Voucher Image Repository Class
// =============================================================================

export class VoucherImageRepository extends BaseRepository<VoucherImageEntity> {
  constructor() {
    super("voucher_images", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, provider, category, item_key, image_path, created_at";
  }

  /**
   * Get image for a specific item
   */
  getImage(
    provider: string,
    category: string,
    itemKey: string,
  ): VoucherImageEntity | null {
    const row = this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM voucher_images
         WHERE provider = ? AND category = ? AND item_key = ?`,
      )
      .get(provider, category, itemKey) as VoucherImageEntity | undefined;
    return row ?? null;
  }

  /**
   * Get all images (for frontend cache)
   */
  getAllImages(): VoucherImageEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM voucher_images ORDER BY provider, category, item_key`,
      )
      .all() as VoucherImageEntity[];
  }

  /**
   * UPSERT an image for an item
   */
  setImage(
    provider: string,
    category: string,
    itemKey: string,
    imagePath: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO voucher_images (provider, category, item_key, image_path)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider, category, item_key) DO UPDATE SET
           image_path = excluded.image_path,
           created_at = CURRENT_TIMESTAMP`,
      )
      .run(provider, category, itemKey, imagePath);
  }

  /**
   * Delete an image by ID
   */
  deleteImage(id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM voucher_images WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  /**
   * Delete an image by item key
   */
  deleteImageByKey(
    provider: string,
    category: string,
    itemKey: string,
  ): boolean {
    const result = this.db
      .prepare(
        `DELETE FROM voucher_images WHERE provider = ? AND category = ? AND item_key = ?`,
      )
      .run(provider, category, itemKey);
    return result.changes > 0;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let voucherImageRepositoryInstance: VoucherImageRepository | null = null;

export function getVoucherImageRepository(): VoucherImageRepository {
  if (!voucherImageRepositoryInstance) {
    voucherImageRepositoryInstance = new VoucherImageRepository();
  }
  return voucherImageRepositoryInstance;
}

export function resetVoucherImageRepository(): void {
  voucherImageRepositoryInstance = null;
}
