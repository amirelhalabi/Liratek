/** @jest-environment jsdom */
/**
 * LIRA-364 — Plan window → Features: super admin switches "Monthly progress"
 * (the monthly KPI snapshot) on or off for ONE shop. Off by default; its own
 * Save, sending only the feature list (each section saves separately).
 *
 * RULE 17 — written before the Features section existed.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { setEnabledFeaturesSchema } from "@liratek/core";

const updateMutate = jest.fn();
const featuresMutate = jest.fn();

const idleMutation = { mutateAsync: jest.fn(), isPending: false };
const emptyHistory = { data: [], isLoading: false };
jest.mock("../../hooks/useSubscriptions", () => ({
  useUpdateSubscriptionMutation: () => ({
    mutateAsync: updateMutate,
    isPending: false,
  }),
  useIssueLicenseKeyMutation: () => idleMutation,
  useActivateSubscriptionMutation: () => idleMutation,
  useExtendTrialMutation: () => idleMutation,
  useSetEnabledFeaturesMutation: () => ({
    mutateAsync: featuresMutate,
    isPending: false,
  }),
  useSubscriptionHistoryQuery: () => emptyHistory,
}));

import { PlanModal } from "../PlanModal";
import type { AdminSubscription } from "@/api/backendApi";

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
    standing: "active",
    trial: null,
    tenant_created_at: "2026-01-01 00:00:00",
    enabledFeatures: [],
    ...over,
  };
}

function renderModal(sub = makeSub()) {
  return render(
    <PlanModal
      subscription={sub}
      sellableModules={["pos", "recharge"]}
      onClose={jest.fn()}
    />,
  );
}

describe("PlanModal — Features (LIRA-364)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    featuresMutate.mockResolvedValue(undefined);
  });

  it("shows Monthly progress off for a shop that never had it", () => {
    renderModal();
    expect(screen.getByTestId("plan-feature-kpi_snapshots")).not.toBeChecked();
  });

  it("shows it on when the shop has it", () => {
    renderModal(makeSub({ enabledFeatures: ["kpi_snapshots"] }));
    expect(screen.getByTestId("plan-feature-kpi_snapshots")).toBeChecked();
  });

  it("switching it on sends only the feature list, in the schema's shape", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("plan-feature-kpi_snapshots"));
    fireEvent.click(screen.getByTestId("plan-save-features"));

    await waitFor(() => expect(featuresMutate).toHaveBeenCalled());
    expect(featuresMutate).toHaveBeenCalledWith({
      tenantId: 7,
      body: setEnabledFeaturesSchema.parse({ features: ["kpi_snapshots"] }),
    });
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("switching it off sends an empty list", async () => {
    renderModal(makeSub({ enabledFeatures: ["kpi_snapshots"] }));
    fireEvent.click(screen.getByTestId("plan-feature-kpi_snapshots"));
    fireEvent.click(screen.getByTestId("plan-save-features"));

    await waitFor(() =>
      expect(featuresMutate).toHaveBeenCalledWith({
        tenantId: 7,
        body: { features: [] },
      }),
    );
  });
});
