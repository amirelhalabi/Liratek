/**
 * LIRA-220 — settings audit rows must never carry a SENSITIVE_SETTING_KEYS
 * value in plaintext.
 *
 * `AuditService.log()` / `.getRecent()` / `.search()` / `.getByEntity()` is
 * the ONE choke point both transports converge on: `electron-app/handlers/
 * auditHelper.ts`'s `audit()` and `backend/src/middleware/audit.ts`'s
 * `auditRest()` both end at `getAuditService().log()`, and the IPC/REST read
 * routes (`auditHandlers.ts` / `backend/src/api/audit.ts`) both call
 * `getAuditService().getRecent/search/getByEntity()` directly. Redacting
 * HERE (rule 14) covers both transports without a second copy of the
 * predicate anywhere else, and also covers any OTHER caller of
 * `AuditService.log()` (e.g. `setupHandlers.ts`, `databaseResetHandlers.ts`)
 * that might one day pass a sensitive setting's value.
 *
 * Two redaction points, on purpose:
 *  - write-time (`log()`): stops a NEW sensitive value from ever reaching
 *    the `audit_log` table in the first place.
 *  - read-time (`getRecent`/`search`/`getByEntity`): protects rows already
 *    written in plaintext before this fix (or by any future caller that
 *    bypasses `log()`'s write-time guard) — cheap, since these methods
 *    already touch every row on the way out.
 *
 * Driven against a stub `AuditRepository` (rule 13 payoff — no DB), same
 * style as `SettingsService.profitsRedaction.test.ts`.
 *
 * Rule 17, by inspection — every "redacts" assertion below fails against the
 * pre-fix `AuditService` (which passes `data`/rows through unmodified), and
 * every "does NOT redact" assertion guards against over-broad redaction
 * swallowing normal audit rows.
 */

import { AuditService } from "../AuditService";
import type {
  AuditRepository,
  AuditLogEntity,
  CreateAuditLogData,
} from "../../repositories/AuditRepository";
import { PROFITS_PASSWORD_SETTING_KEY } from "../../constants/profitsAccess";

const NORMAL_KEY = "shop_base_system";
const SENSITIVE_VALUE = "SCRYPT:deadbeef:c0ffee";

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

  return { service: new AuditService(repo), log, getRecent, search, getByEntity };
}

function baseWrite(overrides: Partial<CreateAuditLogData> = {}): CreateAuditLogData {
  return {
    user_id: 1,
    username: "admin",
    role: "admin",
    action: "update",
    entity_type: "setting",
    entity_id: PROFITS_PASSWORD_SETTING_KEY,
    summary: 'Updated setting "profits_password_hash"',
    new_values: { value: SENSITIVE_VALUE },
    ...overrides,
  };
}

function leakedRow(overrides: Partial<AuditLogEntity> = {}): AuditLogEntity {
  return {
    id: 1,
    user_id: 1,
    username: "admin",
    role: "admin",
    action: "update",
    entity_type: "setting",
    entity_id: PROFITS_PASSWORD_SETTING_KEY,
    summary: 'Updated setting "profits_password_hash"',
    old_values: null,
    new_values: JSON.stringify({ value: SENSITIVE_VALUE }),
    metadata: null,
    impersonator_id: null,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("AuditService — write-time redaction of SENSITIVE_SETTING_KEYS (LIRA-220)", () => {
  it("redacts new_values before handing the row to the repository", () => {
    const { service, log } = makeService();

    service.log(baseWrite());

    expect(log).toHaveBeenCalledTimes(1);
    const written = log.mock.calls[0][0] as CreateAuditLogData;
    expect(JSON.stringify(written.new_values ?? "")).not.toContain(
      SENSITIVE_VALUE,
    );
    expect(written.new_values).toEqual({ redacted: true });
  });

  it("redacts old_values too", () => {
    const { service, log } = makeService();

    service.log(
      baseWrite({
        old_values: { value: SENSITIVE_VALUE },
        new_values: { value: "a-different-secret" },
      }),
    );

    const written = log.mock.calls[0][0] as CreateAuditLogData;
    expect(written.old_values).toEqual({ redacted: true });
    expect(written.new_values).toEqual({ redacted: true });
  });

  it("does NOT redact a normal setting key (guards over-broad redaction)", () => {
    const { service, log } = makeService();

    service.log(
      baseWrite({ entity_id: NORMAL_KEY, new_values: { value: "WHISH" } }),
    );

    const written = log.mock.calls[0][0] as CreateAuditLogData;
    expect(written.new_values).toEqual({ value: "WHISH" });
  });

  it("does NOT redact a row of a different entity_type, even if entity_id happens to match a sensitive key string", () => {
    const { service, log } = makeService();

    service.log(
      baseWrite({
        entity_type: "expense",
        new_values: { value: "unrelated" },
      }),
    );

    const written = log.mock.calls[0][0] as CreateAuditLogData;
    expect(written.new_values).toEqual({ value: "unrelated" });
  });

  it("a sensitive row with no new_values/old_values at all is left as-is (nothing to redact)", () => {
    const { service, log } = makeService();

    service.log(baseWrite({ new_values: undefined }));

    const written = log.mock.calls[0][0] as CreateAuditLogData;
    expect(written.new_values).toBeUndefined();
  });
});

describe("AuditService — read-time redaction protects rows already in the DB (LIRA-220)", () => {
  it("getRecent() redacts a leaked plaintext row", () => {
    const { service, getRecent } = makeService();
    getRecent.mockReturnValue([leakedRow()]);

    const rows = service.getRecent(10);

    expect(rows[0].new_values ?? "").not.toContain(SENSITIVE_VALUE);
    expect(JSON.parse(rows[0].new_values as string)).toEqual({
      redacted: true,
    });
  });

  it("search() redacts a leaked plaintext row", () => {
    const { service, search } = makeService();
    search.mockReturnValue({ rows: [leakedRow()], total: 1 });

    const { rows } = service.search({});

    expect(rows[0].new_values ?? "").not.toContain(SENSITIVE_VALUE);
    expect(JSON.parse(rows[0].new_values as string)).toEqual({
      redacted: true,
    });
  });

  it("getByEntity() redacts a leaked plaintext row", () => {
    const { service, getByEntity } = makeService();
    getByEntity.mockReturnValue([leakedRow()]);

    const rows = service.getByEntity("setting", PROFITS_PASSWORD_SETTING_KEY);

    expect(rows[0].new_values ?? "").not.toContain(SENSITIVE_VALUE);
  });

  it("a normal setting row passes through every read method unredacted", () => {
    const { service, getRecent, search, getByEntity } = makeService();
    const normalRow = leakedRow({
      entity_id: NORMAL_KEY,
      new_values: JSON.stringify({ value: "WHISH" }),
    });
    getRecent.mockReturnValue([normalRow]);
    search.mockReturnValue({ rows: [normalRow], total: 1 });
    getByEntity.mockReturnValue([normalRow]);

    expect(JSON.parse(service.getRecent(10)[0].new_values as string)).toEqual(
      { value: "WHISH" },
    );
    expect(
      JSON.parse(service.search({}).rows[0].new_values as string),
    ).toEqual({ value: "WHISH" });
    expect(
      JSON.parse(
        service.getByEntity("setting", NORMAL_KEY)[0].new_values as string,
      ),
    ).toEqual({ value: "WHISH" });
  });

  it("a row with no stored value stays null, not a fabricated redaction marker", () => {
    const { service, getRecent } = makeService();
    getRecent.mockReturnValue([leakedRow({ new_values: null })]);

    expect(service.getRecent(10)[0].new_values).toBeNull();
  });
});
