# Contract: enabled modules (existing route, consumed by the phone)

`GET /api/modules/enabled` — `backend/src/api/modules.ts:25`. Unchanged by this ticket; the web's
`getEnabledModules()` (`frontend/src/api/backendApi.ts:4639`) reads the same route.

**Auth**: router-level `authenticateJWT` (tenant from the token). No role check.

**Success** (HTTP 200):

```json
{
  "success": true,
  "modules": [
    { "key": "debts", "label": "Accounts", "is_enabled": 1, "...": "..." }
  ]
}
```

`modules` = rows with `is_enabled = 1` for the token's tenant, ordered by `sort_order`, filtered by plan entitlement
(`ModuleService.getEnabledModules`).

**Failure**: HTTP 500 `{ "success": false, "error": "Failed to fetch enabled modules" }`; 401 when the token is
invalid.

## What the phone relies on

- Only `success === true` and each entry's `key` (string).
- Any other shape is treated as a failure → gate stays closed (FR-005).
- A key absent from the list means "off" — including modules the shop's plan does not include.
