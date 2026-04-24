/**
 * Setup Wizard IPC Handlers
 *
 * Handles first-run setup: checks if setup is required, and processes
 * the complete setup payload from the wizard.
 */

import { ipcMain, app } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { getDb } from "../main.js";
import { getSettingsService, logger } from "@liratek/core";

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

        const allPMs = db.prepare("SELECT code FROM payment_methods").all() as {
          code: string;
        }[];

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

  // ── Detect existing LiraTek databases on network volumes ──────────────────
  ipcMain.handle("setup:detectNetworkDb", async () => {
    try {
      const esmRequire = createRequire(import.meta.url);
      const Database = esmRequire(
        "better-sqlite3",
      ) as typeof import("better-sqlite3");

      const databases: Array<{ path: string; shopName: string }> = [];

      if (process.platform === "darwin") {
        const volumesDir = "/Volumes";
        if (!fs.existsSync(volumesDir)) {
          return { success: true, databases: [] };
        }

        const volumes = fs.readdirSync(volumesDir);
        const DB_PATTERNS = [
          "Library/Application Support/liratek/phone_shop.db",
          "Documents/LiraTek/liratek.db",
        ];

        for (const vol of volumes) {
          // Skip local disk
          if (vol === "Macintosh HD" || vol === "Macintosh HD - Data") continue;

          for (const pattern of DB_PATTERNS) {
            const dbPath = path.join(volumesDir, vol, pattern);
            try {
              if (!fs.existsSync(dbPath)) continue;

              const db = new Database(dbPath, { readonly: true });
              try {
                const setupRow = db
                  .prepare(
                    "SELECT value FROM system_settings WHERE key_name = 'setup_complete'",
                  )
                  .get() as { value: string } | undefined;
                if (setupRow?.value !== "1") continue;

                const nameRow = db
                  .prepare(
                    "SELECT value FROM system_settings WHERE key_name = 'shop_name'",
                  )
                  .get() as { value: string } | undefined;

                databases.push({
                  path: dbPath,
                  shopName: nameRow?.value || "Unknown Shop",
                });
              } finally {
                db.close();
              }
            } catch {
              // Skip inaccessible or invalid DBs
            }
          }
        }
      }

      logger.info(
        { count: databases.length },
        "Network DB detection completed",
      );
      return { success: true, databases };
    } catch (error) {
      logger.error({ error }, "setup:detectNetworkDb failed");
      return {
        success: false,
        databases: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ── Join an existing shop (secondary laptop) ──────────────────────────────
  ipcMain.handle(
    "setup:joinExistingShop",
    async (
      _event,
      payload: {
        dbPath: string;
        users: Array<{ username: string; password: string; role: string }>;
      },
    ) => {
      try {
        const esmRequire = createRequire(import.meta.url);
        const Database = esmRequire(
          "better-sqlite3",
        ) as typeof import("better-sqlite3");

        // Validate DB exists
        if (!fs.existsSync(payload.dbPath)) {
          return { success: false, error: "Database file not found" };
        }

        // Open the remote DB and verify it's a valid LiraTek DB
        const db = new Database(payload.dbPath);
        let shopName = "Unknown Shop";

        try {
          const setupRow = db
            .prepare(
              "SELECT value FROM system_settings WHERE key_name = 'setup_complete'",
            )
            .get() as { value: string } | undefined;

          if (setupRow?.value !== "1") {
            return {
              success: false,
              error: "Database has not completed setup",
            };
          }

          const nameRow = db
            .prepare(
              "SELECT value FROM system_settings WHERE key_name = 'shop_name'",
            )
            .get() as { value: string } | undefined;
          shopName = nameRow?.value || "Unknown Shop";

          // Add users in a transaction
          if (payload.users.length > 0) {
            db.transaction(() => {
              for (const u of payload.users) {
                if (!u.username?.trim() || !u.password) continue;

                const existing = db
                  .prepare("SELECT id FROM users WHERE username = ? LIMIT 1")
                  .get(u.username.trim()) as { id: number } | undefined;

                if (!existing) {
                  db.prepare(
                    "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, ?, 1)",
                  ).run(
                    u.username.trim(),
                    hashPassword(u.password),
                    u.role || "staff",
                  );
                }
              }
            })();
          }
        } finally {
          db.close();
        }

        // Write db-path.txt so the app uses this DB on next launch
        const configDir = path.join(os.homedir(), "Documents", "LiraTek");
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(
          path.join(configDir, "db-path.txt"),
          payload.dbPath,
          "utf8",
        );

        logger.info(
          { dbPath: payload.dbPath, shopName, users: payload.users.length },
          "Joined existing shop",
        );

        return { success: true, requiresRestart: true, shopName };
      } catch (error) {
        logger.error({ error }, "setup:joinExistingShop failed");
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  // ── Browse for database file (native file dialog) ─────────────────────────
  ipcMain.handle("setup:browseForDatabase", async () => {
    try {
      const { dialog } = await import("electron");
      const result = await dialog.showOpenDialog({
        title: "Select LiraTek Database",
        filters: [{ name: "Database", extensions: ["db", "sqlite"] }],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      // Verify it's a valid LiraTek DB
      const dbPath = result.filePaths[0];
      const esmRequire = createRequire(import.meta.url);
      const Database = esmRequire(
        "better-sqlite3",
      ) as typeof import("better-sqlite3");

      const db = new Database(dbPath, { readonly: true });
      try {
        const setupRow = db
          .prepare(
            "SELECT value FROM system_settings WHERE key_name = 'setup_complete'",
          )
          .get() as { value: string } | undefined;

        if (setupRow?.value !== "1") {
          return {
            success: false,
            error: "This database has not completed initial setup",
          };
        }

        const nameRow = db
          .prepare(
            "SELECT value FROM system_settings WHERE key_name = 'shop_name'",
          )
          .get() as { value: string } | undefined;

        return {
          success: true,
          path: dbPath,
          shopName: nameRow?.value || "Unknown Shop",
        };
      } finally {
        db.close();
      }
    } catch (error) {
      logger.error({ error }, "setup:browseForDatabase failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ── Relaunch the app (after joining an existing shop) ─────────────────────
  ipcMain.handle("setup:relaunch", async () => {
    app.relaunch();
    app.exit(0);
  });
}
