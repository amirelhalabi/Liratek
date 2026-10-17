/**
 * LIRA-333 T021 — the shared "Send on WhatsApp" hook behind the post-sale
 * strip and the sale details window.
 *
 *  - prefetches the saved sale once per sale id (so the click can open
 *    WhatsApp inside the browser's gesture window);
 *  - `send()` calls `openExternalUrl` SYNCHRONOUSLY with the one shared
 *    description's link;
 *  - no phone on the sale → asks for one; an invalid typed number is
 *    refused without opening anything;
 *  - a blocked pop-up is shown, never swallowed (FR-018);
 *  - FR-023: across every path, nothing but the reads and the open is
 *    called — no write.
 *
 * `mockApi` is module-level, so `useApi()` returns a stable identity
 * (rule 25).
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { toWhatsAppNumber } from "@liratek/core";
import type {
  SaleDetail,
  SaleDetailItem,
} from "@/features/sales/types/saleDetail";
import type { ShopInfo } from "@/hooks/useShopName";
import { buildSaleReceiptData } from "@/features/sales/utils/saleReceipt";
import {
  buildWhatsAppLink,
  formatReceiptWhatsApp,
} from "@/features/sales/utils/receiptFormatter";

const mockGetSale = jest.fn();
const mockGetSaleItems = jest.fn();
const mockOpenExternalUrl = jest.fn();
const mockWrite = jest.fn();

// Every other ApiAdapter method resolves to mockWrite, so ANY write the
// hook made would be recorded there (FR-023 guard).
const mockApi: Record<string, jest.Mock> = new Proxy(
  {
    getSale: mockGetSale,
    getSaleItems: mockGetSaleItems,
    openExternalUrl: mockOpenExternalUrl,
  } as Record<string, jest.Mock>,
  {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => mockWrite(prop, ...args);
    },
  },
);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const mockShop: ShopInfo = {
  name: "Corner Shop",
  phone: "70 123 456",
  location: "Hamra",
  logo: "",
  headerText: "",
  warrantyTerms: "",
};
jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => mockShop,
}));

import { useSendReceiptOnWhatsApp } from "../useSendReceiptOnWhatsApp";

function sale(over: Partial<SaleDetail> = {}): SaleDetail {
  return {
    id: 42,
    client_id: 7,
    client_name: "Ali",
    client_phone: "03 123 456",
    total_amount_usd: 10,
    discount_usd: 0,
    final_amount_usd: 10,
    extra_usd: 0,
    paid_usd: 10,
    paid_lbp: 0,
    change_given_usd: 0,
    change_given_lbp: 0,
    exchange_rate_snapshot: 89_000,
    status: "completed",
    created_at: "2026-10-10 08:15:00",
    sale_phone: "03 123 456",
    linked_client_phone: "03 123 456",
    tender_usd: 10,
    tender_lbp: 0,
    gift_card_usd: 0,
    on_account_usd: 0,
    ...over,
  };
}

const items: SaleDetailItem[] = [
  {
    id: 1,
    sale_id: 42,
    product_id: 9,
    quantity: 1,
    sold_price_usd: 10,
    name: "Cable",
    barcode: "1",
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSaleItems.mockResolvedValue(items);
  mockOpenExternalUrl.mockResolvedValue({ success: true });
});

afterEach(() => {
  // FR-023: no path ever writes.
  expect(mockWrite).not.toHaveBeenCalled();
});

async function ready(s: SaleDetail) {
  mockGetSale.mockResolvedValue(s);
  const hook = renderHook(() => useSendReceiptOnWhatsApp(s.id));
  await waitFor(() => expect(hook.result.current.status).toBe("ready"));
  return hook;
}

describe("useSendReceiptOnWhatsApp", () => {
  it("prefetches the saved sale once per sale id", async () => {
    const hook = await ready(sale());
    hook.rerender();
    hook.rerender();
    expect(mockGetSale).toHaveBeenCalledTimes(1);
    expect(mockGetSale).toHaveBeenCalledWith(42);
    expect(mockGetSaleItems).toHaveBeenCalledTimes(1);
    expect(mockGetSaleItems).toHaveBeenCalledWith(42);
  });

  it("send() opens the one shared description's link, synchronously", async () => {
    const s = sale();
    const hook = await ready(s);
    const expectedUrl = buildWhatsAppLink(
      "9613123456",
      formatReceiptWhatsApp(buildSaleReceiptData(s, items, mockShop)),
    );
    expect(toWhatsAppNumber(s.sale_phone)).toEqual({
      ok: true,
      digits: "9613123456",
    });

    act(() => {
      hook.result.current.send();
      // no await between the click and the open
      expect(mockOpenExternalUrl).toHaveBeenCalledTimes(1);
    });
    expect(mockOpenExternalUrl).toHaveBeenCalledWith({ url: expectedUrl });
  });

  it("asks for a number when the sale has none", async () => {
    const hook = await ready(
      sale({ sale_phone: null, linked_client_phone: null, client_id: null }),
    );
    expect(hook.result.current.needsNumber).toBe(true);
    act(() => hook.result.current.send());
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it("a typed number is used for this send only", async () => {
    const hook = await ready(
      sale({ sale_phone: null, linked_client_phone: null }),
    );
    act(() => hook.result.current.send("+33 6 12 34 56 78"));
    expect(mockOpenExternalUrl.mock.calls[0][0].url).toMatch(
      /^https:\/\/wa\.me\/33612345678\?text=/,
    );
  });

  it("refuses an invalid typed number without opening", async () => {
    const hook = await ready(
      sale({ sale_phone: null, linked_client_phone: null }),
    );
    act(() => hook.result.current.send("abc"));
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
    expect(hook.result.current.error).toMatch(/not a valid/i);
  });

  it("shows a blocked pop-up instead of failing silently (FR-018)", async () => {
    mockOpenExternalUrl.mockResolvedValue({ success: false, error: "blocked" });
    const hook = await ready(sale());
    act(() => hook.result.current.send());
    await waitFor(() =>
      expect(hook.result.current.error).toBe(
        "WhatsApp could not be opened — allow pop-ups and try again",
      ),
    );
  });

  it("reports a failed load and does not open", async () => {
    mockGetSale.mockRejectedValue(new Error("offline"));
    const hook = renderHook(() => useSendReceiptOnWhatsApp(42));
    await waitFor(() => expect(hook.result.current.status).toBe("error"));
    act(() => hook.result.current.send());
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it("refetches when the refresh key changes (a corrected phone is used)", async () => {
    mockGetSale.mockResolvedValueOnce(sale());
    const hook = renderHook(
      ({ key }: { key: number }) => useSendReceiptOnWhatsApp(42, key),
      { initialProps: { key: 0 } },
    );
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    mockGetSale.mockResolvedValueOnce(sale({ sale_phone: "76 901 610" }));
    hook.rerender({ key: 1 });
    await waitFor(() => expect(mockGetSale).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.status).toBe("ready"));
    act(() => hook.result.current.send());
    expect(mockOpenExternalUrl.mock.calls[0][0].url).toMatch(
      /^https:\/\/wa\.me\/96176901610\?/,
    );
  });

  it("does nothing for no sale", () => {
    const hook = renderHook(() => useSendReceiptOnWhatsApp(null));
    expect(hook.result.current.status).toBe("idle");
    expect(mockGetSale).not.toHaveBeenCalled();
  });
});
