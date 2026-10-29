/**
 * LIRA-360 — insurance renewal reminders at the repository layer:
 * `insurance_type` is stored, `getInsuranceRenewalCandidates()` returns only
 * live insurance sales of this tenant with the shop's sale day (rule 27),
 * and `dismissInsuranceRenewal()` records "Won't renew".
 *
 * RULE 17 — written before the columns were persisted and before either
 * method existed. Real production schema (create_db.sql + migrations).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { CustomServiceRepository } from "../CustomServiceRepository";
import { createCustomServiceSchema } from "../../validators/customService";
import type { CreateCustomServicePayload } from "../../validators/customService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

describe("LIRA-360 — insurance renewals (repository)", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
    initDatabase(db);
    runMigrations(db);
    db.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug) VALUES (2, 'Other shop', 'other-shop')`,
    ).run();
    initFixedTenantContext(1);
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function sell(over: Partial<CreateCustomServicePayload> = {}): number {
    const data = createCustomServiceSchema.parse({
      description: "Car insurance",
      price_usd: 100,
      cost_usd: 80,
      category: "insurance",
      insurance_type: "COMPULSORY",
      client_name: "Ali",
      phone_number: "70123456",
      ...over,
    });
    const res = repo.createService(data);
    if (!res.success || !res.id) throw new Error(res.error ?? "sell failed");
    return res.id;
  }

  const candidateIds = (): number[] =>
    repo.getInsuranceRenewalCandidates().map((c) => c.id);

  it("stores insurance_type and reads it back", () => {
    const id = sell({ insurance_type: "LIFE" });
    expect(repo.getById(id)?.insurance_type).toBe("LIFE");
    const untyped = sell({ insurance_type: undefined });
    expect(repo.getById(untyped)?.insurance_type).toBeNull();
  });

  it("returns live insurance sales only", () => {
    const live = sell();
    sell({ category: "repair", insurance_type: undefined });
    const voided = sell();
    db.prepare(`UPDATE custom_services SET status = 'voided' WHERE id = ?`).run(
      voided,
    );
    const refunded = sell();
    db.prepare(`UPDATE custom_services SET is_refunded = 1 WHERE id = ?`).run(
      refunded,
    );
    const otherTenant = sell();
    db.prepare(`UPDATE custom_services SET tenant_id = 2 WHERE id = ?`).run(
      otherTenant,
    );
    expect(candidateIds()).toEqual([live]);
  });

  it("keeps a dismissed sale as a candidate, with its mark", () => {
    const id = sell();
    expect(repo.dismissInsuranceRenewal(id, "rana")).toEqual({
      success: true,
    });
    const c = repo.getInsuranceRenewalCandidates().find((r) => r.id === id);
    expect(c?.renewal_dismissed_at).toEqual(expect.any(String));
    const row = db
      .prepare(
        `SELECT renewal_dismissed_by FROM custom_services WHERE id = ?`,
      )
      .get(id) as { renewal_dismissed_by: string };
    expect(row.renewal_dismissed_by).toBe("rana");
  });

  it("sale_day is the shop's day, not the UTC day (rule 27)", () => {
    // 01:30 Beirut on 2025-11-05 is stored as 22:30 UTC the day before.
    const id = sell({ transaction_time: "2025-11-04T22:30:00.000Z" });
    const day = runWithTenant(
      1,
      () =>
        repo.getInsuranceRenewalCandidates().find((c) => c.id === id)
          ?.sale_day,
      { clientTzOffsetMinutes: 180 },
    );
    expect(day).toBe("2025-11-05");
  });

  describe("dismissInsuranceRenewal", () => {
    it("refuses a missing row", () => {
      expect(repo.dismissInsuranceRenewal(9999, "rana").success).toBe(false);
    });
    it("refuses a non-insurance service", () => {
      const id = sell({ category: "repair", insurance_type: undefined });
      expect(repo.dismissInsuranceRenewal(id, "rana").success).toBe(false);
    });
    it("refuses a refunded insurance", () => {
      const id = sell();
      db.prepare(`UPDATE custom_services SET is_refunded = 1 WHERE id = ?`).run(
        id,
      );
      expect(repo.dismissInsuranceRenewal(id, "rana").success).toBe(false);
    });
    it("refuses a second dismissal", () => {
      const id = sell();
      repo.dismissInsuranceRenewal(id, "rana");
      expect(repo.dismissInsuranceRenewal(id, "omar").success).toBe(false);
      const row = db
        .prepare(
          `SELECT renewal_dismissed_by FROM custom_services WHERE id = ?`,
        )
        .get(id) as { renewal_dismissed_by: string };
      expect(row.renewal_dismissed_by).toBe("rana");
    });
    it("refuses another tenant's insurance", () => {
      const id = sell();
      db.prepare(`UPDATE custom_services SET tenant_id = 2 WHERE id = ?`).run(
        id,
      );
      expect(repo.dismissInsuranceRenewal(id, "rana").success).toBe(false);
    });
  });
});
