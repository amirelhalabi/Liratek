/**
 * The WhatsApp Cloud API access token must never sit in the audit trail in
 * plaintext.
 *
 * An admin saving `whatsapp_api_key` through the generic settings pipe writes
 * an audit row with `new_values: { value: <token> }`. The audit read routes
 * (`/api/audit/recent`, `/by-entity`, `/search`) are open to staff, and
 * AuditService redacts only SENSITIVE_SETTING_KEYS, which does not list this
 * key. So staff can read the token from the audit log even if the settings
 * reads are fixed.
 *
 * Security audit run-1, fingerprint
 * settings/whatsapp_api_key-unclassified-secret-staff-readable (audit half).
 *
 * Same stub-repository style as AuditService.settingsRedaction.test.ts.
 */

import { AuditService } from "../AuditService";
import type {
  AuditRepository,
  AuditLogEntity,
} from "../../repositories/AuditRepository";

const TOKEN_KEY = "whatsapp_api_key";
const TOKEN_VALUE = "DUMMY_META_TOKEN_123";

function makeService() {
  const log = jest.fn();
  const getRecent = jest.fn();
  const search = jest.fn();
  const getByEntity = jest.fn();
  const repo = {
    log,
    getRecent,
    search,
    getByEntity,
  } as unknown as AuditRepository;
  return { service: new AuditService(repo), log, getByEntity };
}

function leakedRow(): AuditLogEntity {
  return {
    id: 1,
    user_id: 1,
    username: "admin",
    role: "admin",
    action: "update",
    entity_type: "setting",
    entity_id: TOKEN_KEY,
    summary: 'Updated setting "whatsapp_api_key"',
    old_values: null,
    new_values: JSON.stringify({ value: TOKEN_VALUE }),
    metadata: null,
    impersonator_id: null,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
  };
}

describe("AuditService — WhatsApp token is redacted", () => {
  it("log() does not store the token in plaintext", () => {
    const { service, log } = makeService();

    service.log({
      user_id: 1,
      username: "admin",
      role: "admin",
      action: "update",
      entity_type: "setting",
      entity_id: TOKEN_KEY,
      summary: 'Updated setting "whatsapp_api_key"',
      new_values: { value: TOKEN_VALUE },
    });

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls[0])).not.toContain(TOKEN_VALUE);
  });

  it("getByEntity() does not return a token already stored in plaintext", () => {
    const { service, getByEntity } = makeService();
    getByEntity.mockReturnValue([leakedRow()]);

    const rows = service.getByEntity("setting", TOKEN_KEY);

    expect(JSON.stringify(rows)).not.toContain(TOKEN_VALUE);
  });
});
