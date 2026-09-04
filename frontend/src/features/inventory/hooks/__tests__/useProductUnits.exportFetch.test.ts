/** @jest-environment jsdom */
/**
 * LIRA-143 owner item #6 — `fetchAllUnitsForExport`, the I/O half of "export
 * every row matching the current filters". The page-loop ARITHMETIC is covered
 * in `pages/PhoneUnits/__tests__/phoneUnitsLogic.test.ts` (`planExportFetch`);
 * this file covers what the loop does with the plan: the calls it actually
 * makes, the filters it carries on every one of them, and the two ways it
 * stops early.
 */
import { fetchAllUnitsForExport } from "../useProductUnits";
import type {
  UnitListFilters,
  UnitListResult,
  UnitListRowWithWarranty,
} from "../useProductUnits";
import { planExportFetch } from "../../pages/PhoneUnits/phoneUnitsLogic";

function row(id: number): UnitListRowWithWarranty {
  return {
    id,
    product_id: 7,
    imei: `35693803564${String(id).padStart(4, "0")}`,
    status: "IN_STOCK",
    is_defective: 0,
    warranty_override_until: null,
    created_at: "2026-08-01 10:00:00",
    product_name: "iPhone 15 Pro",
    product_deleted: null,
    product_warranty_months: null,
    sale_item_id: null,
    sold_at: null,
    sold_price_usd: null,
    client_name: null,
    warranty_until: null,
    sale_refunded: null,
    warranty: { source: null, until: null, state: "NONE" },
  };
}

/** A `list` stub that serves `total` rows out of an in-memory set, honouring
 *  limit/offset exactly as the real endpoint does. */
function serverWith(total: number) {
  const all = Array.from({ length: total }, (_, i) => row(i + 1));
  const calls: UnitListFilters[] = [];
  const list = jest.fn(async (filters: UnitListFilters) => {
    calls.push(filters);
    return {
      rows: all.slice(filters.offset, filters.offset + filters.limit),
      total,
    } satisfies UnitListResult;
  });
  return { list, calls };
}

describe("fetchAllUnitsForExport", () => {
  it("assembles every row across pages, in order, and reports the call count", async () => {
    const { list, calls } = serverWith(450);
    const result = await fetchAllUnitsForExport(list, {}, planExportFetch(450));

    expect(result.calls).toBe(3);
    expect(list).toHaveBeenCalledTimes(3);
    expect(result.rows).toHaveLength(450);
    expect(result.capped).toBe(false);
    expect(result.rows[0]!.id).toBe(1);
    expect(result.rows[449]!.id).toBe(450);
    expect(calls.map((c) => c.offset)).toEqual([0, 200, 400]);
    expect(calls.map((c) => c.limit)).toEqual([200, 200, 50]);
  });

  it("carries the SAME filters on every page — an export cannot drift mid-loop", async () => {
    const { list, calls } = serverWith(450);
    await fetchAllUnitsForExport(
      list,
      { status: "IN_STOCK", defectiveOnly: true, search: "iPhone" },
      planExportFetch(450),
    );

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.status).toBe("IN_STOCK");
      expect(call.defectiveOnly).toBe(true);
      expect(call.search).toBe("iPhone");
    }
  });

  it("makes no request at all when nothing matched", async () => {
    const { list } = serverWith(0);
    const result = await fetchAllUnitsForExport(list, {}, planExportFetch(0));
    expect(list).not.toHaveBeenCalled();
    expect(result).toEqual({ rows: [], capped: false, calls: 0 });
  });

  it("stops ON the cap and flags it — never more rows than the plan allows", async () => {
    const { list } = serverWith(5400);
    const result = await fetchAllUnitsForExport(
      list,
      {},
      planExportFetch(5400),
    );
    expect(result.rows).toHaveLength(5000);
    expect(result.capped).toBe(true);
    expect(list).toHaveBeenCalledTimes(25);
  });

  it("stops early when a page comes back SHORT (rows deleted mid-loop)", async () => {
    // The plan was built from total=450, but the second page returns only 30
    // rows — a concurrent delete shrank the result set. Continuing would fire
    // a third request into empty space.
    const list = jest
      .fn<Promise<UnitListResult>, [UnitListFilters]>()
      .mockResolvedValueOnce({
        rows: Array.from({ length: 200 }, (_, i) => row(i + 1)),
        total: 450,
      })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 30 }, (_, i) => row(200 + i + 1)),
        total: 230,
      });

    const result = await fetchAllUnitsForExport(list, {}, planExportFetch(450));

    expect(list).toHaveBeenCalledTimes(2);
    expect(result.calls).toBe(2);
    expect(result.rows).toHaveLength(230);
  });

  it("never over-collects if the server ignores a short last limit", async () => {
    // A server that always returns a full 200 despite `limit: 50` must not be
    // able to push the export past the plan's row count.
    const all = Array.from({ length: 450 }, (_, i) => row(i + 1));
    const list = jest.fn(async (filters: UnitListFilters) => ({
      rows: all.slice(filters.offset, filters.offset + 200),
      total: 450,
    }));

    const result = await fetchAllUnitsForExport(list, {}, planExportFetch(450));
    expect(result.rows).toHaveLength(450);
  });

  it("propagates a failed page instead of writing a silently partial export", async () => {
    const list = jest
      .fn<Promise<UnitListResult>, [UnitListFilters]>()
      .mockResolvedValueOnce({
        rows: Array.from({ length: 200 }, (_, i) => row(i + 1)),
        total: 450,
      })
      .mockRejectedValueOnce(new Error("IPC failed"));

    await expect(
      fetchAllUnitsForExport(list, {}, planExportFetch(450)),
    ).rejects.toThrow("IPC failed");
  });
});
