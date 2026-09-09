/**
 * Database Reset IPC Handlers (LIRA-165 — Settings > Reset Data)
 *
 * Admin-only "Reset Data" action. Wipes all operational data (transactions,
 * payments, drawer movements, ledgers, catalogs, contacts) while KEEPING the
 * configuration captured by the setup wizard (accounts, base system, modules,
 * currencies, users, settings), so the shop restarts from a clean slate
 * without re-running the wizard. See
 * docs/plans/todo_plans/DATABASE_RESET_PLAN.md for the full table
 * classification and the reasoning behind every keep/wipe/zero decision.
 *
 * Safety net: a file backup is taken immediately before the wipe, and the
 * reset is ABORTED — the DB is never touched — if the backup fails. This
 * mirrors backup:create in backupHandlers.ts (WAL checkpoint, then
 * BackupService.createBackup against the resolved DB path) and reuses its
 * exact backup-directory plumbing (`getBackupServiceInstance()`) rather than
 * duplicating the directory-resolution logic.
 *
 * The audit entry for the reset itself is written AFTER the wipe commits,
 * because `audit_log` is one of the wiped tables — this makes the reset the
 * first new row in a fresh trail rather than erasing its own record.
 */

import { ipcMain } from "electron";
import {
  getDatabaseResetService,
  getDatabase,
  resolveDatabasePath,
  getAuditService,
  getUserRepository,
  logger,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { validatePayload, DatabaseResetSchema } from "../schemas/index.js";
import { getBackupServiceInstance } from "./backupHandlers.js";

export function registerDatabaseResetHandlers(): void {
  logger.info("Registering database reset IPC handlers");

  // ── Preview (read-only) ────────────────────────────────────────────────
  ipcMain.handle("database:resetPreview", async (event) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const data = getDatabaseResetService().preview();
      return { success: true, data };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, "database:resetPreview failed");
      return { success: false, error: errorMsg };
    }
  });

  // ── Reset (destructive write path) ─────────────────────────────────────
  ipcMain.handle("database:reset", async (event, payload: unknown) => {
    try {
      // Actor is ALWAYS derived from the session, never trusted from the
      // client payload.
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const validation = validatePayload(DatabaseResetSchema, payload);
      if (!validation.ok) return { success: false, error: validation.error };

      // 1. Backup FIRST. Destructive + irreversible ⇒ abort on any failure,
      // before the DB is touched at all.
      let backupPath: string | undefined;
      try {
        const db = getDatabase();
        try {
          // Flush WAL into the main file so the backup captures everything
          // committed so far (same step backup:create performs).
          db.pragma("wal_checkpoint(TRUNCATE)");
        } catch {
          // Best-effort — proceed with whatever is on disk if this fails.
        }

        const dbPath = resolveDatabasePath().path; // same source main.ts uses
        const backupResult = getBackupServiceInstance().createBackup(dbPath);
        if (!backupResult.success) {
          return {
            success: false,
            error: `Backup failed — reset aborted: ${backupResult.error ?? "unknown error"}`,
          };
        }
        backupPath = backupResult.path;
      } catch (backupError) {
        const reason =
          backupError instanceof Error
            ? backupError.message
            : String(backupError);
        logger.error({ error: reason }, "database:reset backup step failed");
        return {
          success: false,
          error: `Backup failed — reset aborted: ${reason}`,
        };
      }

      // 2. Wipe. The service re-validates the confirmation phrase itself.
      const result = getDatabaseResetService().reset({
        confirmation: validation.data.confirmation,
        backupPath,
      });

      // 3. Audit AFTER the wipe commits — audit_log is itself wiped by the
      // reset, so this is deliberately the first new row, not a pre-wipe
      // entry that the reset would immediately erase.
      if (result.success && result.data) {
        let username = `user-${auth.userId}`;
        try {
          const user = getUserRepository().findById(auth.userId);
          if (user) username = user.username;
        } catch {
          // fall back to user-{id}
        }
        try {
          getAuditService().log({
            user_id: auth.userId,
            username,
            role: auth.role,
            action: "reset",
            entity_type: "database",
            summary: `Database reset: ${result.data.totalDeleted} row(s) deleted`,
            metadata: {
              deletedRows: result.data.totalDeleted,
              backupPath,
            },
          });
        } catch {
          // Never block a completed reset on an audit-write failure.
        }
      }

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, "database:reset failed");
      return { success: false, error: errorMsg };
    }
  });

  logger.info("Database reset IPC handlers registered");
}
