import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  RefreshCw,
  Banknote,
  Wrench,
  Settings,
  BookOpen,
  Send,
  Smartphone,
  SquareActivity,
  Play,
  TrendingUp,
  Bitcoin,
  Zap,
  Briefcase,
  Circle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { appEvents } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useModules } from "@/contexts/ModuleContext";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";

const iconMap: Record<string, LucideIcon> = {
  LayoutDashboard,
  TrendingUp,
  ShoppingCart,
  BookOpen,
  Package,
  Users,
  RefreshCw,
  Send,
  Smartphone,
  Banknote,
  Wrench,
  Bitcoin,
  Zap,
  Briefcase,
  Settings,
  SquareActivity,
};

/** Accent color per module key — badge bg, icon text, hover border, top accent, tinted shadow */
const accentMap: Record<
  string,
  {
    bg: string;
    text: string;
    border: string;
    topBorder: string;
    shadow: string;
  }
> = {
  dashboard: {
    bg: "bg-violet-400/10",
    text: "text-violet-400",
    border: "hover:border-violet-500/60",
    topBorder: "border-t-violet-500/60",
    shadow: "hover:shadow-violet-900/20",
  },
  commissions: {
    bg: "bg-pink-400/10",
    text: "text-pink-400",
    border: "hover:border-pink-500/60",
    topBorder: "border-t-pink-500/60",
    shadow: "hover:shadow-pink-900/20",
  },
  pos: {
    bg: "bg-emerald-400/10",
    text: "text-emerald-400",
    border: "hover:border-emerald-500/60",
    topBorder: "border-t-emerald-500/60",
    shadow: "hover:shadow-emerald-900/20",
  },
  sales_history: {
    bg: "bg-green-400/10",
    text: "text-green-400",
    border: "hover:border-green-500/60",
    topBorder: "border-t-green-500/60",
    shadow: "hover:shadow-green-900/20",
  },
  products: {
    bg: "bg-teal-400/10",
    text: "text-teal-400",
    border: "hover:border-teal-500/60",
    topBorder: "border-t-teal-500/60",
    shadow: "hover:shadow-teal-900/20",
  },
  clients: {
    bg: "bg-blue-400/10",
    text: "text-blue-400",
    border: "hover:border-blue-500/60",
    topBorder: "border-t-blue-500/60",
    shadow: "hover:shadow-blue-900/20",
  },
  debts: {
    bg: "bg-red-400/10",
    text: "text-red-400",
    border: "hover:border-red-500/60",
    topBorder: "border-t-red-500/60",
    shadow: "hover:shadow-red-900/20",
  },
  exchange: {
    bg: "bg-amber-400/10",
    text: "text-amber-400",
    border: "hover:border-amber-500/60",
    topBorder: "border-t-amber-500/60",
    shadow: "hover:shadow-amber-900/20",
  },
  services: {
    bg: "bg-indigo-400/10",
    text: "text-indigo-400",
    border: "hover:border-indigo-500/60",
    topBorder: "border-t-indigo-500/60",
    shadow: "hover:shadow-indigo-900/20",
  },
  recharge: {
    bg: "bg-sky-400/10",
    text: "text-sky-400",
    border: "hover:border-sky-500/60",
    topBorder: "border-t-sky-500/60",
    shadow: "hover:shadow-sky-900/20",
  },
  expenses: {
    bg: "bg-rose-400/10",
    text: "text-rose-400",
    border: "hover:border-rose-500/60",
    topBorder: "border-t-rose-500/60",
    shadow: "hover:shadow-rose-900/20",
  },
  maintenance: {
    bg: "bg-orange-400/10",
    text: "text-orange-400",
    border: "hover:border-orange-500/60",
    topBorder: "border-t-orange-500/60",
    shadow: "hover:shadow-orange-900/20",
  },
  custom_services: {
    bg: "bg-purple-400/10",
    text: "text-purple-400",
    border: "hover:border-purple-500/60",
    topBorder: "border-t-purple-500/60",
    shadow: "hover:shadow-purple-900/20",
  },
  settings: {
    bg: "bg-slate-400/10",
    text: "text-slate-400",
    border: "hover:border-slate-500/60",
    topBorder: "border-t-slate-500/60",
    shadow: "hover:shadow-slate-900/20",
  },
};

const defaultAccent = {
  bg: "bg-violet-400/10",
  text: "text-violet-400",
  border: "hover:border-violet-500/60",
  topBorder: "border-t-violet-500/60",
  shadow: "hover:shadow-violet-900/20",
};

/** Map route to module key for accent lookup */
function routeToKey(route: string): string {
  return route.replace(/^\//, "").replace(/-/g, "_") || "dashboard";
}

const CONSOLIDATED_KEYS = new Set(["recharge", "ipec_katch", "binance"]);

/** Map column count to Tailwind grid class */
const colsClass: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6",
};

export default function HomeGrid() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { enabledModules } = useModules();
  const { flags } = useFeatureFlags();

  const [columns, setColumns] = useState(
    () => Number(localStorage.getItem("home_columns")) || 5,
  );

  // Re-read when settings change
  useEffect(() => {
    const handler = () =>
      setColumns(Number(localStorage.getItem("home_columns")) || 5);
    window.addEventListener("layout-mode-changed", handler);
    return () => window.removeEventListener("layout-mode-changed", handler);
  }, []);

  const navItems = useMemo(() => {
    // Dashboard card is always first
    const items: Array<{
      to: string;
      icon: LucideIcon;
      label: string;
      action?: () => void;
    }> = [{ to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" }];

    let consolidatedInserted = false;
    for (const m of enabledModules) {
      if (m.admin_only && !isAdmin) continue;
      if (m.route === "") continue;
      // Skip dashboard (already added)
      if (m.key === "dashboard") continue;

      if (CONSOLIDATED_KEYS.has(m.key)) {
        if (!consolidatedInserted) {
          consolidatedInserted = true;
          items.push({
            to: "/recharge",
            icon: Smartphone,
            label: "Mobile Recharge",
          });
        }
        continue;
      }

      items.push({
        to: m.route,
        icon: iconMap[m.icon] || Circle,
        label: m.label,
      });
    }

    return items;
  }, [enabledModules, isAdmin]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold text-white">Home</h1>
        <p className="text-slate-400 text-sm mt-1">
          Select a module to get started
        </p>
      </div>

      <div className={clsx("grid gap-4", colsClass[columns] || "grid-cols-5")}>
        {navItems.map((item) => {
          const accent = accentMap[routeToKey(item.to)] || defaultAccent;
          return (
            <button
              key={item.to}
              onClick={() => {
                if (item.action) {
                  item.action();
                } else {
                  navigate(item.to);
                }
              }}
              className={clsx(
                "flex flex-col items-center justify-center gap-4 p-6 min-h-[8rem]",
                "bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 border-t-2 rounded-xl",
                "transition-all duration-200 hover:scale-[1.03] hover:shadow-lg active:scale-[0.98] group",
                accent.border,
                accent.topBorder,
                accent.shadow,
              )}
            >
              <div className={clsx("p-3 rounded-xl", accent.bg)}>
                <item.icon
                  size={28}
                  className={clsx(accent.text, "transition-colors")}
                />
              </div>
              <span className="text-[0.8125rem] font-medium text-slate-300 group-hover:text-white transition-colors">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Admin-only Opening / Closing — only when session management is enabled */}
      {isAdmin && flags.sessionManagement && (
        <div className="pt-4 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-3">
            Admin Actions
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => appEvents.emit("opening:open")}
              className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700/50 rounded-xl transition-all hover:border-emerald-500/60 hover:shadow-lg text-slate-300 hover:text-white group"
            >
              <div className="p-1.5 rounded-lg bg-emerald-400/10">
                <Play size={18} className="text-emerald-400" />
              </div>
              <span className="text-sm font-medium">Opening</span>
            </button>
            <button
              onClick={() => appEvents.emit("closing:open")}
              className="flex items-center gap-2 px-4 py-3 bg-slate-800 border border-slate-700/50 rounded-xl transition-all hover:border-rose-500/60 hover:shadow-lg text-slate-300 hover:text-white group"
            >
              <div className="p-1.5 rounded-lg bg-rose-400/10">
                <SquareActivity size={18} className="text-rose-400" />
              </div>
              <span className="text-sm font-medium">Closing</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
