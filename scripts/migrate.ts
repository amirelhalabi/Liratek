#!/usr/bin/env tsx
/**
 * Database Migration CLI
 *
 * Usage:
 *   npm run migrate              - Run all pending migrations
 *   npm run migrate status       - Show migration status
 *   npm run migrate rollback N   - Rollback to version N
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  initDatabase,
  getDatabase,
} from "../packages/core/src/db/connection.js";
import {
  runMigrations,
  getMigrationStatus,
  rollbackTo,
  getCurrentVersion,
} from "../packages/core/src/db/migrations/index.js";

const command = process.argv[2] || "up";
const arg = process.argv[3];

function resolveDbPath(): string {
  // Check for explicit env var first
  if (process.env.LIRATEK_DB_PATH) return process.env.LIRATEK_DB_PATH;
  // Read from db-path.txt
  const dbPathFile = join(
    import.meta.dirname || __dirname,
    "..",
    "db-path.txt",
  );
  if (existsSync(dbPathFile)) {
    const p = readFileSync(dbPathFile, "utf-8").trim();
    if (p && existsSync(p)) return p;
  }
  throw new Error(
    "Cannot find database. Set LIRATEK_DB_PATH or ensure db-path.txt points to a valid file.",
  );
}

async function main() {
  const dbPath = resolveDbPath();
  console.log(`📂 Using database: ${dbPath}\n`);
  const rawDb = new Database(dbPath);
  initDatabase(rawDb);
  const db = getDatabase();

  try {
    switch (command) {
      case "up":
      case "migrate":
        console.log("🚀 Running migrations...\n");
        runMigrations(db);
        break;

      case "status":
        console.log("📊 Migration Status\n");
        const status = getMigrationStatus(db);
        console.log(`Current Version: ${status.currentVersion}`);
        console.log(`Latest Version:  ${status.latestVersion}`);
        console.log(`\nApplied Migrations (${status.applied.length}):`);
        status.applied.forEach((m) => {
          console.log(`  ✅ ${m.version}. ${m.name} (${m.applied_at})`);
        });
        if (status.pending.length > 0) {
          console.log(`\nPending Migrations (${status.pending.length}):`);
          status.pending.forEach((m) => {
            console.log(`  ⏳ ${m.version}. ${m.name} - ${m.description}`);
          });
        } else {
          console.log("\n✅ Database is up to date!");
        }
        break;

      case "rollback":
        if (!arg) {
          console.error(
            "❌ Please specify target version: npm run migrate rollback N",
          );
          process.exit(1);
        }
        const targetVersion = parseInt(arg, 10);
        if (isNaN(targetVersion)) {
          console.error("❌ Invalid version number");
          process.exit(1);
        }
        console.log(`⬅️  Rolling back to version ${targetVersion}...\n`);
        rollbackTo(db, targetVersion);
        break;

      case "version":
        console.log(`Database version: ${getCurrentVersion(db)}`);
        break;

      case "help":
        console.log(`
Database Migration CLI

Commands:
  migrate, up        Run all pending migrations (default)
  status             Show current migration status
  rollback N         Rollback to version N
  version            Show current database version
  help               Show this help message

Examples:
  npm run migrate
  npm run migrate status
  npm run migrate rollback 3
        `);
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('Run "npm run migrate help" for usage');
        process.exit(1);
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
