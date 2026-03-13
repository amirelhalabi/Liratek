/**
 * Test Google Sheets Connection
 *
 * Run with: node scripts/test-google-sheets.cjs
 */

require("dotenv").config({ path: ".env" });
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");

async function testConnection() {
  console.log("🔍 Testing Google Sheets Connection...\n");

  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!keyPath || !spreadsheetId) {
    console.error("❌ Missing environment variables:");
    if (!keyPath) console.error("   - GOOGLE_SERVICE_ACCOUNT_KEY_PATH");
    if (!spreadsheetId) console.error("   - GOOGLE_SHEET_ID");
    console.error("\n📝 Please check your backend/.env file");
    process.exit(1);
  }

  const fullPath = path.join(__dirname, "..", keyPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Service account key file not found at: ${fullPath}`);
    process.exit(1);
  }

  try {
    console.log("📊 Reading from Google Sheets...");

    const key = JSON.parse(fs.readFileSync(fullPath, "utf8"));

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Test reading data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: "Sheet1!A2:N10",
    });

    const rows = response.data.values;

    console.log("✅ Connected to Google Sheets");
    console.log(`✅ Found sheet with ${rows ? rows.length : 0} clients\n`);

    // Get headers
    const headersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: "Sheet1!A1:N1",
    });
    const headers = headersResponse.data.values[0] || [];

    console.log("📋 Columns found:");
    headers.forEach((header, i) => {
      console.log(`   ${String.fromCharCode(65 + i)}. ${header}`);
    });

    if (rows && rows.length > 0) {
      console.log("\n📝 Sample data (first client):");
      const firstClient = rows[0];
      headers.forEach((header, i) => {
        const value = firstClient[i] || "(empty)";
        console.log(`   ${header}: ${value}`);
      });
    } else {
      console.log("\n⚠️  No client data found in sheet");
      console.log("💡 Add test data starting from row 2");
    }

    console.log("\n✅ Test successful!");
    console.log("\n🎉 Google Sheets is ready to use!");
    console.log("\nNext steps:");
    console.log("1. Verify the data looks correct");
    console.log("2. Proceed to Phase 2: Backend Implementation");
  } catch (error) {
    console.error("\n❌ Test failed!");
    console.error("Error:", error.message);
    process.exit(1);
  }
}

testConnection();
