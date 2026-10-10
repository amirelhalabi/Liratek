/**
 * LIRA-297 (rule 21/24) — `createProduct` takes the product form payload
 * (`CreateProductPayload`, core's `productFormCreateSchema`). On desktop it
 * goes to IPC as-is; on web it is translated to the REST route's
 * `createProductSchema` names. Every key of the form schema must reach the
 * REST body under SOME name, or be listed below as deliberately not sent —
 * this is the test that catches the next silently dropped field.
 *
 * Field names are read from the schemas' own `.shape` (rule 24).
 */

import {
  createProductSchema,
  productFormCreateSchema,
  type CreateProductPayload,
} from "@liratek/core";

export {}; // module scope

function okJson(data: unknown) {
  return {
    ok: true,
    status: 201,
    text: async () => JSON.stringify(data),
  } as any;
}

/** Form key → the REST body key it travels under. */
const REST_NAME: Partial<Record<keyof CreateProductPayload, string>> = {
  cost_price: "cost_price_usd",
  retail_price: "retail_price_usd",
  stock_quantity: "stock",
  min_stock_level: "min_stock_threshold",
};

/** Form keys the REST create route has no field for — not sent on web.
 *  `whish_price` is not read by the desktop handler either; `image_url` is
 *  read on desktop but no caller sends it and REST has no column mapping. */
const NOT_SENT_ON_WEB: ReadonlyArray<string> = ["whish_price", "image_url"];

const PAYLOAD: CreateProductPayload = {
  barcode: "1234567890",
  name: "USB cable",
  category: "Accessories",
  cost_price: 2,
  retail_price: 5,
  whish_price: 6,
  stock_quantity: 3,
  min_stock_level: 4,
  image_url: "x.png",
  supplier: "Acme",
  warranty_months: 12,
  is_old_stock: true,
};

describe("backendApi.createProduct dual-mode", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    jest.clearAllMocks();
  });

  it("the fixture sets every form-schema key", () => {
    expect(Object.keys(PAYLOAD).sort()).toEqual(
      Object.keys(productFormCreateSchema.shape).sort(),
    );
  });

  it("in Electron mode: sends the payload to IPC unchanged", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;
    const createProduct = jest.fn(async () => ({ success: true, id: 9 }));
    (globalThis as any).window.api = { inventory: { createProduct } };

    const apiMod = await import("../backendApi");
    const result = await apiMod.createProduct(PAYLOAD);

    expect(createProduct).toHaveBeenCalledWith(PAYLOAD);
    expect(result).toEqual({ success: true, id: 9 });
  });

  it("in Web mode: every form key reaches the REST body (or is listed as not sent)", async () => {
    globalThis.fetch = jest.fn(async () =>
      okJson({ success: true, data: { id: 9 } }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.createProduct(PAYLOAD);
    expect(result).toMatchObject({ success: true, id: 9 });

    const init = (globalThis.fetch as jest.Mock).mock.calls[0][1];
    const body = JSON.parse(init.body);
    const restKeys = Object.keys(createProductSchema.shape);

    for (const key of Object.keys(productFormCreateSchema.shape)) {
      if (NOT_SENT_ON_WEB.includes(key)) {
        continue;
      }
      const restKey = REST_NAME[key as keyof CreateProductPayload] ?? key;
      // The REST schema must know the name, or Zod strips it server-side.
      expect(restKeys).toContain(restKey);
      expect(body).toHaveProperty(
        restKey,
        PAYLOAD[key as keyof CreateProductPayload],
      );
    }
  });

  it.each([12, 0, null])(
    "in Web mode: the REST create schema accepts the body with warranty_months=%p and keeps it",
    async (warranty_months) => {
      globalThis.fetch = jest.fn(async () =>
        okJson({ success: true, data: { id: 9 } }),
      ) as any;

      const apiMod = await import("../backendApi");
      await apiMod.createProduct({ ...PAYLOAD, warranty_months });

      const body = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body,
      );
      const parsed = createProductSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.warranty_months).toBe(warranty_months);
        expect(parsed.data.cost_price_usd).toBe(PAYLOAD.cost_price);
        expect(parsed.data.retail_price_usd).toBe(PAYLOAD.retail_price);
        expect(parsed.data.stock).toBe(PAYLOAD.stock_quantity);
      }
    },
  );

  it("in Web mode: a code-less product sends no barcode (the server generates one)", async () => {
    globalThis.fetch = jest.fn(async () =>
      okJson({ success: true, data: { id: 9 } }),
    ) as any;

    const apiMod = await import("../backendApi");
    await apiMod.createProduct({ ...PAYLOAD, barcode: null });

    const body = JSON.parse((globalThis.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).not.toHaveProperty("barcode");
  });
});
