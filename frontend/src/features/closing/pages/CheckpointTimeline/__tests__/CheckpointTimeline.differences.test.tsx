/** @jest-environment jsdom */
/**
 * LIRA-335 — Checkpoint Timeline shows each difference's status (US2).
 *
 * The status, direction and open amount come from the server's
 * `CheckpointDifferenceView` (core `describeCheckpointDifference`, rule 14);
 * the page only renders them. Fixtures are typed with that core view so a
 * renamed field fails the type-check (rule 24).
 *
 * Rule 17: written before the page change and run against the unchanged page.
 * The useApi mock is a stable module-level object (rule 25).
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CheckpointDifferenceView } from "@liratek/core";
import CheckpointTimeline from "../index";

type Currency = {
  currency_code: string;
  opening_amount: number;
  physical_amount?: number;
  drawer_name?: string;
};

function checkpoint(
  id: number,
  drawer: string,
  createdAt: string,
  notes: string,
  currencies: Currency[],
  differences: CheckpointDifferenceView[] = [],
) {
  return {
    id,
    closing_date: createdAt.slice(0, 10),
    drawer_name: drawer,
    checkpoint_type: "CHECKPOINT" as const,
    created_at: createdAt,
    created_by: 1,
    user_name: "Rami",
    notes,
    currencies: currencies.map((c) => ({ drawer_name: drawer, ...c })),
    differences,
  };
}

function difference(
  over: Partial<CheckpointDifferenceView>,
): CheckpointDifferenceView {
  return {
    id: 1,
    closing_id: 1,
    closing_created_at: "2026-10-12 18:00:00",
    drawer_name: "General",
    currency_code: "USD",
    amount: 50,
    direction: "OVER",
    resolved: 0,
    open: 50,
    status: "OPEN",
    closed_at: null,
    closed_by_name: null,
    shortage_expense_id: null,
    resolutions: [],
    ...over,
  };
}

const mockGetCheckpointTimeline = jest.fn();
const mockApi = {
  getInitialCheckpointDate: jest.fn().mockResolvedValue(null),
  getCheckpointTimeline: mockGetCheckpointTimeline,
  getCarrierLineAdjustments: jest
    .fn()
    .mockResolvedValue({ success: true, adjustments: [] }),
  closeCheckpointDifference: jest.fn(),
  reopenCheckpointDifference: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

let mockRole: "admin" | "staff" = "admin";
const mockAuth = {
  get user() {
    return { id: 1, username: "amir", role: mockRole };
  },
};
jest.mock("@/features/auth/context/AuthContext", () => ({
  ...jest.requireActual("@/features/auth/context/AuthContext"),
  useOptionalAuth: () => mockAuth,
}));

function serve(
  checkpoints: ReturnType<typeof checkpoint>[],
  openCount?: number,
) {
  mockGetCheckpointTimeline.mockResolvedValue({
    success: true,
    checkpoints,
    ...(openCount !== undefined ? { open_count: openCount } : {}),
  });
}

async function rowWith(text: string): Promise<HTMLElement> {
  const cell = await screen.findByText(text);
  return cell.closest("tr") as HTMLElement;
}

function openDetails(row: HTMLElement): HTMLElement {
  fireEvent.click(within(row).getByTitle("View details"));
  return screen
    .getByText(/Checkpoint Details/)
    .closest("div.fixed") as HTMLElement;
}

const OPEN = checkpoint(
  11,
  "General",
  "2026-10-12 18:00:00",
  "open one",
  [{ currency_code: "USD", opening_amount: 1000, physical_amount: 1050 }],
  [difference({ id: 101, closing_id: 11 })],
);

const RESOLVED = checkpoint(
  12,
  "General",
  "2026-10-12 18:01:00",
  "resolved one",
  [{ currency_code: "USD", opening_amount: 1000, physical_amount: 1050 }],
  [
    difference({
      id: 102,
      closing_id: 12,
      resolved: 50,
      open: 0,
      status: "RESOLVED",
      resolutions: [
        {
          transaction_id: 4821,
          transaction_type: "SALE",
          summary: "Phone case",
          amount: 50,
          // UTC as stored; Beirut is UTC+3 → Mon 14:10 / Tue 10:05.
          effective_time: "2026-10-12 11:10:00",
          entered_at: "2026-10-13 07:05:00",
          user_name: "Amir",
        },
      ],
    }),
  ],
);

const PARTLY = checkpoint(
  13,
  "OMT_System",
  "2026-10-12 18:02:00",
  "partly one",
  [{ currency_code: "USD", opening_amount: 2330, physical_amount: 2310 }],
  [
    difference({
      id: 103,
      closing_id: 13,
      drawer_name: "OMT_System",
      amount: -20,
      direction: "SHORT",
      resolved: 12,
      open: 8,
      status: "PARTLY_RESOLVED",
      resolutions: [
        {
          transaction_id: 4790,
          transaction_type: "EXPENSE",
          summary: "Courier",
          amount: -12,
          effective_time: "2026-10-12 16:20:00",
          entered_at: "2026-10-13 09:40:00",
          user_name: "Amir",
        },
      ],
    }),
  ],
);

const CLOSED = checkpoint(
  14,
  "General",
  "2026-10-12 18:03:00",
  "closed one",
  [{ currency_code: "USD", opening_amount: 983, physical_amount: 980 }],
  [
    difference({
      id: 104,
      closing_id: 14,
      amount: -3,
      direction: "SHORT",
      resolved: 0,
      open: 3,
      status: "CLOSED",
      closed_at: "2026-10-13 11:00:00",
      closed_by_name: "Amir",
      shortage_expense_id: 4760,
    }),
  ],
);

const MATCHED = checkpoint(
  15,
  "General",
  "2026-10-12 18:04:00",
  "matched one",
  [{ currency_code: "USD", opening_amount: 1050, physical_amount: 1050 }],
);

beforeEach(() => {
  mockGetCheckpointTimeline.mockReset();
  mockApi.closeCheckpointDifference.mockReset();
  mockApi.reopenCheckpointDifference.mockReset();
  mockRole = "admin";
});

describe("Checkpoint Timeline — difference status on each row (LIRA-335)", () => {
  it("an OPEN difference keeps today's amber Over $50.00 with no status pill", async () => {
    serve([OPEN]);
    render(<CheckpointTimeline />);

    const row = await rowWith("open one");
    const status = within(row).getByText("Over $50.00");
    expect(status.closest(".text-amber-400")).not.toBeNull();
    expect(row.textContent).not.toMatch(/Resolved|Closed|Open/);
  });

  it("a RESOLVED difference is struck through, has a Resolved pill and names the sale", async () => {
    serve([RESOLVED]);
    render(<CheckpointTimeline />);

    const row = await rowWith("resolved one");
    const struck = within(row).getByText("Over $50.00");
    expect(struck.className).toContain("line-through");
    expect(within(row).getByText("Resolved")).toBeTruthy();
    expect(row.textContent).toContain("Phone case");
    // Named like the Transactions page Summary, never by an internal id.
    expect(row.textContent).not.toContain("#4821");
    expect(row.textContent).toContain(
      "Phone case · entered Tue 10:05 AM with time Mon 02:10 PM",
    );
  });

  it("a PARTLY_RESOLVED difference says how much is still open", async () => {
    serve([PARTLY]);
    render(<CheckpointTimeline />);

    const row = await rowWith("partly one");
    expect(row.textContent).toContain("Short $20.00");
    expect(within(row).getByText("Partly resolved · $8.00 open")).toBeTruthy();
    expect(row.textContent).toContain("Courier");
    expect(row.textContent).not.toContain("#4790");
  });

  it("a CLOSED Short says Closed · Short and names the shortage expense", async () => {
    serve([CLOSED]);
    render(<CheckpointTimeline />);

    const row = await rowWith("closed one");
    expect(row.textContent).toContain("Short $3.00");
    expect(within(row).getByText("Closed · Short")).toBeTruthy();
    expect(row.textContent).toContain("Drawer shortage expense");
    expect(row.textContent).not.toContain("#4760");
    expect(row.textContent).toContain("Closed by Amir");
  });

  it("a matched checkpoint still reads Balanced", async () => {
    serve([MATCHED]);
    render(<CheckpointTimeline />);

    const row = await rowWith("matched one");
    expect(row.textContent).toContain("Balanced");
  });
});

describe("Checkpoint Timeline — Open differences only filter (LIRA-335)", () => {
  it("asks the server for open_only and shows how many rows match", async () => {
    serve([OPEN, PARTLY], 2);
    render(<CheckpointTimeline />);
    await rowWith("open one");

    const toggle = screen.getByLabelText(/Open differences only/);
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mockGetCheckpointTimeline).toHaveBeenLastCalledWith(
        expect.objectContaining({ open_only: true }),
      ),
    );
    const label = toggle.closest("label") as HTMLElement;
    await waitFor(() => expect(label.textContent).toContain("2"));
  });

  it("does not send open_only while the filter is off", async () => {
    serve([OPEN]);
    render(<CheckpointTimeline />);
    await rowWith("open one");

    expect(mockGetCheckpointTimeline).toHaveBeenCalled();
    for (const [filters] of mockGetCheckpointTimeline.mock.calls) {
      expect(filters).not.toHaveProperty("open_only", true);
    }
  });
});

describe("Checkpoint Timeline — details window resolution block (LIRA-335)", () => {
  it("lists what resolved the difference and what is still open, and offers Close difference… to admins", async () => {
    serve([PARTLY]);
    render(<CheckpointTimeline />);

    const details = openDetails(await rowWith("partly one"));
    expect(details.textContent).toContain("Resolved by");
    expect(details.textContent).toContain("Courier");
    expect(details.textContent).not.toContain("#4790");
    expect(details.textContent).toContain("Still open");
    expect(details.textContent).toContain("8.00");
    expect(
      within(details).getByRole("button", { name: "Close difference…" }),
    ).toBeTruthy();
    expect(
      within(details).queryByRole("button", { name: "Reopen" }),
    ).toBeNull();
    expect(details.textContent).toContain(
      "Missing entry found? Re-enter it with Set custom time before",
    );
  });

  it("a closed difference offers Reopen instead", async () => {
    serve([CLOSED]);
    render(<CheckpointTimeline />);

    const details = openDetails(await rowWith("closed one"));
    expect(
      within(details).getByRole("button", { name: "Reopen" }),
    ).toBeTruthy();
    expect(
      within(details).queryByRole("button", { name: "Close difference…" }),
    ).toBeNull();
  });

  it("a non-admin sees the status but no Close or Reopen", async () => {
    mockRole = "staff";
    serve([PARTLY, CLOSED]);
    render(<CheckpointTimeline />);

    const partly = openDetails(await rowWith("partly one"));
    expect(partly.textContent).toContain("Still open");
    expect(
      within(partly).queryByRole("button", { name: "Close difference…" }),
    ).toBeNull();
    expect(within(partly).queryByRole("button", { name: "Reopen" })).toBeNull();
  });

  it("after Close as short the details window shows the refreshed status (not failing-first: written after the page change)", async () => {
    serve([PARTLY]);
    render(<CheckpointTimeline />);
    const details = openDetails(await rowWith("partly one"));

    const closedPartly = {
      ...PARTLY,
      differences: [
        {
          ...PARTLY.differences[0],
          status: "CLOSED" as const,
          closed_by_name: "Amir",
          closed_at: "2026-10-13 11:00:00",
          shortage_expense_id: 4801,
        },
      ],
    };
    mockApi.closeCheckpointDifference.mockResolvedValue({
      success: true,
      data: closedPartly.differences[0],
    });
    serve([closedPartly]);

    fireEvent.click(
      within(details).getByRole("button", { name: "Close difference…" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close as short" }));

    await waitFor(() =>
      expect(
        within(details).getByRole("button", { name: "Reopen" }),
      ).toBeTruthy(),
    );
    expect(mockApi.closeCheckpointDifference).toHaveBeenCalledWith({
      difference_id: 103,
    });
    expect(details.textContent).toContain("Drawer shortage expense");
    expect(details.textContent).not.toContain("#4801");
    expect(screen.queryByText("Close as short")).toBeNull();
  });
});
