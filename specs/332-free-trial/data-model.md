# Data Model: Free trial on signup (LIRA-332)

## Migration

**Version**: use the next free version at build time. It is the last entry of `packages/core/src/db/migrations/index.ts` + 1. The last entry was v219 on 2026-10-17, but other sessions add migrations at the same time, so re-read it right before you write.

Rule 10: the same change goes into `electron-app/create_db.sql`. `yarn check:schema-equivalence` must stay at 0 diffs.

```sql
-- up
ALTER TABLE tenant_subscriptions ADD COLUMN trial_started_at DATETIME;
ALTER TABLE tenant_subscriptions ADD COLUMN trial_ends_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_trial_ends
  ON tenant_subscriptions(trial_ends_at) WHERE trial_ends_at IS NOT NULL;

-- down: the 12-step rebuild without the two columns. SQLite DROP COLUMN
-- exists (3.35+), but follow whatever the add-migration skill prescribes
-- for this repo's SQLite and SQLCipher builds.
DROP INDEX IF EXISTS idx_tenant_subscriptions_trial_ends;
ALTER TABLE tenant_subscriptions DROP COLUMN trial_ends_at;
ALTER TABLE tenant_subscriptions DROP COLUMN trial_started_at;
```

- **No backfill**: existing rows keep NULL, so they are not on a trial (FR-004, SC-001).
- **Where it runs**: on every database file the runner touches.
  - Shared mode: the one file.
  - Per-tenant mode: the platform file and each shop file.
  - In shop files the table holds no rows (§ 12.2), so there the column is inert.
- **`create_db.sql`**: add the two columns to `CREATE TABLE tenant_subscriptions` and add the partial index. The desktop seed `INSERT OR IGNORE … (1,'standard','active',NULL)` is unchanged: the desktop is never on a trial (FR-021).
- **No table-classification lists change**: there is no new table, so `tenantSplit`, `platformSplitGuard`, `resetTables`, `offline/tables.ts`, `idRange.ts` and `tenantSnapshot.ts` stay as they are. `SNAPSHOT_NULLED_COLUMNS` does not need the trial columns, because they are not secrets. In per-tenant mode a shop file holds no subscription rows. In **shared** mode `tenantSnapshot.ts` copies the shop's own `tenant_subscriptions` row (only `license_key` nulled), so the trial columns travel to the PC. That is harmless: the PC takes its trial standing from checkin (research R8), never from this row, and desktop standing reads tenant 1's local row.

## Entity: Subscription (extended), `tenant_subscriptions`

| Column | Type | Rule |
| --- | --- | --- |
| `trial_started_at` | DATETIME NULL, UTC `YYYY-MM-DD HH:MM:SS` | Set at sign-up, in the same transaction as the tenant row. Also set by Extend on a row that has none. Cleared by Activate and markPaid. |
| `trial_ends_at` | DATETIME NULL, UTC `YYYY-MM-DD HH:MM:SS` | The exact end instant: 00:00 Asia/Beirut on the day after the last trial day. NULL means not on a trial. |

**Invariant**, enforced by the service, never by callers: `trial_ends_at IS NOT NULL` ⇒ `status = 'active' AND current_period_end IS NULL AND grace_ends_at IS NULL`.

### Derived: `standing` (never stored)

| Precedence | Condition | standing |
| --- | --- | --- |
| 1 | no row / lookup failed | `null`: fail open, no strip, no gate |
| 2 | invariant broken (trial set, but status ≠ active or period set) | the paid reading (step 5), logged once as a warning |
| 3 | `trial_ends_at` set and `now < trial_ends_at` | `trial` |
| 4 | `trial_ends_at` set and `now >= trial_ends_at` | `trial_ended` |
| 5 | otherwise | `status`: `active` / `grace` / `read_only` (unchanged) |

### Derived: `TrialView` (one pure function, `trialView(endsAt, now)` in `utils/trialCalendar.ts`)

| Field | Type | Derivation |
| --- | --- | --- |
| `endsAt` | ISO UTC string | the stored `trial_ends_at` |
| `lastDay` | `YYYY-MM-DD` | `shopDayOf(endsAt − 1 ms)`, in Asia/Beirut |
| `daysLeft` | integer ≥ 0 | `ended ? 0 : dayDiff(lastDay, shopDayOf(now)) + 1` (today counts) |
| `endsSoon` | boolean | `!ended && daysLeft <= 3` |
| `ended` | boolean | `now >= endsAt` |

Sign-up seed: `trial_ends_at = startOfShopDay(shopDayOf(signup) + TRIAL_LENGTH_DAYS)`, with `TRIAL_LENGTH_DAYS = 14`. The sign-up day is day 1 (research R4).

### State transitions

```
                 sign-up (invite link / Google)
 (no row) ─────────────────────────────────────────► trial
                                                      │  now ≥ trial_ends_at (live, no sweep)
                                                      ▼
            Extend trial (future lastDay) ◄────── trial_ended
            ─────────────────────────────► trial
 trial / trial_ended ── Activate (until = null) ──► active (no period)
 trial / trial_ended ── Activate (until = D)    ──► active (period end = endOfShopDay(D)) ── sweep ──► grace ──► read_only
 owner-created active (no period) ── Extend trial ──► trial
 grace / read_only / active-with-period ── Extend trial ──► REFUSED ("This shop pays; use Activate subscription")
 any ── Extend to lastDay with endOfShopDay(lastDay) <= now ──► REFUSED ("Choose a date in the future")
```

- Suspension (`tenants.status`) is orthogonal. No transition here reads it or writes it (FR-016).
- Nothing in this model deletes or archives anything (FR-010).

## Entity: Owner trial action (audit row; no new table)

This is written with `AuditService.logAdminAction`: a platform `audit_log` row plus a shop note.

| Field | Value |
| --- | --- |
| `action` | `"activate_subscription"` or `"extend_trial"` |
| `entity_type` | `"subscription"` |
| `entity_id` | tenant id (string) |
| actor | `req.user` (the super admin), never the body |
| `old_values` / `new_values` | `{ standing, trialEndsAt, trialLastDay, currentPeriodEnd }` |
| `metadata.targetTenantId` | tenant id |

The sign-up "start" is the existing self-service signup audit row (`metadata.via` = `invite_link` / `google`, plus `invitation_id`). The trial end date is visible from the subscription row itself.

## Validation rules (core `validators/subscription.ts`)

| Schema | Shape | Rules |
| --- | --- | --- |
| `activateSubscriptionSchema` | `{ until: string \| null }` | `until` matches `^\d{4}-\d{2}-\d{2}$` and is a real calendar date. Past or future is checked by the service (`endOfShopDay(until) > now`), not by Zod, because the schema has no clock. |
| `extendTrialSchema` | `{ lastDay: string }` | same date rule. The service refuses `endOfShopDay(lastDay) <= now`. |

Both export `z.input` types (`ActivateSubscriptionInput`, `ExtendTrialInput`) from `index.ts` and `browser.ts`.
