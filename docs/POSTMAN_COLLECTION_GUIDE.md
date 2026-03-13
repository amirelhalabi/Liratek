# Postman Collection - LiraTek Subscription Management

## Overview

This Postman collection contains all API endpoints for the LiraTek subscription management system, including:

- Client-facing APIs
- Admin APIs
- Plan enforcement tests
- Health & system endpoints

---

## Installation

### Step 1: Import Collection

1. Open Postman
2. Click **Import** (top left)
3. Select the file: `docs/Postman_Collection.json`
4. Click **Import**

### Step 2: Configure Environment Variables

The collection uses these variables (already configured):

| Variable               | Value                        | Description                    |
| ---------------------- | ---------------------------- | ------------------------------ |
| `base_url`             | `http://localhost:3000`      | Backend API URL                |
| `professional_api_key` | `lsk_test_prof_abc123xyz789` | Test Professional plan API key |
| `essentials_api_key`   | `lsk_test_ess_def456uvw012`  | Test Essentials plan API key   |

**To modify:**

1. Click on the collection name in Postman
2. Go to **Variables** tab
3. Edit values as needed

---

## Testing Guide

### 1. Test Client-Facing APIs

#### Get Available Plans

```
GET {{base_url}}/api/subscription/plans
```

- ✅ No authentication required
- ✅ Returns list of all plans with features

#### Get Current Subscription

```
GET {{base_url}}/api/subscription/current
Authorization: Bearer {{professional_api_key}}
```

- ✅ Returns current plan details
- ✅ Shows available features

#### Request Plan Change

```
POST {{base_url}}/api/subscription/change-plan
Authorization: Bearer {{essentials_api_key}}
Content-Type: application/json

{
  "new_plan": "professional"
}
```

- ⚠️ Requires admin approval in Google Sheets

---

### 2. Test Admin APIs

#### Get All Clients

```
GET {{base_url}}/api/admin/subscriptions/clients
```

- ✅ Returns list of all clients
- ✅ Shows plan, status, contact info

#### Get Specific Client

```
GET {{base_url}}/api/admin/subscriptions/clients/Test Shop Professional
```

- ✅ Returns detailed client information

#### Force Sync Client

```
POST {{base_url}}/api/admin/subscriptions/clients/Test Shop Professional/sync
```

- ✅ Manually sync client data from Google Sheets

#### Get Sync Status

```
GET {{base_url}}/api/admin/subscriptions/sync/status
```

- ✅ Shows sync service status
- ✅ Cache size, interval, running state

#### Trigger Manual Sync

```
POST {{base_url}}/api/admin/subscriptions/sync/trigger
```

- ✅ Sync all clients from Google Sheets

---

### 3. Test Plan Enforcement

#### Professional Plan Access to Exchange

```
GET {{base_url}}/api/exchange/rates
Authorization: Bearer {{professional_api_key}}
```

- ✅ Should succeed (200 OK)

#### Essentials Plan Access to Exchange

```
GET {{base_url}}/api/exchange/rates
Authorization: Bearer {{essentials_api_key}}
```

- ❌ Should fail (403 Forbidden)
- ✅ Plan restriction enforced

#### Both Plans Access to POS

```
GET {{base_url}}/api/sales
Authorization: Bearer {{professional_api_key}}
```

```
GET {{base_url}}/api/sales
Authorization: Bearer {{essentials_api_key}}
```

- ✅ Both should succeed (200 OK)
- ✅ POS is available in both plans

---

### 4. Test Error Scenarios

#### No API Key

```
GET {{base_url}}/api/subscription/current
```

- ❌ Should return 401 Unauthorized

#### Invalid API Key

```
GET {{base_url}}/api/subscription/current
Authorization: Bearer invalid_key
```

- ❌ Should return 401 Unauthorized

#### Client Not Found

```
GET {{base_url}}/api/admin/subscriptions/clients/NonExistent Shop
```

- ❌ Should return 404 Not Found

---

## Expected Responses

### Success Response (200 OK)

```json
{
  "shop_name": "Test Shop Professional",
  "plan": "professional",
  "status": "active",
  "features": [
    "pos",
    "inventory",
    "debts",
    "clients",
    "exchange",
    "expenses",
    ...
  ],
  "created_at": "2026-03-12",
  "billing_cycle": "monthly"
}
```

### Error Response (401 Unauthorized)

```json
{
  "error": "Unauthorized",
  "message": "API key required. Set LIRATEK_API_KEY in .env file."
}
```

### Error Response (403 Forbidden)

```json
{
  "error": "Forbidden",
  "message": "This feature is not available in your essentials plan.",
  "requiredPlan": "professional",
  "currentPlan": "essentials",
  "upgradeAvailable": true
}
```

### Error Response (404 Not Found)

```json
{
  "error": "Not Found",
  "message": "Client not found: NonExistent Shop"
}
```

---

## Workflow Examples

### Scenario 1: New Client Onboarding

1. Admin adds client to Google Sheets
2. Admin triggers sync: `POST /api/admin/subscriptions/sync/trigger`
3. Client receives API key
4. Client tests: `GET /api/subscription/current`
5. Client starts using the app

### Scenario 2: Plan Upgrade Request

1. Client requests upgrade: `POST /api/subscription/change-plan`
2. Admin receives request (check logs)
3. Admin updates plan in Google Sheets
4. Admin syncs client: `POST /api/admin/subscriptions/clients/:shopName/sync`
5. Client now has access to Professional features

### Scenario 3: Subscription Expiration

1. Admin sets status to "grace_period" in Google Sheets
2. Admin sets `grace_period_ends` date (7 days from now)
3. Client can still access all features
4. After grace period ends, access is denied (403)
5. Admin renews: set status back to "active"

---

## Troubleshooting

### Server Not Running

```bash
cd backend
npm start
```

### API Key Not Working

- Check API key matches Google Sheets
- Ensure sync has completed
- Check cache TTL (12 hours)

### Plan Enforcement Not Working

- Restart server to clear cache
- Check module name in middleware matches route
- Verify plan in Google Sheets

### Sync Failing

- Check Google Sheets API is enabled
- Verify service account has access to sheet
- Check sheet tab name is "Sheet1"

---

## Additional Resources

- [Subscription Management Plan](./SUBSCRIPTION_MANAGEMENT_PLAN.md)
- [Google Sheets Setup](./GOOGLE_SHEETS_SETUP.md)
- [API Documentation](../backend/README.md)

---

**Collection Version:** 1.0  
**Last Updated:** 2026-03-12  
**Compatible With:** LiraTek v1.18.32+
