# Contracts: Insurance expiry reminders (LIRA-360)

Both transports call the same `CustomServiceService` methods. Schemas live once in `packages/core/src/validators/customService.ts`; adapter payload types are `z.input<typeof …>` (rule 21).

## 1. Read the list

| | Desktop (IPC) | Web (REST) |
| --- | --- | --- |
| Channel / route | `custom-services:insurance-renewals` | `GET /api/custom-services/insurance-renewals?client_day=YYYY-MM-DD` (declared before `/:id`) |
| Auth | session | `authenticateJWT` (no role restriction, like `/api/dashboard/*` reads) |
| Input schema | `insuranceRenewalsQuerySchema = z.object({ client_day: isoDay.optional() })` | same |
| Service | `getInsuranceRenewals(data.client_day ?? clientDay())` | same |
| Returns (raw read shape) | `InsuranceRenewal[]` (see data-model) | same JSON array |

Adapter: `backendApi.getInsuranceRenewals({ client_day: localDay() })` via `ipcOrHttp`; exposed on `ElectronApiAdapter` and typed on `ApiAdapter`.

## 2. "Won't renew"

| | Desktop (IPC) | Web (REST) |
| --- | --- | --- |
| Channel / route | `custom-services:dismiss-insurance-renewal` | `POST /api/custom-services/insurance-renewals/:id/dismiss` |
| Auth | `requireRole(["admin","staff"])` | `authenticateJWT` → `requireRole(["admin","staff"])` |
| Input schema | `dismissInsuranceRenewalSchema = z.object({ id: z.coerce.number().int().positive() })` | same (id from path) |
| Actor | desktop session username | `req.user.username` (never from body) |
| Service | `dismissInsuranceRenewal(id, actor)` | same |
| Returns | `{ success: true }` / `{ success: false, error }` | same envelope, HTTP 200 on failure |

Errors: row not found, not an insurance, refunded/voided, already dismissed → `{ success:false, error }` with a user-readable message.

Offline: binding `custom-services:dismiss-insurance-renewal` in `offline/bindings/customServices.ts`, actor = event actor.

## 3. Create insurance sale — changed

`createCustomServiceSchema` gains `insurance_type: z.enum(INSURANCE_TYPES).optional()` plus a refinement: refused when `category !== "insurance"`. Missing on an insurance sale is accepted and stored NULL (research R12); the form makes it required. Repository INSERT writes it. Preload `data` type gains the field (rule 12). Rule 23 three-way diff required before merging.

History read (`getHistoryColumns`) adds `insurance_type`.

## 4. UI contract

- **Dashboard card** `data-testid="insurance-renewals-card"`; rows `insurance-renewal-row-<id>`; button `insurance-renewal-dismiss-<id>`; empty `insurance-renewals-empty`. Shown only when module `custom_services` is enabled.
- **Bell**: one `warning` line per day: "Insurance: {upcoming} expire this week, {expired} expired" (parts with 0 omitted), opens `/`.
- **Sale form**: `data-testid="insurance-type-select"`, visible only for the Insurance category, required.
