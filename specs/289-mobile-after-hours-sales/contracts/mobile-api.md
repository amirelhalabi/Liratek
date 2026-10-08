# API contract — LIRA-289 mobile app

Base URL: `https://api.liratek.shop`. The phone calls it directly, not through a shop subdomain.

Every response is the IPC-style envelope `{ success, data?, error? }` with HTTP 200, except where an existing route already differs (noted below).

Every authenticated request carries these headers:

```
Authorization: Bearer <jwt>
X-Client-Day: YYYY-MM-DD           # phone's local date (rule 27)
X-Client-Tz-Offset: <minutes>      # same meaning as the web client sends
```

When a response includes `X-Renewed-Token`, the phone replaces its stored token with it, as the web does.

## New: `/api/mobile/auth`

No `authenticateJWT` on these routes. They use the existing failed-login rate limiter.

### `POST /api/mobile/auth/login`

```json
{ "shop": "cornertech", "username": "rami", "password": "…", "deviceName": "Rami's iPhone" }
```

- `shop`: a slug, matched case-insensitively. The server finds the tenant by slug and then authenticates the username **inside that tenant only**.
- Success: `{ success: true, data: { token, user: { id, username, role: "admin" }, shop: { slug, name } } }`. A session is created with `device_type: "mobile"`.
- All of these return the same `{ success:false, error:"INVALID_CREDENTIALS" }`: unknown shop, wrong username or password, deactivated user, and a shop that is not active.
- Lapsed (read-only) shops sign in and return `shop.status` so the app shows the same state as the web (spec Story 1 #8).
- Staff user with a correct password: `{ success:false, error:"ADMIN_ONLY" }`, and no session is created. This reveals the account exists only to someone who already holds valid credentials.

### `POST /api/mobile/auth/google/nonce`

- Body: `{}`.
- Returns `{ success:true, data:{ nonce } }`, single use, valid 10 min.
- This route is dropped if the PKCE fallback is chosen (research R6).

### `POST /api/mobile/auth/google`

```json
{ "idToken": "<google id token>", "nonce": "<from /nonce>", "deviceName": "…" }
```

- The server verifies:
  - the signature against Google's keys;
  - `iss`;
  - `aud` against the allow-list (`GOOGLE_CLIENT_ID` + `GOOGLE_MOBILE_CLIENT_IDS`);
  - `exp`;
  - that the nonce matches and is unused;
  - `email_verified`.
- It looks up `signin_directory` for the Google `sub`, reads each match's role, and keeps admins in active or lapsed shops.
- Exactly one match: same success shape as `/login`.
- Refusals:
  - `GOOGLE_NOT_CONNECTED`: no match. The app explains how to connect Google in web Settings.
  - `ADMIN_ONLY`: matches, but only staff.
  - `MULTIPLE_SHOPS`: admin in more than one shop. No list is returned (spec FR-025).
  - `INVALID_GOOGLE_TOKEN`: verification failed.

### `POST /api/mobile/auth/signup-link`

- Body: `{ "email": "…" }`.
- Calls the existing LIRA-278 "Create your shop by email" service unchanged, so the link opens on the web.
- Always returns `{ success:true }`, so the response never reveals whether the email is known.

### Sign out

Sign out uses the existing `POST /api/auth/logout` with the phone's bearer token, which ends only that session.

## Reused, behaviour unchanged

| Use | Route | Notes |
| --- | --- | --- |
| Record a WHISH_APP / OMT_APP transfer, Katsh / iPick voucher | `POST /api/services/transactions` | Body is `z.input<typeof createFinancialServiceSchema>`. The phone sends `provider` ∈ `WHISH_APP, OMT_APP, Katsh, iPick` and `paidByMethod` ∈ `CUSTOMER_ACCOUNT, WHISH, OMT, BINANCE`, with `clientId` when on account. **New:** optional `Idempotency-Key` header. |
| Record a repayment | `POST /api/debts/repayments` | Body is `z.input<typeof addRepaymentSchema>`. Returns **HTTP 400** on failure (existing behaviour); the phone reads the JSON body in that case too. **New:** optional `Idempotency-Key`. |
| Voucher catalog | `GET /api/mobile-service-items` | |
| Balances | `GET /api/dashboard/drawer-balances` | The phone shows `Whish_App`, `OMT_App`, `Binance`, `Katsh`, `iPick`. |
| Client search | `GET /api/clients?search=` | |
| Client debt | `GET /api/debts/clients/:clientId/total` | |
| Transactions by date | `GET /api/transactions/recent?from=&to=&…` | `from`/`to` become local-date bounds after the R2 fix. |

## New, shared with desktop

### `GET /api/closing/since-last-count?drawers=Whish_App,OMT_App,Binance,Katsh,iPick`

- Admin only.
- Returns `{ success:true, data:[{ drawer, lastCountAt, transactions:[…] }] }`. Fields are in `data-model.md`.
- IPC mirror `closing:get-since-last-count` with the same Zod schema from `packages/core/src/validators/closing.ts`.

## Idempotency header semantics

- `Idempotency-Key: <uuid>` is optional.
- The same key + user + route within 24 h:
  - replays the first response if that request finished;
  - returns `{success:false, error:"DUPLICATE_IN_PROGRESS"}` while the first request is still running.
- The phone generates one key per "Save" tap and reuses it on retries of that tap.
