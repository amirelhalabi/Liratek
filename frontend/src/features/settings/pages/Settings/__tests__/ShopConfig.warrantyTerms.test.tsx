/** @jest-environment jsdom */
/**
 * LIRA-296 (T022) — the shop's "Warranty terms" text (Settings → Shop
 * Config), at most 1000 characters, saved as the `warranty_terms_text`
 * setting and printed on every receipt that has a warranty line.
 * The `useApi` mock returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

jest.mock("@/hooks/useShopName", () => ({
  invalidateShopInfo: jest.fn(),
}));

import ShopConfig from "../ShopConfig";

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.updateSetting.mockResolvedValue({ success: true });
  mockApi.getAllSettings.mockResolvedValue([
    { key_name: "shop_name", value: "Corner Shop" },
    { key_name: "warranty_terms_text", value: "No water damage." },
  ]);
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <ShopConfig />
    </MemoryRouter>,
  );

it("loads the saved terms into a 1000-character textarea", async () => {
  renderPage();
  const box = await screen.findByLabelText("Warranty terms");
  expect(box.tagName).toBe("TEXTAREA");
  await waitFor(() => expect(box).toHaveValue("No water damage."));
  expect(box).toHaveAttribute("maxLength", "1000");
});

it("saves the terms as warranty_terms_text", async () => {
  renderPage();
  const box = await screen.findByLabelText("Warranty terms");
  await waitFor(() => expect(box).toHaveValue("No water damage."));
  fireEvent.change(box, { target: { value: "Manufacturing faults only." } });
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() =>
    expect(mockApi.updateSetting).toHaveBeenCalledWith(
      "warranty_terms_text",
      "Manufacturing faults only.",
    ),
  );
});
