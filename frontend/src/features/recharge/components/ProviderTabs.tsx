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
}

export function ProviderTabs({
  providers,
  activeProvider,
  onSelectProvider,
}: ProviderTabsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((provider) => {
        const IconComponent =
          ICON_COMPONENTS[provider.iconKey] || ICON_COMPONENTS.Zap;
        const isActive = activeProvider === provider.key;

        return (
          <button
            key={provider.key}
            onClick={() => onSelectProvider(provider.key)}
            className={`px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${
              isActive
                ? `${provider.activeBg} ${provider.activeText} shadow-lg`
                : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700"
            }`}
          >
            <IconComponent size={16} />
            {provider.label}
          </button>
        );
      })}
    </div>
  );
}
