/**
 * Every provider tab shows its own brand logo (not a generic icon), and its
 * colours come from the shared brand module — the expected
 * values are read from `PROVIDER_BRANDS`, never hand-typed.
 */
import { render, screen } from "@testing-library/react";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";
import { ProviderTabs } from "../ProviderTabs";
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
    expect(katshLogo?.style.width).toBe("36px");

    const whish = screen.getByRole("button", { name: "Whish App" });
    expect(whish).toHaveTextContent("Whish App");
    expect(whish).toHaveAttribute("aria-pressed", "true");
    expect(katsh).toHaveAttribute("aria-pressed", "false");
  });
});
