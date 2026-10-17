/** @jest-environment jsdom */
/**
 * LIRA-331 — the shop-settings payload must not depend on the display
 * language. Fills every field the Shop Config tab saves, flips every feature
 * toggle, and saves, once in English and once in Arabic; the captured
 * `updateSetting` calls must be deep-equal (setting keys and the operator's
 * own values, never a label).
 *
 * Selectors are input ids and structure, so the same steps work in both
 * languages.
 *
 * Written before ShopConfig was converted: it passed against the unconverted
 * component (not failing-first — a guard against future drift, e.g. a
 * translated "Default (System Print Dialog)" label leaking into a printer).
 */
import { render, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { i18n, loadLanguage } from "@/i18n/setup";

const mockApi = {
  getAllSettings: jest.fn(),
  updateSetting: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));
jest.mock("@/contexts/FeatureFlagContext", () => ({
  useFeatureFlags: () => ({ refreshFlags: jest.fn() }),
}));
jest.mock("@/hooks/useShopName", () => ({ invalidateShopInfo: jest.fn() }));

import ShopConfig from "../ShopConfig";

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}

async function runFlow(): Promise<Array<[string, string]>> {
  jest.clearAllMocks();
  localStorage.clear();
  mockApi.getAllSettings.mockResolvedValue([
    { key_name: "shop_name", value: "Corner Shop" },
  ]);
  mockApi.updateSetting.mockResolvedValue({ success: true });

  const { unmount } = render(
    <MemoryRouter>
      <ShopConfig />
    </MemoryRouter>,
  );
  await waitFor(() => expect(byId("shop-name")).not.toBeNull());

  fireEvent.change(byId("shop-name"), { target: { value: "Al Amir Mobile" } });
  fireEvent.change(byId("shop-phone"), { target: { value: "+961 71 000 111" } });
  fireEvent.change(byId("shop-location"), { target: { value: "Tripoli" } });
  fireEvent.change(byId("shop-receipt-header"), {
    target: { value: "Thank you" },
  });
  fireEvent.change(byId("shop-warranty-terms"), {
    target: { value: "Factory faults only" },
  });
  fireEvent.change(byId("alfa-credit-cost"), { target: { value: "86000" } });
  fireEvent.change(byId("alfa-credit-sell"), { target: { value: "101000" } });
  fireEvent.change(byId("margin-alert-threshold"), {
    target: { value: "50000" },
  });

  // Every feature toggle (the round switches) flips once.
  document
    .querySelectorAll("div.relative.w-10.h-5")
    .forEach((toggle) => fireEvent.click(toggle));

  // The save button is the last button on the page's button row.
  const pageRoot = byId("shop-name").closest(".space-y-6") as HTMLElement;
  const rows = pageRoot.querySelectorAll(":scope > div.flex.gap-2.justify-end");
  const buttons = rows[rows.length - 1]!.querySelectorAll("button");
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(mockApi.updateSetting).toHaveBeenCalled());

  const calls = mockApi.updateSetting.mock.calls.map(
    ([k, v]) => [k, v] as [string, string],
  );
  unmount();
  return calls.sort(([a], [b]) => a.localeCompare(b));
}

async function inLanguage(lang: "en" | "ar") {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow();
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("ShopConfig — the saved settings are identical in English and Arabic", () => {
  it("every field and every feature toggle", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);
    expect(Object.fromEntries(en)).toEqual({
      shop_name: "Al Amir Mobile",
      shop_phone: "+961 71 000 111",
      shop_location: "Tripoli",
      receipt_header_text: "Thank you",
      warranty_terms_text: "Factory faults only",
      receipt_logo: "",
      feature_session_management: "disabled",
      feature_customer_sessions: "disabled",
      auto_check_updates: "0",
      allow_out_of_stock_sales: "1",
      receipt_printer: "",
      barcode_printer: "",
      alfa_credit_cost_lbp: "86000",
      alfa_credit_sell_rate_lbp: "101000",
      recharge_margin_alert_threshold: "50000",
    });
  });
});
