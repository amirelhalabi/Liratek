/** @jest-environment jsdom */

/**
 * LIRA-377 T048 — offline work held because a shop restore removed a record
 * it points at (`restore_removed`). The item shows the removed records and
 * the restore it came from. When every removed record is a client, the admin
 * picks another client ("Book with this client") or books it as a walk-in;
 * otherwise only Dismiss is offered. Payloads are checked against the core
 * `reviewApplySchema` (strict, so a wrong key name fails — rule 24).
 * `useApi` returns a stable module-level object (rule 25).
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import {
  reviewApplySchema,
  type ReviewItemView,
  type RestoreRemovedDetails,
} from "@liratek/core";
import OfflineReview from "../index";

const mockGetItems = jest.fn();
const mockApply = jest.fn();
const mockDismiss = jest.fn();
const mockApi = {
  getOfflineReviewItems: mockGetItems,
  getOfflineHistory: jest.fn(async () => ({
    success: true,
    data: { events: [] },
  })),
  applyOfflineReviewItem: mockApply,
  dismissOfflineReviewItem: mockDismiss,
  markOfflineReviewItemReviewed: jest.fn(),
  bookOfflineReviewItemAnyway: jest.fn(),
  getOfflineReviewPreview: jest.fn(),
};
jest.mock("@liratek/ui", () => ({ useApi: () => mockApi }));

// The client picker (ClientAutocompleteInput) reads clients through the
// dual-mode adapter module directly.
const mockGetClients = jest.fn(async () => [
  { id: 7, full_name: "Maya Haddad", phone_number: "70111222" },
  { id: 8, full_name: "Karim Saleh", phone_number: "71333444" },
]);
jest.mock("@/api/backendApi", () => ({
  ...jest.requireActual("@/api/backendApi"),
  getClients: () => mockGetClients(),
  getDebtors: jest.fn(async () => []),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({
    user: { role: "admin", username: "owner" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

const clientDetails: RestoreRemovedDetails = {
  restoreId: 5,
  restoredTo: "2026-11-09T14:30:00.000Z",
  removed: [
    { table: "clients", id: 412, label: "Ali Mansour", path: "client_id" },
  ],
};
const productDetails: RestoreRemovedDetails = {
  restoreId: 5,
  restoredTo: "2026-11-09T14:30:00.000Z",
  removed: [
    {
      table: "products",
      id: 93,
      label: "iPhone cable",
      path: "items.0.product_id",
    },
  ],
};

const item = (over: Partial<ReviewItemView>): ReviewItemView => ({
  id: 21,
  kind: "restore_removed",
  label: "Points at a record the restore removed",
  state: "open",
  holding: true,
  actions: ["apply", "dismiss"],
  reason: "The client this sale points at was removed by the shop restore",
  details: clientDetails as unknown as Record<string, unknown>,
  eventId: "e21",
  eventStatus: "held",
  channel: "sales:process",
  channelLabel: "Sale",
  occurredAt: "2026-11-09T16:00:00.000Z",
  deviceId: 2,
  deviceNo: 2,
  deviceName: "Back PC",
  actorUserId: 21,
  actorName: "cashier",
  createdAt: "2026-11-10T09:00:00.000Z",
  resolvedBy: null,
  resolvedAt: null,
  ...over,
});

function serve(items: ReviewItemView[]) {
  mockGetItems.mockResolvedValue({
    success: true,
    data: {
      items,
      groups: [
        {
          kind: "restore_removed",
          label: "Points at a record the restore removed",
          count: items.length,
        },
      ],
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApply.mockResolvedValue({ success: true, data: { state: "applied" } });
  mockDismiss.mockResolvedValue({
    success: true,
    data: { state: "dismissed" },
  });
});

describe("OfflineReview — restore_removed items", () => {
  it("shows the removed record and the restore it came from", async () => {
    serve([item({})]);
    render(<OfflineReview />);
    expect(await screen.findByText(/Ali Mansour/)).toBeTruthy();
    expect(screen.getByText(/clients #412/)).toBeTruthy();
    expect(screen.getByText(/restore to .*2026/i)).toBeTruthy();
  });

  it("client case: no plain Apply; 'Book with this client' sends the picked client", async () => {
    serve([item({})]);
    render(<OfflineReview />);
    await screen.findByText(/Ali Mansour/);
    expect(screen.queryByRole("button", { name: "Apply item 21" })).toBeNull();

    const book = screen.getByRole("button", {
      name: /book with this client/i,
    }) as HTMLButtonElement;
    expect(book.disabled).toBe(true);

    await waitFor(() => expect(mockGetClients).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("client-autocomplete-field"), {
      target: { value: "Maya" },
    });
    fireEvent.mouseDown(await screen.findByTestId("client-option-7"));
    expect(book.disabled).toBe(false);

    fireEvent.click(book);
    expect(mockApply).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Confirm" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
    const [id, body] = mockApply.mock.calls[0];
    expect(id).toBe(21);
    expect(reviewApplySchema.safeParse(body).success).toBe(true);
    expect(body).toEqual(reviewApplySchema.parse({ replacementClientId: 7 }));
  });

  it("client case: 'Book as walk-in' sends the walk-in choice", async () => {
    serve([item({})]);
    render(<OfflineReview />);
    fireEvent.click(
      await screen.findByRole("button", { name: /book as walk-in/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledTimes(1));
    const [id, body] = mockApply.mock.calls[0];
    expect(id).toBe(21);
    expect(reviewApplySchema.safeParse(body).success).toBe(true);
    expect(body).toEqual(reviewApplySchema.parse({ walkIn: true }));
  });

  it("shows the service's refusal", async () => {
    mockApply.mockResolvedValue({
      success: false,
      error: "That client no longer exists (stub)",
    });
    serve([item({})]);
    render(<OfflineReview />);
    fireEvent.click(
      await screen.findByRole("button", { name: /book as walk-in/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(
      await screen.findByText(/That client no longer exists \(stub\)/),
    ).toBeTruthy();
  });

  it("non-client case: details visible, Dismiss only — no Apply, no picker", async () => {
    serve([
      item({
        actions: ["dismiss"],
        details: {
          ...productDetails,
          // the hold keeps what the PC recorded (ReplayEngine)
          payload: { client_id: null, final_amount: 12.5, items: [{ product_id: 93 }] },
        } as unknown as Record<string, unknown>,
      }),
    ]);
    render(<OfflineReview />);
    expect(await screen.findByText(/iPhone cable/)).toBeTruthy();
    expect(screen.getByText(/products #93/)).toBeTruthy();
    // what the PC recorded is shown, so the cashier can re-enter it
    expect(screen.getByText(/What the PC recorded/)).toBeTruthy();
    expect(screen.getByText(/"final_amount": 12.5/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apply item 21" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /book with this client/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /book as walk-in/i }),
    ).toBeNull();
    expect(screen.queryByTestId("client-autocomplete-field")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss item 21" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockDismiss).toHaveBeenCalledTimes(1));
    expect(mockApply).not.toHaveBeenCalled();
  });
});
