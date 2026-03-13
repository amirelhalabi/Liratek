require("dotenv").config({ path: "backend/.env" });
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");

async function checkSheet() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!keyPath) {
    console.error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_PATH in .env");
    process.exit(1);
  }

  const fullPath = path.join(__dirname, "..", "backend", keyPath);
  const key = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  // Get spreadsheet metadata
  const response = await sheets.spreadsheets.get({
    spreadsheetId: spreadsheetId,
  });

  console.log("📊 Spreadsheet:", response.data.properties.title);
  console.log("\n📋 Tabs found:");
  response.data.sheets.forEach((sheet, i) => {
    console.log(
      `   ${i + 1}. ${sheet.properties.title} (${sheet.properties.gridRowCount} rows)`,
    );
  });
}

checkSheet().catch(console.error);
