/**
 * Table lists for row capture and the N5 manifest (LIRA-306, R4, FR-020,
 * FR-035) — PURE.
 *
 * MAP_EXCLUDED_TABLES — never compared between the PC's created rows and
 * the server's: the audit log and sign-in `sessions` (the IPC handler and
 * the REST middleware write them differently, audit.ts), the duplicate-reply
 * store, and platform/account tables no offline action writes. The customer
 * basket tables are NOT excluded — they are business rows and are mapped.
 * Guarded by RowCaptureRepository.test.ts (every name exists in
 * create_db.sql).
 */
import { OFFLINE_ID_TABLES } from "./idRange.js";

export const MAP_EXCLUDED_TABLES: readonly string[] = [
  "audit_log",
  "sessions",
  "idempotency_keys",
  "tenants",
  "tenant_subscriptions",
  "email_outbox",
  "signup_invitations",
  "user_invitations",
  "password_reset_tokens",
  "email_verification_tokens",
  "user_identities",
  "sso_handoff_tokens",
  "signin_codes",
  "signin_directory",
  "sync_queue",
  "sync_errors",
];

/** Every id-range table whose rows the manifest cross-checks (N5). */
export const MANIFEST_KEY_TABLES: readonly string[] = OFFLINE_ID_TABLES.filter(
  (t) => !MAP_EXCLUDED_TABLES.includes(t),
);
