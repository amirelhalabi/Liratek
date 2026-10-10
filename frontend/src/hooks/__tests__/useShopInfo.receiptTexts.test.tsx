/** @jest-environment jsdom */
/**
 * LIRA-296 (T023, SF-3) — `useShopInfo` also carries the saved receipt
 * header and the warranty terms, so every receipt builder gets them from the
 * one cached settings read (never a second fetch per receipt).
 * The `useApi` mock returns ONE stable object (rule 25).
 */
import { renderHook, waitFor } from "@testing-library/react";

const mockApi = { getAllSettings: jest.fn() };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useOptionalAuth: () => ({ isAuthenticated: true }),
}));

import { useShopInfo, invalidateShopInfo } from "../useShopName";

beforeEach(() => {
  invalidateShopInfo();
  mockApi.getAllSettings.mockResolvedValue([
    { key_name: "shop_name", value: "Corner Shop" },
    { key_name: "receipt_header_text", value: "  Open daily 9-9  " },
    { key_name: "warranty_terms_text", value: "No water damage." },
  ]);
});

it("returns the receipt header and the warranty terms", async () => {
  const { result } = renderHook(() => useShopInfo());
  await waitFor(() => expect(result.current.name).toBe("Corner Shop"));
  expect(result.current.headerText).toBe("Open daily 9-9");
  expect(result.current.warrantyTerms).toBe("No water damage.");
});

it("both are empty strings when unset", async () => {
  mockApi.getAllSettings.mockResolvedValue([
    { key_name: "shop_name", value: "Corner Shop" },
  ]);
  const { result } = renderHook(() => useShopInfo());
  await waitFor(() => expect(result.current.name).toBe("Corner Shop"));
  expect(result.current.headerText).toBe("");
  expect(result.current.warrantyTerms).toBe("");
});
