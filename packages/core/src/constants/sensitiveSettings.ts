/**
 * `system_settings.key_name`s whose VALUE must never round-trip in
 * plaintext through a generic, non-owning surface — the generic settings
 * read/write pipe (`SettingsService`) AND the audit trail (`AuditService`,
 * LIRA-220).
 *
 * Moved out of `SettingsService.ts` (rule 14 — was a private, undiscoverable
 * `Set` there) so `AuditService.ts` can share the EXACT same membership test
 * instead of hand-copying the list a second time. `SettingsService` still
 * owns the read/write refusal behavior; this file owns only the predicate.
 *
 * `PROFITS_PASSWORD_SETTING_KEY` is redacted from every `SettingsService`
 * read and refused on `updateSetting` — see that class's own comment — and,
 * as of LIRA-220, any `audit_log` row whose `entity_type` is `"setting"` and
 * `entity_id` is one of these keys has its `old_values`/`new_values`
 * replaced with a `{ redacted: true }` marker, both on write
 * (`AuditService.log`) and on every read (`getRecent`/`search`/
 * `getByEntity`) — the latter so a row written in plaintext before this fix
 * (or by any future caller that bypasses the write-time guard) does not keep
 * leaking it.
 *
 * Do not remove a key from this set without adding an authenticated,
 * role-gated replacement read/write path for it first.
 */
import { PROFITS_PASSWORD_SETTING_KEY } from "./profitsAccess.js";

export const SENSITIVE_SETTING_KEYS = new Set<string>([
  PROFITS_PASSWORD_SETTING_KEY,
]);

/** True when `key` is a `system_settings.key_name` in `SENSITIVE_SETTING_KEYS`. */
export function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEYS.has(key);
}
