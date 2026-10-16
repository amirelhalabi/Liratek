import { Zap, Signal, Wifi, Bitcoin, type LucideIcon } from "lucide-react";
import { ProviderLogo } from "@/shared/components/ProviderLogo";
import type { AnyProvider, ProviderConfig } from "../types";

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  Zap,
  Signal,
  Wifi,
  Bitcoin,
};

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
  return (
    <div className="flex flex-wrap items-center gap-2">
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
            aria-label={provider.label}
            aria-pressed={isActive}
            title={provider.label}
            className={`relative h-11 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${
              isActive
                ? `px-4 ${provider.activeBg} ${provider.activeText} shadow-lg`
                : logoOnly
                  ? "px-1.5 opacity-80 hover:opacity-100 hover:scale-110"
                  : "px-4 bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700"
            }`}
          >
            {provider.brand ? (
              <ProviderLogo
                brand={provider.brand}
                variant="icon"
                size={logoOnly ? 36 : 18}
              />
            ) : (
              <IconComponent size={16} />
            )}
            {!logoOnly && provider.label}
            {count > 0 && (
              <span
                className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full leading-none ${
                  isActive
                    ? "bg-white/25 text-white"
                    : logoOnly
                      ? "absolute -top-1 -right-1 bg-orange-500 text-white"
                      : "bg-orange-500/20 text-orange-400"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
