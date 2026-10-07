# API Contracts: Email Invites for Sign-up (LIRA-267)

Every response uses the existing `{ success, data?, error? }` envelope built by `createSuccessResponse` / `createErrorResponse`.

- **Admin routes** follow the HTTP status conventions in `backend/src/api/admin.ts`.
- **Auth routes** keep the statuses that `/signup` already uses (201, 400 and 403), so current clients keep working.

Request schemas live in `packages/core/src/validators/signupInvitation.ts` and are re-exported from core's `index.ts` **and** `browser.ts` (rule 21). Frontend payload types use `z.input<typeof …>`.

## Admin (super-admin only)

Mounted under the existing `router.use(authenticateJWT, requireSuperAdmin)` in `backend/src/api/admin.ts`. Every handler runs inside `runWithoutTenant`.

### `GET /api/admin/signup-invitations`

Returns the 200 most recent invites, newest first.

```jsonc
// 200
{ "success": true, "data": {
  "emailConfigured": true,
  "invitations": [{
    "id": 12, "email": "owner@shop.com", "shopNameHint": "Cell City",
    "status": "pending",               // pending | used | expired | revoked (derived)
    "createdAt": "2026-10-07T09:00:00.000Z",
    "expiresAt": "2026-10-10T09:00:00.000Z",
    "usedAt": null, "usedByTenant": null,   // { id, slug } once used
    "revokedAt": null,
    "email": { "status": "accepted", "attempts": 1, "lastError": null, "sentAt": "…" },
    // email.status is queued | accepted | failed. The outbox states pending and sending both show as queued.
  }]
}}
```

### `POST /api/admin/signup-invitations`

- **Creates** an invite with `source: "admin"`.
- **Body** (`createSignupInvitationSchema`): `{ email: string (email, ≤254, trimmed + lowercased), shopNameHint?: string (≤100) }`
- **201:** `{ success: true, data: { invitation: <same shape as a list item> } }`
- **409:** `EMAIL_NOT_CONFIGURED` when `EMAIL_TRANSPORT=disabled`. Nothing is created.
- **409:** `EMAIL_ALREADY_HAS_SHOP` when the address is already a shop's `contact_email`. The error names the shop's slug. Nothing is created (FR-013a).
- A second pending invite to the same address is allowed.
- **400:** validation errors.
- **Side effects, in one transaction:** insert the `signup_invitations` row, insert the `email_outbox` row (`signup-invite:<id>`), and link the two. The audit log records `logAdminAction({ action: "signup_invitation.create" })` with the invite id and the email.
- The raw token is **never** in the response. It reaches people only by email.

### `POST /api/admin/signup-invitations/:id/revoke`

- **200:** `{ success: true, data: { invitation } }`. Calling it again is harmless: an already-revoked invite returns 200 unchanged.
- **409:** the invite is already used.
- **404:** unknown id.
- **Audit log:** `signup_invitation.revoke`.

### Re-sending

A re-send is not a separate route. The owner creates a new invite with `POST`; the old link keeps its own state.

## Public auth

### `POST /api/auth/signup/request` (self-serve)

- **Middleware:** a dedicated `signupRequestLimiter` (5 per hour per IP; when exceeded it returns 429 "Too many requests, please try again later", the same for any email), then `validateRequest(requestSignupLinkSchema)`.
- **Body:** `{ email: string (email, ≤254, trimmed + lowercased), turnstileToken: string (1..2048) }`.
- **Order of checks:**
  1. If self-serve is not available (email or Turnstile not configured): 200 `{ success: false, error: "Sign-up is not available right now." }`
  2. Verify Turnstile server-side (`https://challenges.cloudflare.com/turnstile/v0/siteverify` with `TURNSTILE_SECRET_KEY` and the client IP). If the token is rejected: 200 `{ success: false, error: "Please complete the check and try again." }`. If Cloudflare is unreachable or times out (5 seconds): 200 `{ success: false, error: "Please try again in a few minutes." }`. The check fails closed.
  3. Otherwise **always** return 200 `{ success: true, data: { message: "If this address can be used, we've emailed a link." } }`. Behind that response, the server sends nothing if the address already has a shop (FR-028), if the address made 3 or more requests in the last hour, or if the daily cap is reached (the cap also logs a warning). Otherwise it calls `service.create({ source: "self", invitedByUserId: null, … })`.
- **Audit log:** none, because there is no tenant or actor. A `logger.info` records the outcome with the email hashed, never the plain address.

### `POST /api/auth/signup/invite/check`

The token goes in the request body, not the URL path, so it never ends up in access logs. This route is rate-limited by the existing `signupLimiter`.

- **Body:** `{ token: string (1..200) }`
- **200 valid:** `{ success: true, data: { email, shopNameHint, expiresAt } }`
- **200 invalid:** `{ success: false, error: "This invite link is not valid. Ask for a new invite." }`
  - The same response is used for unknown, expired, used and revoked tokens (spec FR-009).
  - A token that another sign-up has claimed in the last 10 minutes also gets this response.

### `POST /api/auth/signup` (changed)

This route changes in **two stages**. The reason is that a push to `main` deploys to production, so the shared-code path must not disappear before email is proven to work there.

- **Stage A (build):** `signupSchema` accepts **exactly one** of the two fields below. Zod `.superRefine` rejects requests with both or neither.
- **Stage B (launch, FR-013):** the `inviteCode` field, the `SIGNUP_INVITE_CODE` env var and the code-path tests are deleted, and `inviteToken` becomes required. This stage is merged only after quickstart §5 step 3 has passed in production.

The fields:

- `inviteCode: string`: the existing shared-code path, Stage A only. It stays the same, except the comparison becomes constant-time.
- `inviteToken: string`: the new path. The steps are those in research R4:
  1. Claim the invite.
  2. Call `provisionTenant({ …body, contactEmail: invite.email })`. Any `contactEmail` in the body is **ignored**: the server takes the email from the invite only.
  3. On success, mark the invite used. On failure, release it.

| Case | Status | Body |
| --- | --- | --- |
| Token invalid, expired, used, revoked or claimed | 403 | `"This invite link is not valid. Ask for a new invite."` |
| Shared code sent but `SIGNUP_INVITE_CODE` unset | 403 | `"Signup is disabled on this deployment"` (unchanged) |
| Provisioning error, e.g. slug taken | 400 | Message as today. The invite is released. |
| Invite email already belongs to a shop (race past the admin check) | 400 | "This email already has a shop." Caught from the unique index. The invite is released. |
| Success | 201 | `{ tenant, loginUrl }` (unchanged) |

### `GET /api/auth/signup-status` (extended)

- **Stage A:** adds `emailInvitesEnabled`, `selfServeEnabled` (email and Turnstile both configured) and `turnstileSiteKey` (public, or null). Login.tsx shows **Sign up** (renamed from "Create your shop") when `selfServeEnabled` is true, or while the shared code still exists.
- **Stage B:** the shared-code meaning of `enabled` is removed. **Sign up** shows only when `selfServeEnabled` is true. `/signup` opened without `?invite=` shows the email request form, or "Sign-up is not available right now" when self-serve is off.

### `POST /api/admin/tenants` (changed)

The body accepts an optional `contactEmail`, which is subject to the uniqueness rule. A duplicate gets 409 `EMAIL_ALREADY_HAS_SHOP`. `AddTenantModal` gets an optional email field (FR-013b).

## Frontend adapter (web-only; each function calls `assertWebOnly`)

`frontend/src/api/backendApi.ts`:

| Function | Calls |
| --- | --- |
| `adminListSignupInvitations()` | GET admin list |
| `adminCreateSignupInvitation(input: z.input<typeof createSignupInvitationSchema>)` | POST admin create |
| `adminRevokeSignupInvitation(id: number)` | POST revoke |
| `checkSignupInvite(token: string)` | POST check |
| `requestSignupLink(input: z.input<typeof requestSignupLinkSchema>)` | POST request |
| `signup(input: z.input<typeof signupSchema>)` | POST signup. Replaces the hand-written `SignupInput` (rule 21). |

## Email template contract: `signup-invite`

| Variable | Escaped in HTML | Source |
| --- | --- | --- |
| `inviteUrl` | yes (attribute-safe) | `${SIGNUP_INVITE_BASE_URL}/signup?invite=<token>` |
| `shopNameHint` | yes | Invite. Optional; that block is hidden when empty. |
| `expiresAtText` | yes | Formatted in UTC with an explicit "UTC" suffix, so the text doesn't depend on the server's timezone (rule 27). |
| `supportEmail` | yes | `EMAIL_REPLY_TO` or `EMAIL_FROM` |

Subject: `You're invited to open your shop on LiraTek`
