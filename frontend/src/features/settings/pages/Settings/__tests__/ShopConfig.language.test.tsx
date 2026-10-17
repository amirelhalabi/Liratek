/** @jest-environment jsdom */
/**
 * LIRA-331 T031 — Settings → Shop Config: the admin sets the shop's default
 * language (`ui_default_language`) and receipt language (`receipt_language`)
 * through the generic settings pipe. العربية is offered only when the OD-4
 * gate allows it, and a value already stored (e.g. by a signup from the
 * Arabic landing) is never overwritten by saving the form.
 * The `useApi` mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  RECEIPT_LANGUAGE_SETTING_KEY,
  UI_DEFAULT_LANGUAGE_SETTING_KEY,
} from "@liratek/core";

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

function settings(extra: Array<{ key_name: string; value: string }> = []) {
  return [{ key_name: "shop_name", value: "Corner Shop" }, ...extra];
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <ShopConfig />
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockApi.updateSetting.mockResolvedValue({ success: true });
  mockApi.getAllSettings.mockResolvedValue(settings());
});

const saveCalls = () =>
  Object.fromEntries(mockApi.updateSetting.mock.calls.map(([k, v]) => [k, v]));

it("missing keys show English, and saving writes en for both", async () => {
  renderPage();
  const shopDefault = await screen.findByLabelText("Shop default language");
  expect(shopDefault).toHaveValue("en");
  expect(screen.getByLabelText("Receipt language")).toHaveValue("en");
  expect(screen.queryByRole("option", { name: "العربية" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(mockApi.updateSetting).toHaveBeenCalled());
  expect(saveCalls()[UI_DEFAULT_LANGUAGE_SETTING_KEY]).toBe("en");
  expect(saveCalls()[RECEIPT_LANGUAGE_SETTING_KEY]).toBe("en");
});

it("with the preview flag, the admin sets both to Arabic", async () => {
  localStorage.setItem("liratek_arabic_preview", "1");
  renderPage();
  const shopDefault = await screen.findByLabelText("Shop default language");
  fireEvent.change(shopDefault, { target: { value: "ar" } });
  fireEvent.change(screen.getByLabelText("Receipt language"), { target: { value: "ar" } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(mockApi.updateSetting).toHaveBeenCalled());
  expect(saveCalls()[UI_DEFAULT_LANGUAGE_SETTING_KEY]).toBe("ar");
  expect(saveCalls()[RECEIPT_LANGUAGE_SETTING_KEY]).toBe("ar");
});

it("a stored Arabic default survives a save while Arabic is hidden", async () => {
  mockApi.getAllSettings.mockResolvedValue(
    settings([{ key_name: UI_DEFAULT_LANGUAGE_SETTING_KEY, value: "ar" }]),
  );
  renderPage();
  const shopDefault = await screen.findByLabelText("Shop default language");
  await waitFor(() => expect(shopDefault).toHaveValue("ar"));
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(mockApi.updateSetting).toHaveBeenCalled());
  expect(saveCalls()[UI_DEFAULT_LANGUAGE_SETTING_KEY]).toBe("ar");
});
