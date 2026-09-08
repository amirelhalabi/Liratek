/** @jest-environment jsdom */
/**
 * PlanModal — the owner's plan editor.
 *
 * The properties worth pinning are not the layout:
 *
 *   1. Each section sends ONLY its own field. The API applies just the keys
 *      present, precisely so recording a payment cannot blank an allowlist —
 *      and since NULL means "every module", a stray key there would hand a
 *      customer the whole app. A future "one Save button" refactor would
 *      quietly undo that, so it is asserted per button.
 *   2. Unrestricted (null) and empty ([]) are different plans. Conflating
 *      them gives a customer either everything or nothing.
 *   3. Un-ticking from "everything" starts FROM everything, so narrowing a
 *      plan does not mean rebuilding it from zero.
 *   4. The issued licence key stays on screen. It is shown once and cannot be
 *      retrieved, so anything that clears it loses it for good.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const updateMutate = jest.fn();
const issueMutate = jest.fn();

jest.mock("../../hooks/useSubscriptions", () => ({
  useUpdateSubscriptionMutation: () => ({
    mutateAsync: updateMutate,
    isPending: false,
  }),
  useIssueLicenseKeyMutation: () => ({
    mutateAsync: issueMutate,
    isPending: false,
  }),
}));

jest.mock("@liratek/core", () => ({
  UNGATEABLE_MODULES: ["dashboard", "settings", "audit", "closing"],
}));

import { PlanModal } from "../PlanModal";
import type { AdminSubscription } from "@/api/backendApi";

const SELLABLE = ["pos", "inventory", "exchange", "recharge"];

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
    ...over,
  };
}

function renderModal(over: Partial<AdminSubscription> = {}) {
  return render(
    <PlanModal
      subscription={makeSub(over)}
      sellableModules={SELLABLE}
      onClose={jest.fn()}
    />,
  );
}

beforeEach(() => {
  updateMutate.mockReset();
  issueMutate.mockReset();
  updateMutate.mockResolvedValue(undefined);
  issueMutate.mockResolvedValue("lsk_abc123");
});

describe("each section sends only its own field", () => {
  it("Save modules sends entitledModules and NOT periodEnd", async () => {
    renderModal({ current_period_end: "2026-12-31 00:00:00" });

    fireEvent.click(screen.getByTestId("plan-save-modules"));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const patch = updateMutate.mock.calls[0]![0] as {
      patch: Record<string, unknown>;
    };
    expect(patch.patch).toHaveProperty("entitledModules");
    // The guarantee: a module change cannot move the billing period.
    expect(patch.patch).not.toHaveProperty("periodEnd");
    expect(patch.patch).not.toHaveProperty("licenseKey");
  });

  it("Record payment sends periodEnd and NOT entitledModules", async () => {
    renderModal({ entitled_modules: '["pos"]' });

    fireEvent.change(screen.getByTestId("plan-period-end"), {
      target: { value: "2027-01-31" },
    });
    fireEvent.click(screen.getByTestId("plan-record-payment"));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const patch = updateMutate.mock.calls[0]![0] as {
      patch: Record<string, unknown>;
    };
    expect(patch.patch.periodEnd).toBe("2027-01-31");
    // The guarantee that matters most: paying is not an upgrade. A stray
    // entitledModules here (null = everything) would gift the whole app.
    expect(patch.patch).not.toHaveProperty("entitledModules");
  });

  it("an empty date means NO EXPIRY, not an unset field", async () => {
    renderModal({ current_period_end: "2026-12-31 00:00:00" });

    fireEvent.change(screen.getByTestId("plan-period-end"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("plan-record-payment"));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const patch = updateMutate.mock.calls[0]![0] as {
      patch: Record<string, unknown>;
    };
    // Explicit null, so the API clears it — an omitted key would leave the
    // old expiry in place while the UI showed none.
    expect(patch.patch.periodEnd).toBeNull();
  });
});

describe("unrestricted vs empty are different plans", () => {
  it("an unrestricted tenant sends null, not a full list", async () => {
    renderModal({ entitled_modules: null });

    expect(screen.getByTestId("plan-unrestricted")).toBeChecked();
    fireEvent.click(screen.getByTestId("plan-save-modules"));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const patch = updateMutate.mock.calls[0]![0] as {
      patch: { entitledModules: unknown };
    };
    // null means "every module, forever" — enumerating today's modules would
    // silently exclude whatever is added next.
    expect(patch.patch.entitledModules).toBeNull();
  });

  it("un-ticking every module sends [] — a real, restrictive plan", async () => {
    renderModal({ entitled_modules: '["pos"]' });

    fireEvent.click(screen.getByTestId("plan-module-pos"));
    fireEvent.click(screen.getByTestId("plan-save-modules"));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const patch = updateMutate.mock.calls[0]![0] as {
      patch: { entitledModules: unknown };
    };
    expect(patch.patch.entitledModules).toEqual([]);
  });

  it("turning OFF unrestricted starts from every sellable module", async () => {
    // Narrowing a plan should not mean rebuilding it from nothing.
    renderModal({ entitled_modules: null });

    fireEvent.click(screen.getByTestId("plan-unrestricted"));

    for (const key of SELLABLE) {
      expect(screen.getByTestId(`plan-module-${key}`)).toBeChecked();
    }
  });

  it("the first un-tick from unrestricted drops only that module", async () => {
    renderModal({ entitled_modules: null });

    fireEvent.click(screen.getByTestId("plan-unrestricted"));
    fireEvent.click(screen.getByTestId("plan-module-exchange"));
    fireEvent.click(screen.getByTestId("plan-save-modules"));

    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    const patch = updateMutate.mock.calls[0]![0] as {
      patch: { entitledModules: string[] };
    };
    expect(patch.patch.entitledModules).toEqual(
      SELLABLE.filter((k) => k !== "exchange"),
    );
  });
});

describe("existing plans render correctly", () => {
  it("a restricted tenant shows exactly its own modules ticked", () => {
    renderModal({ entitled_modules: '["pos","inventory"]' });

    expect(screen.getByTestId("plan-unrestricted")).not.toBeChecked();
    expect(screen.getByTestId("plan-module-pos")).toBeChecked();
    expect(screen.getByTestId("plan-module-inventory")).toBeChecked();
    expect(screen.getByTestId("plan-module-exchange")).not.toBeChecked();
  });

  it("a CORRUPT allowlist reads as unrestricted, matching the backend", () => {
    // The service and the middleware both fail open on unparseable JSON;
    // showing "nothing selected" here would invite the owner to 'fix' it by
    // saving an empty list and actually restricting the customer.
    renderModal({ entitled_modules: "{not json" });
    expect(screen.getByTestId("plan-unrestricted")).toBeChecked();
  });
});

describe("the licence key", () => {
  it("is shown after issuing", async () => {
    renderModal();

    fireEvent.click(screen.getByTestId("plan-issue-key"));

    expect(await screen.findByTestId("plan-issued-key")).toHaveTextContent(
      "lsk_abc123",
    );
  });

  it("warns that it cannot be retrieved again", async () => {
    renderModal();
    fireEvent.click(screen.getByTestId("plan-issue-key"));
    await screen.findByTestId("plan-issued-key");

    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  it("says that issuing again revokes the old key", () => {
    renderModal({ license_key: "lsk_old" });
    expect(screen.getByTestId("plan-issue-key")).toHaveTextContent(/revokes/i);
  });
});

describe("failures surface", () => {
  it("a rejected save shows the reason and does not claim success", async () => {
    updateMutate.mockRejectedValue(new Error("Tenant has no subscription"));
    renderModal();

    fireEvent.click(screen.getByTestId("plan-save-modules"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tenant has no subscription",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
