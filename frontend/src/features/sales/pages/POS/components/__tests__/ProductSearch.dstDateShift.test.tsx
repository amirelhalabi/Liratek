/** @jest-environment jsdom */

/**
 * ProductSearch — the POS day-navigation arrows (`shiftDate`) must move the
 * `selectedDate` calendar string by exactly one whole day, in every
 * timezone, including across a local DST transition.
 *
 * The old code:
 *   const shiftDate = (days: number) => {
 *     const d = new Date(selectedDate);
 *     d.setDate(d.getDate() + days);
 *     setSelectedDate(d.toISOString().split("T")[0]);
 *   };
 * mixes UTC parsing (`new Date("YYYY-MM-DD")`), LOCAL stepping (`setDate`),
 * and UTC formatting (`toISOString`) in one round-trip. On Lebanon's spring
 * DST transition (the shop's actual timezone, Asia/Beirut), the local day
 * containing the transition is only 23 hours — measured directly: under
 * TZ=Asia/Beirut, `shiftDate("2026-03-28", +1)` produced "2026-03-28"
 * (unchanged) with the old code. Clicking "next day" silently did nothing.
 *
 * The fix replaces all of that with `addDaysToDateString(selectedDate, days)`
 * (`@liratek/core`, pure UTC string arithmetic, negative `days` included) —
 * identical output regardless of the runner's timezone, which is exactly
 * what this test asserts (frontend jest does not pin a TZ).
 *
 * Rule-17 discharge (2026-09-13): copied this file to a temp path outside
 * the repo, then reverted `ProductSearch.tsx`'s `shiftDate` (and removed the
 * now-unused `addDaysToDateString` import, else ts-jest fails the whole
 * suite on TS6133 before the assertion ever runs) to the old
 * `new Date(...).setDate(...).toISOString()` idiom. Ran, from `frontend/`:
 *   node ../node_modules/cross-env/src/bin/cross-env.js TZ=Asia/Beirut npx jest --testPathPatterns "ProductSearch.dstDateShift"
 * It failed exactly as predicted:
 *   expect(dateInput.value).toBe("2026-03-29")
 *   Expected: "2026-03-29"
 *   Received: "2026-03-28"
 * (1 failed, 1 total). Restored from the temp copy; `git diff --stat -- \
 * frontend/src/features/sales/pages/POS/components/ProductSearch.tsx`
 * printed nothing afterward. Confirmed green again under TZ=Asia/Beirut,
 * TZ=America/New_York and TZ=UTC.
 */

import { render, fireEvent, waitFor } from "@testing-library/react";
import ProductSearch from "../ProductSearch";

const mockGetTodaysSales = jest.fn();
const mockGetProducts = jest.fn().mockResolvedValue([]);

// Rule 25 (CLAUDE.md) — `useApi()` MUST return a STABLE reference. A fresh
// object literal per call (the naive `useApi: () => ({...})` shape) makes
// ProductSearch's `useEffect(..., [refreshSalesKey, selectedDate, api])`
// re-fire every render, and since that effect unconditionally calls
// `setTodaysSales(...)`, it becomes a synchronous infinite render loop that
// hangs the test process instead of failing it (confirmed: it hung this
// suite for 120s+ before this fix).
const mockApi = {
  getTodaysSales: mockGetTodaysSales,
  getProducts: mockGetProducts,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
}));

describe("ProductSearch — day-navigation arrows are TZ-independent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTodaysSales.mockResolvedValue([]);
  });

  it("shifts the calendar date forward by exactly one day across Beirut's spring DST transition", async () => {
    const { container } = render(<ProductSearch onAddToCart={jest.fn()} />);

    await waitFor(() => expect(mockGetTodaysSales).toHaveBeenCalled());

    const dateInput = container.querySelector(
      'input[type="date"]',
    ) as HTMLInputElement;
    expect(dateInput).toBeTruthy();

    // Land on the day BEFORE Beirut's 2026 spring-forward transition.
    fireEvent.change(dateInput, { target: { value: "2026-03-28" } });
    expect(dateInput.value).toBe("2026-03-28");

    const nextDayButton = container
      .querySelector("svg.lucide-chevron-right")
      ?.closest("button") as HTMLButtonElement;
    expect(nextDayButton).toBeTruthy();
    expect(nextDayButton.disabled).toBe(false);

    fireEvent.click(nextDayButton);

    expect(dateInput.value).toBe("2026-03-29");
  });
});
