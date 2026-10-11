/**
 * LIRA-256 — OMT statement commission types. The ONE "is this row covered
 * by the statement" predicate (rule 14), shared by the statement check,
 * the settlement guard and both settle screens.
 *
 * RULE 17 — written before `utils/omtCoveredTypes.ts` existed; first run
 * failed with "Cannot find module '../omtCoveredTypes'".
 */
import fs from "fs";
import path from "path";
import {
  isOmtRowCovered,
  normaliseCoveredTypes,
  coveredTypeLabel,
  OMT_COVERED_TYPE_VALUES,
} from "../omtCoveredTypes";
import { OMT_SERVICE_TYPES } from "../omtFees";

describe("isOmtRowCovered", () => {
  it("no choice (undefined) covers every row", () => {
    expect(
      isOmtRowCovered(
        { provider: "OMT", omt_service_type: "WESTERN_UNION" },
        undefined,
      ),
    ).toBe(true);
    expect(
      isOmtRowCovered({ provider: "OMT", omt_service_type: null }, undefined),
    ).toBe(true);
  });

  it("a non-OMT row is always covered (only OMT counter rows carry a type)", () => {
    expect(
      isOmtRowCovered({ provider: "WHISH", omt_service_type: null }, ["INTRA"]),
    ).toBe(true);
    expect(
      isOmtRowCovered({ provider: "OMT_APP", omt_service_type: null }, [
        "INTRA",
      ]),
    ).toBe(true);
  });

  it("an OMT row is covered only when its type is in the list", () => {
    expect(
      isOmtRowCovered({ provider: "OMT", omt_service_type: "INTRA" }, [
        "INTRA",
      ]),
    ).toBe(true);
    expect(
      isOmtRowCovered({ provider: "OMT", omt_service_type: "INTRA" }, [
        "WESTERN_UNION",
      ]),
    ).toBe(false);
  });

  it("an OMT row without a type is covered only by UNSPECIFIED", () => {
    expect(
      isOmtRowCovered({ provider: "OMT", omt_service_type: null }, ["INTRA"]),
    ).toBe(false);
    expect(
      isOmtRowCovered({ provider: "OMT", omt_service_type: null }, [
        "INTRA",
        "UNSPECIFIED",
      ]),
    ).toBe(true);
  });
});

describe("normaliseCoveredTypes / coveredTypeLabel", () => {
  it("de-duplicates and orders by the tuple, UNSPECIFIED last", () => {
    expect(normaliseCoveredTypes(["WESTERN_UNION", "INTRA", "INTRA"])).toEqual([
      "INTRA",
      "WESTERN_UNION",
    ]);
    expect(normaliseCoveredTypes(["UNSPECIFIED", "OMT_CARD"])).toEqual([
      "OMT_CARD",
      "UNSPECIFIED",
    ]);
    expect(OMT_COVERED_TYPE_VALUES[OMT_COVERED_TYPE_VALUES.length - 1]).toBe(
      "UNSPECIFIED",
    );
  });

  it("labels", () => {
    expect(coveredTypeLabel("UNSPECIFIED")).toBe("Type not recorded");
    expect(coveredTypeLabel("WESTERN_UNION")).toBe("Western Union");
    // every value has a non-empty human label
    for (const v of OMT_COVERED_TYPE_VALUES)
      expect(coveredTypeLabel(v).length).toBeGreaterThan(0);
  });
});

describe("OMT_SERVICE_TYPES parity with the database CHECK", () => {
  it("equals, as a set, the values in create_db.sql's omt_service_type CHECK", () => {
    const sqlPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "electron-app",
      "create_db.sql",
    );
    const sql = fs.readFileSync(sqlPath, "utf8");
    const m = sql.match(
      /omt_service_type TEXT CHECK\(omt_service_type IN \(([^)]*)\)\)/,
    );
    expect(m).not.toBeNull();
    const dbValues = m![1].split(",").map((v) => v.trim().replace(/'/g, ""));
    expect(new Set(dbValues)).toEqual(new Set(OMT_SERVICE_TYPES));
    expect(dbValues).toHaveLength(OMT_SERVICE_TYPES.length);
  });
});
