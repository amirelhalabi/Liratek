/**
 * `checkTenantCompleteness()` — § 12.4 ticket item 2. Brand-new module (rule
 * 17): no prior version exists to have been run against, so this is not
 * proven failing-first in the usual sense — stated honestly, matching the
 * ticket's own carve-out for brand-new modules. Each case below is instead
 * the specification the boot-time check must satisfy.
 */
import {
  checkTenantCompleteness,
  EXPECTED_TENANT_STATUSES,
} from "../tenantCompletenessCheck.js";
import type { TenantStatusRow } from "../tenantCompletenessCheck.js";

describe("checkTenantCompleteness", () => {
  it("reports an active tenant with no file as missing — the silent-outage scenario", () => {
    const tenantRows: TenantStatusRow[] = [
      { id: 1, status: "active" },
      { id: 5, status: "active" },
    ];
    // Exactly today's bug: TENANT_DB_MODE flipped before the split ran, so
    // /data/tenants is empty.
    const foundIds: number[] = [];

    const result = checkTenantCompleteness(tenantRows, foundIds);

    expect(result.missingIds).toEqual([1, 5]);
    expect(result.orphanIds).toEqual([]);
    expect(result.provisioningIds).toEqual([]);
  });

  it("reports nothing missing when every active/suspended tenant has a file", () => {
    const tenantRows: TenantStatusRow[] = [
      { id: 1, status: "active" },
      { id: 5, status: "suspended" },
    ];
    const foundIds = [1, 5];

    const result = checkTenantCompleteness(tenantRows, foundIds);

    expect(result.missingIds).toEqual([]);
    expect(result.orphanIds).toEqual([]);
  });

  it("never counts a 'provisioning' tenant as missing, with or without a file", () => {
    const tenantRows: TenantStatusRow[] = [
      { id: 2, status: "provisioning" }, // mid-flight, no file yet
      { id: 3, status: "provisioning" }, // crashed leftover, still no file
    ];

    const result = checkTenantCompleteness(tenantRows, []);

    expect(result.missingIds).toEqual([]);
    expect(result.provisioningIds).toEqual([2, 3]);
  });

  it("never counts an 'archived' tenant as missing even though its file is expected to be gone", () => {
    const tenantRows: TenantStatusRow[] = [{ id: 9, status: "archived" }];

    const result = checkTenantCompleteness(tenantRows, []);

    expect(result.missingIds).toEqual([]);
    expect(result.orphanIds).toEqual([]);
    expect(result.provisioningIds).toEqual([]);
  });

  it("reports a file with no matching platform row at all as an orphan, never a failure signal", () => {
    const tenantRows: TenantStatusRow[] = [{ id: 1, status: "active" }];
    const foundIds = [1, 42]; // 42.db exists but no platform row references it

    const result = checkTenantCompleteness(tenantRows, foundIds);

    expect(result.missingIds).toEqual([]);
    expect(result.orphanIds).toEqual([42]);
  });

  it("EXPECTED_TENANT_STATUSES is exactly active + suspended (documents the contract the tests above assume)", () => {
    expect([...EXPECTED_TENANT_STATUSES].sort()).toEqual(["active", "suspended"]);
  });

  it("sorts missingIds/orphanIds/provisioningIds ascending regardless of input order", () => {
    const tenantRows: TenantStatusRow[] = [
      { id: 9, status: "active" },
      { id: 2, status: "active" },
      { id: 5, status: "provisioning" },
      { id: 3, status: "provisioning" },
    ];

    const result = checkTenantCompleteness(tenantRows, [7, 1]);

    expect(result.missingIds).toEqual([2, 9]);
    expect(result.orphanIds).toEqual([1, 7]);
    expect(result.provisioningIds).toEqual([3, 5]);
  });
});
