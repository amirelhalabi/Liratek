import Database from "better-sqlite3";
import { getClosingRepository, initDatabase } from "@liratek/core";
import { resolveDatabasePath } from "@liratek/core";

const dbPathInfo = resolveDatabasePath();
console.log(`Using database: ${dbPathInfo.path} (${dbPathInfo.source})`);

console.log("Initializing database...");
try {
  const db = new Database(dbPathInfo.path);
  initDatabase(db);
  console.log("✅ Database initialized");
} catch (error) {
  console.error(
    "❌ Database init error:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}

console.log("\nRecalculating drawer balances from payments journal...");

try {
  const closingRepo = getClosingRepository();
  const result = closingRepo.recalculateDrawerBalances();

  if (result.success) {
    console.log("✅ Drawer balances recalculated successfully!");
  } else {
    console.error("❌ Failed to recalculate:", result.error);
    process.exit(1);
  }

  // Show current balances
  const balances = closingRepo.getSystemExpectedBalancesDynamic();
  console.log("\nCurrent drawer balances:");
  for (const [drawer, currencies] of Object.entries(balances)) {
    console.log(`\n${drawer}:`);
    for (const [currency, balance] of Object.entries(currencies)) {
      console.log(`  ${currency}: ${balance.toFixed(2)}`);
    }
  }
} catch (error) {
  console.error("❌ Error:", error instanceof Error ? error.message : error);
  process.exit(1);
}
