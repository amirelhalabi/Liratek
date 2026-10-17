# Contract: REST and device surfaces for the free trial (LIRA-332)

There are no IPC channels. The standalone desktop app is not affected (FR-021), and the paired-PC side uses the existing device-key routes.

## 1. `GET /api/subscription/status` (JWT, any shop role): extended

The response adds the fields marked NEW. Existing fields keep their meaning, except `canWrite`, which is now also `false` for `trial_ended`.

```jsonc
{
  "success": true,
  "data": {
    "status": "active",            // unchanged column value ('active' throughout a trial)
    "standing": "trial",           // NEW: 'trial' | 'trial_ended' | 'active' | 'grace' | 'read_only'
    "plan": "standard",
    "canWrite": true,              // false for read_only AND trial_ended
    "currentPeriodEnd": null,
    "graceEndsAt": null,
    "entitledModules": null,
    "trial": {                     // NEW: null unless standing is trial / trial_ended
      "endsAt": "2026-10-31T22:00:00.000Z",
      "lastDay": "2026-11-01",
      "daysLeft": 12,
      "endsSoon": false,
      "ended": false
    },
    "shop": { "name": "Abou Ali Phones", "address": "abouali.liratek.shop" } // NEW
  }
}
```

- Both hand-built fallbacks (platform user, no row) return `standing: "active"`, `trial: null`, `shop: null`.
- `trial` is computed on the server by `trialView()` at request time. Clients render it and never re-derive it (rule 14, US4-4).

## 2. `GET /api/subscription/by-key` (desktop licence): must NOT change

It returns today's shape. `standing`, `trial` and `shop` are **removed** (`toDesktopView`), so `licenseSync` can never store or act on a trial (FR-021). A guard test pins this.

## 3. Refusal envelope for any write while `trial_ended`

From `requireOpenTrial` (global, mounted before `requireWritableSubscription`):

```http
HTTP/1.1 200 OK
{ "success": false,
  "error": "Your free trial has ended. Contact LiraTek on WhatsApp to activate.",
  "code": "TRIAL_ENDED" }
```

- **Applies to**: POST/PUT/PATCH/DELETE with a tenant JWT, except the paths in `TRIAL_ENDED_ALLOWED_WRITES` (research R6, finalised in T028).
- **Never applies to**:
  - GET/HEAD/OPTIONS;
  - requests with no tenant (public, platform user);
  - device-key requests.
- **Fails open**: no row, or a thrown lookup, lets the write through.
- **Wording (FR-011)**: never "payment overdue", "lapsed" or "read-only".
- **Other places that refuse with the same code and wording**:
  - `UserInvitationService` check/accept for a trial-ended shop (code stays `SHOP_NOT_ACTIVE` for compatibility, with the trial wording);
  - `requireWritableSubscription`, as a fallback when `standing === "trial_ended"`.

## 4. Owner routes (`/api/admin`, router-level `authenticateJWT` + `requireSuperAdmin`)

These follow the admin router's existing error style (HTTP 4xx with `createErrorResponse`) so they match their neighbours. The admin adapter functions already branch on `success`.

### `GET /api/admin/subscriptions`: extended

Each row in `subscriptions[]` gains `standing` and `trial` (the same `TrialView`), computed by the service, plus `tenant_created_at` (FR-015).

### `POST /api/admin/subscriptions/:tenantId/activate`: NEW

- **Body**: `activateSubscriptionSchema`, `{ "until": "2027-10-31" | null }`.
- **200**: `{ success: true, data: { subscription: <status view> } }`
- **400** `VALIDATION_ERROR`: bad id or date, or `until` already over (`endOfShopDay(until) <= now`).
- **404** `NOT_FOUND`: no subscription row.
- **Effect**: one update. `status='active'`, `current_period_end = until ? endOfShopDay(until) : NULL`, and `grace_ends_at`, `trial_started_at`, `trial_ends_at` all NULL. `tenants.status` is untouched.
- **Side effects**:
  - `logAdminAction(action:"activate_subscription")` with old and new values;
  - `scheduleOfflineRound(tenantId)`, so held PC events book (research R8).

### `POST /api/admin/subscriptions/:tenantId/extend-trial`: NEW

- **Body**: `extendTrialSchema`, `{ "lastDay": "2026-11-15" }`.
- **200**: `{ success: true, data: { subscription } }`
- **400** `VALIDATION_ERROR`:
  - "Choose a date in the future" when `endOfShopDay(lastDay) <= now`;
  - "This shop pays; use Activate subscription" when the row is grace, read-only, or active with a period end.
- **404** `NOT_FOUND`.
- **Effect**: `trial_ends_at = endOfShopDay(lastDay)`. If `trial_started_at` is NULL it is set to now.
- **Side effects**: `logAdminAction(action:"extend_trial")` and `scheduleOfflineRound(tenantId)`.

### `GET /api/admin/subscriptions/:tenantId/history`: NEW

- **200**: `{ success: true, data: { entries: [{ at, actor, action, oldValues, newValues }] } }`
- Reads platform audit rows where `entity_type='subscription'` and the target tenant matches, newest first, limit 50.
- The SQL lives in `AuditRepository`, the policy in `AuditService` (rule 13).

### Unchanged

- `PATCH /api/admin/subscriptions/:tenantId` (legacy `periodEnd` / `entitledModules` / `licenseKey`). `markPaid` additionally clears the two trial columns, so a "record payment" on a trial shop can never leave it reading as trial-ended.
- `PATCH /api/admin/tenants/:id` (suspend/activate, abuse) is unchanged (FR-016).

## 5. Sign-up routes (public): behaviour change only

| Route | Change |
| --- | --- |
| `POST /api/auth/signup` (invite link, `source` self or owner-sent) | `provisionTenant({..., trial: { source: "invite_link" }})` |
| `POST /api/auth/signup` with `googleTicket` (`googleSignup.ts`) | `provisionTenant({..., trial: { source: "google" }})`, plus a signup audit row with `via:"google"` if absent |
| `POST /api/admin/tenants` | unchanged: no `trial` means a paying shop (FR-004) |

The request and response shapes are unchanged. No payment field exists or is added (FR-003).

## 6. Paired PC (device key): extended

### `POST /api/offline/checkin`: response `data` gains

```jsonc
"trial": { "standing": "trial_ended", "endsAt": "2026-10-31T22:00:00.000Z" } // or null
```

`null` when the shop is not on a trial or the lookup fails (fail open).

### `POST /api/offline/events`: unchanged contract

Events are stored as today. In the merge round, a head event whose `corrected_at ?? occurred_at >= trial_ends_at` while the trial is ended **waits**: it is not booked or refused, and it stays `received`. It books on the first round after Activate or Extend. Pre-end events book as normal. The default is pending owner decision D-332-A.

### PC recorder (`electron-app/offline/recorder.ts`), offline mode

`offline`/`checkpoint`-class channels return:

```json
{ "success": false, "code": "TRIAL_ENDED", "error": "Your free trial has ended. Contact LiraTek on WhatsApp to activate." }
```

This happens when the stored checkin `trial.standing === "trial_ended"`, or when `trial.endsAt <= Date.now()`. Read and `local` channels still run. With no stored trial, the channels are allowed.
