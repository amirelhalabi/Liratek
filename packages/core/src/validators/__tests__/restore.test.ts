/**
 * LIRA-377 T011 — restore request schemas (contracts/rest.md).
 */
import {
  cancelRestoreSchema,
  confirmRestoreSchema,
  prepareRestoreSchema,
  restoreFileQuerySchema,
} from "../restore.js";

describe("prepareRestoreSchema", () => {
  it("accepts a time restore with a UTC instant", () => {
    const r = prepareRestoreSchema.safeParse({
      kind: "time",
      restoredTo: "2026-11-10T12:00:00Z",
      clientTzOffsetMin: 120,
    });
    expect(r.success).toBe(true);
  });

  it("accepts fractional seconds in UTC", () => {
    expect(
      prepareRestoreSchema.safeParse({
        kind: "time",
        restoredTo: "2026-11-10T12:00:00.123Z",
        clientTzOffsetMin: 0,
      }).success,
    ).toBe(true);
  });

  it("accepts an undo with a positive restoreId", () => {
    const r = prepareRestoreSchema.safeParse({ kind: "undo", restoreId: 12, clientTzOffsetMin: -300 });
    expect(r.success).toBe(true);
  });

  it.each([
    ["offset instead of Z", "2026-11-10T14:00:00+02:00"],
    ["no zone", "2026-11-10T12:00:00"],
    ["date only", "2026-11-10"],
    ["garbage", "yesterday at noon"],
    ["empty", ""],
  ])("refuses restoredTo: %s", (_label, restoredTo) => {
    expect(
      prepareRestoreSchema.safeParse({ kind: "time", restoredTo, clientTzOffsetMin: 0 }).success,
    ).toBe(false);
  });

  it("refuses an unknown kind", () => {
    expect(
      prepareRestoreSchema.safeParse({ kind: "file", restoreId: 1, clientTzOffsetMin: 0 }).success,
    ).toBe(false);
  });

  it("refuses a missing kind", () => {
    expect(prepareRestoreSchema.safeParse({ restoreId: 1, clientTzOffsetMin: 0 }).success).toBe(false);
  });

  it.each([-841, 841, 1.5, Number.NaN])("refuses clientTzOffsetMin %p", (clientTzOffsetMin) => {
    expect(
      prepareRestoreSchema.safeParse({ kind: "undo", restoreId: 1, clientTzOffsetMin }).success,
    ).toBe(false);
  });

  it.each([-840, 840])("accepts boundary clientTzOffsetMin %p", (clientTzOffsetMin) => {
    expect(
      prepareRestoreSchema.safeParse({ kind: "undo", restoreId: 1, clientTzOffsetMin }).success,
    ).toBe(true);
  });

  it("refuses a missing clientTzOffsetMin", () => {
    expect(
      prepareRestoreSchema.safeParse({ kind: "time", restoredTo: "2026-11-10T12:00:00Z" }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, "12"])("refuses undo restoreId %p", (restoreId) => {
    expect(
      prepareRestoreSchema.safeParse({ kind: "undo", restoreId, clientTzOffsetMin: 0 }).success,
    ).toBe(false);
  });
});

describe("confirmRestoreSchema", () => {
  it("accepts a restoreId and a typed name", () => {
    expect(confirmRestoreSchema.safeParse({ restoreId: 13, typedShopName: "CornerTech" }).success).toBe(true);
  });

  it.each([
    ["empty name", { restoreId: 13, typedShopName: "" }],
    ["name over 200", { restoreId: 13, typedShopName: "x".repeat(201) }],
    ["missing name", { restoreId: 13 }],
    ["zero id", { restoreId: 0, typedShopName: "CornerTech" }],
  ])("refuses %s", (_label, body) => {
    expect(confirmRestoreSchema.safeParse(body).success).toBe(false);
  });

  it("accepts a name of exactly 200 characters", () => {
    expect(confirmRestoreSchema.safeParse({ restoreId: 1, typedShopName: "x".repeat(200) }).success).toBe(true);
  });
});

describe("cancelRestoreSchema", () => {
  it("accepts a positive restoreId and refuses others", () => {
    expect(cancelRestoreSchema.safeParse({ restoreId: 13 }).success).toBe(true);
    expect(cancelRestoreSchema.safeParse({ restoreId: -1 }).success).toBe(false);
    expect(cancelRestoreSchema.safeParse({}).success).toBe(false);
  });
});

describe("restoreFileQuerySchema", () => {
  it("coerces the query-string offset to a number", () => {
    const r = restoreFileQuerySchema.safeParse({ clientTzOffsetMin: "180" });
    expect(r.success && r.data.clientTzOffsetMin).toBe(180);
  });

  it.each(["900", "-841", "abc", "1.5"])("refuses %p", (clientTzOffsetMin) => {
    expect(restoreFileQuerySchema.safeParse({ clientTzOffsetMin }).success).toBe(false);
  });

  it("refuses a missing offset", () => {
    expect(restoreFileQuerySchema.safeParse({}).success).toBe(false);
  });
});
