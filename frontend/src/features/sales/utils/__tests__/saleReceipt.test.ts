/**
 * LIRA-333 T011 — the ONE receipt description of a saved sale (FR-006,
 * FR-007, data-model.md). The paper reprint, the post-sale strip and the
 * WhatsApp message all build from `buildSaleReceiptData`, so this pins every
 * mapping. Fixtures are typed by the shared `SaleDetail`/`SaleDetailItem`
 * (rule 24), never hand-typed field names.
 */
import { receiptNumberFor } from "@liratek/core";
import type {
  SaleDetail,
  SaleDetailItem,
} from "@/features/sales/types/saleDetail";
import type { ShopInfo } from "@/hooks/useShopName";
import { buildSaleReceiptData, recipientPhoneFor } from "../saleReceipt";

const shop: ShopInfo = {
  name: "Corner Shop",
  phone: "70 123 456",
  location: "Hamra, Beirut",
  logo: "",
  headerText: "Open 9–9",
  warrantyTerms: "Warranty void if opened.",
};

function sale(over: Partial<SaleDetail> = {}): SaleDetail {
  return {
    id: 42,
    client_id: 7,
    client_name: "Ali",
    client_phone: "76 901 610",
    total_amount_usd: 30,
    discount_usd: 0,
    final_amount_usd: 30,
    extra_usd: 0,
    // deliberately different from tender_*: a later repayment raised them
    paid_usd: 30,
    paid_lbp: 0,
    change_given_usd: 1,
    change_given_lbp: 50_000,
    exchange_rate_snapshot: 89_000,
    status: "completed",
    created_at: "2026-10-10 08:15:00",
    sale_phone: "03 123 456",
    linked_client_phone: "76 901 610",
    tender_usd: 11,
    tender_lbp: 89_000,
    gift_card_usd: 5,
    on_account_usd: 14,
    ...over,
  };
}

const items: SaleDetailItem[] = [
  {
    id: 1,
    sale_id: 42,
    product_id: 9,
    quantity: 2,
    sold_price_usd: 10,
    name: "Charger",
    barcode: "123",
    imei: "356000000000001",
    serial_label: "Serial",
    warranty_until: "2027-04-10",
  },
  {
    id: 2,
    sale_id: 42,
    product_id: 10,
    quantity: 1,
    sold_price_usd: 10,
    name: "Cable",
    barcode: "456",
  },
];

describe("buildSaleReceiptData (data-model.md)", () => {
  it("maps every field from the saved sale", () => {
    const d = buildSaleReceiptData(sale({ extra_usd: 2 }), items, shop);
    expect(d).toEqual({
      shop_name: "Corner Shop",
      shop_phone: "70 123 456",
      shop_location: "Hamra, Beirut",
      header_text: "Open 9–9",
      warranty_terms: "Warranty void if opened.",
      receipt_number: receiptNumberFor(42),
      timestamp: "2026-10-10 08:15:00",
      client_name: "Ali",
      client_phone: "03 123 456",
      items: [
        {
          name: "Charger",
          quantity: 2,
          price: 10,
          subtotal: 20,
          imei: "356000000000001",
          serial_label: "Serial",
          warranty_until: "2027-04-10",
        },
        {
          name: "Cable",
          quantity: 1,
          price: 10,
          subtotal: 10,
          imei: null,
          serial_label: null,
          warranty_until: null,
        },
      ],
      subtotal: 30,
      discount: 0,
      extra: 2,
      total: 32,
      payment_usd: 11,
      payment_lbp: 89_000,
      gift_card_usd: 5,
      on_account_usd: 14,
      on_account_lbp: 0,
      change_usd: 1,
      change_lbp: 50_000,
      exchange_rate: 89_000,
    });
  });

  it("reads tender_*, never paid_* (a repayment changes paid_*)", () => {
    const d = buildSaleReceiptData(
      sale({ paid_usd: 999, paid_lbp: 999, tender_usd: 3, tender_lbp: 0 }),
      items,
      shop,
    );
    expect(d.payment_usd).toBe(3);
    expect(d.payment_lbp).toBe(0);
  });

  it("reads missing receipt fields (older server) as 0 / walk-in", () => {
    // an older server sends none of the LIRA-333 fields
    const {
      sale_phone: _a,
      linked_client_phone: _b,
      tender_usd: _c,
      tender_lbp: _d,
      gift_card_usd: _e,
      on_account_usd: _f,
      ...older
    } = sale({ client_name: null, extra_usd: null });
    void [_a, _b, _c, _d, _e, _f];
    const d = buildSaleReceiptData(older, items, shop);
    expect(d.client_name).toBe("Walk-in Customer");
    expect(d.client_phone).toBe("");
    expect(d.payment_usd).toBe(0);
    expect(d.payment_lbp).toBe(0);
    expect(d.gift_card_usd).toBe(0);
    expect(d.on_account_usd).toBe(0);
    expect(d.extra).toBe(0);
    expect(d.total).toBe(30);
  });

  it("the same sale always gives the same description (SC-003)", () => {
    expect(buildSaleReceiptData(sale(), items, shop)).toEqual(
      buildSaleReceiptData(sale(), items, shop),
    );
  });
});

describe("recipientPhoneFor (FR-012)", () => {
  it("prefers the phone saved with the sale", () => {
    expect(recipientPhoneFor(sale())).toBe("03 123 456");
  });

  it("falls back to the linked client's phone", () => {
    expect(recipientPhoneFor(sale({ sale_phone: "  " }))).toBe("76 901 610");
    expect(recipientPhoneFor(sale({ sale_phone: null }))).toBe("76 901 610");
  });

  it("is null when the sale has neither", () => {
    expect(
      recipientPhoneFor(sale({ sale_phone: null, linked_client_phone: null })),
    ).toBeNull();
  });

  it("never reads the display client_phone", () => {
    expect(
      recipientPhoneFor(
        sale({
          sale_phone: null,
          linked_client_phone: null,
          client_phone: "70 000 000",
        }),
      ),
    ).toBeNull();
  });
});
