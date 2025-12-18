import path from "path";
import Database from "better-sqlite3";

/**
 * One-time migration script to add the 'drawer_name' column to the 'sales' table.
 * This script is idempotent and safe to run multiple times.
 */

console.log("🚀 Starting drawer migration script...");

// --- Database Path ---
// As determined from other project scripts (e.g., reset-sales-debt.js)
const dbDir = path.join(
  process.env.HOME,
  "Library",
  "Application Support",
  "liratek",
);
const dbPath = path.join(dbDir, "phone_shop.db");

console.log(`📁 Using database at: ${dbPath}`);

try {
  // --- Connect to the database ---
  const db = new Database(dbPath);
  console.log("✅ Connected to database.");

  // --- Check if the column already exists ---
  const columns = db.pragma("table_info(sales)");
  const columnExists = columns.some((col) => col.name === "drawer_name");

  if (columnExists) {
    console.log(
      '✅ Column "drawer_name" already exists in "sales" table. No action needed.',
    );
    db.close();
    process.exit(0);
  }

  // --- Add the column if it doesn't exist ---
  console.log('🔧 Column "drawer_name" not found. Adding it now...');

  const alterStmt = db.prepare(`
        ALTER TABLE sales 
        ADD COLUMN drawer_name TEXT NOT NULL DEFAULT 'General_Drawer_B'
    `);

  alterStmt.run();

  console.log(
    '✅ Successfully added "drawer_name" column to the "sales" table.',
  );

  // --- Verify the change ---
  const newColumns = db.pragma("table_info(sales)");
  const newColumn = newColumns.find((col) => col.name === "drawer_name");
  if (newColumn) {
    console.log(`✔️ Verification successful. New column details:`, newColumn);
  } else {
    throw new Error("Verification failed. Column was not added.");
  }

  db.close();
  console.log("✨ Migration completed successfully!");
} catch (error) {
  console.error("❌ Migration failed:", error.message);
  process.exit(1);
}
