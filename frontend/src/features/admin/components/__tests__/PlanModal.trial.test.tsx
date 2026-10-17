/** @jest-environment jsdom */
/**
 * LIRA-332 US3 — PlanModal's "Activate subscription", "Extend trial" and
 * "History" sections (contracts/ui-trial.md). Each saves separately.
 *
 * Field names are asserted by parsing the sent body through the core
 * schemas (rule 24), never by hand.
 *
 * Failing-first: run before the sections existed, every case failed (no
 * such buttons). Not a fix, so these pin a new UI contract.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  activateSubscriptionSchema,
  extendTrialSchema,
  type TrialView,
} from "@liratek/core";
import type { AdminSubscription } from "@/api/backendApi";

const updateMutate = jest.fn();
const issueMutate = jest.fn();
const activateMutate = jest.fn();
const extendMutate = jest.fn();
const historyQuery: {
  data: unknown;
  isLoading: boolean;
} = { data: [], isLoading: false };

const updateMutation = { mutateAsync: updateMutate, isPending: false };
const issueMutation = { mutateAsync: issueMutate, isPending: false };
const activateMutation = { mutateAsync: activateMutate, isPending: false };
const extendMutation = { mutateAsync: extendMutate, isPending: false };

jest.mock("../../hooks/useSubscriptions", () => ({
  useUpdateSubscriptionMutation: () => updateMutation,
  useIssueLicenseKeyMutation: () => issueMutation,
  useActivateSubscriptionMutation: () => activateMutation,
  useExtendTrialMutation: () => extendMutation,
  useSubscriptionHistoryQuery: () => historyQuery,
}));

import { PlanModal } from "../PlanModal";

const TRIAL: TrialView = {
  endsAt: "2026-11-01T22:00:00.000Z",
  lastDay: "2026-11-01",
  daysLeft: 12,
  endsSoon: false,
  ended: false,
};

function makeSub(over: Partial<AdminSubscription> = {}): AdminSubscription {
  return {
    tenant_id: 7,
    tenant_name: "Corner Tech",
    tenant_slug: "cornertech",
    plan: "standard",
    status: "active",
    current_period_end: null,
    grace_ends_at: null,
    license_key: null,
    entitled_modules: null,
    notes: null,
    standing: "trial",
    trial: TRIAL,
    tenant_created_at: "2026-10-19 09:00:00",
    ...over,
  };
}

function renderModal(over: Partial<AdminSubscription> = {}) {
  return render(
    <PlanModal subscription={makeSub(over)} sellableModules={[]} onClose={jest.fn()} />,
  );
}

beforeEach(() => {
  for (const m of [updateMutate, issueMutate, activateMutate, extendMutate]) {
    m.mockReset();
    m.mockResolvedValue(undefined);
  }
  historyQuery.data = [];
});

describe("Activate subscription", () => {
  it("'No end date' sends {until:null}", async () => {
    renderModal();
    fireEvent.click(screen.getByLabelText("No end date"));
    fireEvent.click(screen.getByRole("button", { name: "Activate subscription" }));
    await waitFor(() => expect(activateMutate).toHaveBeenCalledTimes(1));
    const { tenantId, body } = activateMutate.mock.calls[0]![0];
    expect(tenantId).toBe(7);
    expect(activateSubscriptionSchema.parse(body)).toEqual({ until: null });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("'Paid until' sends the chosen day", async () => {
    renderModal({ standing: "trial_ended", trial: { ...TRIAL, ended: true, daysLeft: 0 } });
    fireEvent.click(screen.getByLabelText("Paid until"));
    fireEvent.change(screen.getByTestId("plan-activate-until"), {
      target: { value: "2027-10-31" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activate subscription" }));
    await waitFor(() => expect(activateMutate).toHaveBeenCalledTimes(1));
    expect(activateSubscriptionSchema.parse(activateMutate.mock.calls[0]![0].body)).toEqual({
      until: "2027-10-31",
    });
  });

  it("is not offered to a paying shop", () => {
    renderModal({ standing: "active", trial: null });
    expect(screen.queryByRole("button", { name: "Activate subscription" })).toBeNull();
  });
});

describe("Extend trial", () => {
  it("sends {lastDay}", async () => {
    renderModal();
    fireEvent.change(screen.getByTestId("plan-extend-last-day"), {
      target: { value: "2026-11-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Extend trial" }));
    await waitFor(() => expect(extendMutate).toHaveBeenCalledTimes(1));
    const { tenantId, body } = extendMutate.mock.calls[0]![0];
    expect(tenantId).toBe(7);
    expect(extendTrialSchema.parse(body)).toEqual({ lastDay: "2026-11-15" });
  });

  it("is offered to an owner-created shop with no period, not to a paid period", () => {
    renderModal({ standing: "active", trial: null });
    expect(screen.getByRole("button", { name: "Extend trial" })).toBeInTheDocument();
    renderModal({
      standing: "active",
      trial: null,
      current_period_end: "2027-01-01 00:00:00",
    });
    expect(screen.getAllByRole("button", { name: "Extend trial" })).toHaveLength(1);
  });

  it("shows the server's refusal inline", async () => {
    extendMutate.mockRejectedValue(new Error("Choose a date in the future"));
    renderModal();
    fireEvent.change(screen.getByTestId("plan-extend-last-day"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Extend trial" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a date in the future",
    );
  });
});

describe("History and labels", () => {
  it("lists the entries: when, who, what, before → after", () => {
    historyQuery.data = [
      {
        at: "2026-10-20 09:00:00",
        actor: "root",
        action: "extend_trial",
        summary: "Extended the free trial of tenant 7 to 2026-11-15",
        oldValues: { standing: "trial_ended", trialLastDay: "2026-11-01" },
        newValues: { standing: "trial", trialLastDay: "2026-11-15" },
      },
    ];
    renderModal();
    const list = screen.getByTestId("plan-history");
    expect(list).toHaveTextContent("2026-10-20");
    expect(list).toHaveTextContent("root");
    expect(list).toHaveTextContent("Extended the free trial of tenant 7 to 2026-11-15");
    expect(list).toHaveTextContent("trial_ended → trial");
  });

  it("no new button is labelled just 'Activate' (FR-016)", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /^Activate$/ })).toBeNull();
  });
});
