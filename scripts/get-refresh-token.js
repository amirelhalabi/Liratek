/**
 * Get Google OAuth Refresh Token
 *
 * This script helps you obtain a refresh token for Google Sheets API access.
 *
 * Usage:
 * 1. Run: node scripts/get-refresh-token.js
 * 2. Open the URL in your browser
 * 3. Authorize the application
 * 4. Copy the authorization code from the redirect URL
 * 5. Paste it back in the terminal
 * 6. Refresh token will be displayed and saved to .env
 */

const readline = require("readline");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

// Load environment variables
const envPath = path.join(__dirname, "..", "backend", ".env");
if (fs.existsSync(envPath)) {
  require("dotenv").config({ path: envPath });
}

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function getRefreshToken() {
  console.log("🔑 Google OAuth Refresh Token Generator\n");
  console.log(
    "This will help you get a refresh token for Google Sheets API access.\n",
  );

  // Check if credentials exist
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/oauth/callback";

  if (!clientId || !clientSecret) {
    console.log("❌ Missing OAuth credentials in backend/.env");
    console.log("\nPlease add these to your backend/.env file first:");
    console.log("   GOOGLE_CLIENT_ID=your_client_id");
    console.log("   GOOGLE_CLIENT_SECRET=your_client_secret");
    console.log("\nYou can get these from Google Cloud Console:\n");
    console.log("   1. Go to https://console.cloud.google.com/");
    console.log("   2. Select your project (or create new)");
    console.log("   3. APIs & Services → Credentials");
    console.log("   4. Create OAuth 2.0 Client ID (Web application)");
    console.log("   5. Add redirect URI: http://localhost:3000/oauth/callback");
    console.log("   6. Copy Client ID and Client Secret to .env\n");
    rl.close();
    return;
  }

  console.log("✅ Found OAuth credentials\n");

  // Create OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri,
  );

  // Generate authorization URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // Force refresh token generation
  });

  console.log("📋 Step 1: Authorize this application\n");
  console.log("Open this URL in your browser:\n");
  console.log(authUrl);
  console.log("\n");

  const code = await question(
    "📝 Step 2: Paste the authorization code here:\n> ",
  );

  try {
    console.log("\n⏳ Exchanging code for tokens...\n");

    const { tokens } = await oauth2Client.getToken(code);

    console.log("✅ Success! Here are your tokens:\n");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Access Token (expires in 1 hour):");
    console.log(tokens.access_token);
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Refresh Token (save this!):");
    console.log(tokens.refresh_token);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    if (tokens.refresh_token) {
      // Ask if user wants to save to .env
      const save = await question(
        "💾 Save refresh token to backend/.env? (y/n): ",
      );

      if (save.toLowerCase() === "y") {
        // Read existing .env
        let envContent = "";
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf8");
        }

        // Update or add refresh token
        const refreshTokenRegex = /GOOGLE_REFRESH_TOKEN=.*/;
        if (refreshTokenRegex.test(envContent)) {
          envContent = envContent.replace(
            refreshTokenRegex,
            `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`,
          );
        } else {
          envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
        }

        fs.writeFileSync(envPath, envContent);
        console.log(`\n✅ Refresh token saved to ${envPath}`);
        console.log(
          "\n🎉 You're all set! Run `node scripts/test-google-sheets.js` to verify.\n",
        );
      } else {
        console.log(
          "\n💡 Remember to save the refresh token to backend/.env as:",
        );
        console.log(`   GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
      }
    }
  } catch (error) {
    console.error("\n❌ Failed to get tokens:", error.message);
    console.error("\n💡 Make sure you copied the entire authorization code.");
  }

  rl.close();
}

getRefreshToken().catch(console.error);
