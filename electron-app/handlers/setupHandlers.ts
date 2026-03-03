/**
 * Setup Wizard IPC Handlers
 *
 * Handles first-run setup: checks if setup is required, and processes
 * the complete setup payload from the wizard.
 */

import { ipcMain } from "electron";
import crypto from "crypto";
import { getDb } from "../main.js";
import { getSettingsService } from "@liratek/core";

export interface SetupPayload {
  shop_name: string;
  admin_username: string;
  admin_password: string;
  enabled_modules: string[];
  enabled_payment_methods: string[];
  session_management_enabled: boolean;
  customer_sessions_enabled: boolean;
  // Optional
  active_currencies?: string[];
  extra_users?: { username: string; password: string; role: string }[];
  whatsapp_phone?: string;
  whatsapp_api_key?: string;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .scryptSync(password, Buffer.from(salt, "hex"), 64)
    .toString("hex");
  return `SCRYPT:${salt}:${hash}`;
}

export function registerSetupHandlers() {
  // ── Check if setup is required ─────────────────────────────────────────────
  ipcMain.handle("setup:isRequired", async () => {
    try {
      const settingsService = getSettingsService();
      const isComplete = settingsService.isSetupComplete();
      return { success: true, isRequired: !isComplete };
    } catch (error) {
      return { success: false, isRequired: true, error: String(error) };
    }
  });

  // ── Complete setup wizard ──────────────────────────────────────────────────
  ipcMain.handle("setup:complete", async (_event, payload: SetupPayload) => {
    const db = getDb();

    try {
      // Validate required fields
      if (!payload.shop_name?.trim()) {
        return { success: false, error: "Shop name is required" };
      }
      if (!payload.admin_username?.trim()) {
        return { success: false, error: "Admin username is required" };
      }
      if (!payload.admin_password || payload.admin_password.length < 8) {
        return {
          success: false,
          error: "Password must be at least 8 characters",
        };
      }

      // Check password complexity
      const pwd = payload.admin_password;
      if (!/[A-Z]/.test(pwd) || !/[a-z]/.test(pwd) || !/[0-9]/.test(pwd)) {
        return {
          success: false,
          error: "Password must contain uppercase, lowercase, and a digit",
        };
      }

      // Run everything in a transaction
      db.transaction(() => {
        // 1. Create admin user (replace default seed if present)
        const existingAdmin = db
          .prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
          .get(payload.admin_username) as { id: number } | undefined;

        const passwordHash = hashPassword(payload.admin_password);

        if (existingAdmin) {
          db.prepare(
            "UPDATE users SET password_hash = ?, role = 'admin', is_active = 1 WHERE id = ?",
          ).run(passwordHash, existingAdmin.id);
        } else {
          // Remove the default admin/admin123 seed if it exists
          db.prepare(
            "DELETE FROM users WHERE username = 'admin' AND role = 'admin'",
          ).run();
          db.prepare(
            "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'admin', 1)",
          ).run(payload.admin_username, passwordHash);
        }

        // 2. Save shop name
        db.prepare(
          "INSERT OR REPLACE INTO system_settings (key_name, value) VALUES ('shop_name', ?)",
        ).run(payload.shop_name.trim());

        // 3. Apply module enabled states (mandatory modules: pos, inventory — always enabled)
        const MANDATORY_MODULES = new Set(["pos", "inventory"]);
        const enabledSet = new Set(payload.enabled_modules);

        // Get all toggleable modules
        const allModules = db
          .prepare("SELECT key FROM modules WHERE is_system = 0")
          .all() as { key: string }[];

        for (const mod of allModules) {
          const shouldEnable =
            MANDATORY_MODULES.has(mod.key) || enabledSet.has(mod.key);
          db.prepare("UPDATE modules SET is_enabled = ? WHERE key = ?").run(
            shouldEnable ? 1 : 0,
            mod.key,
          );
        }

        // 4. Apply payment method active states (mandatory: CASH only — always active)
        const MANDATORY_PMS = new Set(["CASH"]);
        const enabledPMs = new Set(payload.enabled_payment_methods);

        const allPMs = db
          .prepare("SELECT code FROM payment_methods WHERE is_system = 0")
          .all() as { code: string }[];

        for (const pm of allPMs) {
          const shouldEnable =
            MANDATORY_PMS.has(pm.code) || enabledPMs.has(pm.code);
          db.prepare(
            "UPDATE payment_methods SET is_active = ? WHERE code = ?",
          ).run(shouldEnable ? 1 : 0, pm.code);
        }

        // 5. Feature flags
        db.prepare(
          "INSERT OR REPLACE INTO system_settings (key_name, value) VALUES ('feature_session_management', ?)",
        ).run(payload.session_management_enabled ? "enabled" : "disabled");

        db.prepare(
          "INSERT OR REPLACE INTO system_settings (key_name, value) VALUES ('feature_customer_sessions', ?)",
        ).run(payload.customer_sessions_enabled ? "enabled" : "disabled");

        // 6. Active currencies (optional — skip if not provided)
        if (payload.active_currencies && payload.active_currencies.length > 0) {
          const allCurrencies = db
            .prepare("SELECT code FROM currencies")
            .all() as { code: string }[];
          const activeCodes = new Set(payload.active_currencies);

          for (const cur of allCurrencies) {
            db.prepare(
              "UPDATE currencies SET is_active = ? WHERE code = ?",
            ).run(activeCodes.has(cur.code) ? 1 : 0, cur.code);
          }
        }

        // 7. Extra users (optional)
        if (payload.extra_users && payload.extra_users.length > 0) {
          for (const u of payload.extra_users) {
            if (!u.username?.trim() || !u.password) continue;
            const existingUser = db
              .prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
              .get(u.username) as { id: number } | undefined;
            if (!existingUser) {
              db.prepare(
                "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)",
              ).run(
                u.username.trim(),
                hashPassword(u.password),
                u.role || "staff",
              );
            }
          }
        }

        // 8. WhatsApp config (optional)
        if (payload.whatsapp_phone) {
          db.prepare(
            "INSERT OR REPLACE INTO system_settings (key_name, value) VALUES ('whatsapp_phone', ?)",
          ).run(payload.whatsapp_phone);
        }
        if (payload.whatsapp_api_key) {
          db.prepare(
            "INSERT OR REPLACE INTO system_settings (key_name, value) VALUES ('whatsapp_api_key', ?)",
          ).run(payload.whatsapp_api_key);
        }

        // 9. Mark setup complete — LAST step
        db.prepare(
          "INSERT OR REPLACE INTO system_settings (key_name, value) VALUES ('setup_complete', '1')",
        ).run();
      })();

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ── Reset setup (Danger Zone) ──────────────────────────────────────────────
  ipcMain.handle("setup:reset", async () => {
    try {
      const settingsService = getSettingsService();
      settingsService.resetSetup();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}
