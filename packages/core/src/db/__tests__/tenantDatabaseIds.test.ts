/**
 * `setTenantDatabaseIdLister` / `listTenantDatabaseIds` — the shop-id
 * listing contract (§ 12.2/§ 12.3 W3). Deliberately trivial: this module is
 * pure plumbing (install a function, call it back), and its only real
 * behavioural contract is "no lister installed ⇒ null, never []" — the
 * distinction Wave-2 fan-out consumers must respect (null means "can't
 * fan out here", not "zero tenants").
 */
import {
  setTenantDatabaseIdLister,
  listTenantDatabaseIds,
} from "../tenantDatabaseIds.js";

describe("tenantDatabaseIds", () => {
  afterEach(() => {
    setTenantDatabaseIdLister(null);
  });

  it("returns null when no lister has been installed", () => {
    expect(listTenantDatabaseIds()).toBeNull();
  });

  it("returns the installed lister's result", () => {
    setTenantDatabaseIdLister(() => [1, 5, 42]);
    expect(listTenantDatabaseIds()).toEqual([1, 5, 42]);
  });

  it("calling the lister again after data changes reflects the new result (no caching)", () => {
    let ids = [1];
    setTenantDatabaseIdLister(() => ids);
    expect(listTenantDatabaseIds()).toEqual([1]);
    ids = [1, 5];
    expect(listTenantDatabaseIds()).toEqual([1, 5]);
  });

  it("setTenantDatabaseIdLister(null) clears an installed lister back to null", () => {
    setTenantDatabaseIdLister(() => [1]);
    expect(listTenantDatabaseIds()).toEqual([1]);
    setTenantDatabaseIdLister(null);
    expect(listTenantDatabaseIds()).toBeNull();
  });
});
