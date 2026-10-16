import { useRef, useState } from "react";
import { Zap, Signal, Wifi, Bitcoin, type LucideIcon } from "lucide-react";
import { ProviderLogo } from "@/shared/components/ProviderLogo";
import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";
import type { AnyProvider, ProviderConfig } from "../types";

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  Zap,
  Signal,
  Wifi,
  Bitcoin,
};

/** Logo sizes: the selected tab's logo sits in a pill with its name; the
 *  unselected ones are bare logos, slightly larger so they stay easy to hit. */
export const TAB_LOGO_PX = { selected: 26, unselected: 36 } as const;

/** Picked-items count: ONE corner pill on every tab, selected or not, so the
 *  count always sits in the same place. Neutral and theme-aware (dark pill in
 *  dark mode, light pill in light mode), so it reads on every brand colour. */
const COUNT_PILL =
  "absolute -top-1 -right-1 min-w-5 px-1.5 py-0.5 text-center text-[10px] font-bold leading-none rounded-full bg-slate-800 text-white border border-slate-600 shadow-sm";

/** Where the sliding hover highlight sits: the hovered logo's box, relative to
 *  the tab row. */
interface HoverSpot {
  brand: ProviderBrandKey;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ProviderTabsProps {
  providers: ProviderConfig[];
  activeProvider: AnyProvider | null;
  onSelectProvider: (provider: AnyProvider) => void;
  /** Selected-item count per provider key — renders a count pill on the tab
   *  (same treatment as the category headers' selection badge). */
  cartCounts?: Record<string, number>;
}

export function ProviderTabs({
  providers,
  activeProvider,
  onSelectProvider,
  cartCounts,
}: ProviderTabsProps) {
  // Hover: ONE soft highlight slides from logo to logo (it is not a per-tab
  // effect), takes each logo's shape (circle or rounded square) and colour,
  // and fades out when the mouse leaves the row. Nothing grows, so square
  // logos never get bigger edges. Kept in place on leave so it fades where it
  // was instead of flying back to the start.
  const [spot, setSpot] = useState<HoverSpot | null>(null);
  const [visible, setVisible] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const brand = spot ? PROVIDER_BRANDS[spot.brand] : null;

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="Providers"
      onMouseLeave={() => setVisible(false)}
      className="relative flex flex-wrap items-center gap-2"
    >
      <div
        aria-hidden="true"
        data-testid="tab-hover-highlight"
        data-visible={String(visible)}
        {...(spot ? { "data-brand": spot.brand } : {})}
        {...(brand ? { "data-shape": brand.shape } : {})}
        className="pointer-events-none absolute left-0 top-0 transition-[transform,width,height,border-radius,background-color,opacity] duration-200 ease-out motion-reduce:transition-opacity"
        style={{
          opacity: visible ? 1 : 0,
          transform: spot
            ? `translate(${spot.left}px, ${spot.top}px)`
            : undefined,
          width: spot?.width ?? 0,
          height: spot?.height ?? 0,
          // Circle logos get a circle; square logos a rounded square that
          // follows their own corners.
          borderRadius: brand?.shape === "circle" ? 9999 : 12,
          // The provider's own colour at ~18% (hex alpha 2e).
          backgroundColor: brand ? `${brand.hex}2e` : "transparent",
        }}
      />
      {providers.map((provider) => {
        const IconComponent =
          ICON_COMPONENTS[provider.iconKey] || ICON_COMPONENTS.Zap;
        const isActive = activeProvider === provider.key;
        const count = cartCounts?.[provider.key] ?? 0;

        // The selected tab is a pill with its name; the others are just the
        // provider's logo, bigger and with no box. A provider without a logo
        // keeps its icon + name in both states.
        const logoOnly = !isActive && !!provider.brand;

        return (
          <button
            key={provider.key}
            type="button"
            onClick={() => onSelectProvider(provider.key)}
            onMouseEnter={(e) => {
              if (!logoOnly || !provider.brand) {
                setVisible(false);
                return;
              }
              // The logo's own box (the button minus its padding), so the
              // highlight hugs the logo, not the hit area.
              const logo = e.currentTarget.firstElementChild as HTMLElement;
              const target = logo ?? e.currentTarget;
              const pad = 4;
              setSpot({
                brand: provider.brand,
                left: e.currentTarget.offsetLeft + target.offsetLeft - pad,
                top: e.currentTarget.offsetTop + target.offsetTop - pad,
                width: target.offsetWidth + pad * 2,
                height: target.offsetHeight + pad * 2,
              });
              setVisible(true);
            }}
            aria-label={provider.label}
            aria-pressed={isActive}
            title={provider.label}
            className={`relative h-12 font-medium flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
              isActive
                ? `rounded-xl px-4 text-base transition-all ${provider.activeBg} ${provider.activeText} shadow-lg`
                : logoOnly
                  ? "rounded-full px-1 text-sm transition-transform duration-150 active:scale-95 motion-reduce:transform-none"
                  : "rounded-lg px-4 text-sm transition-all bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700"
            }`}
          >
            {provider.brand ? (
              <ProviderLogo
                brand={provider.brand}
                variant="icon"
                size={logoOnly ? TAB_LOGO_PX.unselected : TAB_LOGO_PX.selected}
              />
            ) : (
              <IconComponent size={16} />
            )}
            {!logoOnly && provider.label}
            {count > 0 && <span className={COUNT_PILL}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
