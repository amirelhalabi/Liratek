/** @jest-environment jsdom */
/**
 * LIRA-331 (money guard, rule 28d): the Phone Lines payloads are identical
 * whatever the UI language. Walks every write the page makes:
 *   - save a for-sale line's details (carrier, expiry, credit)
 *   - write off a lost line
 *   - recharge a line from each source: Days, Shop-line credit, Card
 * Each runs once in English and once in Arabic, driven by ids/test ids that
 * do not depend on the language; the captured payloads must deep-equal.
 * Not failing-first by nature (guard against future drift). The useApi mock
 * returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ResaleLineRow } from "@liratek/core";
import { i18n, loadLanguage } from "@/i18n/setup";
import { localDay } from "@/shared/utils/localDay";
import PhoneLines from "../index";

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDay(d);
}

const mockApi = {
  getAdminCarrierLines: jest.fn().mockResolvedValue([]),
  createCarrierLine: jest.fn(),
  updateCarrierLine: jest.fn(),
  archiveCarrierLine: jest.fn(),
  toggleCarrierLineActive: jest.fn(),
  setPrimaryCarrierLine: jest.fn(),
  getResaleLines: jest.fn(),
  saveResaleLine: jest.fn(),
  writeOffResaleLine: jest.fn(),
  rechargeResaleLine: jest.fn(),
  getAllActiveCarrierLines: jest.fn(),
  getActiveMobileServiceItems: jest.fn(),
};

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89000, buyRate: 89000, isLoading: false }),
}));

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function line(over: Partial<ResaleLineRow>): ResaleLineRow {
  return {
    product_id: 10,
    phone_number: "70444202",
    name: "Alfa line 70 444 202",
    category: "Phone Lines",
    cost_price_usd: 15,
    selling_price_usd: 25,
    stock_quantity: 1,
    is_unsold: 1,
    resale_line_id: 1,
    carrier: "alfa",
    credits: 0,
    validity_expires_at: inDays(10),
    ...over,
  };
}

type Lang = "en" | "ar";

function last(fn: jest.Mock): unknown {
  return fn.mock.calls[fn.mock.calls.length - 1][0];
}

async function renderPage(lang: Lang) {
  await i18n.changeLanguage(lang);
  const view = render(<PhoneLines />);
  return view;
}

async function saveFlow(lang: Lang): Promise<unknown> {
  const { container, unmount } = await renderPage(lang);
  fireEvent.click(await screen.findByTestId("resale-line-edit-10"));
  fireEvent.change(container.querySelector("#rl-carrier")!, {
    target: { value: "mtc" },
  });
  fireEvent.change(container.querySelector("#rl-expiry")!, {
    target: { value: "2026-12-01" },
  });
  fireEvent.change(container.querySelector("#rl-credits")!, {
    target: { value: "2.5" },
  });
  // The language really switched (otherwise equality is trivial).
  expect(screen.getByTestId("resale-line-save")).toHaveTextContent(
    lang === "ar" ? "احفظ الخط" : "Save line",
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("resale-line-save"));
  });
  await waitFor(() => expect(mockApi.saveResaleLine).toHaveBeenCalled());
  const p = last(mockApi.saveResaleLine);
  unmount();
  return p;
}

async function writeOffFlow(lang: Lang): Promise<unknown> {
  mockApi.getResaleLines.mockResolvedValue([
    line({ product_id: 20, validity_expires_at: inDays(-9), cost_price_usd: 18 }),
  ]);
  const { unmount } = await renderPage(lang);
  fireEvent.click(await screen.findByTestId("resale-line-writeoff-20"));
  await act(async () => {
    fireEvent.click(screen.getByTestId("resale-line-writeoff-confirm"));
  });
  await waitFor(() => expect(mockApi.writeOffResaleLine).toHaveBeenCalled());
  const p = last(mockApi.writeOffResaleLine);
  unmount();
  return p;
}

async function rechargeFlow(
  lang: Lang,
  source: "DAYS" | "SHOP_LINE_CREDIT" | "CARD",
): Promise<unknown> {
  const { container, unmount } = await renderPage(lang);
  const row = await screen.findByTestId("resale-line-10");
  // The row's first button is Recharge (the line is unsold, has a carrier,
  // and is not lost).
  fireEvent.click(row.querySelectorAll("button")[0]);
  await waitFor(() =>
    expect(
      (container.querySelector("#rr-shop-line") as HTMLSelectElement).value,
    ).toBe("4"),
  );
  fireEvent.click(screen.getByTestId(`recharge-source-${source}`));
  if (source === "DAYS") {
    fireEvent.change(container.querySelector("#rr-days")!, {
      target: { value: "30" },
    });
    fireEvent.change(container.querySelector("#rr-days-cost")!, {
      target: { value: "3" },
    });
  } else if (source === "SHOP_LINE_CREDIT") {
    fireEvent.change(container.querySelector("#rr-credits")!, {
      target: { value: "4" },
    });
  } else {
    fireEvent.change(container.querySelector("#rr-card")!, {
      target: { value: "11" },
    });
  }
  expect(screen.getByTestId("recharge-save")).toHaveTextContent(
    lang === "ar" ? "شرّج الخط" : "Recharge line",
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("recharge-save"));
  });
  await waitFor(() => expect(mockApi.rechargeResaleLine).toHaveBeenCalled());
  const p = last(mockApi.rechargeResaleLine);
  unmount();
  return p;
}

beforeAll(async () => {
  await loadLanguage("ar");
});
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getResaleLines.mockResolvedValue([line({})]);
  mockApi.saveResaleLine.mockResolvedValue({ success: true });
  mockApi.writeOffResaleLine.mockResolvedValue({
    success: true,
    data: { expense_id: 5 },
  });
  mockApi.rechargeResaleLine.mockResolvedValue({ success: true, data: {} });
  mockApi.getAllActiveCarrierLines.mockResolvedValue([
    { id: 4, carrier: "alfa", phone_number: "03222875", is_primary: 1, is_active: 1, credits: 20 },
  ]);
  mockApi.getActiveMobileServiceItems.mockResolvedValue([
    { id: 11, provider: "iPick", category: "alfa", subcategory: "Prepaid", label: "7.58", cost_lbp: 770000, credits: 7.58, validity_days: 30, is_active: 1 },
  ]);
});
afterEach(() => i18n.changeLanguage("en"));

describe("Phone Lines payloads do not depend on the UI language", () => {
  it("save a for-sale line's details", async () => {
    const en = await saveFlow("en");
    const ar = await saveFlow("ar");
    expect(ar).toEqual(en);
    expect(en).toEqual({
      product_id: 10,
      carrier: "mtc",
      validity_expires_at: "2026-12-01",
      credits: 2.5,
    });
  });

  it("write off a lost line", async () => {
    const en = await writeOffFlow("en");
    const ar = await writeOffFlow("ar");
    expect(ar).toEqual(en);
    expect(en).toEqual({ product_id: 20, client_day: localDay() });
  });

  it.each([
    ["DAYS", { days: 30, days_cost_usd: 3, source_carrier_line_id: 4 }],
    ["SHOP_LINE_CREDIT", { credits: 4, source_carrier_line_id: 4 }],
    ["CARD", { mobile_service_item_id: 11 }],
  ] as const)("recharge from %s", async (source, expected) => {
    const en = await rechargeFlow("en", source);
    const ar = await rechargeFlow("ar", source);
    expect(ar).toEqual(en);
    expect(en).toMatchObject({
      product_id: 10,
      exchange_rate: 89000,
      source,
      ...expected,
    });
  });
});
