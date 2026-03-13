/**
 * Generate API Key for Client
 *
 * Usage: node scripts/generate-api-key.js [shop_name]
 *
 * Generates a secure API key in format: lsk_[random_32_chars]
 */

const crypto = require("crypto");

function generateApiKey(shopName) {
  // Generate random 16 bytes (32 hex chars)
  const randomPart = crypto.randomBytes(16).toString("hex");

  // Create API key with shop name prefix
  const apiKey = `lsk_${randomPart}`;

  return {
    shop_name: shopName || "Unknown",
    api_key: apiKey,
    generated_at: new Date().toISOString(),
  };
}

// CLI usage
const shopName = process.argv[2];

if (!shopName) {
  console.log("❌ Please provide a shop name");
  console.log("\nUsage: node scripts/generate-api-key.js [shop_name]");
  console.log('\nExample: node scripts/generate-api-key.js "Abu Hassan Store"');
  process.exit(1);
}

const result = generateApiKey(shopName);

console.log("\n🔑 API Key Generated\n");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`Shop Name:     ${result.shop_name}`);
console.log(`API Key:       ${result.api_key}`);
console.log(`Generated:     ${result.generated_at}`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

console.log("📝 Add this to your Google Sheet:\n");
console.log(`Row Data:`);
console.log(`  A (shop_name):        ${result.shop_name}`);
console.log(`  B (plan):             professional`);
console.log(`  C (status):           active`);
console.log(`  D (api_key):          ${result.api_key}`);
console.log(`  E (huggingface_api):  [leave empty or add key]`);
console.log(`  F (contact_email):    [client email]`);
console.log(`  G (contact_phone):    [client phone]`);
console.log(
  `  H (created_at):       ${new Date().toISOString().split("T")[0]}`,
);
console.log(`  I (expires_at):       [leave empty for indefinite]`);
console.log(`  J (last_login_at):    [leave empty]`);
console.log(`  K (last_synced_at):   [leave empty]`);
console.log(`  L (grace_period_ends): [leave empty]`);
console.log(`  M (billing_cycle):    monthly`);
console.log(`  N (notes):            [any internal notes]`);
console.log("");

console.log("💡 After adding to sheet:");
console.log("   1. Save the Google Sheet");
console.log("   2. Go to admin panel: http://localhost:5173/#/admin");
console.log('   3. Click "Sync Now" button');
console.log("   4. Client will appear in the list");
console.log("   5. Give the API key to the client for their .env file");
console.log("");
