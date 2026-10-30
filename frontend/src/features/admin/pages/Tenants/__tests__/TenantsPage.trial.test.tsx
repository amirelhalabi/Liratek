/** @jest-environment jsdom */
/**
 * LIRA-332 US3 (FR-015) — the owner's Tenants list shows each shop's trial:
 * "Trial · 12 days left · ends 2026-11-01" or "Trial ended 2026-11-01",
 * rendered verbatim from the server's view (no date math here). The
 * Suspend/Activate row button keeps its text (FR-016).
 *
 * Failing-first: run before PlanCell knew `standing`, both trial rows read
 * "all modules" and the cases failed.
 */

import { render, screen, within } from "@testing-library/react";
import type { AdminSubscription, AdminTenant } from "@/api/backendApi";

const tenantsQuery = {
  data: [] as AdminTenant[],
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  isFetching: false,
};
const idleMutation = { mutateAsync: jest.fn(), isPending: false };
jest.mock("../../../hooks/useTenants", () => ({
  useTenantsQuery: () => tenantsQuery,
  useCreateTenantMutation: () => idleMutation,
  useUpdateTenantMutation: () => idleMutation,
  useImpersonateTenantMutation: () => idleMutation,
}));
const subsQuery = {
  data: { subscriptions: [] as AdminSubscription[], sellableModules: [] },
};
jest.mock("../../../hooks/useSubscriptions", () => ({
  useSubscriptionsQuery: () => subsQuery,
}));
const invitationsQuery = {
  data: { emailConfigured: true, invitations: [] },
  isLoading: false,
  isError: false,
  error: null,
};
jest.mock("../../../hooks/useSignupInvitations", () => ({
  useSignupInvitationsQuery: () => invitationsQuery,
  useRevokeSignupInvitationMutation: () => idleMutation,
  useCreateSignupInvitationMutation: () => idleMutation,
}));
jest.mock("../../../components/PlanModal", () => ({ PlanModal: () => null }));
jest.mock("../../../components/DeleteTenantModal", () => ({
  DeleteTenantModal: () => null,
}));
jest.mock("@liratek/ui", () => ({ ConfirmModal: () => null }));

import TenantsPage from "../index";

function tenant(id: number, status: AdminTenant["status"] = "active"): AdminTenant {
  return {
    id,
    name: `Shop ${id}`,
    slug: `shop${id}`,
    status,
    user_count: 1,
    last_activity: null,
    created_at: "2026-10-19 09:00:00",
  } as AdminTenant;
}

function sub(tenantId: number, over: Partial<AdminSubscription>): AdminSubscription {
  return {
    tenant_id: tenantId,
    tenant_name: `Shop ${tenantId}`,
    tenant_slug: `shop${tenantId}`,
    plan: "standard",
    status: "active",
    current_period_end: null,
    grace_ends_at: null,
    license_key: null,
    entitled_modules: null,
    notes: null,
    standing: "active",
    trial: null,
    tenant_created_at: "2026-10-19 09:00:00",
    enabledFeatures: [],
    ...over,
  };
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr")!;
}

beforeEach(() => {
  tenantsQuery.data = [tenant(2), tenant(3), tenant(4, "suspended")];
  subsQuery.data.subscriptions = [
    sub(2, {
      standing: "trial",
      trial: {
        endsAt: "2026-11-01T22:00:00.000Z",
        lastDay: "2026-11-01",
        daysLeft: 12,
        endsSoon: false,
        ended: false,
      },
    }),
    sub(3, {
      standing: "trial_ended",
      trial: {
        endsAt: "2026-11-01T22:00:00.000Z",
        lastDay: "2026-11-01",
        daysLeft: 0,
        endsSoon: false,
        ended: true,
      },
    }),
    sub(4, {}),
  ];
});

describe("PlanCell — trial", () => {
  it("a trial reads 'Trial · 12 days left · ends 2026-11-01'", () => {
    render(<TenantsPage />);
    expect(rowOf("Shop 2")).toHaveTextContent("Trial · 12 days left · ends 2026-11-01");
  });

  it("an ended trial reads 'Trial ended 2026-11-01'", () => {
    render(<TenantsPage />);
    expect(rowOf("Shop 3")).toHaveTextContent("Trial ended 2026-11-01");
  });

  it("a paying shop keeps today's text, and Suspend/Activate keep theirs", () => {
    render(<TenantsPage />);
    expect(rowOf("Shop 4")).toHaveTextContent("all modules");
    expect(within(rowOf("Shop 2")).getByRole("button", { name: "Suspend" })).toBeInTheDocument();
    expect(within(rowOf("Shop 4")).getByRole("button", { name: "Activate" })).toBeInTheDocument();
  });
});
