import { Zap, Signal, Wifi, Bitcoin, type LucideIcon } from "lucide-react";
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
    <div className="flex flex-wrap gap-1">
      {providers.map((provider) => {
        const IconComponent =
          ICON_COMPONENTS[provider.iconKey] || ICON_COMPONENTS.Zap;
        const isActive = activeProvider === provider.key;
        const count = cartCounts?.[provider.key] ?? 0;

        return (
          <button
            key={provider.key}
            onClick={() => onSelectProvider(provider.key)}
            className={`h-11 px-4 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${
              isActive
                ? `${provider.activeBg} ${provider.activeText} shadow-lg`
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700"
            }`}
          >
            <IconComponent size={16} />
            {provider.label}
            {count > 0 && (
              <span
                className={`px-1.5 py-0.5 text-[10px] font-bold rounded-full leading-none ${
                  isActive
                    ? "bg-white/25 text-white"
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
