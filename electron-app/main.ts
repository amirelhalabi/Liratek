/**
 * Electron Main Process
 * Uses backend services directly (no REST API in Electron mode)
 */

import { app, BrowserWindow, ipcMain, Menu, dialog } from "electron";
import {
  ELECTRON_RENDERER_URL,
  resolveDatabasePath,
  resolveDatabaseKey,
  applySqlCipherKey,
  initDatabase as initCoreDatabase,
  getSessionRepository,
  getClosingRepository,
  runMigrations,
  logger,
} from "@liratek/core";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import os from "os";
import crypto from "crypto";
import Database from "better-sqlite3";

function loadDotEnvFile(envFilePath: string) {
  if (!fs.existsSync(envFilePath)) return;

  const content = fs.readFileSync(envFilePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();

    if (!key) continue;
    // Do not overwrite env vars already set by the shell
    if (process.env[key] == null) {
      process.env[key] = value;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let db: Database.Database;

// ── Global error handlers ──────────────────────────────────────────────────
// Catch any unhandled error in the main process before it silently crashes.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception in main process");
  dialog
    .showMessageBox({
      type: "error",
      title: "Unexpected Error",
      message: "An unexpected error occurred.",
      detail: err?.message ?? String(err),
      buttons: ["Restart App", "Quit"],
      defaultId: 0,
      cancelId: 1,
    })
    .then(({ response }) => {
      if (response === 0) {
        app.relaunch();
      }
      app.quit();
    })
    .catch(() => {
      app.quit();
    });
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection in main process");
});
// ──────────────────────────────────────────────────────────────────────────

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  // Resolve icon path - resources folder is at project root
  // In dev: __dirname = electron-app/dist, so we need ../../resources
  // In production: __dirname = dist-electron, so we need ../resources
  const iconPath = app.isPackaged
    ? path.join(__dirname, "../resources/icon.png")
    : path.join(__dirname, "../../resources/icon.png");

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.maximize();
  mainWindow.show();

  // Suppress noisy Chromium DevTools protocol errors (Autofill.enable, etc.)
  mainWindow.webContents.on("console-message", (_event, _level, message) => {
    if (message.includes("Autofill.")) {
      _event.preventDefault();
    }
  });

  // Development: Load from Vite dev server
  if (ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "bottom", activate: false });
  }
  // Production: Load from built files
  else {
    // In packaged app: dist-electron/main.js -> ../dist/index.html
    // In dev (non-packaged): dist-electron/main.js -> ../../frontend/dist/index.html
    const indexPath = app.isPackaged
      ? path.join(__dirname, "../dist/index.html")
      : path.join(__dirname, "../../frontend/dist/index.html");
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Load electron-app/.env (repo-local, gitignored)
loadDotEnvFile(path.join(__dirname, "../.env"));

app.whenReady().then(async () => {
  logger.info("App ready, creating window...");

  // Set app icon (especially important for macOS dock)
  const iconPath = app.isPackaged
    ? path.join(__dirname, "../resources/icon.png")
    : path.join(__dirname, "../../resources/icon.png");
  if (fs.existsSync(iconPath)) {
    app.dock?.setIcon(iconPath);
  }

  // Remove default menu bar in production (keep in dev for DevTools access)
  if (!ELECTRON_RENDERER_URL) {
    Menu.setApplicationMenu(null);
  }

  // Initialize database and services
  initializeBackend();

  // Register IPC handlers
  await registerHandlers();

  // Start automatic hourly backup
  startHourlyBackup();

  createWindow();

  // Auto-check for updates in background (packaged builds only, setting-gated)
  try {
    const { autoCheckForUpdates } =
      await import("./handlers/updaterHandlers.js");
    autoCheckForUpdates((key: string) => {
      try {
        const row = db
          .prepare(
            "SELECT value FROM system_settings WHERE key_name = ? LIMIT 1",
          )
          .get(key) as { value?: string } | undefined;
        return row?.value;
      } catch {
        return undefined;
      }
    });
  } catch {
    // Non-fatal: auto-check is a convenience feature
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

/**
 * Initialize database connection and schema
 */
function initializeDatabase() {
  const resolved = resolveDatabasePath();
  let dbPath = resolved.path;
  logger.info({ dbPath, source: resolved.source }, "Database path resolved");

  // Rollback support: if the DB file doesn't exist and db-path-prev.txt does,
  // restore the previous path automatically.
  const configDir = path.join(os.homedir(), "Documents", "LiraTek");
  const prevPathFile = path.join(configDir, "db-path-prev.txt");
  const dbPathFile = path.join(configDir, "db-path.txt");

  if (!fs.existsSync(dbPath) && fs.existsSync(prevPathFile)) {
    const prevPath = fs.readFileSync(prevPathFile, "utf8").trim();
    if (prevPath && fs.existsSync(prevPath)) {
      logger.warn(
        { failedPath: dbPath, restoredPath: prevPath },
        "Database not found at configured path, rolling back to previous path",
      );
      // Restore previous path
      fs.writeFileSync(dbPathFile, prevPath, "utf8");
      fs.unlinkSync(prevPathFile);
      dbPath = prevPath;
    }
  }

  const resolvedKey = resolveDatabaseKey();

  // Ensure the database directory exists (fresh installs won't have it)
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    logger.info({ dbDir }, "Created database directory");
  }

  const isNetworkPath = dbPath.startsWith("\\\\") || dbPath.startsWith("//");

  try {
    db = new Database(dbPath);

    // Apply SQLCipher key (if provided) BEFORE any other access
    const keyResult = applySqlCipherKey(db, resolvedKey.key);

    // Configure pragmas — network-specific pragmas handled by initCoreDatabase
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    if (isNetworkPath) {
      db.pragma("busy_timeout = 5000");
      db.pragma("cache_size = -2000");
      logger.info("Database configured for network share");
    }

    logger.info(
      {
        keySource: resolvedKey.source,
        applied: keyResult.applied,
        supported: keyResult.supported,
        error: keyResult.error,
      },
      "SQLCipher configuration",
    );

    if (resolvedKey.source !== "none" && !keyResult.applied) {
      throw new Error(
        keyResult.supported
          ? `SQLCipher key could not be applied: ${keyResult.error || "unknown error"}`
          : `SQLCipher is not supported by this SQLite build. Provide a SQLCipher-enabled build of SQLite/better-sqlite3. (details: ${keyResult.error || "unknown"})`,
      );
    }

    // Check if database has schema
    const tableCheck = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
      )
      .get();

    if (!tableCheck) {
      logger.info("Database has no schema, initializing from create_db.sql...");

      // In packaged app: create_db.sql is staged into dist-electron/
      // In dev: it's at electron-app/create_db.sql (one level up from dist/)
      const schemaPath = app.isPackaged
        ? path.join(__dirname, "create_db.sql")
        : path.join(__dirname, "../create_db.sql");
      if (!fs.existsSync(schemaPath)) {
        throw new Error(`Schema file not found at ${schemaPath}`);
      }

      const schema = fs.readFileSync(schemaPath, "utf8");
      db.exec(schema);

      const afterCheck = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
        )
        .get();

      if (!afterCheck) {
        throw new Error(
          "Database schema initialization failed (users table still missing)",
        );
      }

      logger.info("Database schema initialized");
    } else {
      logger.info("Database schema OK");
    }

    // Seed default admin user only when setup is NOT complete (dev mode / fresh install before wizard)
    try {
      const setupComplete = (
        db
          .prepare(
            "SELECT value FROM system_settings WHERE key_name = 'setup_complete' LIMIT 1",
          )
          .get() as { value?: string } | undefined
      )?.value;
      const userCount = (
        db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number }
      ).cnt;

      if (setupComplete !== "1" && userCount === 0) {
        logger.info(
          "Seeding default admin user (setup not complete, no users)...",
        );
        const salt = crypto.randomBytes(16).toString("hex");
        const hash = crypto
          .scryptSync("admin123", Buffer.from(salt, "hex"), 64)
          .toString("hex");
        const passwordHash = `SCRYPT:${salt}:${hash}`;

        db.prepare(
          "INSERT INTO users (username, password_hash, role, is_active) VALUES (?, ?, 'admin', 1)",
        ).run("admin", passwordHash);

        logger.info("Default admin user created (admin/admin123)");
      }
    } catch (e) {
      // Don't block app startup on seeding issues
      logger.warn({ error: e }, "Admin seed warning");
    }

    // Initialize @liratek/core database singleton with path
    initCoreDatabase(db, dbPath);

    logger.info(
      { path: dbPath, network: isNetworkPath },
      "Database connected successfully",
    );
    return db;
  } catch (error) {
    logger.error({ error }, "Database connection failed");
    throw error;
  }
}

/**
 * Initialize backend services
 * Services are imported from copied electron/services folder
 */
function initializeBackend() {
  logger.info("Initializing backend services...");

  // Initialize database
  initializeDatabase();

  // Run migrations (idempotent — skips already-applied versions)
  try {
    runMigrations(db);
    logger.info("Database migrations applied");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    logger.error(
      { error: errMsg, stack: errStack },
      "CRITICAL: Database migration failed — some features may not work correctly",
    );
    // Show user-facing warning so migration failures are not silently ignored
    dialog.showErrorBox(
      "Database Migration Warning",
      `A database migration failed. Some features (e.g. inventory) may not work correctly.\n\nError: ${errMsg}\n\nPlease contact support.`,
    );
  }

  // Services are initialized on-demand by handlers
  // Each service gets the db instance when needed

  // One-time drawer balance recalculation to fix accumulated drift.
  // TODO: Remove this block in the next release after v____.
  try {
    const closingRepo = getClosingRepository();
    const result = closingRepo.recalculateDrawerBalances();
    if (result.success) {
      logger.info("Drawer balances recalculated on startup");
    } else {
      logger.warn(
        { error: result.error },
        "Drawer balance recalculation failed",
      );
    }
  } catch (err) {
    logger.warn({ error: err }, "Drawer balance recalculation skipped");
  }

  logger.info("Backend services initialized");
}

/**
 * Get database instance
 * Used by services and handlers
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

/**
 * Register IPC handlers
 * These connect the frontend (renderer) to backend services
 */
async function registerHandlers() {
  logger.info("Registering IPC handlers...");

  try {
    // Import and register all handlers
    const authHandlers = await import("./handlers/authHandlers.js");
    const clientHandlers = await import("./handlers/clientHandlers.js");
    const currencyHandlers = await import("./handlers/currencyHandlers.js");
    const dbHandlers = await import("./handlers/dbHandlers.js");
    const debtHandlers = await import("./handlers/debtHandlers.js");
    const exchangeHandlers = await import("./handlers/exchangeHandlers.js");
    const financialHandlers = await import("./handlers/financialHandlers.js");
    const inventoryHandlers = await import("./handlers/inventoryHandlers.js");
    const maintenanceHandlers =
      await import("./handlers/maintenanceHandlers.js");
    const omtHandlers = await import("./handlers/omtHandlers.js");
    const rateHandlers = await import("./handlers/rateHandlers.js");
    const rechargeHandlers = await import("./handlers/rechargeHandlers.js");
    const reportHandlers = await import("./handlers/reportHandlers.js");
    const salesHandlers = await import("./handlers/salesHandlers.js");
    const lotoHandlers = await import("./handlers/lotoHandlers.js");
    const supplierHandlers = await import("./handlers/supplierHandlers.js");
    const updaterHandlers = await import("./handlers/updaterHandlers.js");
    const sessionHandlers = await import("./handlers/sessionHandlers.js");
    const moduleHandlers = await import("./handlers/moduleHandlers.js");
    const paymentMethodHandlers =
      await import("./handlers/paymentMethodHandlers.js");
    const whatsappHandlers = await import("./handlers/whatsappHandlers.js");
    const itemCostHandlers = await import("./handlers/itemCostHandlers.js");
    const voucherImageHandlers =
      await import("./handlers/voucherImageHandlers.js");
    const customServiceHandlers =
      await import("./handlers/customServiceHandlers.js");
    const transactionHandlers =
      await import("./handlers/transactionHandlers.js");
    const profitHandlers = await import("./handlers/profitHandlers.js");
    const setupHandlers = await import("./handlers/setupHandlers.js");
    const printHandlers = await import("./handlers/printHandlers.js");
    const voiceBotHandlers = await import("./handlers/voiceBotHandlers.js");
    const backupHandlers = await import("./handlers/backupHandlers.js");
    const mobileServiceItemHandlers =
      await import("./handlers/mobileServiceItemHandlers.js");
    const auditHandlers = await import("./handlers/auditHandlers.js");

    // Register all handlers
    authHandlers.registerAuthHandlers();
    clientHandlers.registerClientHandlers();
    currencyHandlers.registerCurrencyHandlers();
    dbHandlers.registerDatabaseHandlers();
    debtHandlers.registerDebtHandlers();
    exchangeHandlers.registerExchangeHandlers();
    financialHandlers.registerFinancialHandlers();
    inventoryHandlers.registerInventoryHandlers();
    maintenanceHandlers.registerMaintenanceHandlers();
    omtHandlers.registerOMTHandlers();
    rateHandlers.registerRateHandlers();
    rechargeHandlers.registerRechargeHandlers();
    reportHandlers.registerReportHandlers();
    salesHandlers.registerSalesHandlers();
    lotoHandlers.registerLotoHandlers();
    supplierHandlers.registerSupplierHandlers();
    updaterHandlers.registerUpdaterHandlers();
    sessionHandlers.registerSessionHandlers();
    moduleHandlers.registerModuleHandlers();
    paymentMethodHandlers.registerPaymentMethodHandlers();
    whatsappHandlers.registerWhatsAppHandlers();
    itemCostHandlers.registerItemCostHandlers();
    voucherImageHandlers.registerVoucherImageHandlers();
    customServiceHandlers.registerCustomServiceHandlers();
    transactionHandlers.registerTransactionHandlers();
    profitHandlers.registerProfitHandlers();
    setupHandlers.registerSetupHandlers();
    printHandlers.registerPrintHandlers();
    voiceBotHandlers.registerVoiceBotHandlers();
    backupHandlers.registerBackupHandlers();
    mobileServiceItemHandlers.registerMobileServiceItemHandlers();
    auditHandlers.registerAuditHandlers();

    // Windows focus fix handler
    ipcMain.on("display:fix-focus", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        win.blur();
        win.focus();
      }
    });

    logger.info("All IPC handlers registered");

    // Check and record Loto monthly fee if it's the first Monday
    lotoHandlers.checkLotoMonthlyFee();

    // Start periodic session cleanup
    startSessionCleanup();
  } catch (error) {
    logger.error({ error }, "Failed to register handlers");
    throw error;
  }
}

/**
 * Start periodic session cleanup
 * Runs every 5 minutes to clean up expired and inactive sessions
 */
function startSessionCleanup() {
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

  const cleanupSessions = () => {
    try {
      const sessionRepo = getSessionRepository();

      // Delete expired sessions (past expires_at)
      const expiredCount = sessionRepo.deleteExpiredSessions();

      // Delete inactive short sessions (30+ min of inactivity)
      const inactiveCount = sessionRepo.deleteInactiveSessions();

      const totalCleaned = expiredCount + inactiveCount;

      if (totalCleaned > 0) {
        logger.info(
          {
            totalCleaned,
            expiredCount,
            inactiveCount,
          },
          "Session cleanup completed",
        );
      }
    } catch (error) {
      logger.error({ error }, "Error during session cleanup");
    }
  };

  // Run cleanup immediately on startup
  cleanupSessions();

  // Then run every 5 minutes
  setInterval(cleanupSessions, CLEANUP_INTERVAL);

  logger.info("Periodic session cleanup started (every 5 minutes)");
}

// ── Automatic Hourly Backup ──────────────────────────────────────────────────
function startHourlyBackup() {
  const BACKUP_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

  const createHourlyBackup = async () => {
    try {
      const { ReportService } = await import("./services/ReportService.js");
      const { getSettingsService } = await import("@liratek/core");

      const service = new ReportService();
      const backupResult = await service.backupDatabase();

      if (backupResult.success) {
        // Update last_backup_at setting
        try {
          const settings = getSettingsService();
          settings.updateSetting("last_backup_at", new Date().toISOString());
        } catch {}

        logger.info(
          { path: backupResult.path },
          "Automatic hourly backup created",
        );
      } else {
        logger.error(
          { error: backupResult.error },
          "Automatic hourly backup failed",
        );
      }
    } catch (error) {
      logger.error({ error }, "Error during automatic backup");
    }
  };

  // Run backup immediately on startup (after 1 minute delay)
  setTimeout(createHourlyBackup, 60 * 1000);

  // Then run every hour
  setInterval(createHourlyBackup, BACKUP_INTERVAL);

  logger.info("Automatic hourly backup started (every 1 hour)");
}
