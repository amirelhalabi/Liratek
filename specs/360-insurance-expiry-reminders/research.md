# Research: Insurance expiry reminders (LIRA-360)

## R1 — "Cron job" vs compute on read

- **Decision**: No scheduled job. A read computes the list from stored data each time the Dashboard loads or the TopBar bell polls.
- **Rationale**: Expiry is a pure function of `created_at` and today. The desktop app has no server to run a cron on; a backend cron would only cover web and would have to store results somewhere both apps read. The TopBar already polls (`notifications_poll_interval_ms`, default 60 s) and emits once-per-day keyed alerts for phone lines (`resaleLineAlerts.ts`), so the same mechanism delivers the bell line.
- **Alternatives**: Backend interval in `backend/src/services/*Sweep.ts` writing a notifications table — rejected: web-only, adds a table and a second truth, still needs a desktop path.

## R2 — Sale day and "today" (rule 27)

- **Decision**: Sale day = `localDayExpr("created_at")` in SQL (shifted by the request's client tz offset on web, machine zone on desktop). Today = `query.client_day ?? clientDay()` passed in. Expiry date and `days_left` computed in TypeScript by a pure helper in `utils/insuranceRenewal.ts` (calendar date arithmetic on `YYYY-MM-DD` strings, no `Date` of the host zone).
- **Rationale**: `created_at` is UTC; a 01:00 Beirut sale is the previous UTC day. Backdated sales already store their `transaction_time` in `created_at` (`COALESCE(?, …)` on insert).
- **Leap day**: 29 Feb + 1 year → 28 Feb (clamp to month end).

## R3 — Listing window

- **Decision**: Listed when `days_left <= 7` (includes all negative values). `INSURANCE_RENEWAL_WARNING_DAYS = 7` constant in the pure module. Bell "expire this week" = `0 <= days_left <= 7`; "expired" = `days_left < 0`.

## R4 — Exclusions ("refunded, voided, cancelled")

- **Decision**: Exclude `status = 'voided'`, `is_refunded = 1`, `renewal_dismissed_at IS NOT NULL`, and `direction = 'OUT'`. Also require `status = 'completed'` (a pending sale is not a sold policy).
- **Verified**: `status` only takes `pending` | `completed` (schema default `completed`) or `voided`; the Custom Services page never sends `pending`, and the Via Partner insurance path does not change `status`. So `status = 'completed'` excludes nothing real.
- **Finding**: `insuranceFulfillment.ts` documents there is NO `CANCELLED` fulfilment status; cancel and refund are the same operation and set `is_refunded`. So "cancelled" is covered by `is_refunded = 1`.

## R5 — Customer identity and phone matching

- **Decision**: Two insurances belong to the same customer when both have the same non-null `client_id`, OR both have a phone whose normalised form is equal and non-empty. Normaliser in core (`normalizePhoneForMatch`): keep digits only; strip a leading `00961` or `961`; strip one leading `0`. So `+961 70 123 456`, `70-123-456`, `0070123456`… compare equal.
- **Finding**: the only existing normaliser is `frontend/src/utils/phoneNumber.ts` (`normalizePhoneNumber` strips spaces, dashes, parens — not the country code). Core cannot import frontend; a pure core helper is added and the frontend may adopt it later (out of scope).
- **Matching where**: in TypeScript in the service/helper, not SQL — the normaliser is not expressible cleanly in SQLite and the candidate set is small. Repository returns all live insurance rows for the tenant (id, client_id, client_name, phone_number, description, insurance_type, sale_day, dismissal fields); helper groups and decides.

## R6 — Renewal rule

- **Decision**: Row A is renewed when a live row B exists with B.sale_day > A.sale_day (tie broken by B.id > A.id), same customer (R5), and (A.insurance_type IS NULL OR B.insurance_type = A.insurance_type). "Live" = passes R4 except the dismissal filter (a dismissed later sale still proves the customer renewed). A refunded/voided B never renews A, so refunding a renewal brings A back automatically.
- **Consequence**: with several old unrenewed rows of the same type for one customer, only the newest is listed (the older ones are renewed by it).

## R7 — Bell cadence

- **Decision**: TopBar adds one line per day keyed `insurance-renewals:<today>`. Bell history (`window.notificationHistory`) is memory-only and a module-level set (the LIRA-309 `resale:` pattern) is cleared by a page reload, so the last shown day is ALSO stored in `localStorage` (`liratek.insuranceRenewals.lastBellDay`, read/write wrapped in try/catch). If storage is unavailable it falls back to the in-memory set (at most one line per page load). Text with counts; omitted part when its count is 0; no line when both are 0. Click → `/` (Dashboard). If the existing `UINotification` has no click target, add an optional `href` field (check `packages/ui` notification type during build).

## R8 — Roles

- **Verified**: the only user roles are `admin` and `staff` (`validators/account.ts`), and the Credits & Stock row is not role-gated (its grid has 3 columns and 2 cards today, so the new card fills the free slot). So "everyone with Dashboard access" = admin + staff.
- **Decision**: Read — any authenticated user (Dashboard reads in `backend/src/api/dashboard.ts` have no `requireRole`; desktop handler mirrors with no role restriction beyond session). Dismiss — `requireRole(["admin","staff"])`, same as `custom-services` add on both transports. Actor username from JWT / desktop session, never from payload.

## R9 — Where the read lives

- **Decision**: On the custom-services surface (`custom-services:insurance-renewals`, `GET /api/custom-services/insurance-renewals`), not on dashboard. The Dashboard consumes it; the data owner is Custom Services. Static path declared before `/:id`.

## R10 — Module gate

- **Decision**: Frontend hides card/bell/picker when `custom_services` module is disabled (`useModules()`), same as resale alerts gate on recharge. The read itself still works if called.

## R11 — Day-one list size

- **Unknown, unmeasured**: local dev DBs (`liratek-web-dev.db`, `cedar-mobile-screenshots.db`) hold 0 insurance rows; production data was not queried. The card has its own scroll area (max ~5 rows visible) and a total count, so a long list does not stretch the `overflow-hidden` Dashboard.

## R12 — Type required in the UI, optional on the server

- **Decision**: The sale form requires `insurance_type` for Insurance. The server schema accepts it missing on an insurance sale (stored NULL = untyped, renewed by customer only) and refuses it on any other category.
- **Rationale**: Vercel (frontend) and Fly (backend) deploy separately; a browser tab opened before the deploy, or an offline-queued sale (LIRA-306) replayed after it, would otherwise have a paid sale rejected. Rule 23 holds: the key is consumed (written to the row) whenever sent.
