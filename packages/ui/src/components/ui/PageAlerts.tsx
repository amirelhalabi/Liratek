/**
 * PageAlerts — compact popover pill for page-header attention items.
 *
 * Dashboard used to stack full-width amber banners under the page title, one
 * per condition (starting drawer amounts, starting checkpoint, carrier
 * lines) — each eating the entire row even though most shops only ever hit
 * zero or one of them at a time, and the row grows every time a new module
 * gets its own "needs attention" case. Collapsing them into one pill in
 * `PageHeader`'s `actions` slot keeps the header a fixed size regardless of
 * how many alerts are active, while the popover panel still gives each
 * alert's detail text room to wrap instead of being squeezed into a
 * single truncated line.
 *
 * Presentation-only by design (DIP) — this component knows nothing about
 * drawers, checkpoints, or carrier lines. Callers own the conditions, copy,
 * and click handlers; this just lays out whatever `PageAlertItem[]` it's
 * given.
 *
 * Portalling follows the same pattern as `Select.tsx` / `MultiSelect.tsx`:
 * `anchor` forces @headlessui/react to portal the panel into the shared
 * `#headlessui-portal-root`, which is required here because the Dashboard's
 * outer container is `overflow-hidden` — an in-flow absolutely-positioned
 * panel would get clipped instead of floating above the page. `z-[500]`
 * matches the same deliberate ceiling documented in `Select.tsx` (above every
 * modal in the app, below NotificationCenter's toasts).
 */

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface PageAlertItem {
  id: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  /** e.g. "Set now", "Review" — the component appends the arrow itself. */
  actionLabel: string;
  onAction: () => void;
}

export interface PageAlertsProps {
  alerts: PageAlertItem[];
  className?: string;
}

export default function PageAlerts({
  alerts,
  className = "",
}: PageAlertsProps) {
  if (alerts.length === 0) return null;

  const count = alerts.length;
  const countLabel =
    count === 1 ? "1 needs attention" : `${count} need attention`;

  return (
    <Popover className={className}>
      <PopoverButton
        data-testid="page-alerts-trigger"
        className="flex items-center gap-2 h-11 px-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/15 transition-colors"
      >
        {({ open }) => (
          <>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium">{countLabel}</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </>
        )}
      </PopoverButton>

      <PopoverPanel
        anchor="bottom end"
        className="z-[500] w-[26rem] max-w-[calc(100vw-3rem)] rounded-xl bg-slate-900 border border-slate-700 shadow-lg p-1.5"
      >
        {({ close }) => (
          <>
            {alerts.map((alert) => {
              const Icon = alert.icon;
              return (
                <button
                  key={alert.id}
                  type="button"
                  data-testid={`page-alerts-row-${alert.id}`}
                  onClick={() => {
                    close();
                    alert.onAction();
                  }}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-left hover:bg-slate-800/60 transition-colors"
                >
                  <Icon className="w-5 h-5 text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-amber-300">
                      {alert.title}
                    </p>
                    <p className="text-xs text-amber-400/70">{alert.detail}</p>
                  </div>
                  <span className="text-xs text-amber-400 font-medium shrink-0">
                    {alert.actionLabel} →
                  </span>
                </button>
              );
            })}
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}
