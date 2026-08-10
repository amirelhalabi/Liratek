/**
 * End-to-end proof: a provider created through the new phase-5 write path
 * (`ServiceProviderService.createProvider`) is IMMEDIATELY usable as a
 * `financial_services.provider` value under the real v154 composite FK.
 *
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b's whole point is that
 * "Syria" (or any new provider) becomes "a data entry, not a migration"
 * (phase 5 header). This is the test that actually proves the taxonomy
 * works end-to-end, not just that each layer is individually correct:
 *
 *  1. Build the REAL v153 (`add_service_providers_table`) and v154
 *     (`financial_services_provider_check_to_fk`) migrations against a
 *     from-scratch DB — not a hand-rolled schema — so this test tracks the
 *     actual production DDL, including the composite FK
 *     `(tenant_id, provider) -> service_providers(tenant_id, code)`.
 *  2. Call the real `ServiceProviderService.createProvider({code: 'SYRIA',
 *     label: 'Syria'})` — the same method the new IPC handler/REST route
 *     call — and confirm it lands with `drawer_name = 'General'`
 *     (invariant 1, ServiceProviderService's own doc comment).
 *  3. Confirm `FinancialServiceRepository`'s real `assertValidProvider`
 *     guard (the repository-boundary membership check added in phase 3)
 *     accepts 'SYRIA' without throwing.
 *  4. Insert a real `financial_services` row with `provider = 'SYRIA'` and
 *     confirm it succeeds — the composite FK is genuinely satisfied, not
 *     just "no error happened to occur".
 *  5. Negative control: an INSERT with a provider that was never created
 *     through this path is rejected by the SAME FK — proving step 4 isn't
 *     vacuously true (the FK is actually enforcing something).
 */

import Database from "better-sqlite3";
import { MIGRATIONS } from "../../db/migrations/index.js";
import {
  ServiceProviderService,
  resetServiceProviderService,
} from "../ServiceProviderService.js";
import {
  ServiceProviderRepository,
  resetServiceProviderRepository,
} from "../../repositories/ServiceProviderRepository.js";
import { FinancialServiceRepository } from "../../repositories/FinancialServiceRepository.js";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext.js";

const migrationV153 = MIGRATIONS.find((m) => m.version === 153)!;
const migrationV154 = MIGRATIONS.find((m) => m.version === 154)!;

// A representative (not exhaustive) subset of the real `financial_services`
// columns, with the EXACT live 9-value CHECK migration v154 matches verbatim
// — mirrors FinancialServicesProviderFkMigration.test.ts's fixture.
const FINANCIAL_SERVICES_SCHEMA = `
  CREATE TABLE financial_services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER REFERENCES tenants(id),
    provider TEXT CHECK(provider IN ('OMT', 'WHISH', 'BOB', 'OTHER', 'iPick', 'Katsh', 'WHISH_APP', 'OMT_APP', 'BINANCE')) NOT NULL,
    service_type TEXT CHECK(service_type IN ('SEND', 'RECEIVE', 'BILL')) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'USD' NOT NULL,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

function buildTestDb(): Database.Database {
  const db = new Database(":memory:");
  // better-sqlite3 defaults `foreign_keys` ON in this codebase (see
  // FinancialServicesProviderFkMigration.test.ts's identical comment) —
  // `financial_services.tenant_id REFERENCES tenants(id)` needs a real
  // parent row.
  db.exec(`
    CREATE TABLE tenants (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT NOT NULL,
      slug   TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    INSERT INTO tenants (id, name, slug, status) VALUES (1, 'Default', 'default', 'active');
  `);
  db.exec(FINANCIAL_SERVICES_SCHEMA);

  // Real migrations, in order: v153 creates + seeds service_providers (the 9
  // existing codes for tenant 1), v154 rebuilds financial_services onto the
  // composite FK against it.
  migrationV153.up(db);
  migrationV154.up(db);

  return db;
}

/** Invoke the private `assertValidProvider` method without a full
 *  createTransaction() round trip — same pattern as
 *  FinancialServiceRepository.assertValidProvider.test.ts. */
function assertValidProvider(
  repo: FinancialServiceRepository,
  provider: string,
): void {
  (
    repo as unknown as { assertValidProvider: (p: string) => void }
  ).assertValidProvider(provider);
}

describe("ServiceProviderService.createProvider -> usable as financial_services.provider (v154 FK) — §5b phase 5 end-to-end proof", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = buildTestDb();
    (globalThis as any).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    resetServiceProviderRepository();
    resetServiceProviderService();
  });

  afterEach(() => {
    delete (globalThis as any).__LIRATEK_TEST_DB__;
    resetTenantContext();
    resetServiceProviderRepository();
    resetServiceProviderService();
    db.close();
  });

  it("a freshly created provider settles to General, passes assertValidProvider, and satisfies the real composite FK", () => {
    const service = new ServiceProviderService(new ServiceProviderRepository());

    const createResult = service.createProvider({
      code: "SYRIA",
      label: "Syria",
    });
    expect(createResult.success).toBe(true);

    // Invariant 1: always General, never PCD-eligible — even though nothing
    // in the create call asked for a drawer.
    const providerRepo = new ServiceProviderRepository();
    const row = providerRepo.getByCode("SYRIA");
    expect(row).toBeDefined();
    expect(row!.drawer_name).toBe("General");
    expect(row!.is_system).toBe(0);
    expect(row!.is_system_provider).toBe(0);

    // The real repository-boundary guard (phase 3) accepts it.
    const financialRepo = new FinancialServiceRepository();
    expect(() => assertValidProvider(financialRepo, "SYRIA")).not.toThrow();

    // The real composite FK accepts a genuine INSERT.
    const ins = db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'SYRIA', 'SEND', 25)`,
      )
      .run();
    expect(ins.changes).toBe(1);
    expect(db.pragma("foreign_key_check")).toEqual([]);

    const stored = db
      .prepare(`SELECT provider FROM financial_services WHERE id = ?`)
      .get(ins.lastInsertRowid) as { provider: string };
    expect(stored.provider).toBe("SYRIA");
  });

  it("negative control: a provider NEVER created through this path is rejected by both the app-level guard and the real FK", () => {
    const financialRepo = new FinancialServiceRepository();

    expect(() => assertValidProvider(financialRepo, "NEVER_CREATED")).toThrow(
      /Invalid provider 'NEVER_CREATED'/,
    );

    expect(() =>
      db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (1, 'NEVER_CREATED', 'SEND', 1)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it("a provider created for tenant 1 is NOT usable for a different tenant (tenant-scoped FK, not global)", () => {
    db.exec(`INSERT INTO tenants (id, name, slug, status) VALUES (2, 'Second Shop', 'second-shop', 'active');`);

    const service = new ServiceProviderService(new ServiceProviderRepository());
    const createResult = service.createProvider({
      code: "SYRIA",
      label: "Syria",
    });
    expect(createResult.success).toBe(true);

    // Same code, but under tenant 2 there is no matching service_providers
    // row — the composite FK must still reject it.
    expect(() =>
      db
        .prepare(
          `INSERT INTO financial_services (tenant_id, provider, service_type, amount) VALUES (2, 'SYRIA', 'SEND', 1)`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});
