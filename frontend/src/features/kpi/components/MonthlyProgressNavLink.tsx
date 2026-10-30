/**
 * LIRA-364 — the sidebar's "Monthly progress" item. Rendered for admins only
 * (the Sidebar gates the role); shows itself only when the shop's switch is
 * on, which the read itself reports (`enabled`), so the menu and the page
 * follow the one gate in KpiSnapshotService.getProgress.
 */
import { NavLink } from "react-router-dom";
import { LineChart } from "lucide-react";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import { useKpiProgressQuery } from "../hooks/useKpiProgress";

export function MonthlyProgressNavLink({
  isCollapsed,
}: {
  isCollapsed: boolean;
}) {
  const { t } = useTranslation("layout");
  const { data } = useKpiProgressQuery();
  if (!data?.enabled) return null;
  return (
    <NavLink
      to="/monthly-progress"
      data-testid="nav-monthly-progress"
      className={({ isActive }) =>
        clsx(
          "flex items-center gap-3 py-3 rounded-xl transition-all font-medium whitespace-nowrap w-full",
          isActive
            ? "bg-violet-600 text-white"
            : "text-slate-400 hover:bg-slate-800 hover:text-white",
          isCollapsed ? "justify-center px-1" : "px-3",
        )
      }
      title={isCollapsed ? t("nav.monthlyProgress") : undefined}
    >
      <LineChart size={20} className="min-w-[20px]" />
      {!isCollapsed && (
        <span className="opacity-100 transition-opacity duration-200">
          {t("nav.monthlyProgress")}
        </span>
      )}
    </NavLink>
  );
}
