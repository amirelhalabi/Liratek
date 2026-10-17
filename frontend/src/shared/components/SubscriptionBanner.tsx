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
 *
 * LIRA-332: also the free-trial strip (days left + "Contact us to activate")
 * and the "trial ended" alert, on every page (MainLayout). It branches on the
 * server's `standing`, never on `status` (which stays `active` for the whole
 * trial), and renders the server's `trial` view verbatim — no date math here
 * (rules 14 and 27).
 */

import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Clock, MessageCircle } from "lucide-react";
import { buildActivationWhatsAppUrl } from "@liratek/core";
import {
  getSubscriptionStatus,
  type SubscriptionStatusView,
} from "@/api/backendApi";
import { TRIAL_ENDED_EVENT } from "@/api/httpClient";
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
    // LIRA-332: a write refused with TRIAL_ENDED re-reads at once.
    const onTrialEnded = () => void load();
    window.addEventListener(TRIAL_ENDED_EVENT, onTrialEnded);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(TRIAL_ENDED_EVENT, onTrialEnded);
    };
  }, []);

  if (!view) return null;
  // An older server (before the trial) sends no `standing`: read `status`.
  const standing = view.standing ?? view.status;
  if (standing === "active") return null;

  if (standing === "trial" || standing === "trial_ended") {
    return <TrialBanner view={view} ended={standing === "trial_ended"} />;
  }

  if (standing === "grace") {
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

function activationHref(view: SubscriptionStatusView): string {
  return buildActivationWhatsAppUrl({
    shopName: view.shop?.name,
    shopAddress: view.shop?.address,
  });
}

/** LIRA-332 — contracts/ui-trial.md, word for word. */
function TrialBanner({
  view,
  ended,
}: {
  view: SubscriptionStatusView;
  ended: boolean;
}) {
  const href = activationHref(view);
  const button = (label: string, tone: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`ml-auto inline-flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1 text-xs font-semibold ${tone}`}
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {label}
    </a>
  );

  if (ended) {
    return (
      <div
        role="alert"
        data-testid="trial-ended"
        className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm bg-red-500/15 border-b border-red-500/40 text-red-300"
      >
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>
          <strong>Your free trial has ended.</strong> You can still sign in,
          see and export everything. To keep adding sales and records, contact
          LiraTek on WhatsApp to activate.
        </span>
        {button(
          "Contact LiraTek on WhatsApp",
          "bg-red-500 hover:bg-red-600 text-white",
        )}
      </div>
    );
  }

  const trial = view.trial;
  if (!trial) return null;
  const amber = trial.endsSoon;
  let text: ReactNode;
  if (trial.daysLeft <= 1) {
    text = (
      <>
        <strong>Last day of your free trial</strong> (ends tonight,{" "}
        {trial.lastDay}).
      </>
    );
  } else if (trial.endsSoon) {
    text = (
      <>
        Your free trial ends soon: <strong>{trial.daysLeft} days left</strong>,
        last day {trial.lastDay}.
      </>
    );
  } else {
    text = (
      <>
        Free trial: <strong>{trial.daysLeft} days left</strong>
      </>
    );
  }

  return (
    <div
      role="status"
      data-testid="trial-strip"
      className={
        amber
          ? "flex flex-wrap items-center gap-2 px-4 py-1.5 text-sm bg-amber-500/15 border-b border-amber-500/40 text-amber-300"
          : "flex flex-wrap items-center gap-2 px-4 py-1.5 text-sm bg-slate-800 border-b border-slate-700 text-slate-300"
      }
    >
      <Clock className="w-4 h-4 shrink-0" />
      <span>{text}</span>
      {button(
        "Contact us to activate",
        amber
          ? "bg-amber-500 hover:bg-amber-600 text-slate-900"
          : "bg-orange-500 hover:bg-orange-600 text-white",
      )}
    </div>
  );
}

export default SubscriptionBanner;
