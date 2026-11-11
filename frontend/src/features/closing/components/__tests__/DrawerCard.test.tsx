/**
 * DrawerCard — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { DrawerCard } from "../DrawerCard";
import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";
import { getVarianceStatus } from "../../utils/variance";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("DrawerCard.brandAccent", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Closing / checkpoint drawer cards take their frame and title colour from
   * the provider brand, like the Dashboard drawer cards (owner request
   * 2026-10-16). Expected classes come from PROVIDER_BRANDS (rule 24); the
   * unbranded General drawer keeps its own frame and a white title.
   */

  type Props = Parameters<typeof DrawerCard>[0];

  const currencies = [
    { code: "USD", name: "US Dollar", symbol: "$" },
  ] as unknown as Props["currencies"];

  const renderCard = (drawer: Props["drawer"]) =>
    render(
      <DrawerCard
        drawer={drawer}
        currencies={currencies}
        getDisplayValue={() => "0"}
        onAmountChange={() => {}}
      />,
    );

  const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

  describe("DrawerCard brand accent", () => {
    it.each<[Props["drawer"], ProviderBrandKey]>([
      ["OMT_App", "OMT"],
      ["OMT_System", "OMT"],
      ["Whish_App", "WHISH"],
      ["Whish_System", "WHISH"],
      ["Katsh", "KATSH"],
      ["iPick", "IPICK"],
      ["MTC", "MTC"],
      ["Alfa", "ALFA"],
      ["Binance", "BINANCE"],
    ])("%s card uses the %s logo, frame and title colour", (drawer, brand) => {
      const { container } = renderCard(drawer);
      const b = PROVIDER_BRANDS[brand];
      const card = container.firstElementChild as HTMLElement;
      expect(
        screen.getByTestId(`provider-logo-${brand.toLowerCase()}`),
      ).toBeTruthy();
      for (const t of tokens(b.border)) expect(card).toHaveClass(t);
      for (const t of tokens(b.tint)) expect(card).toHaveClass(t);
      const title = card.querySelector("h3");
      for (const t of tokens(b.accentText)) expect(title).toHaveClass(t);
      expect(title).not.toHaveClass("text-white");
    });

    it("General keeps its own frame and a white title", () => {
      const { container } = renderCard("General");
      const card = container.firstElementChild as HTMLElement;
      expect(screen.queryByTestId(/provider-logo-/)).toBeNull();
      expect(card).toHaveClass("border-blue-500/30");
      expect(card.querySelector("h3")).toHaveClass("text-white");
    });
  });
});

describe("DrawerCard", () => {
  beforeAll(resetBetweenFiles);

  describe("DrawerCard", () => {
    it("renders drawer label and calls onAmountChange", () => {
      const onAmountChange = jest.fn();
      render(
        <DrawerCard
          drawer="General"
          currencies={[{ code: "USD", name: "US Dollar", is_active: 1 }]}
          getDisplayValue={() => ""}
          onAmountChange={onAmountChange}
        />,
      );

      expect(screen.getByText("General")).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText("USD"), {
        target: { value: "1" },
      });
      expect(onAmountChange).toHaveBeenCalledWith("General", "USD", "1");
    });

    // Stored credits are sums of doubles; the box must show cents, not the
    // float noise (owner screenshot 2026-10-14: "705.3000000000001").
    // Not proven failing-first: written after the fix.
    it("shows a line's Credits rounded to cents, without float noise", () => {
      render(
        <DrawerCard
          drawer="MTC"
          currencies={[]}
          getDisplayValue={() => ""}
          onAmountChange={jest.fn()}
          carrierLines={[
            {
              lineId: 1,
              phoneNumber: "03924245",
              label: null,
              creditsValue: "705.3000000000001",
              onCreditsChange: jest.fn(),
              expectedCredits: 705.3000000000001,
              countedExpiresAt: "2027-01-11",
              expectedExpiresAt: "2027-01-11",
              onExpiryChange: jest.fn(),
              onResetExpiry: jest.fn(),
            },
          ]}
        />,
      );

      expect(screen.getByLabelText("Credits")).toHaveValue("705.3");
    });

    // Carrier cards (MTC/Alfa) — one row per active SIM line (LIRA-252 item A):
    // the drawer amount is no longer a free-typed field, it's the SUM of every
    // line's own Credits input.
    it("renders one Credits+Validity row per active line and sums them into the header total", () => {
      const onExpiryChange = jest.fn();
      const onCreditsChange = jest.fn();
      render(
        <DrawerCard
          drawer="MTC"
          currencies={[]}
          getDisplayValue={() => ""}
          onAmountChange={jest.fn()}
          carrierLines={[
            {
              lineId: 1,
              phoneNumber: "03111111",
              label: "Shop MTC",
              creditsValue: "40",
              onCreditsChange,
              expectedCredits: 40,
              countedExpiresAt: "2026-09-10",
              expectedExpiresAt: "2026-08-31",
              onExpiryChange,
              onResetExpiry: jest.fn(),
            },
            {
              lineId: 2,
              phoneNumber: "03222222",
              label: null,
              creditsValue: "10",
              onCreditsChange: jest.fn(),
              expectedCredits: 10,
              countedExpiresAt: "",
              expectedExpiresAt: null,
              onExpiryChange: jest.fn(),
              onResetExpiry: jest.fn(),
            },
          ]}
        />,
      );

      expect(screen.getByText(/03111111/)).toBeInTheDocument();
      expect(screen.getByText(/03222222/)).toBeInTheDocument();
      expect(screen.getAllByLabelText("Credits")).toHaveLength(2);
      expect(screen.getAllByLabelText("Validity")).toHaveLength(2);

      // Header total = 40 + 10 = 50.
      expect(screen.getByText("50.00")).toBeInTheDocument();

      // Validity variance (line 1) uses the shared day-count grammar.
      const validities = screen.getAllByLabelText("Validity");
      expect(validities[0]).toHaveValue("2026-09-10");
      expect(screen.getByText("+10d")).toBeInTheDocument();
      expect(screen.getByText("Expected: 2026-08-31")).toBeInTheDocument();

      fireEvent.change(validities[0], { target: { value: "2026-09-11" } });
      expect(onExpiryChange).toHaveBeenCalledWith("2026-09-11");

      const credits = screen.getAllByLabelText("Credits");
      fireEvent.change(credits[0], { target: { value: "45" } });
      expect(onCreditsChange).toHaveBeenCalledWith("45");
    });

    it("shows no validity row when the card has no carrier lines", () => {
      render(
        <DrawerCard
          drawer="General"
          currencies={[{ code: "USD", name: "US Dollar", is_active: 1 }]}
          getDisplayValue={() => ""}
          onAmountChange={jest.fn()}
        />,
      );
      expect(screen.queryByLabelText("Validity")).not.toBeInTheDocument();
    });
  });
});

describe("DrawerCard.usdTotal (LIRA-304)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-304 T050 (spec FR-022/FR-023, US7) — the checkpoint's information-only
   * USD total: shown when the card gets one, never part of the match status.
   */

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
});
