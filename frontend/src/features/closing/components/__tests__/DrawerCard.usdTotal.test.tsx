/** @jest-environment jsdom */
/**
 * LIRA-304 T050 (spec FR-022/FR-023, US7) — the checkpoint's information-only
 * USD total: shown when the card gets one, never part of the match status.
 */
import { render, screen } from "@testing-library/react";
import { DrawerCard } from "../DrawerCard";
import { getVarianceStatus } from "../../utils/variance";

const currencies = [
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "LBP", name: "Lebanese Pound", symbol: "LBP" },
] as unknown as Parameters<typeof DrawerCard>[0]["currencies"];

const base = {
  drawer: "OMT_System" as Parameters<typeof DrawerCard>[0]["drawer"],
  currencies,
  getDisplayValue: () => "0",
  onAmountChange: () => {},
};

it("renders the info-only total when given one", () => {
  render(<DrawerCard {...base} usdTotal={{ expected: 253, counted: 253 }} />);
  expect(screen.getByTestId("drawer-usd-total").textContent).toContain(
    "Total ≈ (info only)",
  );
});

it("renders nothing without a total (single-currency drawer)", () => {
  render(<DrawerCard {...base} />);
  expect(screen.queryByTestId("drawer-usd-total")).toBeNull();
});

it("a matching USD total does not make mismatched currencies balanced", () => {
  // Expected 8,900,000 LBP, counted $100: same value at 89,000, but each
  // currency is still compared on its own.
  expect(getVarianceStatus(100, 0).status).toBe("diff");
  expect(getVarianceStatus(0, 8_900_000).status).toBe("diff");
});
