/** @jest-environment jsdom */
/**
 * LIRA-292 — the per-device display preferences (navigation style, items per
 * row, POS product display, auto-fill payment, UI scale) moved from Settings
 * → Shop Config to My account → "Display (this device)", so staff can set
 * their own. Shop Config keeps only shop-wide settings, plus one line telling
 * an admin where the display options went.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockGetAllSettings = jest.fn();
const mockApi = {
  getAllSettings: mockGetAllSettings,
  updateSetting: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/contexts/FeatureFlagContext", () => ({
  useFeatureFlags: () => ({ refreshFlags: jest.fn() }),
}));

jest.mock("@/hooks/useShopName", () => ({
  invalidateShopInfo: jest.fn(),
}));

import ShopConfig from "../ShopConfig";

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAllSettings.mockResolvedValue([
    { key_name: "shop_name", value: "Corner Shop" },
  ]);
});

it("no longer renders the per-device display controls", async () => {
  render(
    <MemoryRouter>
      <ShopConfig />
    </MemoryRouter>,
  );
  expect(await screen.findByLabelText("Shop Name")).toHaveValue("Corner Shop");
  expect(screen.queryByText("Navigation Style")).toBeNull();
  expect(screen.queryByText("POS Product Display")).toBeNull();
  expect(screen.queryByText("Auto-fill Payment Amount")).toBeNull();
  expect(screen.queryByText("UI Scale")).toBeNull();
  expect(screen.queryByRole("button", { name: "90%" })).toBeNull();
});

it("tells the admin the display options moved, with a link to My account", async () => {
  render(
    <MemoryRouter>
      <ShopConfig />
    </MemoryRouter>,
  );
  await screen.findByLabelText("Shop Name");
  expect(screen.getByText(/Display options moved to/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "My account" })).toHaveAttribute(
    "href",
    "/account",
  );
});
