import { useMemo, useRef, useState } from "react";
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
  TrendingUp,
  Bitcoin,
  Clock,
  Briefcase,
  Zap,
  BarChart2,
  ClipboardList,
  Circle,
  Shield,
  UserCheck,
  Handshake,
  Truck,
  Gift,
  Pin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useModules } from "@/contexts/ModuleContext";
import { useShopName } from "@/hooks/useShopName";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";
import { useSidebarFavorites } from "@/shared/hooks/useSidebarFavorites";

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
  UserCheck,
  Handshake,
  Truck,
  Shield,
  Gift,
};

interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

type NavItem = {
  to: string;
  icon: LucideIcon;
  label: string;
  prefetch?: () => void;
};

export default function Sidebar({ isCollapsed, toggleSidebar }: SidebarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { enabledModules } = useModules();
  const shopName = useShopName();
  const { flags } = useFeatureFlags();
  const { favorites, toggleFavorite, isFavorite } = useSidebarFavorites();

  const [holdingRoute, setHoldingRoute] = useState<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks whether the last hold ran to completion — suppresses the subsequent click event.
  const holdCompletedRef = useRef(false);

  const handleHoldStart = (route: string) => {
    holdCompletedRef.current = false;
    setHoldingRoute(route);
    holdTimerRef.current = setTimeout(() => {
      holdCompletedRef.current = true;
      toggleFavorite(route);
      setHoldingRoute(null);
    }, 800);
  };

  const handleHoldEnd = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHoldingRoute(null);
  };

  // Consolidated module group: recharge + ipec_katch + binance → one "Mobile Recharge" link
  const CONSOLIDATED_KEYS = new Set(["recharge", "ipec_katch", "binance"]);

  // Build nav items from DB modules
  const allNavItems = useMemo(() => {
    let consolidatedInserted = false;
    return enabledModules
      .filter((m) => !m.admin_only || isAdmin)
      .filter((m) => m.route !== "")
      .filter((m) => !["reports", "transactions"].includes(m.key))
      .reduce<NavItem[]>((acc, m) => {
        if (CONSOLIDATED_KEYS.has(m.key)) {
          if (!consolidatedInserted) {
            consolidatedInserted = true;
            acc.push({
              to: "/recharge",
              icon: Smartphone,
              label: "Mobile Recharge",
              prefetch: () => import("@/features/recharge/pages/Recharge"),
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
      }, []);
  }, [enabledModules, isAdmin]);

  // Split into favorites (FIFO order) and the rest (original DB order)
  const favoriteItems = favorites
    .map((route) => allNavItems.find((i) => i.to === route))
    .filter((i): i is NavItem => i != null);
  const restItems = allNavItems.filter((i) => !isFavorite(i.to));

  const renderNavItem = (item: NavItem) => {
    const isHolding = holdingRoute === item.to;
    const isPinned = isFavorite(item.to);

    return (
      <div
        key={item.to}
        className="relative select-none"
        onPointerDown={() => handleHoldStart(item.to)}
        onPointerUp={handleHoldEnd}
        onPointerLeave={handleHoldEnd}
        onPointerCancel={handleHoldEnd}
      >
        <NavLink
          to={item.to}
          onMouseEnter={item.prefetch}
          onClick={(e) => {
            if (holdCompletedRef.current) {
              e.preventDefault();
              holdCompletedRef.current = false;
            }
          }}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-3 py-2.5 rounded-xl transition-all font-medium whitespace-nowrap w-full",
              isActive
                ? "bg-violet-600 text-white shadow-lg shadow-violet-900/20"
                : "text-slate-400 hover:bg-slate-800 hover:text-white",
              isCollapsed ? "justify-center px-1" : "px-3",
              isHolding && "opacity-75",
            )
          }
          title={isCollapsed ? item.label : undefined}
        >
          {/* Icon — with small dot overlay when pinned + collapsed */}
          <div className="relative min-w-[20px]">
            <item.icon size={20} />
            {isPinned && isCollapsed && (
              <span className="absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-violet-400" />
            )}
          </div>

          {!isCollapsed && (
            <>
              <span className="flex-1 opacity-100 transition-opacity duration-200">
                {item.label}
              </span>
              {isPinned && (
                <Pin
                  size={11}
                  className="text-violet-400 opacity-50 shrink-0"
                />
              )}
            </>
          )}
        </NavLink>

        {/* Hold-to-favorite progress bar — fills left→right over 3 s */}
        {isHolding && (
          <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-violet-400 sidebar-hold-fill" />
        )}
      </div>
    );
  };

  return (
    <aside
      className={clsx(
        "bg-slate-900 border-r border-slate-700 flex flex-col transition-all duration-300 ease-in-out",
        isCollapsed ? "w-15" : "w-64",
      )}
    >
      <div
        className={clsx(
          "h-12 flex items-center border-b border-slate-700",
          isCollapsed ? "justify-center px-1" : "justify-between px-4",
        )}
      >
        {!isCollapsed && (
          <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent whitespace-nowrap overflow-hidden">
            {shopName}
          </h1>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isCollapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
        </button>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto overflow-x-hidden">
        {/* Pinned items */}
        {favoriteItems.map(renderNavItem)}

        {/* Divider — only shown when both groups are non-empty */}
        {favoriteItems.length > 0 && restItems.length > 0 && (
          <div className="my-1 mx-1 border-t border-slate-700/50" />
        )}

        {/* Regular items */}
        {restItems.map(renderNavItem)}

        {isAdmin && flags.sessionManagement && (
          <NavLink
            to="/checkpoint-timeline"
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 py-3 rounded-xl transition-all font-medium whitespace-nowrap w-full",
                isActive
                  ? "bg-violet-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white",
                isCollapsed ? "justify-center px-1" : "px-3",
              )
            }
            title={isCollapsed ? "Checkpoint Timeline" : undefined}
          >
            <Clock size={20} className="min-w-[20px]" />
            {!isCollapsed && (
              <span className="opacity-100 transition-opacity duration-200">
                Checkpoint Timeline
              </span>
            )}
          </NavLink>
        )}
      </nav>

      <div className="p-1 border-t border-slate-700 text-center text-xs text-slate-500 overflow-hidden">
        <p>v{__APP_VERSION__}</p>
      </div>
    </aside>
  );
}
