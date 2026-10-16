/** @jest-environment jsdom */
/**
 * Seed-run finding (2026-10-16): right after Reset Data reloaded the app,
 * Settings sat on "Loading..." until the user navigated away. The stall
 * itself was not reproduced (the whole app's first requests were slow —
 * likely the backend restarting), but Shop Config made it a dead end:
 * `load()` had try/finally with NO catch, so a failed settings read fell
 * through to a BLANK form (an unhandled rejection) — and saving that blank
 * form would overwrite the shop's real settings — while a stalled read
 * showed "Loading..." with no way to retry.
 *
 * Now: a failed read shows the reason and Retry (never the blank form); a
 * slow read offers Retry. The `useApi` mock is ONE stable object (rule 25).
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
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

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import ShopConfig from "../ShopConfig";

const SETTINGS = [{ key_name: "shop_name", value: "Corner Shop" }];

const renderPage = () =>
  render(
    <MemoryRouter>
      <ShopConfig />
    </MemoryRouter>,
  );

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.useRealTimers();
});

it("a failed settings read shows the reason and Retry — never a blank, saveable form", async () => {
  mockApi.getAllSettings
    .mockRejectedValueOnce({ status: 503, message: "Server restarting" })
    .mockResolvedValueOnce(SETTINGS);

  renderPage();

  expect(await screen.findByText(/Server restarting/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /save/i })).toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
  });
  expect(await screen.findByDisplayValue("Corner Shop")).toBeInTheDocument();
  expect(mockApi.getAllSettings).toHaveBeenCalledTimes(2);
});

it("a stalled settings read offers Retry instead of 'Loading...' forever", async () => {
  jest.useFakeTimers();
  mockApi.getAllSettings
    .mockReturnValueOnce(new Promise(() => {}))
    .mockResolvedValueOnce(SETTINGS);

  renderPage();
  expect(screen.getByText(/Loading/)).toBeInTheDocument();

  await act(async () => {
    jest.advanceTimersByTime(15_000);
  });
  expect(screen.getByTestId("shop-config-slow")).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
  });
  expect(await screen.findByDisplayValue("Corner Shop")).toBeInTheDocument();
});
