/** @jest-environment jsdom */
/**
 * Every currency toggle in the app reads USD | LBP; the Whish App Bills
 * switch read LBP | USD (owner, 2026-10-16). Written before the fix
 * (rule 17).
 */
import { render, screen } from "@testing-library/react";
import { WhishCurrencySwitch } from "../WhishCurrencySwitch";

describe("WhishCurrencySwitch — order", () => {
  it("lists USD first, then LBP, like every other currency toggle", () => {
    render(<WhishCurrencySwitch value="LBP" onChange={() => {}} />);
    expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "USD",
      "LBP",
    ]);
  });
});
