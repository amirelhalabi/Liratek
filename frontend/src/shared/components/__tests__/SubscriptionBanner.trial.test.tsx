/**
 * LIRA-332 — the banner's trial states (contracts/ui-trial.md), branched on
 * the server's `standing`, with today's grace/read-only markup unchanged.
 *
 * Failing-first: run against the pre-LIRA-332 banner, every trial and
 * trial-ended case failed (it rendered nothing for `status:"active"`), and
 * the event case failed (no listener). The grace/read-only/active/null cases
 * passed then and now — regression pins, not guards.
 *
 * The mock returns a fresh view object per call, but the mock FUNCTION is a
 * stable module-level reference (rule 25).
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { buildActivationWhatsAppUrl } from "@liratek/core";
import type { SubscriptionStatusView } from "@/api/backendApi";

const mockGetSubscriptionStatus = jest.fn<
  Promise<SubscriptionStatusView | null>,
  []
>();

jest.mock("@/api/backendApi", () => ({
  getSubscriptionStatus: () => mockGetSubscriptionStatus(),
}));

import { SubscriptionBanner } from "../SubscriptionBanner";
import { TRIAL_ENDED_EVENT } from "@/api/httpClient";

const SHOP = { name: "Abou Ali Phones", address: "abouali.liratek.shop" };

function view(
  over: Partial<SubscriptionStatusView> & Pick<SubscriptionStatusView, "standing">,
): SubscriptionStatusView {
  return {
    status: "active",
    plan: "standard",
    canWrite: true,
    currentPeriodEnd: null,
    graceEndsAt: null,
    entitledModules: null,
    trial: null,
    shop: SHOP,
    ...over,
  };
}

function trial(daysLeft: number, lastDay = "2026-11-01") {
  return view({
    standing: "trial",
    trial: {
      endsAt: "2026-11-01T22:00:00.000Z",
      lastDay,
      daysLeft,
      endsSoon: daysLeft <= 3,
      ended: false,
    },
  });
}

const ENDED = view({
  standing: "trial_ended",
  canWrite: false,
  trial: {
    endsAt: "2026-11-01T22:00:00.000Z",
    lastDay: "2026-11-01",
    daysLeft: 0,
    endsSoon: false,
    ended: true,
  },
});

beforeEach(() => mockGetSubscriptionStatus.mockReset());

describe("SubscriptionBanner — trial", () => {
  it("12 days left: the slim strip", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(trial(12));
    render(<SubscriptionBanner />);
    const strip = await screen.findByTestId("trial-strip");
    expect(strip).toHaveTextContent("Free trial: 12 days left");
  });

  it("the last day", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(trial(1));
    render(<SubscriptionBanner />);
    const strip = await screen.findByTestId("trial-strip");
    expect(strip).toHaveTextContent(
      "Last day of your free trial (ends tonight, 2026-11-01).",
    );
  });

  it("3 days left: ends soon, with the last day", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(trial(3));
    render(<SubscriptionBanner />);
    const strip = await screen.findByTestId("trial-strip");
    expect(strip).toHaveTextContent(
      "Your free trial ends soon: 3 days left, last day 2026-11-01.",
    );
  });

  it("the button opens the one WhatsApp activation link", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(trial(12));
    render(<SubscriptionBanner />);
    const link = await screen.findByRole("link", {
      name: "Contact us to activate",
    });
    expect(link).toHaveAttribute(
      "href",
      buildActivationWhatsAppUrl({
        shopName: SHOP.name,
        shopAddress: SHOP.address,
      }),
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("trial ended: the red alert with the FR-011 text and the WhatsApp button", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(ENDED);
    render(<SubscriptionBanner />);
    const alert = await screen.findByTestId("trial-ended");
    expect(alert).toHaveTextContent(
      "Your free trial has ended. You can still sign in, see and export everything. To keep adding sales and records, contact LiraTek on WhatsApp to activate.",
    );
    expect(alert.textContent).not.toMatch(/overdue|lapsed|read-only/i);
    expect(
      screen.getByRole("link", { name: "Contact LiraTek on WhatsApp" }),
    ).toHaveAttribute(
      "href",
      buildActivationWhatsAppUrl({
        shopName: SHOP.name,
        shopAddress: SHOP.address,
      }),
    );
  });

  it("TRIAL_ENDED_EVENT re-fetches at once", async () => {
    mockGetSubscriptionStatus.mockResolvedValueOnce(trial(1));
    mockGetSubscriptionStatus.mockResolvedValueOnce(ENDED);
    render(<SubscriptionBanner />);
    await screen.findByTestId("trial-strip");
    act(() => {
      window.dispatchEvent(new CustomEvent(TRIAL_ENDED_EVENT));
    });
    expect(await screen.findByTestId("trial-ended")).toBeInTheDocument();
    expect(mockGetSubscriptionStatus).toHaveBeenCalledTimes(2);
  });
});

describe("SubscriptionBanner — unchanged states", () => {
  it.each([
    ["active", view({ standing: "active" })],
    ["null", null],
  ])("%s → nothing", async (_label, v) => {
    mockGetSubscriptionStatus.mockResolvedValue(v);
    const { container } = render(<SubscriptionBanner />);
    await waitFor(() => expect(mockGetSubscriptionStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("a rejected status read → nothing", async () => {
    mockGetSubscriptionStatus.mockRejectedValue(new Error("down"));
    const { container } = render(<SubscriptionBanner />);
    await waitFor(() => expect(mockGetSubscriptionStatus).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("grace keeps today's text", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(
      view({ standing: "grace", status: "grace", graceEndsAt: "2026-11-05 10:00:00" }),
    );
    render(<SubscriptionBanner />);
    expect(await screen.findByTestId("subscription-banner")).toHaveTextContent(
      "Payment overdue. Everything still works until 2026-11-05. Please settle the subscription to avoid going read-only.",
    );
  });

  it("read-only keeps today's text", async () => {
    mockGetSubscriptionStatus.mockResolvedValue(
      view({ standing: "read_only", status: "read_only", canWrite: false }),
    );
    render(<SubscriptionBanner />);
    expect(await screen.findByTestId("subscription-banner")).toHaveTextContent(
      "Read-only. You can still view, search and export everything — including what customers owe you — but new entries are paused until the subscription is settled.",
    );
  });
});
