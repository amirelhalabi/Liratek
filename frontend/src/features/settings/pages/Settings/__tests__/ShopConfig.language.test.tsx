/** @jest-environment jsdom */
/**
 * LIRA-331 T031 — Settings → Shop Config: the admin sets the shop's default
 * language (`ui_default_language`) and receipt language (`receipt_language`)
 * through the generic settings pipe.
 *
 * Arabic ships dark (OD-4): without the owner preview flag the two selects
 * are not shown at all, and saving the form writes neither key — so shops
 * see no change, and a value already stored (e.g. Arabic from a signup on the
 * Arabic landing) is never rewritten. A key is written only when changed.
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

const writtenKeys = () => mockApi.updateSetting.mock.calls.map(([k]) => k);
const saveCalls = () =>
  Object.fromEntries(mockApi.updateSetting.mock.calls.map(([k, v]) => [k, v]));

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(mockApi.updateSetting).toHaveBeenCalled());
}

it("while Arabic is hidden: no language selects, and saving writes neither key", async () => {
  renderPage();
  await screen.findByLabelText("Shop Name");
  expect(screen.queryByLabelText("Shop default language")).toBeNull();
  expect(screen.queryByLabelText("Receipt language")).toBeNull();
  await save();
  expect(writtenKeys()).not.toContain(UI_DEFAULT_LANGUAGE_SETTING_KEY);
  expect(writtenKeys()).not.toContain(RECEIPT_LANGUAGE_SETTING_KEY);
});

it("a stored Arabic default survives a save while Arabic is hidden", async () => {
  mockApi.getAllSettings.mockResolvedValue(
    settings([{ key_name: UI_DEFAULT_LANGUAGE_SETTING_KEY, value: "ar" }]),
  );
  renderPage();
  await screen.findByLabelText("Shop Name");
  await save();
  expect(writtenKeys()).not.toContain(UI_DEFAULT_LANGUAGE_SETTING_KEY);
});

it("with the preview flag, the admin sets both to Arabic", async () => {
  localStorage.setItem("liratek_arabic_preview", "1");
  renderPage();
  const shopDefault = await screen.findByLabelText("Shop default language");
  expect(shopDefault).toHaveValue("en");
  fireEvent.change(shopDefault, { target: { value: "ar" } });
  fireEvent.change(screen.getByLabelText("Receipt language"), { target: { value: "ar" } });
  await save();
  expect(saveCalls()[UI_DEFAULT_LANGUAGE_SETTING_KEY]).toBe("ar");
  expect(saveCalls()[RECEIPT_LANGUAGE_SETTING_KEY]).toBe("ar");
});

it("with the preview flag, an unchanged language is not written", async () => {
  localStorage.setItem("liratek_arabic_preview", "1");
  renderPage();
  await screen.findByLabelText("Shop default language");
  await save();
  expect(writtenKeys()).not.toContain(UI_DEFAULT_LANGUAGE_SETTING_KEY);
  expect(writtenKeys()).not.toContain(RECEIPT_LANGUAGE_SETTING_KEY);
});
