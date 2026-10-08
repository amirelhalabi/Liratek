# Data Model: LIRA-288

**Migration:** **v200 `signin_directory`**. Re-read the last entry in `packages/core/src/db/migrations/index.ts` first; when this was written it was v199 `signin_codes`. Mirror the change in `electron-app/create_db.sql`, including the `schema_migrations` seed row, give it a `down()`, and make `yarn check:schema-equivalence` pass.

## New table: `signin_directory` (platform-only)

| Column | Type | Rules |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `kind` | TEXT NOT NULL CHECK (kind IN ('email','google')) | |
| `value` | TEXT NOT NULL | For `email`, the lowercased, trimmed address. For `google`, the Google `sub`. |
| `target_tenant_id` | INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE | Deliberately not called `tenant_id` (see tenantSplit.ts:119-126). |
| `target_user_id` | INTEGER NOT NULL | The user lives in the shop's own records, so there is no foreign key. |
| `username` | TEXT NOT NULL | Shown as "as rami" in www lists. |
| `display_email` | TEXT NULL | The email Google reported, for `google` rows. NULL for `email` rows. |
| `created_at`, `updated_at` | TEXT NOT NULL | UTC ISO. |

**Constraints and indexes:**
- `UNIQUE(kind, value, target_tenant_id)`: one user per shop per email or Google account. This mirrors `UNIQUE(provider, subject, tenant_id)` on `user_identities` and the per-shop unique email (v196).
- `INDEX(target_tenant_id, target_user_id)`: used when `syncUser` replaces a user's rows.
- The lookup by `(kind, value)` is served by the prefix of the UNIQUE index.

**Registration:**
- `tenantSplit.ts` `PLATFORM_ONLY_TABLES` and `KNOWN_TABLES_WITHOUT_TENANT_ID`.
- `resetTables.ts` `RESET_EXCLUDED_TABLES`, enforced by the guard test `resetTables.guard.test.ts`.
- `scripts/check-tenant-scoping.mjs`: `NON_TENANT_TABLES`.

## Invariants

1. A row exists **only** for a user who is active (`is_active = 1`) and not a super admin, and:
   - for `kind='email'`, whose email is set **and** confirmed;
   - for `kind='google'`, who has a `user_identities` row.
2. Whether a row is usable is decided at read time by the one predicate **`DIRECTORY_USABLE`**: `JOIN tenants t ON t.id = d.target_tenant_id WHERE t.status = 'active'`.
3. `syncUser(tenantId, userId)` makes invariant 1 hold for that user, whatever the earlier state, so running it twice changes nothing.
4. The shop's own records (`users`, `user_identities`) are the source of truth. The directory can always be rebuilt from them.

## Read model (www)

```
DirectoryAccount = { tenant_id, slug, shop_name, user_id, username }   // slug/name joined from tenants
findByEmail(email)       -> DirectoryAccount[]   ORDER BY shop name, username
findByGoogleSubject(sub) -> DirectoryAccount[]   ORDER BY shop name
```

These replace `UserRepository.findSigninAccountsByEmail` and `UserIdentityRepository.findBySubjectAllTenants`, with the same shapes, so the callers barely change.

## Existing tables, rule change only (no schema change)

- **`user_identities`:** keeps `UNIQUE(provider, subject, tenant_id)` and `UNIQUE(user_id, provider)`. These already **are** the new rule. The application-level "other shop" refusal is removed.
- **`users`:** a Google-only user joining by invite gets an unusable random `password_hash` (research R6).

## Back-fill (in v200)

Shared mode, where `users`, `user_identities` and `tenants` are all in the same file:

```
INSERT INTO signin_directory (kind,value,target_tenant_id,target_user_id,username,display_email,created_at,updated_at)
  SELECT 'email', lower(u.email), u.tenant_id, u.id, u.username, NULL, :now, :now
    FROM users u WHERE u.email IS NOT NULL AND u.email_verified_at IS NOT NULL
     AND u.is_active = 1 AND u.role <> 'super_admin'
  UNION ALL
  SELECT 'google', i.subject, i.tenant_id, u.id, u.username, i.email, :now, :now
    FROM user_identities i JOIN users u ON u.id = i.user_id
   WHERE u.is_active = 1 AND u.role <> 'super_admin';
```

The migration skips this when `users` is absent, which is the case in a per-tenant platform file. There, the operator runs `signinDirectoryCli --write`.
