#!/usr/bin/env node

/**
 * Reset Sales & Debts Script
 *
 * This script safely clears all sales, sales items, and debt records
 * while preserving customers, products, and other data.
 *
 * It creates a backup before deletion.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database path
const dbDir = path.join(
  process.env.HOME,
  "Library",
  "Application Support",
  "liratek",
);
const dbPath = path.join(dbDir, "phone_shop.db");
const backupPath = path.join(dbDir, "phone_shop.db.backup");

console.log("🔄 Reset Sales & Debts Script\n");
console.log(`📁 Database: ${dbPath}\n`);

// Check if database exists
if (!fs.existsSync(dbPath)) {
  console.error("❌ Database not found at:", dbPath);
  console.error("Please run the app first to create the database.");
  process.exit(1);
}

try {
  // Create backup
  console.log("💾 Creating backup...");
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath); // Remove old backup
  }
  fs.copyFileSync(dbPath, backupPath);
  console.log("✅ Backup created:", backupPath);
  console.log("");

  // Open database
  const db = new Database(dbPath);

  // Disable foreign key constraints temporarily
  db.pragma("foreign_keys = OFF");

  console.log("🗑️  Deleting records...\n");

  // Get row counts before deletion
  const salesBefore = db.prepare("SELECT COUNT(*) as count FROM sales").get();
  const saleItemsBefore = db
    .prepare("SELECT COUNT(*) as count FROM sale_items")
    .get();
  const debtBefore = db
    .prepare("SELECT COUNT(*) as count FROM debt_ledger")
    .get();

  console.log(`  Sales records:      ${salesBefore.count}`);
  console.log(`  Sale items:         ${saleItemsBefore.count}`);
  console.log(`  Debt ledger:        ${debtBefore.count}`);
  console.log("");

  // Delete records (order matters with FK constraints)
  // Delete sale items first (references sales)
  const saleItemsDeleted = db.prepare("DELETE FROM sale_items").run().changes;
  // Delete sales
  const salesDeleted = db.prepare("DELETE FROM sales").run().changes;
  // Delete debts
  const debtsDeleted = db.prepare("DELETE FROM debt_ledger").run().changes;

  // Re-enable foreign key constraints
  db.pragma("foreign_keys = ON");

  console.log("🗑️  Deleted:\n");
  console.log(`  Sales:              ${salesDeleted} records`);
  console.log(`  Sale items:         ${saleItemsDeleted} records`);
  console.log(`  Debt ledger:        ${debtsDeleted} records`);
  console.log("");

  // Reset auto-increment sequences
  console.log("🔧 Resetting sequences...\n");
  try {
    db.pragma("foreign_keys = OFF");
    db.prepare(
      'DELETE FROM sqlite_sequence WHERE name IN ("sales", "sale_items", "debt_ledger")',
    ).run();
    db.pragma("foreign_keys = ON");
    console.log("✅ Sequences reset\n");
  } catch (e) {
    console.log("⚠️  Could not reset sequences (may not exist)\n");
  }

  // Verify deletion
  const salesAfter = db.prepare("SELECT COUNT(*) as count FROM sales").get();
  const saleItemsAfter = db
    .prepare("SELECT COUNT(*) as count FROM sale_items")
    .get();
  const debtAfter = db
    .prepare("SELECT COUNT(*) as count FROM debt_ledger")
    .get();

  console.log("✅ Verification:\n");
  console.log(
    `  Sales records:      ${salesAfter.count} (was ${salesBefore.count})`,
  );
  console.log(
    `  Sale items:         ${saleItemsAfter.count} (was ${saleItemsBefore.count})`,
  );
  console.log(
    `  Debt ledger:        ${debtAfter.count} (was ${debtBefore.count})`,
  );
  console.log("");

  // Check preserved data
  const clientCount = db.prepare("SELECT COUNT(*) as count FROM clients").get();
  const productCount = db
    .prepare("SELECT COUNT(*) as count FROM products")
    .get();
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();

  console.log("✅ Preserved data:\n");
  console.log(`  Clients:            ${clientCount.count}`);
  console.log(`  Products:           ${productCount.count}`);
  console.log(`  Users:              ${userCount.count}`);
  console.log("");

  db.close();

  console.log("✨ Reset completed successfully!");
  console.log("");
  console.log("📝 Summary:");
  console.log(`  • ${salesDeleted} sales deleted`);
  console.log(`  • ${saleItemsDeleted} sale items deleted`);
  console.log(`  • ${debtsDeleted} debt records deleted`);
  console.log(`  • Backup saved to: ${path.basename(backupPath)}`);
  console.log(`  • All customers and products preserved`);
  console.log("");
  console.log("🚀 You can now run: npm run dev");
  console.log("");
} catch (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}
