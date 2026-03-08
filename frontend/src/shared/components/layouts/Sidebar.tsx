import { useMemo } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  RefreshCw,
  Banknote,
  Wrench,
  Settings,
  PanelLeftClose,
  PanelLeft,
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
  BarChart2,
  ClipboardList,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { appEvents } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useModules } from "@/contexts/ModuleContext";
import { useShopName } from "@/hooks/useShopName";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";

// Map Lucide icon names (stored in DB) to actual icon components
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
  BarChart2,
  ClipboardList,
};

interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

export default function Sidebar({ isCollapsed, toggleSidebar }: SidebarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { enabledModules } = useModules();
  const shopName = useShopName();
  const { flags } = useFeatureFlags();

  // Consolidated module group: recharge + ipec_katch + binance → one "Mobile Recharge" link
  const CONSOLIDATED_KEYS = new Set(["recharge", "ipec_katch", "binance"]);

  // Build nav items from DB modules
  const navItems = useMemo(() => {
    let consolidatedInserted = false;
    return enabledModules
      .filter((m) => !m.admin_only || isAdmin)
      .filter((m) => m.route !== "") // Exclude closing (no route — it's a button)
      .reduce<Array<{ to: string; icon: LucideIcon; label: string }>>(
        (acc, m) => {
          if (CONSOLIDATED_KEYS.has(m.key)) {
            if (!consolidatedInserted) {
              consolidatedInserted = true;
              acc.push({
                to: "/recharge",
                icon: Smartphone,
                label: "Mobile Recharge",
              });
            }
            return acc;
          }
          acc.push({
            to: m.route,
            icon: iconMap[m.icon] || Circle,
            label: m.label,
          });
          return acc;
        },
        [],
      );
  }, [enabledModules, isAdmin]);

  const handleClosingClick = () => {
    appEvents.emit("closing:open");
  };

  const handleOpeningClick = () => {
    appEvents.emit("opening:open");
  };

  return (
    <aside
      className={clsx(
        "bg-slate-900 border-r border-slate-700 flex flex-col transition-all duration-300 ease-in-out",
        isCollapsed ? "w-20" : "w-64",
      )}
    >
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-700">
        {!isCollapsed && (
          <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent whitespace-nowrap overflow-hidden">
            {shopName}
          </h1>
        )}
        <button
          onClick={toggleSidebar}
          className={clsx(
            "p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors",
            isCollapsed ? "mx-auto" : "",
          )}
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-2 overflow-y-auto overflow-x-hidden">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-medium whitespace-nowrap",
                isActive
                  ? "bg-violet-600 text-white shadow-lg shadow-violet-900/20"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white",
                isCollapsed ? "justify-center" : "",
              )
            }
            title={isCollapsed ? item.label : undefined}
          >
            <item.icon size={20} className="min-w-[20px]" />
            {!isCollapsed && (
              <span className="opacity-100 transition-opacity duration-200">
                {item.label}
              </span>
            )}
          </NavLink>
        ))}
        {/* Opening and Closing Buttons - admin only, only when session management is enabled */}
        {isAdmin && flags.sessionManagement && (
          <button
            onClick={handleOpeningClick}
            className={clsx(
              "flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-medium whitespace-nowrap w-full",
              "text-slate-400 hover:bg-slate-800 hover:text-white",
              isCollapsed ? "justify-center" : "",
            )}
            title={isCollapsed ? "Opening" : undefined}
          >
            <Play size={20} className="min-w-[20px]" />
            {!isCollapsed && (
              <span className="opacity-100 transition-opacity duration-200">
                Opening
              </span>
            )}
          </button>
        )}
        {isAdmin && flags.sessionManagement && (
          <button
            onClick={handleClosingClick}
            className={clsx(
              "flex items-center gap-3 px-3 py-3 rounded-xl transition-all font-medium whitespace-nowrap w-full",
              "text-slate-400 hover:bg-slate-800 hover:text-white",
              isCollapsed ? "justify-center" : "",
            )}
            title={isCollapsed ? "Closing" : undefined}
          >
            <SquareActivity size={20} className="min-w-[20px]" />
            {!isCollapsed && (
              <span className="opacity-100 transition-opacity duration-200">
                Closing
              </span>
            )}
          </button>
        )}
      </nav>

      <div className="p-4 border-t border-slate-700 text-center text-xs text-slate-500 overflow-hidden">
        {!isCollapsed ? (
          <>
            <p>System Online</p>
            <p className="mt-1">v1.0.0</p>
          </>
        ) : (
          <div
            className="w-2 h-2 bg-emerald-500 rounded-full mx-auto"
            title="System Online"
          />
        )}
      </div>
    </aside>
  );
}
