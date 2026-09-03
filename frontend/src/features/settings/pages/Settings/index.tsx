import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tag } from "lucide-react";
import { PageHeader } from "@liratek/ui";
import UsersManager from "./UsersManager";
import Diagnostics from "./Diagnostics";
import CurrencyManager from "./CurrencyManager";
import ShopConfig from "./ShopConfig";
import NotificationsConfig from "./NotificationsConfig";
import ModulesManager from "./ModulesManager";
import IntegrationsConfig from "./IntegrationsConfig";
import CategoriesManager from "./CategoriesManager";
import MobileServicesManager from "./MobileServicesManager";
import CarrierLinesManager from "./CarrierLinesManager";

type TabKey =
  | "shop"
  | "categories"
  | "notifications"
  | "modules"
  | "currencies"
  | "users"
  | "diagnostics"
  | "integrations"
  | "mobile-services"
  | "carrier-lines";

/** Every valid tab key — the single source of truth for the `?tab=` deep
 *  link below, so a new tab automatically becomes a valid deep-link target
 *  without a second list to maintain (rule 14). */
const TAB_KEYS: readonly TabKey[] = [
  "shop",
  "categories",
  "notifications",
  "modules",
  "currencies",
  "users",
  "diagnostics",
  "integrations",
  "mobile-services",
  "carrier-lines",
];

function isTabKey(value: string | null): value is TabKey {
  return value != null && (TAB_KEYS as readonly string[]).includes(value);
}

/**
 * Deep-link mechanism (carrier-lines-validity plan Phase 4): any caller can
 * navigate here with `?tab=<key>` (e.g. `navigate("/settings?tab=carrier-lines")`
 * from the Dashboard's carrier-line expiry banner) and land directly on that
 * tab instead of the "Shop Config" default. Deliberately generic — keyed off
 * `TAB_KEYS`, not carrier-lines-specific — so any future tab gets the same
 * deep-link for free.
 *
 * Seeded once, in the `useState` initializer, deliberately not re-synced via
 * a `useEffect` on every `searchParams` change: `/settings` is one of several
 * distinct top-level routes (see `App.tsx`), so React Router always unmounts
 * and remounts this component on the way in from elsewhere — the initializer
 * reruns on every such navigation. A live-sync effect would only matter for a
 * second deep-link fired while already mounted here, which nothing in this
 * app does today, and it trips the `react-hooks/set-state-in-effect` rule.
 */
export default function Settings() {
  const [searchParams] = useSearchParams();
  const [active, setActive] = useState<TabKey>(() => {
    const tab = searchParams.get("tab");
    return isTabKey(tab) ? tab : "shop";
  });

  const tabs = [
    { key: "shop", label: "Shop Config" },
    { key: "categories", label: "Categories & Suppliers", icon: Tag },
    { key: "notifications", label: "Notifications" },
    { key: "modules", label: "Modules & Drawers" },
    { key: "currencies", label: "Currencies & Rates" },
    { key: "users", label: "Users" },
    { key: "integrations", label: "Integrations" },
    { key: "mobile-services", label: "Mobile Services" },
    { key: "carrier-lines", label: "Carrier Lines" },
    { key: "diagnostics", label: "Diagnostics" },
  ] as { key: TabKey; label: string; icon?: typeof Tag }[];

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-6 pt-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader title="Settings" />

      {/* Tab Navigation Section */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 shadow-lg flex flex-col overflow-hidden">
        <div className="flex gap-2 p-2 border-b border-slate-700 shrink-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`px-3 py-1 rounded ${active === t.key ? "bg-violet-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto -mr-6 pl-4 pt-4 pr-10 pb-6">
          {active === "shop" && <ShopConfig />}
          {active === "categories" && <CategoriesManager />}
          {active === "notifications" && <NotificationsConfig />}
          {active === "modules" && <ModulesManager />}
          {active === "currencies" && <CurrencyManager />}
          {active === "users" && <UsersManager />}
          {active === "integrations" && <IntegrationsConfig />}
          {active === "mobile-services" && <MobileServicesManager />}
          {active === "carrier-lines" && <CarrierLinesManager />}
          {active === "diagnostics" && <Diagnostics />}
        </div>
      </div>
    </div>
  );
}
