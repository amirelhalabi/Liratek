/**
 * Test Phase 2 Implementation
 *
 * Tests:
 * 1. Google Sheets Service
 * 2. Cache Service
 * 3. API Key Validation
 * 4. Plan Permissions
 * 5. Sync Service
 */

require("dotenv").config({ path: ".env" });
const path = require("path");
const fs = require("fs");

async function testPhase2() {
  console.log("🧪 Testing Phase 2 Implementation\n");
  console.log("=".repeat(50));

  // Test 1: Google Sheets Service
  console.log("\n1️⃣  Testing Google Sheets Service...");
  try {
    const { getGoogleSheetsService } =
      await import("../dist/services/GoogleSheetsService.js");
    const sheets = getGoogleSheetsService();
    await sheets.initialize();
    console.log("   ✅ Google Sheets Service initialized");

    const clients = await sheets.getAllClients();
    console.log(`   ✅ Retrieved ${clients.length} clients`);

    const testClient = await sheets.getClientByApiKey(
      "lsk_test_prof_abc123xyz789",
    );
    if (testClient) {
      console.log(`   ✅ Found test client: ${testClient.shop_name}`);
    } else {
      console.log(
        "   ⚠️  Test client not found (expected if using different test data)",
      );
    }
  } catch (error) {
    console.log("   ❌ Google Sheets Service failed:", error.message);
    return;
  }

  // Test 2: Cache Service
  console.log("\n2️⃣  Testing Cache Service...");
  try {
    const { getSubscriptionCache } =
      await import("../dist/services/SubscriptionCacheService.js");
    const cache = getSubscriptionCache();

    const testData = {
      shop_name: "Test Shop",
      plan: "professional",
      status: "active",
      api_key: "test_key_123",
      created_at: new Date().toISOString(),
    };

    cache.set("Test Shop", testData);
    const retrieved = cache.get("Test Shop");

    if (retrieved && retrieved.shop_name === "Test Shop") {
      console.log("   ✅ Cache Service working");
      console.log(`   ✅ TTL: ${cache.getStats().ttlHours} hours`);
    } else {
      console.log("   ❌ Cache retrieval failed");
    }
  } catch (error) {
    console.log("   ❌ Cache Service failed:", error.message);
  }

  // Test 3: Plan Permissions
  console.log("\n3️⃣  Testing Plan Permissions...");
  try {
    const { getPlanComparison } =
      await import("../dist/middleware/checkPlanPermissions.js");
    const comparison = getPlanComparison();

    console.log(
      `   ✅ Essentials plan: ${comparison.essentials.length} modules`,
    );
    console.log(
      `   ✅ Professional plan: ${comparison.professional.length} modules`,
    );

    if (comparison.professional.length > comparison.essentials.length) {
      console.log("   ✅ Plan differentiation working");
    }
  } catch (error) {
    console.log("   ❌ Plan Permissions failed:", error.message);
  }

  // Test 4: Sync Service
  console.log("\n4️⃣  Testing Sync Service...");
  try {
    const { getSubscriptionSyncService } =
      await import("../dist/services/SubscriptionSyncService.js");
    const syncService = getSubscriptionSyncService();

    const status = syncService.getStatus();
    console.log(`   ✅ Sync Service initialized`);
    console.log(`   ✅ Interval: ${status.intervalHours} hours`);
    console.log(`   ✅ Cache size: ${status.cacheSize} clients`);
  } catch (error) {
    console.log("   ❌ Sync Service failed:", error.message);
  }

  // Test 5: API Endpoints
  console.log("\n5️⃣  Testing API Endpoints...");
  console.log("   ℹ️  API endpoints will be tested via HTTP requests");
  console.log("   ℹ️  Start server with: npm start");
  console.log(
    "   ℹ️  Test with: curl http://localhost:3000/api/subscription/plans",
  );

  console.log("\n" + "=".repeat(50));
  console.log("✅ Phase 2 testing complete!\n");
  console.log("📋 Next steps:");
  console.log("   1. Start server: npm start");
  console.log(
    "   2. Test API: curl http://localhost:3000/api/subscription/plans",
  );
  console.log("   3. Test with API key:");
  console.log(
    "      curl -H 'Authorization: Bearer lsk_test_prof_abc123xyz789' \\",
  );
  console.log("           http://localhost:3000/api/subscription/current");
  console.log("");
}

testPhase2().catch(console.error);
