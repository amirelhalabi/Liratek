/**
 * List all clients with their debt information
 */

const Database = require("better-sqlite3");
const path = require("path");
const os = require("os");

function getDatabasePath() {
  const platform = os.platform();
  let dbPath;

  if (platform === "darwin") {
    dbPath = path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "@liratek",
      "electron-app",
      "liratek.db",
    );
  } else if (platform === "win32") {
    dbPath = path.join(
      os.homedir(),
      "AppData",
      "Roaming",
      "@liratek",
      "electron-app",
      "liratek.db",
    );
  } else {
    dbPath = path.join(
      os.homedir(),
      ".config",
      "@liratek",
      "electron-app",
      "liratek.db",
    );
  }
  return dbPath;
}

const dbPath = getDatabasePath();
console.log(`📍 Database path: ${dbPath}\n`);

try {
  const db = new Database(dbPath);

  const clients = db
    .prepare(
      `
    SELECT 
      c.id, 
      c.full_name, 
      c.phone_number,
      COUNT(dl.id) as debt_count,
      SUM(dl.amount_usd) as total_debt_usd
    FROM clients c
    LEFT JOIN debt_ledger dl ON c.id = dl.client_id
    GROUP BY c.id
    ORDER BY c.id DESC
    LIMIT 20
  `,
    )
    .all();

  console.log("👥 Recent Clients with Debt Info:\n");
  clients.forEach((client) => {
    console.log(`ID: ${client.id}`);
    console.log(`Name: "${client.full_name}"`);
    console.log(`Phone: ${client.phone_number || "N/A"}`);
    console.log(`Debt Entries: ${client.debt_count}`);
    console.log(`Total Debt (USD): $${client.total_debt_usd || 0}`);
    console.log("---");
  });

  db.close();
} catch (error) {
  console.error("❌ Error:", error.message);
  console.log(
    "\n💡 Make sure the app is NOT running before executing this script.",
  );
  process.exit(1);
}
