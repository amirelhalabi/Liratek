import { useState } from "react";
import { Settings as SettingsIcon, Tag } from "lucide-react";
import { PageHeader } from "@liratek/ui";
import UsersManager from "./UsersManager";
import Diagnostics from "./Diagnostics";
import CurrencyManager from "./CurrencyManager";
import ShopConfig from "./ShopConfig";
import SupplierLedger from "./SupplierLedger";
import NotificationsConfig from "./NotificationsConfig";
import ActivityLogViewer from "./ActivityLogViewer";
import ModulesManager from "./ModulesManager";
import IntegrationsConfig from "./IntegrationsConfig";
import CategoriesManager from "./CategoriesManager";

type TabKey =
  | "shop"
  | "categories"
  | "suppliers"
  | "notifications"
  | "activity"
  | "modules"
  | "currencies"
  | "users"
  | "diagnostics"
  | "integrations";

export default function Settings() {
  const [active, setActive] = useState<TabKey>("shop");

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader icon={SettingsIcon} title="Settings" />

      {/* Tab Navigation Section */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 shadow-lg flex flex-col overflow-hidden">
        <div className="flex gap-2 p-2 border-b border-slate-700 shrink-0">
          {(
            [
              { key: "shop", label: "Shop Config" },
              { key: "categories", label: "Categories & Suppliers", icon: Tag },
              { key: "suppliers", label: "Suppliers" },
              { key: "notifications", label: "Notifications" },
              { key: "activity", label: "Activity Logs" },
              { key: "modules", label: "Modules & Drawers" },
              { key: "currencies", label: "Currencies & Rates" },
              { key: "users", label: "Users" },
              { key: "integrations", label: "Integrations" },
              { key: "diagnostics", label: "Diagnostics" },
            ] as { key: TabKey; label: string; icon?: any }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`px-3 py-1 rounded ${active === t.key ? "bg-violet-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {active === "shop" && <ShopConfig />}
          {active === "categories" && <CategoriesManager />}
          {active === "suppliers" && <SupplierLedger />}
          {active === "notifications" && <NotificationsConfig />}
          {active === "activity" && <ActivityLogViewer />}
          {active === "modules" && <ModulesManager />}
          {active === "currencies" && <CurrencyManager />}
          {active === "users" && <UsersManager />}
          {active === "integrations" && <IntegrationsConfig />}
          {active === "diagnostics" && <Diagnostics />}
        </div>
      </div>
    </div>
  );
}
