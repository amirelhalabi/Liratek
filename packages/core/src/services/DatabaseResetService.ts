/**
 * Database Reset Service (LIRA-165 — Settings › Reset Data)
 *
 * Orchestration only — no `getDatabase()`, no SQL (rule 13). All data access
 * goes through `DatabaseResetRepository`, injected via the constructor
 * (DIP) so this service is unit-testable with a mocked repo.
 *
 * The confirmation phrase is re-validated HERE, server-side, even though the
 * UI already requires the operator to type it exactly. The UI check is not
 * a guard — anyone driving the IPC channel or REST route directly bypasses
 * it — so this is the one place that must refuse a mismatched phrase before
 * the repository is ever touched (defence in depth).
 */

import {
  getDatabaseResetRepository,
  type DatabaseResetRepository,
} from "../repositories/DatabaseResetRepository.js";
import {
  DATABASE_RESET_CONFIRMATION_PHRASE,
  type DatabaseResetPreview,
  type DatabaseResetResult,
} from "../constants/resetTables.js";
import { settingsLogger } from "../utils/logger.js";

/**
 * Named `DatabaseResetRequest`, NOT `DatabaseResetInput` — that name is
 * already taken by the Zod-inferred type in `validators/databaseReset.ts`
 * (which only carries `confirmation`; `backupPath` is resolved by the
 * caller, not user-supplied input, so it lives on the wider service-level
 * shape instead of the validated request body).
 */
export interface DatabaseResetRequest {
  confirmation: string;
  /** Desktop-only: path of the pre-wipe file backup, taken by the caller
   *  before invoking `reset()`. Passed straight through into the result so
   *  the UI can show where it lives. Web/REST omits it (Litestream
   *  continuous replication covers the server DB instead). */
  backupPath?: string;
}

export interface DatabaseResetOutcome {
  success: boolean;
  data?: DatabaseResetResult;
  error?: string;
}

export class DatabaseResetService {
  private repo: DatabaseResetRepository;

  constructor(repo: DatabaseResetRepository = getDatabaseResetRepository()) {
    this.repo = repo;
  }

  /**
   * Row counts a reset would touch, for the confirmation UI.
   */
  preview(): DatabaseResetPreview {
    try {
      return this.repo.previewCounts();
    } catch (error) {
      settingsLogger.error({ error }, "Database reset preview failed");
      throw error;
    }
  }

  /**
   * Wipe every tenant-owned operational table to the fresh-install
   * baseline. Rejects (without touching the repository) unless
   * `input.confirmation` matches `DATABASE_RESET_CONFIRMATION_PHRASE`
   * exactly.
   */
  reset(input: DatabaseResetRequest): DatabaseResetOutcome {
    if (input.confirmation !== DATABASE_RESET_CONFIRMATION_PHRASE) {
      settingsLogger.warn(
        { providedLength: input.confirmation?.length ?? 0 },
        "Database reset rejected: confirmation phrase mismatch",
      );
      return {
        success: false,
        error: `Confirmation phrase must be exactly "${DATABASE_RESET_CONFIRMATION_PHRASE}"`,
      };
    }

    try {
      settingsLogger.info(
        { backupPath: input.backupPath },
        "Database reset starting",
      );

      const result = this.repo.resetTenantData();
      const data: DatabaseResetResult = {
        ...result,
        ...(input.backupPath !== undefined && {
          backupPath: input.backupPath,
        }),
      };

      settingsLogger.info(
        { totalDeleted: data.totalDeleted, backupPath: data.backupPath },
        "Database reset completed",
      );

      return { success: true, data };
    } catch (error) {
      settingsLogger.error({ error }, "Database reset failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Database reset failed",
      };
    }
  }
}

let instance: DatabaseResetService | null = null;

export function getDatabaseResetService(): DatabaseResetService {
  if (!instance) {
    instance = new DatabaseResetService();
  }
  return instance;
}

export function resetDatabaseResetService(): void {
  instance = null;
}
