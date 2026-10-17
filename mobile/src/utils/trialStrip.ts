import { buildActivationWhatsAppUrl } from "@liratek/core/utils/activationLink";
import type { TrialView } from "@liratek/core/utils/trialCalendar";

/**
 * LIRA-332 — what the phone's trial strip shows, decided in one pure place so
 * it is testable without rendering. Same states and words as the web banner
 * (contracts/ui-trial.md) and the same WhatsApp link builder (core). The
 * server's `trial` view is shown as given — no date math on the phone.
 */

/** The part of GET /api/subscription/status the strip reads. */
export interface TrialStatus {
  standing: "trial" | "trial_ended" | "active" | "grace" | "read_only";
  trial: TrialView | null;
  shop: { name: string; address: string } | null;
}

export interface TrialStripModel {
  tone: "neutral" | "warning" | "danger";
  text: string;
  button: string;
  url: string;
}

export const TRIAL_ENDED_STRIP_TEXT =
  "Your free trial has ended. You can still sign in, see and export everything. To keep adding sales and records, contact LiraTek on WhatsApp to activate.";

/** null: nothing to show (paying shop, unknown, or no answer yet). */
export function trialStripModel(status: TrialStatus | null): TrialStripModel | null {
  if (!status?.trial) return null;
  const url = buildActivationWhatsAppUrl({
    shopName: status.shop?.name,
    shopAddress: status.shop?.address,
  });
  if (status.standing === "trial_ended") {
    return { tone: "danger", text: TRIAL_ENDED_STRIP_TEXT, button: "Contact LiraTek on WhatsApp", url };
  }
  if (status.standing !== "trial") return null;
  const t = status.trial;
  const button = "Contact us to activate";
  if (t.daysLeft <= 1) {
    return { tone: "warning", text: `Last day of your free trial (ends tonight, ${t.lastDay}).`, button, url };
  }
  if (t.endsSoon) {
    return {
      tone: "warning",
      text: `Your free trial ends soon: ${t.daysLeft} days left, last day ${t.lastDay}.`,
      button,
      url,
    };
  }
  return { tone: "neutral", text: `Free trial: ${t.daysLeft} days left`, button, url };
}
