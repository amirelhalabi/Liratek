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
  SquareActivity, // Imported SquareActivity icon
  Play,
} from "lucide-react";
import clsx from "clsx";
import { appEvents } from "../../utils/appEvents";
import { useAuth } from "../../../features/auth/context/AuthContext";

interface SidebarProps {
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

export default function Sidebar({ isCollapsed, toggleSidebar }: SidebarProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const allNavItems = [
    { to: "/", icon: LayoutDashboard, label: "Dashboard" },
    { to: "/pos", icon: ShoppingCart, label: "Point of Sale" },
    { to: "/debts", icon: BookOpen, label: "Debts" },
    { to: "/products", icon: Package, label: "Inventory" },
    { to: "/clients", icon: Users, label: "Clients" },
    { to: "/exchange", icon: RefreshCw, label: "Exchange" },
    { to: "/services", icon: Send, label: "OMT/Whish" },
    { to: "/recharge", icon: Smartphone, label: "Recharge" },
    { to: "/expenses", icon: Banknote, label: "Expenses" },
    { to: "/maintenance", icon: Wrench, label: "Maintenance" },
    // REMOVED: { to: '/closing', icon: SquareActivity, label: 'Closing' }, // New Closing page link
    { to: "/settings", icon: Settings, label: "Settings", adminOnly: true },
  ];

  // Filter nav items based on role
  const navItems = allNavItems.filter((item) => !item.adminOnly || isAdmin);

  const handleClosingClick = () => {
    appEvents.emit("openClosingModal");
  };

  const handleOpeningClick = () => {
    appEvents.emit("openOpeningModal");
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
            Corner Tech
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
        {/* Opening and Closing Buttons - admin only */}
        {isAdmin && (
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
        {isAdmin && (
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
