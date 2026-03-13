# Subscription Validation During Login - Implementation

## Overview

Implemented subscription plan validity checking during the login process. The system now validates both credentials (local database) and subscription status (Google Sheets) before allowing login.

---

## Architecture

### Flow:

```
User Login Attempt
    ↓
1. Validate Credentials (Local DB)
    ↓
2. If credentials valid → Check Subscription (Google Sheets)
    ↓
3. Check: API Key exists
    Check: Status is active/grace_period
    Check: Not expired/paused
    Check: Grace period not ended
    ↓
4. If valid → Allow login with JWT
   If invalid → Block login with 403 error
```

---

## Implementation Details

### 1. Backend Service: `SubscriptionValidationService.ts`

**Location:** `/backend/src/services/SubscriptionValidationService.ts`

**Function:** `validateSubscription(shopName: string)`

**Checks:**

- ✅ Shop exists in Google Sheets
- ✅ API key is configured
- ✅ Subscription status is "active" or "grace_period"
- ✅ Grace period hasn't expired (if applicable)
- ✅ Not "expired" or "paused"

**Returns:**

```typescript
interface SubscriptionStatus {
  isValid: boolean;
  shopName?: string;
  plan?: string;
  status?: string;
  error?: string;
  gracePeriodEnds?: string;
}
```

**Fail-Open Behavior:**

- If Google Sheets is unavailable, login is allowed but error is logged
- Prevents service downtime from blocking all logins

---

### 2. Login Endpoint Enhancement

**Location:** `/backend/src/api/auth.ts`

**Changes:**

- Added subscription validation after successful credential auth
- Returns 403 Forbidden if subscription is invalid
- Includes detailed error information in response

**Response Format:**

```json
{
  "success": false,
  "error": {
    "code": "SUBSCRIPTION_INVALID",
    "message": "Subscription has expired. Please contact support.",
    "details": {
      "shopName": "Test Shop",
      "plan": "professional",
      "status": "expired"
    }
  }
}
```

---

### 3. Error Code Addition

**Location:** `/packages/core/src/utils/errors.ts`

**Added:**

```typescript
SUBSCRIPTION_INVALID: "SUBSCRIPTION_INVALID";
```

---

## Login Scenarios

### ✅ Successful Login

**Conditions:**

- Valid username/password
- Shop exists in Google Sheets
- API key configured
- Status is "active"

**Result:** Login succeeds, JWT issued

---

### ❌ Login Blocked - Expired Subscription

**Conditions:**

- Valid credentials
- Status = "expired"

**Error:**

```
403 Forbidden
"Subscription has expired. Please contact support."
```

---

### ❌ Login Blocked - Paused Subscription

**Conditions:**

- Valid credentials
- Status = "paused"

**Error:**

```
403 Forbidden
"Subscription is paused. Please contact support."
```

---

### ⚠️ Login Allowed - Grace Period

**Conditions:**

- Valid credentials
- Status = "grace_period"
- Grace period end date not passed

**Result:** Login succeeds with warning logged

---

### ❌ Login Blocked - Grace Period Expired

**Conditions:**

- Valid credentials
- Status = "grace_period"
- Current date > grace_period_ends

**Error:**

```
403 Forbidden
"Grace period has ended. Please renew your subscription."
```

---

### ❌ Login Blocked - No API Key

**Conditions:**

- Valid credentials
- API key field empty in Google Sheets

**Error:**

```
403 Forbidden
"No API key configured for this shop"
```

---

### ❌ Login Blocked - Shop Not Found

**Conditions:**

- Valid credentials
- Shop name not in Google Sheets

**Error:**

```
403 Forbidden
"Shop not found in subscription system"
```

---

## Testing

### Test Cases:

1. **Active Subscription Login**

   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"...","rememberMe":false}'
   ```

   Expected: ✅ Login succeeds

2. **Expired Subscription Login**
   - Set status = "expired" in Google Sheets
   - Try login
     Expected: ❌ 403 Forbidden

3. **Grace Period Login**
   - Set status = "grace_period"
   - Set grace_period_ends = future date
   - Try login
     Expected: ✅ Login succeeds

4. **No API Key Login**
   - Clear api_key field in Google Sheets
   - Try login
     Expected: ❌ 403 Forbidden

---

## Google Sheets Configuration

### Required Columns:

| Column | Name              | Type | Required |
| ------ | ----------------- | ---- | -------- |
| A      | shop_name         | Text | ✅       |
| B      | plan              | Text | ✅       |
| C      | status            | Text | ✅       |
| D      | api_key           | Text | ✅       |
| L      | grace_period_ends | Date | ❌       |

### Valid Status Values:

- `active` - Normal operation
- `expired` - Subscription ended
- `grace_period` - Payment overdue, grace period active
- `paused` - Manually paused by admin

---

## Admin Actions

### To Block a User:

1. Open Google Sheets
2. Find client row
3. Change status to "expired" or "paused"
4. Save
5. User will be blocked on next login attempt

### To Grant Grace Period:

1. Open Google Sheets
2. Find client row
3. Change status to "grace_period"
4. Set grace_period_ends date (e.g., 7 days from now)
5. Save
6. User can still login until grace period ends

### To Renew Subscription:

1. Open Google Sheets
2. Find client row
3. Change status back to "active"
4. Clear grace_period_ends (if set)
5. Save
6. User can login normally

---

## Logging

### Successful Validation:

```json
{
  "level": "info",
  "msg": "Subscription validated during login",
  "userId": 1,
  "shopName": "Test Shop",
  "plan": "professional"
}
```

### Failed Validation:

```json
{
  "level": "warn",
  "msg": "Login blocked - subscription invalid",
  "userId": 1,
  "shopName": "Test Shop",
  "error": "Subscription has expired"
}
```

### Service Unavailable (Fail-Open):

```json
{
  "level": "error",
  "msg": "Subscription validation error - allowing login",
  "userId": 1,
  "error": "Google Sheets API error"
}
```

---

## Security Considerations

1. **API Key Validation:**
   - API key must be present in Google Sheets
   - Key format: `lsk_[32_hex_chars]`
   - Generated using crypto.randomBytes(16)

2. **Shop Name Matching:**
   - Username must match shop_name in Google Sheets
   - Case-sensitive matching

3. **Fail-Open Design:**
   - Google Sheets downtime doesn't block logins
   - Errors are logged for investigation
   - Prevents denial-of-service via Sheets API

4. **Grace Period:**
   - Allows temporary access during payment delays
   - Configurable per-client
   - Automatically expires

---

## Future Enhancements

### Phase 2+ (Not Implemented):

- [ ] API key-based authentication (instead of username/password)
- [ ] Automatic subscription expiry checking (cron job)
- [ ] Email notifications before expiry
- [ ] Payment integration (Stripe/PayPal)
- [ ] Self-service renewal from client portal
- [ ] Usage limits per plan tier
- [ ] Feature flags per plan
- [ ] Multi-shop support per account

---

## Files Modified/Created

### Created:

1. `/backend/src/services/SubscriptionValidationService.ts` - Validation logic
2. `/docs/SUBSCRIPTION_VALIDATION_IMPLEMENTATION.md` - This document

### Modified:

1. `/backend/src/api/auth.ts` - Added validation to login endpoint
2. `/packages/core/src/utils/errors.ts` - Added SUBSCRIPTION_INVALID error code

---

## Deployment Checklist

- [x] SubscriptionValidationService created
- [x] Login endpoint updated
- [x] Error code added to core
- [x] Backend builds successfully
- [x] Services restart correctly
- [ ] Test with various subscription statuses
- [ ] Test with Google Sheets downtime simulation
- [ ] Update admin documentation
- [ ] Train support team on subscription management

---

**Status:** ✅ Implementation Complete  
**Version:** 1.18.32  
**Date:** 2026-03-12  
**Author:** LiraTek Development Team
