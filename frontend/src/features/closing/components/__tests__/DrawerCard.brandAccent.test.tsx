/** @jest-environment jsdom */
/**
 * Closing / checkpoint drawer cards take their frame and title colour from
 * the provider brand, like the Dashboard drawer cards (owner request
 * 2026-10-16). Expected classes come from PROVIDER_BRANDS (rule 24); the
 * unbranded General drawer keeps its own frame and a white title.
 */
import { render, screen } from "@testing-library/react";
import { DrawerCard } from "../DrawerCard";
import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";

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
