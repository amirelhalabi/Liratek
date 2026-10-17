/**
 * LIRA-331: the signed-in user's own preferences (today: the UI language).
 * Desktop mirror of GET /api/user-preferences/me and
 * PUT /api/user-preferences/me/language (backend/src/api/userPreferences.ts);
 * both call UserPreferencesService (rule 19) and answer the same flat
 * envelope. The user ALWAYS comes from the session, never the payload.
 */
import { ipcMain } from "electron";
import { getUserPreferencesService, isAppError } from "@liratek/core";
import { settingsLogger } from "@liratek/core";
import { requireRole, type UserRole } from "../session.js";
import { SetMyLanguageSchema, validatePayload } from "../schemas/index.js";

const TENANT_ROLES: UserRole[] = ["admin", "staff"];

function failure(error: unknown, fallback: string) {
  if (isAppError(error) && error.isOperational) {
    return { success: false, error: error.message, code: error.code };
  }
  settingsLogger.error({ error }, fallback);
  return { success: false, error: fallback, code: "INTERNAL_ERROR" };
}

export function registerUserPreferencesHandlers(): void {
  ipcMain.handle("user-preferences:get", (event) => {
    const auth = requireRole(event.sender.id, TENANT_ROLES);
    if (!auth.ok) return { success: false, error: auth.error, code: "UNAUTHORIZED" };
    try {
      return { success: true, data: getUserPreferencesService().getMine(auth.userId) };
    } catch (error) {
      return failure(error, "Failed to load your preferences");
    }
  });

  ipcMain.handle("user-preferences:set-language", (event, data: unknown) => {
    const auth = requireRole(event.sender.id, TENANT_ROLES);
    if (!auth.ok) return { success: false, error: auth.error, code: "UNAUTHORIZED" };

    const v = validatePayload(SetMyLanguageSchema, data);
    if (!v.ok) return { success: false, error: v.error, code: "VALIDATION_ERROR" };

    try {
      return {
        success: true,
        data: getUserPreferencesService().setMine(auth.userId, v.data),
      };
    } catch (error) {
      return failure(error, "Failed to save your language");
    }
  });
}
