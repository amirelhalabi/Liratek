/**
 * LIRA-306 T013 — id positions (R3, FR-014, FR-019).
 *
 * The server rewrites an offline id ONLY where the payload holds an id: keys
 * named `id`, `*_id`, `*Id` (and id arrays `ids`, `*_ids`, `*Ids`),
 * polymorphic pairs (`{kind, id}`, `referenceTable` + `referenceId`), nested
 * payloads (`cartItems[].formData`) and JSON strings in declared keys
 * (`form_data`, `formData`). A numeric string in an id position counts. A
 * value anywhere else is never touched — an LBP amount of 1 004 000 000 001,
 * a phone, an IMEI or a barcode can fall in the numeric range.
 */
import {
  collectIdPositions,
  rewriteIdPositions,
  offlineIdsOutsidePositions,
  isIdKey,
} from "../idPositions";

const C = 1_017_000_000_001; // PC 1, clients
const S = 1_023_000_000_001; // PC 1, sales
const SESSION = 1_026_000_000_001;
const MAP = new Map<number, number>([
  [C, 512],
  [S, 2001],
  [SESSION, 77],
]);
const lookup = (v: number) => MAP.get(v);

describe("idPositions", () => {
  it("recognises id-named keys only", () => {
    for (const k of ["id", "client_id", "clientId", "referenceId", "sale_item_id", "ids", "product_ids", "checkpointIds"]) {
      expect({ k, id: isIdKey(k) }).toEqual({ k, id: true });
    }
    for (const k of ["amount_lbp", "phone", "imei", "barcode", "paid", "valid", "reference_number", "item_key"]) {
      expect({ k, id: isIdKey(k) }).toEqual({ k, id: false });
    }
  });

  it("rewrites client_id, clientId, id, targets[].id, referenceId and nested formData ids", () => {
    const payload = {
      id: S,
      client_id: C,
      clientId: C,
      targets: [{ kind: "sale", id: S }],
      referenceTable: "sales",
      referenceId: S,
      cartItems: [{ item_id: "u-1", formData: { client_id: C, nested: { sale_id: S } } }],
      items: [{ product_id: 33, quantity: 1 }],
    };
    const { payload: out, unmapped } = rewriteIdPositions("session:checkout", payload, lookup);
    expect(unmapped).toEqual([]);
    expect(out).toEqual({
      id: 2001,
      client_id: 512,
      clientId: 512,
      targets: [{ kind: "sale", id: 2001 }],
      referenceTable: "sales",
      referenceId: 2001,
      cartItems: [{ item_id: "u-1", formData: { client_id: 512, nested: { sale_id: 2001 } } }],
      items: [{ product_id: 33, quantity: 1 }],
    });
    // pure: the input is not mutated
    expect(payload.client_id).toBe(C);
  });

  it("rewrites inside a JSON string in a declared key and writes it back as a string", () => {
    const payload = { sessionId: SESSION, form_data: JSON.stringify({ client_id: C, amount_lbp: C }) };
    const { payload: out } = rewriteIdPositions("session:cart:add", payload, lookup);
    expect(out.sessionId).toBe(77);
    expect(typeof out.form_data).toBe("string");
    expect(JSON.parse(out.form_data as string)).toEqual({ client_id: 512, amount_lbp: C });
  });

  it("treats a numeric string in an id position as an id and writes a string back", () => {
    const { payload: out } = rewriteIdPositions("clients:update", { id: String(C) }, lookup);
    expect(out.id).toBe("512");
  });

  it("never touches amounts, phones, IMEIs or barcodes in the offline range", () => {
    const payload = {
      client_id: C,
      amount_lbp: 1_004_000_000_001,
      phone: "1004000000001",
      imei: 1_017_000_000_001,
      barcode: "1023000000001",
      payments: [{ method: "CASH", currencyCode: "LBP", amount: 1_004_000_000_001 }],
    };
    const { payload: out } = rewriteIdPositions("sales:process", payload, lookup);
    expect(out).toEqual({ ...payload, client_id: 512 });
  });

  it("reports an in-range id with no map entry as unmapped and leaves it", () => {
    const missing = 1_017_000_000_999;
    const { payload: out, unmapped } = rewriteIdPositions("sales:process", { client_id: missing }, lookup);
    expect(unmapped).toEqual([missing]);
    expect(out.client_id).toBe(missing);
  });

  it("collectIdPositions lists every id position with its value (paths)", () => {
    const got = collectIdPositions("session:checkout", {
      sessionId: SESSION,
      clientId: 5,
      cartItems: [{ formData: { client_id: C } }],
      note: "id 1017000000001",
    });
    expect(got.map((p) => [p.path, p.value])).toEqual([
      ["sessionId", SESSION],
      ["clientId", 5],
      ["cartItems[0].formData.client_id", C],
    ]);
  });

  it("offlineIdsOutsidePositions reports an offline id in a non-id key (FR-014)", () => {
    expect(
      offlineIdsOutsidePositions({ client_id: C, ref: S, nested: { qty: SESSION }, amount_lbp: 5 }),
    ).toEqual([
      { path: "ref", value: S },
      { path: "nested.qty", value: SESSION },
    ]);
    expect(offlineIdsOutsidePositions({ client_id: C, phone: "1017000000001" })).toEqual([]);
  });
});
