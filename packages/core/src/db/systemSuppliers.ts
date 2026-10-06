import type Database from "better-sqlite3";

/**
 * The suppliers every shop must own. Modules find them by `provider`, scoped to
 * the tenant (OMT/Whish settlement, iPick/Katsh bills, the app wallets, Loto).
 *
 * Mirrors electron-app/create_db.sql's tenant-1 supplier seed exactly —
 * including Whish's legacy `is_system = 0`, its v78 deactivation (LIRA-045:
 * OMT-base shops settle Whish through the partner ledger) and the LIRA-112
 * commission config. `systemSuppliers.test.ts` compares the two against the
 * real file, so editing one without the other fails CI.
 *
 * Used by `TenantRepository.seedConfig` (every new tenant) and migration v191
 * (backfill for tenants created before the seed existed).
 */
const SYSTEM_SUPPLIERS = [
  {
    name: "iPick",
    module_key: "ipec_katch",
    provider: "iPick",
    is_active: 1,
    is_system: 1,
    commission_eligible: 0,
    commission_entry_mode: "LUMP",
    commission_rate: null,
    commission_rate_currency: "USD",
  },
  {
    name: "Katsh",
    module_key: "ipec_katch",
    provider: "Katsh",
    is_active: 1,
    is_system: 1,
    commission_eligible: 1,
    commission_entry_mode: "RATE",
    commission_rate: 20000,
    commission_rate_currency: "LBP",
  },
  {
    name: "OMT",
    module_key: "omt_whish",
    provider: "OMT",
    is_active: 1,
    is_system: 1,
    commission_eligible: 1,
    commission_entry_mode: "LUMP",
    commission_rate: null,
    commission_rate_currency: "USD",
  },
  {
    name: "Whish",
    module_key: "omt_whish",
    provider: "WHISH",
    is_active: 0,
    is_system: 0,
    commission_eligible: 1,
    commission_entry_mode: "LUMP",
    commission_rate: null,
    commission_rate_currency: "USD",
  },
  {
    name: "OMT App",
    module_key: "ipec_katch",
    provider: "OMT_APP",
    is_active: 1,
    is_system: 1,
    commission_eligible: 1,
    commission_entry_mode: "LUMP",
    commission_rate: null,
    commission_rate_currency: "USD",
  },
  {
    name: "Whish App",
    module_key: "ipec_katch",
    provider: "WHISH_APP",
    is_active: 1,
    is_system: 1,
    commission_eligible: 1,
    commission_entry_mode: "LUMP",
    commission_rate: null,
    commission_rate_currency: "USD",
  },
  {
    name: "Loto Liban",
    module_key: null,
    provider: "LOTO",
    is_active: 1,
    is_system: 1,
    commission_eligible: 1,
    commission_entry_mode: "LUMP",
    commission_rate: null,
    commission_rate_currency: "USD",
  },
] as const;

/** Providers `seedSystemSuppliers` can create (LIRA-258: `ensureSystemSupplier`
 *  seeds only for these, never for a custom provider). */
export const SYSTEM_SUPPLIER_PROVIDERS: ReadonlySet<string> = new Set(
  SYSTEM_SUPPLIERS.map((s) => s.provider),
);

export interface SeedSystemSuppliersResult {
  inserted: number;
  /**
   * Providers NOT seeded because the tenant already has a supplier with that
   * name but a different provider (e.g. a hand-added "OMT"). Such a tenant
   * still lacks the provider row its module looks up, so callers must surface
   * these, never swallow them.
   */
  skippedByName: string[];
}

/**
 * Insert each system supplier the tenant does not already have, then link a
 * just-inserted iPick / OMT App to that tenant's own OMT row (v176's account
 * model). Idempotent. Never touches a row that already existed: a supplier the
 * owner deactivated stays deactivated, and a child an admin detached from the
 * OMT account stays detached.
 *
 * "Already has" = same provider, OR same name (suppliers is UNIQUE on
 * tenant_id + name — a hand-added "OMT" must skip, not crash a boot-time
 * migration; it is reported in `skippedByName`). `module_key` is set only when
 * that tenant has the module row, because (tenant_id, module_key) is a foreign
 * key into modules.
 */
export function seedSystemSuppliers(
  db: Database.Database,
  tenantId: number,
): SeedSystemSuppliersResult {
  const hasProvider = db.prepare(
    `SELECT 1 FROM suppliers WHERE tenant_id = ? AND provider = ?`,
  );
  const hasName = db.prepare(
    `SELECT 1 FROM suppliers WHERE tenant_id = ? AND name = ?`,
  );
  const insert = db.prepare(`
    INSERT INTO suppliers (
      tenant_id, name, module_key, provider, is_active, is_system,
      commission_eligible, commission_entry_mode, commission_rate, commission_rate_currency
    )
    VALUES (?, ?, (SELECT key FROM modules WHERE tenant_id = ? AND key = ?), ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertedIds: number[] = [];
  const skippedByName: string[] = [];
  for (const s of SYSTEM_SUPPLIERS) {
    if (hasProvider.get(tenantId, s.provider)) continue;
    if (hasName.get(tenantId, s.name)) {
      skippedByName.push(s.provider);
      continue;
    }
    const res = insert.run(
      tenantId,
      s.name,
      tenantId,
      s.module_key,
      s.provider,
      s.is_active,
      s.is_system,
      s.commission_eligible,
      s.commission_entry_mode,
      s.commission_rate,
      s.commission_rate_currency,
    );
    insertedIds.push(Number(res.lastInsertRowid));
  }

  const link = db.prepare(`
    UPDATE suppliers
       SET account_supplier_id = (
             SELECT p.id FROM suppliers p
              WHERE p.tenant_id = ? AND p.provider = 'OMT'
              LIMIT 1)
     WHERE id = ?
       AND tenant_id = ?
       AND provider IN ('iPick', 'OMT_APP')
       AND account_supplier_id IS NULL
       AND EXISTS (SELECT 1 FROM suppliers p WHERE p.tenant_id = ? AND p.provider = 'OMT')
  `);
  for (const id of insertedIds) {
    link.run(tenantId, id, tenantId, tenantId);
  }

  return { inserted: insertedIds.length, skippedByName };
}
