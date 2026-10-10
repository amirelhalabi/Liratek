/**
 * LIRA-296 (T031, rule 26) — `WARRANTY_COST` rows in the Transactions table.
 * They are system-written siblings of an operator's warranty claim
 * (`metadata.is_auto = true`), so the default view hides them; the
 * "Warranty Cost" type filter reveals them. Absent/unparsable metadata reads
 * as visible (the safe direction). No cash badge: the row moves no drawer.
 */
import { FILTER_GROUPS, isWarrantyCostVisible } from "../auditConstants";
import { presentationFor } from "../transactionPresentation";

const AUTO = JSON.stringify({ is_auto: true, warranty_claim_id: 4 });

describe("WARRANTY_COST rows", () => {
  it("hidden by default when auto, shown by the Warranty Cost filter", () => {
    expect(isWarrantyCostVisible(AUTO, undefined)).toBe(false);
    expect(isWarrantyCostVisible(AUTO, { type: "SALE" })).toBe(false);
    expect(isWarrantyCostVisible(AUTO, { type: "WARRANTY_COST" })).toBe(true);
  });

  it("missing or broken metadata reads as visible", () => {
    expect(isWarrantyCostVisible(null, undefined)).toBe(true);
    expect(isWarrantyCostVisible("{not json", undefined)).toBe(true);
  });

  it("has a Warranty Cost filter option", () => {
    const all = FILTER_GROUPS.flatMap((g) => g.options);
    expect(all).toContainEqual(
      expect.objectContaining({
        type: "WARRANTY_COST",
        label: "Warranty Cost",
      }),
    );
  });

  it("is labelled and carries no cash badge", () => {
    expect(presentationFor("WARRANTY_COST")).toMatchObject({
      label: "Warranty Cost",
      direction: null,
    });
  });
});
