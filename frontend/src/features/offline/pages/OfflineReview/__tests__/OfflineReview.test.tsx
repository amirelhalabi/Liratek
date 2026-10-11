/** @jest-environment jsdom */

/**
 * LIRA-306 T072 — "Offline work to review" (web, admin; FR-037, US3).
 * Groups by kind with plain labels; what / when / which PC / who / reason and
 * the matching row; actions call the adapter (ids only; the dismiss body is
 * the core `reviewDismissSchema` input — rule 24); money actions ask to
 * confirm first; staff see "admins only" and nothing is loaded.
 * `useApi` returns a stable module-level object (rule 25).
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { reviewDismissSchema, type ReviewItemView } from "@liratek/core";
import OfflineReview from "../index";

const mockGetItems = jest.fn();
const mockGetHistory = jest.fn();
const mockApply = jest.fn();
const mockDismiss = jest.fn();
const mockReviewed = jest.fn();
const mockBookAnyway = jest.fn();
const mockPreview = jest.fn();
const mockApi = {
  getOfflineReviewItems: mockGetItems,
  getOfflineHistory: mockGetHistory,
  applyOfflineReviewItem: mockApply,
  dismissOfflineReviewItem: mockDismiss,
  markOfflineReviewItemReviewed: mockReviewed,
  bookOfflineReviewItemAnyway: mockBookAnyway,
  getOfflineReviewPreview: mockPreview,
};
jest.mock("@liratek/ui", () => ({ useApi: () => mockApi }));

let mockRole = "admin";
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({
    user: { role: mockRole, username: "owner" },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

const item = (over: Partial<ReviewItemView>): ReviewItemView => ({
  id: 1,
  kind: "possible_duplicate",
  label: "Possible duplicate — held until you decide",
  state: "open",
  holding: true,
  actions: ["apply", "dismiss"],
  reason: "Everything matches a row booked within 5 minutes",
  details: { match: { table: "sales", id: 881, at: "2026-10-10 10:12:00" } },
  eventId: "e1",
  eventStatus: "held",
  channel: "sales:process",
  channelLabel: "Sale",
  occurredAt: "2026-10-10T10:10:00.000Z",
  deviceId: 2,
  deviceNo: 2,
  deviceName: "Back PC",
  actorUserId: 21,
  actorName: "cashier",
  createdAt: "2026-10-10T11:30:00.000Z",
  resolvedBy: null,
  resolvedAt: null,
  ...over,
});

const ITEMS = [
  item({}),
  item({
    id: 2,
    kind: "certain_duplicate",
    label: "Same transfer already booked — skipped",
    actions: ["reviewed", "book_anyway"],
    channelLabel: "OMT/Whish transfer",
    holding: false,
  }),
  item({
    id: 3,
    kind: "stock_count_off",
    label: "Stock count was off",
    actions: ["reviewed"],
    holding: false,
    details: {},
  }),
];

beforeEach(() => {
  mockRole = "admin";
  jest.clearAllMocks();
  mockGetItems.mockResolvedValue({
    success: true,
    data: {
      items: ITEMS,
      groups: [
        {
          kind: "possible_duplicate",
          label: "Possible duplicate — held until you decide",
          count: 1,
        },
        {
          kind: "certain_duplicate",
          label: "Same transfer already booked — skipped",
          count: 1,
        },
        { kind: "stock_count_off", label: "Stock count was off", count: 1 },
      ],
    },
  });
  mockGetHistory.mockResolvedValue({ success: true, data: { events: [] } });
  for (const m of [mockApply, mockDismiss, mockReviewed, mockBookAnyway])
    m.mockResolvedValue({ success: true, data: { state: "applied" } });
});

describe("OfflineReview page", () => {
  it("groups the open items by kind with plain labels, PC, who and the matching row", async () => {
    render(<OfflineReview />);
    expect(
      await screen.findByRole("heading", {
        name: /Possible duplicate — held until you decide \(1\)/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: /Same transfer already booked — skipped \(1\)/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: /Stock count was off \(1\)/ }),
    ).toBeTruthy();
    expect(screen.getAllByText(/Back PC \(PC 2\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/cashier/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Matches sales #881/).length).toBeGreaterThan(0);
    expect(mockGetItems).toHaveBeenCalledWith({ state: "open" });
  });

  it("Apply asks to confirm, then calls the adapter with the item id and reloads", async () => {
    render(<OfflineReview />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Apply item 1" }),
    );
    expect(mockApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mockGetItems).toHaveBeenCalledTimes(2));
  });

  it("Dismiss sends a schema-shaped body; Cancel sends nothing", async () => {
    render(<OfflineReview />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Dismiss item 1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss item 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockDismiss).toHaveBeenCalledTimes(1));
    const [id, body] = mockDismiss.mock.calls[0];
    expect(id).toBe(1);
    expect(reviewDismissSchema.safeParse(body).success).toBe(true);
    expect(Object.keys(body).every((k) => k in reviewDismissSchema.shape)).toBe(
      true,
    );
  });

  it("Book anyway (confirmed) and Mark reviewed (no confirm needed for a note)", async () => {
    render(<OfflineReview />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Book anyway item 2" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockBookAnyway).toHaveBeenCalledWith(2));
    const reviewed = screen.getByRole("button", {
      name: "Mark reviewed item 3",
    }) as HTMLButtonElement;
    await waitFor(() => expect(reviewed.disabled).toBe(false));
    fireEvent.click(reviewed);
    await waitFor(() => expect(mockReviewed).toHaveBeenCalledWith(3));
  });

  it("shows the server's refusal", async () => {
    mockApply.mockResolvedValue({
      success: false,
      error: "Refused by the service (stub)",
    });
    render(<OfflineReview />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Apply item 1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(
      await screen.findByText(/Refused by the service \(stub\)/),
    ).toBeTruthy();
  });

  it("staff see 'admins only' and nothing is loaded", async () => {
    mockRole = "staff";
    render(<OfflineReview />);
    expect(screen.getByText(/only for admins/i)).toBeTruthy();
    expect(mockGetItems).not.toHaveBeenCalled();
  });

  it("Apply on a drawer count shows the PC's and the server's figures side by side before confirming (FR-032)", async () => {
    mockGetItems.mockResolvedValue({
      success: true,
      data: {
        items: [item({ id: 9, kind: "held_checkpoint", label: "Drawer count or checkpoint taken offline — held", channel: "closing:create-checkpoint", channelLabel: "Drawer count", details: {} })],
        groups: [{ kind: "held_checkpoint", label: "Drawer count or checkpoint taken offline — held", count: 1 }],
      },
    });
    mockPreview.mockResolvedValue({
      success: true,
      data: { kind: "drawer_count", figures: [{ drawer_name: "General", currency_code: "USD", pc_expected: 100, server_expected: 130, physical: 95 }] },
    });
    render(<OfflineReview />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply item 9" }));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith(9));
    const dialog = await screen.findByRole("dialog", { name: "Confirm" });
    const row = await within(dialog).findByRole("row", { name: /General/ });
    expect(row.textContent).toMatch(/USD/);
    expect(row.textContent).toMatch(/100/);
    expect(row.textContent).toMatch(/130/);
    expect(row.textContent).toMatch(/95/);
    expect(within(dialog).getByText(/PC expected/i)).toBeTruthy();
    expect(within(dialog).getByText(/Server expected/i)).toBeTruthy();
    expect(mockApply).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mockApply).toHaveBeenCalledWith(9));
  });
});
