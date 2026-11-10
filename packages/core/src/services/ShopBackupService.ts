/**
 * Web "Download backup" (Settings › Backup) — a shop admin downloads a SQLite
 * file of THEIR OWN shop.
 *
 * The shop is ALWAYS the current tenant context (`getCurrentTenantId()`),
 * never a caller-supplied id. The copy is built by the same single-shop
 * builder as the offline copy (via `ShopBackupRepository`, rule 13), into a
 * fresh `mkdtemp` directory; the caller streams `filePath` and MUST call
 * `dispose()` when done (on success, error or abort) — it is idempotent.
 *
 * File name: `liratek-<slug>-<stamp>.db`, where `stamp` is the browser's
 * local `YYYY-MM-DD-HHmm` (rule 27); the server's own clock is only the
 * fallback. Server-only: exported from `index.ts`, never `browser.ts`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  getShopBackupRepository,
  type ShopBackupRepository,
} from "../repositories/ShopBackupRepository.js";
import type { ShopBackupQuery } from "../validators/backup.js";

export interface ShopBackupServiceDeps {
  /** Parent of the per-download temp directory. Default: `os.tmpdir()`. */
  tmpRoot?: string;
  now?: () => Date;
}

export interface ShopBackupFile {
  filePath: string;
  fileName: string;
  sizeBytes: number;
  /** Removes the temp directory. Safe to call more than once. */
  dispose: () => void;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD-HHmm` in the server's local time — the fallback only. */
function serverStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** A slug is already `[a-z0-9-]`; anything else is dropped so the name is
 * always safe in a `Content-Disposition` header and on any file system. */
function safeSlug(slug: string | null, tenantId: number): string {
  const cleaned = (slug ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || `shop-${tenantId}`;
}

export class ShopBackupService {
  constructor(
    private readonly repo: ShopBackupRepository,
    private readonly deps: ShopBackupServiceDeps = {},
  ) {}

  createBackup(query: ShopBackupQuery): ShopBackupFile {
    const tenantId = getCurrentTenantId();
    const dir = fs.mkdtempSync(path.join(this.deps.tmpRoot ?? os.tmpdir(), "liratek-backup-"));
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      fs.rmSync(dir, { recursive: true, force: true });
    };
    try {
      const filePath = path.join(dir, "backup.db");
      const { sizeBytes } = this.repo.writeShopCopy(tenantId, filePath);
      const stamp = query.stamp ?? serverStamp(this.deps.now ? this.deps.now() : new Date());
      const fileName = `liratek-${safeSlug(this.repo.getShopSlug(tenantId), tenantId)}-${stamp}.db`;
      return { filePath, fileName, sizeBytes, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }
}

let instance: ShopBackupService | null = null;

export function getShopBackupService(): ShopBackupService {
  if (!instance) instance = new ShopBackupService(getShopBackupRepository());
  return instance;
}

export function resetShopBackupService(): void {
  instance = null;
}
