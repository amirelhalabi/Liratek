/**
 * Shared audit logging helper for IPC handlers.
 *
 * Provides a simple `audit()` function that all handlers can call
 * after a successful mutation. Fire-and-forget — never throws.
 */

import { getAuditService, getUserRepository } from "@liratek/core";
import type { CreateAuditLogData } from "@liratek/core";
import { getSession } from "../session.js";

type AuditInput = Omit<CreateAuditLogData, "user_id" | "username" | "role"> & {
  user_id?: number;
  username?: string;
  role?: string;
};

/**
 * Log an audit entry. Resolves user info from session if not provided.
 *
 * @param webContentsId - Electron webContents ID for session lookup
 * @param data - Audit data (user_id/username/role auto-resolved if missing)
 */
export function audit(webContentsId: number, data: AuditInput): void {
  try {
    const service = getAuditService();

    let userId = data.user_id ?? 0;
    let username = data.username ?? "unknown";
    let role = data.role ?? "unknown";

    // Resolve from session if not provided
    if (!data.user_id || !data.username) {
      const session = getSession(webContentsId);
      if (session) {
        userId = session.userId;
        role = session.role;
        // Look up username
        if (!data.username) {
          try {
            const userRepo = getUserRepository();
            const user = userRepo.findById(userId);
            username = user?.username ?? `user-${userId}`;
          } catch {
            username = `user-${userId}`;
          }
        }
      }
    }

    service.log({
      ...data,
      user_id: userId,
      username,
      role,
    });
  } catch {
    // Never throw from audit — it must not break the mutation
  }
}

/**
 * Build audit data from a requireRole() result.
 */
export function auditFromAuth(
  auth: { userId?: number; role?: string },
  data: Omit<CreateAuditLogData, "user_id" | "username" | "role">,
  username?: string,
): CreateAuditLogData {
  let resolvedUsername = username ?? "unknown";
  if (!username && auth.userId) {
    try {
      const userRepo = getUserRepository();
      const user = userRepo.findById(auth.userId);
      resolvedUsername = user?.username ?? `user-${auth.userId}`;
    } catch {
      resolvedUsername = `user-${auth.userId}`;
    }
  }

  return {
    ...data,
    user_id: auth.userId ?? 0,
    username: resolvedUsername,
    role: auth.role ?? "unknown",
  };
}
