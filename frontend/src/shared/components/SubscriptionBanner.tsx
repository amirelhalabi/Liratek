/**
 * A strip that appears only when a shop's subscription is not simply fine.
 *
 * Exists because enforcement is otherwise silent in the worst way: in
 * `read_only` every write comes back 402 and the UI would show a generic
 * failure, so a shop would conclude the app is broken rather than that a
 * payment is due. Grace is the same problem in the other direction — nothing
 * changes yet, so nobody finds out until it does.
 *
 * Renders NOTHING when active, when standing cannot be determined, or before
 * the first answer arrives. That silence is the fail-open model reaching the
 * UI: a banner that appeared on an unknown state would accuse a paying
 * customer of not paying.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import {
  getSubscriptionStatus,
  type SubscriptionStatusView,
} from "@/api/backendApi";
import logger from "@/utils/logger";

/**
 * Re-checked periodically so a shop that pays mid-shift sees the banner clear
 * without restarting. Slow on purpose: this is a billing state that changes
 * daily at most, and the desktop side reads a local row anyway.
 */
const REFRESH_MS = 15 * 60 * 1000;

export function SubscriptionBanner() {
  const [view, setView] = useState<SubscriptionStatusView | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const next = await getSubscriptionStatus();
        if (!cancelled) setView(next);
      } catch (error) {
        // Cannot tell => say nothing. Never assume the worse state.
        logger.error("subscription status failed:", error);
        if (!cancelled) setView(null);
      }
    };

    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!view || view.status === "active") return null;

  if (view.status === "grace") {
    return (
      <div
        role="status"
        data-testid="subscription-banner"
        className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-500/15 border-b border-amber-500/40 text-amber-300"
      >
        <Clock className="w-4 h-4 shrink-0" />
        <span>
          <strong>Payment overdue.</strong> Everything still works
          {view.graceEndsAt ? ` until ${view.graceEndsAt.slice(0, 10)}` : ""}.
          Please settle the subscription to avoid going read-only.
        </span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="subscription-banner"
      className="flex items-center gap-2 px-4 py-2 text-sm bg-red-500/15 border-b border-red-500/40 text-red-300"
    >
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>
        <strong>Read-only.</strong> You can still view, search and export
        everything — including what customers owe you — but new entries are
        paused until the subscription is settled.
      </span>
    </div>
  );
}

export default SubscriptionBanner;
