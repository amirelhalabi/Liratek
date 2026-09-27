/**
 * `migrateAllTenants()` — the boot-time "migrate every shop file" step
 * (§ 12.2: "Every shop file is migrated at boot ... A failure is logged for
 * that shop and not fatal."). Pure function, driven with a fake pool — no
 * real files needed, that part of the contract is `TenantDatabasePool`'s own
 * tests' job.
 */
import { migrateAllTenants } from "../migrateAllTenants.js";
import type { MigratableTenantPool } from "../migrateAllTenants.js";

describe("migrateAllTenants", () => {
  it("calls pool.get(id) for every id and reports all-ok when none throw", () => {
    const seen: number[] = [];
    const pool: MigratableTenantPool = {
      get: (id) => {
        seen.push(id);
        return {};
      },
    };
    const onError = jest.fn();

    const result = migrateAllTenants([1, 5, 7], pool, onError);

    expect(seen).toEqual([1, 5, 7]);
    expect(onError).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: 3, failed: 0, failedIds: [] });
  });

  it("one tenant's failure does not stop the others from being attempted", () => {
    // Brand-new module (rule 17: honestly not seen failing on unfixed code —
    // there is no "before" version of this file). The behaviour this guards
    // is real regardless: a naive `ids.forEach(id => pool.get(id))` with no
    // try/catch would stop at the first throw and never attempt tenant 7.
    const seen: number[] = [];
    const pool: MigratableTenantPool = {
      get: (id) => {
        seen.push(id);
        if (id === 5) throw new Error("migration failed for tenant 5");
        return {};
      },
    };
    const onError = jest.fn();

    const result = migrateAllTenants([1, 5, 7], pool, onError);

    expect(seen).toEqual([1, 5, 7]); // tenant 7 WAS attempted despite 5 throwing
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(5, expect.any(Error));
    expect(result).toEqual({ ok: 2, failed: 1, failedIds: [5] });
  });

  it("reports every failing id, in order, when more than one tenant fails", () => {
    const pool: MigratableTenantPool = {
      get: (id) => {
        if (id === 2 || id === 4) throw new Error(`bad tenant ${id}`);
        return {};
      },
    };
    const onError = jest.fn();

    const result = migrateAllTenants([1, 2, 3, 4], pool, onError);

    expect(result).toEqual({ ok: 2, failed: 2, failedIds: [2, 4] });
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("returns all-zero for an empty id list without calling pool.get at all", () => {
    const get = jest.fn();
    const onError = jest.fn();

    const result = migrateAllTenants([], { get }, onError);

    expect(get).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: 0, failed: 0, failedIds: [] });
  });
});
