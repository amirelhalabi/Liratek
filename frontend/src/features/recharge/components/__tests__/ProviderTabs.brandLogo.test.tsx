/**
 * Every provider tab shows its own brand logo (not a generic icon), and its
 * colours come from the shared brand module — the expected
 * values are read from `PROVIDER_BRANDS`, never hand-typed.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";
import { ProviderTabs, TAB_LOGO_PX } from "../ProviderTabs";
import { PROVIDER_CONFIGS, type ProviderConfig } from "../../types";

function config(key: ProviderConfig["key"]): ProviderConfig {
  const found = PROVIDER_CONFIGS.find((p) => p.key === key);
  if (!found) throw new Error(`no provider config for ${key}`);
  return found;
}

describe("ProviderTabs — brand logos", () => {
  const BRAND_OF = {
    MTC: "MTC",
    Alfa: "ALFA",
    iPick: "IPICK",
    Katsh: "KATSH",
    WHISH_APP: "WHISH",
    OMT_APP: "OMT",
    BINANCE: "BINANCE",
  } as const;

  it("every Mobile Recharge provider carries its own brand", () => {
    for (const [key, brand] of Object.entries(BRAND_OF)) {
      expect(config(key as ProviderConfig["key"]).brand).toBe(brand);
    }
  });

  it("takes every provider's colour classes from PROVIDER_BRANDS", () => {
    for (const [key, brand] of Object.entries(BRAND_OF)) {
      const c = config(key as ProviderConfig["key"]);
      const b = PROVIDER_BRANDS[brand];
      expect(c.color).toBe(b.text);
      expect(c.bgTint).toBe(b.tint);
      expect(c.activeBg).toBe(b.solid);
      expect(c.badgeCls).toBe(b.badge);
    }
  });

  it("renders the brand logo on branded tabs and the lucide icon elsewhere", () => {
    render(
      <ProviderTabs
        providers={[config("Katsh"), config("WHISH_APP"), config("OMT_APP")]}
        activeProvider="OMT_APP"
        onSelectProvider={() => {}}
      />,
    );

    const whishTab = screen.getByRole("button", { name: /Whish App/ });
    const omtTab = screen.getByRole("button", { name: /OMT App/ });
    const katshTab = screen.getByRole("button", { name: /Katsh/ });

    expect(
      whishTab.querySelector('[data-testid="provider-logo-whish"]'),
    ).not.toBeNull();
    expect(whishTab.querySelector("svg.lucide-zap")).toBeNull();

    expect(
      omtTab.querySelector('[data-testid="provider-logo-omt"]'),
    ).not.toBeNull();
    expect(omtTab.querySelector("svg.lucide-zap")).toBeNull();

    expect(
      katshTab.querySelector('[data-testid="provider-logo-katsh"]'),
    ).not.toBeNull();
    expect(katshTab.querySelector("svg.lucide-zap")).toBeNull();

    // Active OMT tab carries the brand fill.
    for (const cls of PROVIDER_BRANDS.OMT.solid.split(" ")) {
      expect(omtTab).toHaveClass(cls);
    }
  });

  it("every Mobile Recharge provider shows its own logo, Binance included", () => {
    const keys = [
      "MTC",
      "Alfa",
      "iPick",
      "Katsh",
      "WHISH_APP",
      "OMT_APP",
      "BINANCE",
    ] as const;
    render(
      <ProviderTabs
        providers={keys.map((k) => config(k))}
        activeProvider={null}
        onSelectProvider={() => {}}
      />,
    );
    const logoIds = {
      MTC: "provider-logo-mtc",
      Alfa: "provider-logo-alfa",
      iPick: "provider-logo-ipick",
      Katsh: "provider-logo-katsh",
      WHISH_APP: "provider-logo-whish",
      OMT_APP: "provider-logo-omt",
      BINANCE: "provider-logo-binance",
    };
    for (const k of keys) {
      const tab = screen.getByRole("button", { name: config(k).label });
      expect(tab.querySelector(`[data-testid="${logoIds[k]}"]`)).not.toBeNull();
    }
  });

  it("an unselected tab is just a bigger logo; the selected tab adds its name", () => {
    render(
      <ProviderTabs
        providers={[config("Katsh"), config("WHISH_APP")]}
        activeProvider="WHISH_APP"
        onSelectProvider={() => {}}
      />,
    );
    // Accessible name and tooltip still carry the provider name.
    const katsh = screen.getByRole("button", { name: "Katsh" });
    expect(katsh).toHaveAttribute("title", "Katsh");
    expect(katsh).not.toHaveTextContent("Katsh");
    expect(katsh.className).not.toMatch(/\bborder\b|bg-slate-800/);
    const katshLogo = katsh.querySelector<HTMLElement>(
      '[data-testid="provider-logo-katsh"]',
    );
    expect(katshLogo?.style.width).toBe(`${TAB_LOGO_PX.unselected}px`);

    const whish = screen.getByRole("button", { name: "Whish App" });
    expect(whish).toHaveTextContent("Whish App");
    expect(whish).toHaveAttribute("aria-pressed", "true");
    expect(katsh).toHaveAttribute("aria-pressed", "false");
  });

  it("sizes: selected logo 26px, unselected 36px, every tab 48px tall", () => {
    expect(TAB_LOGO_PX).toEqual({ selected: 26, unselected: 36 });
    render(
      <ProviderTabs
        providers={[config("Katsh"), config("WHISH_APP")]}
        activeProvider="WHISH_APP"
        onSelectProvider={() => {}}
      />,
    );
    const whish = screen.getByRole("button", { name: "Whish App" });
    const katsh = screen.getByRole("button", { name: "Katsh" });
    expect(
      whish.querySelector<HTMLElement>('[data-testid="provider-logo-whish"]')
        ?.style.width,
    ).toBe("26px");
    expect(whish).toHaveClass("h-12", "text-base");
    expect(katsh).toHaveClass("h-12");
  });

  it("hover: ONE highlight slides between unselected logos, shaped like each logo, and fades out on leave", () => {
    render(
      <ProviderTabs
        providers={[config("iPick"), config("Katsh"), config("WHISH_APP")]}
        activeProvider="WHISH_APP"
        onSelectProvider={() => {}}
      />,
    );
    const highlight = screen.getByTestId("tab-hover-highlight");
    expect(highlight).toHaveAttribute("data-visible", "false");

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Katsh" }));
    expect(highlight).toHaveAttribute("data-visible", "true");
    expect(highlight).toHaveAttribute("data-brand", "KATSH");
    expect(highlight).toHaveAttribute(
      "data-shape",
      PROVIDER_BRANDS.KATSH.shape,
    );

    // Same element moves to the next logo and takes its shape.
    fireEvent.mouseEnter(screen.getByRole("button", { name: "iPick" }));
    expect(screen.getAllByTestId("tab-hover-highlight")).toHaveLength(1);
    expect(highlight).toHaveAttribute("data-brand", "IPICK");
    expect(highlight).toHaveAttribute(
      "data-shape",
      PROVIDER_BRANDS.IPICK.shape,
    );

    // The selected tab never gets the highlight.
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Whish App" }));
    expect(highlight).toHaveAttribute("data-visible", "false");

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Katsh" }));
    fireEvent.mouseLeave(screen.getByRole("group", { name: "Providers" }));
    expect(highlight).toHaveAttribute("data-visible", "false");

    // No growing on hover any more.
    expect(screen.getByRole("button", { name: "Katsh" })).not.toHaveClass(
      "hover:scale-125",
    );
  });

  it("the picked-items count on an unselected logo is a neutral pill, not orange", () => {
    render(
      <ProviderTabs
        providers={[config("Katsh"), config("WHISH_APP")]}
        activeProvider="WHISH_APP"
        cartCounts={{ Katsh: 2 }}
        onSelectProvider={() => {}}
      />,
    );
    const katsh = screen.getByRole("button", { name: "Katsh" });
    const badge = screen.getByText("2");
    expect(katsh).toContainElement(badge);
    expect(badge).toHaveClass("bg-slate-800", "text-white", "border-slate-600");
    expect(badge.className).not.toMatch(/orange/);
  });

  it("the selected tab's count is the same corner pill as the logos'", () => {
    render(
      <ProviderTabs
        providers={[config("Katsh"), config("WHISH_APP")]}
        activeProvider="Katsh"
        cartCounts={{ Katsh: 3, WHISH_APP: 1 }}
        onSelectProvider={() => {}}
      />,
    );
    const selected = screen.getByText("3");
    const unselected = screen.getByText("1");
    expect(screen.getByRole("button", { name: "Katsh" })).toContainElement(
      selected,
    );
    expect(selected.className).toBe(unselected.className);
    expect(selected).toHaveClass("absolute", "-top-1", "-end-1");
  });

  it("no browser focus outline after a click; a keyboard focus ring only", () => {
    render(
      <ProviderTabs
        providers={[config("Katsh"), config("WHISH_APP")]}
        activeProvider="Katsh"
        onSelectProvider={() => {}}
      />,
    );
    for (const name of ["Katsh", "Whish App"]) {
      expect(screen.getByRole("button", { name })).toHaveClass(
        "outline-none",
        "focus-visible:ring-2",
      );
    }
  });
});
