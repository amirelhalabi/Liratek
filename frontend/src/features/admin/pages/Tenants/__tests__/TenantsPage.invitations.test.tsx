/** @jest-environment jsdom */
/**
 * Tenants page — sign-up invitations (LIRA-267 US1/US2) and the "Add tenant"
 * error path (FR-013b).
 *
 *   - "Send invite" sits next to "Add tenant" and opens the invite form.
 *   - The Invitations table shows email, who started it (Admin/Self), sent,
 *     expires, status and the email-delivery badge; a failed send carries its
 *     last error as a tooltip.
 *   - Revoke asks first, then revokes by id. Only a pending invite offers it.
 *   - "Email not configured" banner when the server cannot email links.
 *   - Add tenant's 409 (duplicate email) reaches the form in the server's own
 *     words — requestJson throws a plain object, not an Error.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { SignupInvitationView } from "@/api/backendApi";

// ── tenants / subscriptions hooks (stable objects, rule 25) ────────────────
const createTenantMutate = jest.fn();
const tenantsQuery = {
  data: [],
  isLoading: false,
  isError: false,
  error: null,
  refetch: jest.fn(),
  isFetching: false,
};
const createTenantMutation = { mutateAsync: createTenantMutate, isPending: false };
const idleMutation = { mutateAsync: jest.fn(), isPending: false };
jest.mock("../../../hooks/useTenants", () => ({
  useTenantsQuery: () => tenantsQuery,
  useCreateTenantMutation: () => createTenantMutation,
  useUpdateTenantMutation: () => idleMutation,
  useImpersonateTenantMutation: () => idleMutation,
}));
const subsQuery = { data: { subscriptions: [], sellableModules: [] } };
jest.mock("../../../hooks/useSubscriptions", () => ({
  useSubscriptionsQuery: () => subsQuery,
}));

// ── invitations hooks ───────────────────────────────────────────────────────
const revokeMutate = jest.fn();
const invitationsQuery: {
  data: { emailConfigured: boolean; invitations: SignupInvitationView[] } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} = { data: undefined, isLoading: false, isError: false, error: null };
const revokeMutation = { mutateAsync: revokeMutate, isPending: false };
const createInviteMutation = { mutateAsync: jest.fn(), isPending: false };
jest.mock("../../../hooks/useSignupInvitations", () => ({
  useSignupInvitationsQuery: () => invitationsQuery,
  useRevokeSignupInvitationMutation: () => revokeMutation,
  useCreateSignupInvitationMutation: () => createInviteMutation,
}));

// Modals with their own data needs are irrelevant here.
jest.mock("../../../components/PlanModal", () => ({ PlanModal: () => null }));
jest.mock("../../../components/DeleteTenantModal", () => ({
  DeleteTenantModal: () => null,
}));
jest.mock("@liratek/ui", () => ({
  ConfirmModal: (p: {
    isOpen: boolean;
    title: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    p.isOpen ? (
      <div role="dialog" aria-label={p.title}>
        <button onClick={p.onConfirm}>{p.confirmLabel ?? "Confirm"}</button>
        <button onClick={p.onCancel}>Cancel</button>
      </div>
    ) : null,
}));

import TenantsPage from "../index";

function inv(over: Partial<SignupInvitationView>): SignupInvitationView {
  return {
    id: 1,
    email: "a@shop.com",
    shopNameHint: null,
    source: "admin",
    status: "pending",
    createdAt: "2026-10-07T09:00:00.000Z",
    expiresAt: "2026-10-10T09:00:00.000Z",
    usedAt: null,
    usedByTenant: null,
    revokedAt: null,
    emailDelivery: { status: "accepted", attempts: 1, lastError: null, sentAt: "2026-10-07T09:00:05.000Z" },
    ...over,
  };
}

beforeEach(() => {
  createTenantMutate.mockReset();
  revokeMutate.mockReset();
  revokeMutate.mockResolvedValue(inv({ status: "revoked" }));
  invitationsQuery.data = {
    emailConfigured: true,
    invitations: [
      inv({ id: 1, email: "pending@shop.com" }),
      inv({
        id: 2,
        email: "self@shop.com",
        source: "self",
        status: "used",
        usedByTenant: { id: 5, slug: "selfshop" },
      }),
      inv({
        id: 3,
        email: "bounced@shop.com",
        emailDelivery: {
          status: "failed",
          attempts: 4,
          lastError: "550 mailbox unavailable",
          sentAt: null,
        },
      }),
      inv({
        id: 4,
        email: "queued@shop.com",
        emailDelivery: { status: "queued", attempts: 0, lastError: null, sentAt: null },
      }),
    ],
  };
});

const row = (email: string) =>
  screen.getByTestId("invitations-table").querySelector(
    `tr[data-email="${email}"]`,
  ) as HTMLElement;

it("puts a Send invite button next to Add tenant that opens the invite form", () => {
  render(<TenantsPage />);
  expect(screen.getByRole("button", { name: "Add tenant" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
  expect(screen.getByTestId("send-invite-email")).toBeInTheDocument();
});

it("lists invitations with source, status and the email badge", () => {
  render(<TenantsPage />);
  const pending = within(row("pending@shop.com"));
  expect(pending.getByText("Admin")).toBeInTheDocument();
  expect(pending.getByText("pending")).toBeInTheDocument();
  expect(pending.getByText("Accepted")).toBeInTheDocument();

  const self = within(row("self@shop.com"));
  expect(self.getByText("Self")).toBeInTheDocument();
  expect(self.getByText("used")).toBeInTheDocument();
  expect(self.getByText(/selfshop/)).toBeInTheDocument();

  const failed = within(row("bounced@shop.com")).getByText("Failed");
  expect(failed).toHaveAttribute("title", "550 mailbox unavailable");

  expect(within(row("queued@shop.com")).getByText("Queued")).toBeInTheDocument();
  expect(screen.queryByText(/email not configured/i)).toBeNull();
});

it("offers Revoke only on pending invites, confirms, then revokes by id", async () => {
  render(<TenantsPage />);
  expect(
    within(row("self@shop.com")).queryByRole("button", { name: "Revoke" }),
  ).toBeNull();

  fireEvent.click(
    within(row("pending@shop.com")).getByRole("button", { name: "Revoke" }),
  );
  expect(revokeMutate).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: /revoke/i });
  fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(revokeMutate).toHaveBeenCalledWith(1));
});

it("shows the Email not configured banner", () => {
  invitationsQuery.data = { emailConfigured: false, invitations: [] };
  render(<TenantsPage />);
  expect(screen.getByText(/email not configured/i)).toBeInTheDocument();
  expect(screen.getByText(/no invitations yet/i)).toBeInTheDocument();
});

it("shows Add tenant's duplicate-email 409 in the server's words", async () => {
  createTenantMutate.mockRejectedValue({
    status: 409,
    message: {
      code: "EMAIL_ALREADY_HAS_SHOP",
      message: "A shop already exists for this email",
    },
  });
  render(<TenantsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Add tenant" }));
  fireEvent.change(screen.getByPlaceholderText("Acme Retail"), {
    target: { value: "Acme" },
  });
  fireEvent.change(screen.getByTestId("add-tenant-admin-username"), {
    target: { value: "admin" },
  });
  fireEvent.change(screen.getByTestId("add-tenant-admin-password"), {
    target: { value: "secret1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create tenant" }));

  expect(
    await screen.findByText("A shop already exists for this email"),
  ).toBeInTheDocument();
});
