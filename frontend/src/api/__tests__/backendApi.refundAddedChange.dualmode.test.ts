/**
 * LIRA-342 — "+ Customer gives change" in the refund window: the claim
 * (`refundAddedChangeSchema`, rule 24 — fixture parsed through the core
 * schema) rides on BOTH transports with the same shape (rule 22):
 * - generic refund: IPC 6th positional arg / REST body `addedChange`;
 * - POS Refund Sale: IPC 6th positional arg / REST body `addedChange`.
 *
 * Rule 17 disclosure: written AFTER the adapter change — NOT proven
 * failing-first.
 */
import { refundAddedChangeSchema } from "@liratek/core";

export {};

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

const LEGS = [{ method: "CASH", currencyCode: "USD" as const, amount: 55 }];
const ADDED = refundAddedChangeSchema.parse({
  added_change_usd: 2.78,
  added_change_lbp: 0,
  customerPayments: [{ method: "CASH", currencyCode: "LBP", amount: 250_000 }],
});

type Win = { api?: unknown };
const win = (): Win => (globalThis as unknown as { window: Win }).window;

describe("backendApi — refund added change, dual mode", () => {
  beforeEach(() => {
    jest.resetModules();
    const g = globalThis as unknown as { window?: Win };
    g.window = g.window || {};
  });
  afterEach(() => {
    delete win().api;
    jest.clearAllMocks();
  });

  it("refundTransaction, Electron: addedChange is the 6th positional arg", async () => {
    const refund = jest.fn(async () => ({ success: true, refundId: 1 }));
    win().api = { transactions: { refund } };
    const apiMod = await import("../backendApi");
    await apiMod.refundTransaction(
      9,
      LEGS,
      undefined,
      90_000,
      undefined,
      ADDED,
    );
    expect(refund).toHaveBeenCalledWith(
      9,
      LEGS,
      undefined,
      90_000,
      undefined,
      ADDED,
    );
  });

  it("refundTransaction, web: REST body carries addedChange", async () => {
    delete win().api;
    globalThis.fetch = jest.fn(async () =>
      okJson({ success: true, refundId: 2 }),
    ) as unknown as typeof fetch;
    const apiMod = await import("../backendApi");
    await apiMod.refundTransaction(
      9,
      LEGS,
      undefined,
      90_000,
      undefined,
      ADDED,
    );
    const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/transactions/9/refund");
    const body = JSON.parse(options.body);
    expect(refundAddedChangeSchema.parse(body.addedChange)).toEqual(ADDED);
    expect(body.refundLegs).toEqual(LEGS);
    expect(body.exchangeRate).toBe(90_000);
  });

  it("refundSale, Electron: addedChange is the 6th positional arg", async () => {
    const refund = jest.fn(async () => ({ success: true, refundId: 3 }));
    win().api = { sales: { refund } };
    const apiMod = await import("../backendApi");
    await apiMod.refundSale(7, LEGS, undefined, 90_000, undefined, ADDED);
    expect(refund).toHaveBeenCalledWith(
      7,
      LEGS,
      undefined,
      90_000,
      undefined,
      ADDED,
    );
  });

  it("refundSale, web: REST body carries addedChange", async () => {
    delete win().api;
    globalThis.fetch = jest.fn(async () =>
      okJson({ success: true, refundId: 4 }),
    ) as unknown as typeof fetch;
    const apiMod = await import("../backendApi");
    await apiMod.refundSale(7, LEGS, undefined, 90_000, undefined, ADDED);
    const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/sales/7/refund");
    expect(JSON.parse(options.body)).toEqual({
      refundLegs: LEGS,
      exchangeRate: 90_000,
      addedChange: ADDED,
    });
  });
});
