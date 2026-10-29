# Data model: Insurance expiry reminders (LIRA-360)

## `custom_services` — new columns (migration v227)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `insurance_type` | TEXT | yes | One of `INSURANCE_TYPES`. Required by the sale form when `category = 'insurance'`; the server accepts it missing (stored NULL = untyped, see research R12) and refuses it on any other category. NULL for every other category and for insurance sold before v227. Allowed values are enforced by the Zod schema. |
| `renewal_dismissed_at` | TEXT | yes | UTC timestamp when staff clicked "Won't renew". NULL = not dismissed. |
| `renewal_dismissed_by` | TEXT | yes | Username of the actor (from session/JWT). |

`custom_services` has no `updated_at` column today (it has `edited_at`); dismiss does not touch `edited_at` (that tracks detail edits). Adding `updated_at` to this legacy table is out of scope. `down()` drops the three columns (table-rebuild pattern used by other column-drop migrations). `electron-app/create_db.sql` gets the same three columns.

## `INSURANCE_TYPES` (core constant, pure module)

| Code | English label (owner-approved 2026-10-29) | Arabic label |
| --- | --- | --- |
| `COMPULSORY` | Compulsory | إلزامي |
| `THIRD_PARTY` | Third party | ضد الغير |
| `DOMESTIC_WORKER` | Domestic worker | عاملة منزلية |
| `ALL_RISK` | All risk | شامل |
| `LIFE` | Life | حياة |

Labels live in frontend locale files; the stored value is the code.

## Insurance renewal (derived, not stored)

```ts
interface InsuranceRenewal {
  id: number;                 // custom_services.id
  client_id: number | null;
  client_name: string | null;
  phone_number: string | null;
  description: string;        // fallback label when no name
  insurance_type: InsuranceType | null;
  sale_day: string;           // YYYY-MM-DD, shop day
  expiry_day: string;         // sale_day + 1 calendar year (29 Feb → 28 Feb)
  days_left: number;          // expiry_day − today; negative = overdue
}
```

Sort: `days_left` ascending (most overdue first, then soonest).

## Rules (FR-002, FR-003)

- **Live insurance**: `category = 'insurance' AND status = 'completed' AND status != 'voided' AND is_refunded = 0 AND COALESCE(direction,'IN') = 'IN'`, tenant-scoped.
- **Same customer**: same non-null `client_id`, or equal non-empty `normalizePhoneForMatch(phone_number)`.
- **Renewed**: a later live insurance (by `sale_day`, then `id`) for the same customer with the same `insurance_type`, or any type when the older row's type is NULL.
- **Listed**: live, not renewed, `renewal_dismissed_at IS NULL`, `days_left <= 7`.

## State

```
sold ──(days_left > 7)──> not listed
  └──(days_left ≤ 7)──> listed ──renewal sold──> not listed (returns if renewal refunded/voided)
                              └──"Won't renew"──> not listed (permanent for this row)
refunded / voided at any time ──> never listed
```
