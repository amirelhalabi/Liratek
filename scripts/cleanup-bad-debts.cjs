/**
 * Cleanup Script: Remove Bad Test Debts and Related Sales
 *
 * This script will:
 * 1. Find all debt entries for "amir el halabi" and "testing" clients
 * 2. Find related sales
 * 3. Delete the debt entries
 * 4. Optionally delete the sales (if they were test sales)
 * 5. Show a summary of what was deleted
 */

const Database = require("better-sqlite3");
const path = require("path");
const os = require("os");

// Determine database path based on OS
function getDatabasePath() {
  const platform = os.platform();
  let dbPath;

  if (platform === "darwin") {
    // macOS - Use the correct path from db-path.txt
    dbPath = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "liratek",
      "phone_shop.db",
    );
  } else if (platform === "win32") {
    // Windows
    dbPath = path.join(
      os.homedir(),
      "AppData",
      "Roaming",
      "liratek",
      "phone_shop.db",
    );
  } else {
    // Linux
    dbPath = path.join(os.homedir(), ".config", "liratek", "phone_shop.db");
  }

  return dbPath;
}

const dbPath = getDatabasePath();
console.log(`📍 Database path: ${dbPath}`);

try {
  // Open database
  const db = new Database(dbPath);
  console.log("✅ Database opened successfully\n");

  // Start transaction
  db.exec("BEGIN TRANSACTION");

  // Find specific bad debt entries (IDs 36 and 37)
  const badDebtIds = [36, 37];

  const debts = db
    .prepare(
      `
    SELECT id, client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_at
    FROM debt_ledger
    WHERE id IN (${badDebtIds.map(() => "?").join(",")})
  `,
    )
    .all(...badDebtIds);

  if (debts.length === 0) {
    console.log("⚠️  No bad debt entries found. Nothing to delete.");
    db.close();
    process.exit(0);
  }

  // Get clients for these debts
  const clientIds = [...new Set(debts.map((d) => d.client_id))];
  const clients = db
    .prepare(
      `
    SELECT id, full_name, phone_number 
    FROM clients 
    WHERE id IN (${clientIds.map(() => "?").join(",")})
  `,
    )
    .all(...clientIds);

  console.log("👥 Affected clients:");
  clients.forEach((client) => {
    console.log(
      `  - ${client.full_name} (ID: ${client.id}, Phone: ${client.phone_number})`,
    );
  });
  console.log("");

  console.log(`🔍 Found ${debts.length} debt entries:`);
  debts.forEach((debt) => {
    const client = clients.find((c) => c.id === debt.client_id);
    console.log(
      `  - ID: ${debt.id}, Client: ${client.full_name}, Type: ${debt.transaction_type}, Amount USD: ${debt.amount_usd}, Transaction ID: ${debt.transaction_id}`,
    );
  });
  console.log("");

  // Find related sales
  const saleIds = debts
    .filter((d) => d.transaction_type === "Sale Debt")
    .map((d) => d.transaction_id)
    .filter((id) => id !== null);
  let sales = [];

  if (saleIds.length > 0) {
    sales = db
      .prepare(
        `
      SELECT id, client_id, final_amount_usd, status, created_at
      FROM sales
      WHERE id IN (${saleIds.map(() => "?").join(",")})
    `,
      )
      .all(...saleIds);

    console.log(`📦 Found ${sales.length} related sales:`);
    sales.forEach((sale) => {
      const client = clients.find((c) => c.id === sale.client_id);
      console.log(
        `  - Sale ID: ${sale.id}, Client: ${client?.full_name || "N/A"}, Amount: $${sale.final_amount_usd}, Status: ${sale.status}`,
      );
    });
    console.log("");
  }

  // Ask for confirmation
  console.log("⚠️  WARNING: This will delete:");
  console.log(`   - ${debts.length} debt entries`);
  console.log(`   - ${sales.length} related sales`);
  console.log("");
  console.log("❓ Do you want to proceed? (yes/no)");

  // Read user input
  const readline = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  readline.question("", (answer) => {
    if (answer.toLowerCase() === "yes" || answer.toLowerCase() === "y") {
      try {
        // Delete specific bad debt entries
        const deleteDebtsStmt = db.prepare(`
          DELETE FROM debt_ledger WHERE id IN (${badDebtIds.map(() => "?").join(",")})
        `);
        const debtsResult = deleteDebtsStmt.run(...badDebtIds);
        console.log(`✅ Deleted ${debtsResult.changes} bad debt entries`);

        // Delete related sales (including sale_items)
        if (saleIds.length > 0) {
          // First delete sale_items
          const deleteSaleItemsStmt = db.prepare(`
            DELETE FROM sale_items WHERE sale_id IN (${saleIds.map(() => "?").join(",")})
          `);
          const itemsResult = deleteSaleItemsStmt.run(...saleIds);
          console.log(`✅ Deleted ${itemsResult.changes} sale items`);

          // Then delete sales
          const deleteSalesStmt = db.prepare(`
            DELETE FROM sales WHERE id IN (${saleIds.map(() => "?").join(",")})
          `);
          const salesResult = deleteSalesStmt.run(...saleIds);
          console.log(`✅ Deleted ${salesResult.changes} sales`);
        }

        // Commit transaction
        db.exec("COMMIT");
        console.log("\n🎉 Cleanup completed successfully!");
        console.log("");
        console.log("📊 Summary:");
        console.log(`   - Debt entries deleted: ${debtsResult.changes}`);
        console.log(`   - Sales deleted: ${sales.length}`);
        console.log(`   - Clients affected: ${clients.length}`);
        console.log("");
        console.log(
          "ℹ️  Note: The client records were NOT deleted, only their debts and test sales.",
        );
      } catch (error) {
        db.exec("ROLLBACK");
        console.error("❌ Error during deletion:", error.message);
        process.exit(1);
      } finally {
        db.close();
        readline.close();
      }
    } else {
      db.exec("ROLLBACK");
      db.close();
      console.log("❌ Cleanup cancelled. No changes made.");
      readline.close();
    }
  });
} catch (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}
