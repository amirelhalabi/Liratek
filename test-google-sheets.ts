import { google } from "googleapis";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, ".env") });

async function testGoogleSheets() {
  try {
    console.log("Testing Google Sheets connection...");

    const googleSheetId = process.env.GOOGLE_SHEET_ID;
    const serviceAccountPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

    console.log("GOOGLE_SHEET_ID:", googleSheetId);
    console.log("GOOGLE_SERVICE_ACCOUNT_KEY_PATH:", serviceAccountPath);

    if (!googleSheetId || !serviceAccountPath) {
      console.error("Missing Google Sheets configuration in .env file");
      return;
    }

    const fullPath = path.resolve(__dirname, serviceAccountPath);
    console.log("Full service account path:", fullPath);

    if (!fs.existsSync(fullPath)) {
      console.error(`Service account file not found at: ${fullPath}`);
      return;
    }

    const key = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    console.log("Service account file loaded successfully");

    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Test connection by reading sheet metadata
    console.log("Testing connection to Google Sheets...");
    const response = await sheets.spreadsheets.get({
      spreadsheetId: googleSheetId,
    });

    console.log("✅ Connected to Google Sheets successfully!");
    console.log("Spreadsheet title:", response.data.properties.title);

    // Test reading data
    console.log("Reading client data...");
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: googleSheetId,
      range: "Sheet1!A2:N",
    });

    const rows = dataResponse.data.values || [];
    console.log(`✅ Read ${rows.length} client rows from sheet`);

    if (rows.length > 0) {
      console.log("First client data:", rows[0]);
    }
  } catch (error: any) {
    console.error("❌ Google Sheets test failed:", error.message);
    console.error("Error details:", error);
  }
}

testGoogleSheets();
