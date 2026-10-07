# Data Model: Email Invites for Sign-up (LIRA-267)

**Migration:** one new migration, numbered last + 1. When this was written the last migration was v194, so this would be **v195**, but re-read the end of `packages/core/src/db/migrations/index.ts` before adding it.

**Every change must also be applied to:**
- the `CREATE TABLE` statements in `electron-app/create_db.sql`;
- the `schema_migrations` seed list in `create_db.sql`, around :2196 (change the trailing `;` to `,` and add the new row);
- a `down()`.

**Checked by:** `yarn check:schema-equivalence`. Build core first.

## tenants (existing): one new column

| Column | Type | Notes |
| --- | --- | --- |
| `contact_email` | `TEXT NULL` | Stored trimmed and lowercased. Set from the invite on sign-up. NULL for shops created before this change or with the shared invite code. |

- Adding a column with `ALTER TABLE … ADD COLUMN` needs no table rebuild.
- Add `CREATE UNIQUE INDEX idx_tenants_contact_email ON tenants(contact_email) WHERE contact_email IS NOT NULL`.
  - This enforces one shop per email (spec FR-013a). Values are always stored lowercased, so the index is effectively case-insensitive.
  - Existing rows are all NULL, so the index builds cleanly.
- `TenantRepository.create`, `TenantEntity`, and `ProvisionTenantData` (`TenantProvisioningService.ts:51-59`) each gain an optional `contactEmail`. So does the admin `createTenantSchema` (FR-013b).

## signup_invitations (new, platform-level, no tenant_id)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | INTEGER PK AUTOINCREMENT | |
| `email` | TEXT NOT NULL | Trimmed, lowercased, valid email, at most 254 characters. |
| `shop_name_hint` | TEXT NULL | At most 100 characters. Shown on the sign-up form as a suggestion; the person can change it. |
| `token_hash` | TEXT NOT NULL UNIQUE | `sha256(token)` as hex. The token itself is never stored here. |
| `source` | TEXT NOT NULL CHECK (source IN ('admin','self')) | `admin` means sent from the Tenants page. `self` means requested on the sign-up page. |
| `invited_by_user_id` | INTEGER NULL | The super-admin's user id, taken from the JWT. NULL when `source = 'self'`. |
| `expires_at` | TEXT NOT NULL | UTC ISO-8601 time, set to creation time plus 72 hours. |
| `claimed_at` | TEXT NULL | A short-lived lock while the shop is being created (research R4). |
| `used_at` | TEXT NULL | |
| `used_by_tenant_id` | INTEGER NULL REFERENCES tenants(id) | Records which shop the invite created. It does not scope the row to that shop. |
| `revoked_at` | TEXT NULL | |
| `email_outbox_id` | INTEGER NULL REFERENCES email_outbox(id) | The email that announces this invite. |
| `created_at`, `updated_at` | DATETIME DEFAULT CURRENT_TIMESTAMP | |

**Indexes:**
- `UNIQUE(token_hash)`
- `(email, created_at)`: serves the per-email rate limit (3 per hour) and the lookup by email.
- `(source, created_at)`: serves the platform-wide daily cap on self-serve requests.

**Time format:** every time comparison in this table uses ISO strings that the app writes. The current time is passed in as a parameter, never computed with SQLite's `datetime('now')`. That keeps the format consistent and makes the times testable.

### Derived status

Status is worked out when the list is read, never stored. The rules are checked in this order:

1. `revoked_at` is set → **revoked**
2. `used_at` is set → **used**
3. `expires_at` is at or before now → **expired**
4. otherwise → **pending**

A row with `claimed_at` set but `used_at` empty counts as **pending**.

**Crash between creating the shop and finalizing:** a later claim reaches provisioning, which fails with `EMAIL_ALREADY_HAS_SHOP` because of the unique index. The service then finds the shop by `contact_email = invite.email`. Because that shop was created from this invite, the service finalizes the invite as used with that shop's id, instead of releasing it, and returns the generic refusal. Only one shop can ever exist for an invite.

### Lifecycle

```
created ──► pending ──claim──► (claimed) ──provision ok──► used
                │                   └──provision fails / 10-min lapse──► pending
                ├──revoke──► revoked
                └──72h──► expired
```

## email_outbox (new, platform-level, no tenant_id)

| Column | Type | Rules |
| --- | --- | --- |
| `id` | INTEGER PK AUTOINCREMENT | |
| `idempotency_key` | TEXT NOT NULL UNIQUE | For an invite: `signup-invite:<invitation id>`. |
| `template` | TEXT NOT NULL | For example `signup-invite`. |
| `to_email` | TEXT NOT NULL | |
| `data_json` | TEXT NOT NULL | The template variables. The `inviteUrl` key is **removed** once the row reaches `accepted` or `failed`. |
| `status` | TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed')) | |
| `attempts` | INTEGER NOT NULL DEFAULT 0 | |
| `next_attempt_at` | TEXT NOT NULL | UTC ISO time. |
| `give_up_at` | TEXT NOT NULL | UTC ISO time. For an invite email this is the invite's `expires_at`. No round starts after this time. |
| `locked_at` | TEXT NULL | Set when the row is claimed for sending. Used to recover rows stuck in `sending`. |
| `last_error` | TEXT NULL | Cut to 1000 characters. Never contains credentials. |
| `provider_message_id` | TEXT NULL | |
| `sent_at` | TEXT NULL | When the provider accepted the email. |
| `created_at`, `updated_at` | DATETIME DEFAULT CURRENT_TIMESTAMP | |

**Indexes:**
- `UNIQUE(idempotency_key)`
- `(status, next_attempt_at)`

### State machine

```
pending ──claim──► sending: round = up to 2 back-to-back attempts
                       │──either attempt ok──► accepted
                       │──permanent error──► failed
                       │──both transient, now+10m < give_up_at──► pending (next_attempt_at = now + 10m)
                       └──both transient, now+10m ≥ give_up_at──► failed
pending ◄──locked_at older than 10 min (crash recovery)── sending

`attempts` counts every individual try, for display and diagnosis only. It never decides when to stop.
```

## Split tool (`packages/core/src/db/tenantSplit.ts`)

- Delete `signup_invitations` and `email_outbox` from every `tenants/<id>.db` file, in the same way `tenant_subscriptions` is deleted at :566.
- Count both tables in the verify step, around :781.
- Both tables are kept whole in `platform.db`.
