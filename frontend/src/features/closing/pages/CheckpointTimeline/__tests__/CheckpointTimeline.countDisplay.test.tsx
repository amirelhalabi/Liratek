/** @jest-environment jsdom */
/**
 * Checkpoint Timeline — what a cashier reads off each row and its details.
 *
 * Found by driving the web app on 2026-10-12:
 *  - a drawer counted at 0 showed the EXPECTED amount and "Matched";
 *  - an empty drawer (0 → 0) read "—" / "No amounts recorded";
 *  - variances were a bare sign ("USD -3.00"), never "short" / "over";
 *  - rows carried a time but never a day, even across a multi-day range;
 *  - the all-drawers setup checkpoint showed the code word "AGGREGATED" and
 *    listed every drawer's amounts with no drawer name on any line.
 *
 * The fixtures carry `physical_amount: 0` the way the fixed
 * `ClosingRepository.getCheckpointTimeline` returns it (its own guard:
 * ClosingRepository.timelineZeroCount.test.ts).
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
) {
  return {
    id,
    closing_date: createdAt.slice(0, 10),
    drawer_name: drawer,
    checkpoint_type: "CHECKPOINT" as const,
    created_at: createdAt,
    created_by: 1,
    user_name: "admin",
    notes,
    currencies: currencies.map((c) => ({ drawer_name: drawer, ...c })),
  };
}

const mockGetCheckpointTimeline = jest.fn();
const mockApi = {
  getInitialCheckpointDate: jest.fn().mockResolvedValue(null),
  getCheckpointTimeline: mockGetCheckpointTimeline,
  getCarrierLineAdjustments: jest
    .fn()
    .mockResolvedValue({ success: true, adjustments: [] }),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function serve(checkpoints: ReturnType<typeof checkpoint>[]) {
  mockGetCheckpointTimeline.mockResolvedValue({ success: true, checkpoints });
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

beforeEach(() => mockGetCheckpointTimeline.mockReset());

describe("Checkpoint Timeline — counted amounts", () => {
  it("a drawer counted at 0 shows $0.00 and the shortage, on the row and in the details", async () => {
    serve([
      checkpoint(
        6,
        "General",
        "2026-10-12 17:55:00",
        "Owner took all dollars home",
        [
          { currency_code: "USD", opening_amount: 205, physical_amount: 0 },
          {
            currency_code: "LBP",
            opening_amount: 1_450_000,
            physical_amount: 1_450_000,
          },
        ],
      ),
    ]);
    render(<CheckpointTimeline />);

    const row = await rowWith("Owner took all dollars home");
    expect(row.textContent).toContain("$0.00");
    expect(row.textContent).toContain("Short $205.00");
    expect(screen.getByText("Counted")).toBeTruthy();

    const details = openDetails(row);
    expect(details.textContent).toContain("Short 205.00");
    expect(details.textContent).not.toMatch(/205\.00\s*→\s*205\.00/);
  });

  it("an empty drawer counted 0 → 0 reads as a balanced count, not a missing one", async () => {
    serve([
      checkpoint(2, "OMT_App", "2026-10-12 17:52:00", "empty drawer", [
        { currency_code: "USD", opening_amount: 0, physical_amount: 0 },
        { currency_code: "LBP", opening_amount: 0, physical_amount: 0 },
      ]),
    ]);
    render(<CheckpointTimeline />);

    const row = await rowWith("empty drawer");
    expect(row.textContent).toContain("$0.00");
    expect(row.textContent).toContain("Balanced");

    const details = openDetails(row);
    expect(details.textContent).not.toContain("No amounts recorded");
    expect(within(details).getAllByText("Matched")).toHaveLength(2);
  });

  it("a variance says Short or Over in words, with the currency written the shop's way", async () => {
    serve([
      checkpoint(5, "General", "2026-10-12 17:53:17", "Evening", [
        { currency_code: "USD", opening_amount: 197, physical_amount: 205 },
      ]),
      checkpoint(3, "General", "2026-10-12 17:53:01", "Afternoon", [
        {
          currency_code: "LBP",
          opening_amount: 1_500_000,
          physical_amount: 1_450_000,
        },
      ]),
    ]);
    render(<CheckpointTimeline />);

    expect((await rowWith("Evening")).textContent).toContain("Over $8.00");
    expect((await rowWith("Afternoon")).textContent).toContain(
      "Short 50,000 LBP",
    );
  });
});

describe("Checkpoint Timeline — dates", () => {
  it("shows the day on each row once the range covers more than one day, and always in the details", async () => {
    serve([
      checkpoint(1, "General", "2026-10-11 09:10:00", "Morning count", [
        { currency_code: "USD", opening_amount: 200, physical_amount: 197 },
      ]),
    ]);
    const { container } = render(<CheckpointTimeline />);
    await screen.findByText("Morning count");

    const from = container.querySelectorAll('input[type="date"]')[0];
    fireEvent.change(from, { target: { value: "2026-10-11" } });
    await waitFor(() =>
      expect(mockGetCheckpointTimeline).toHaveBeenLastCalledWith(
        expect.objectContaining({ date_from: "2026-10-11" }),
      ),
    );

    const row = await rowWith("Morning count");
    expect(row.textContent).toContain("Oct 11");

    const details = openDetails(row);
    expect(details.textContent).toContain("Oct 11, 2026");
  });
});

describe("Checkpoint Timeline — the all-drawers setup checkpoint", () => {
  const setup = () =>
    serve([
      {
        ...checkpoint(
          1,
          "AGGREGATED",
          "2026-10-12 18:24:00",
          "Initial drawer amounts setup",
          [],
        ),
        currencies: [
          {
            drawer_name: "General",
            currency_code: "USD",
            opening_amount: 10_000,
            physical_amount: 10_000,
          },
          {
            drawer_name: "General",
            currency_code: "LBP",
            opening_amount: 100_000_000,
            physical_amount: 100_000_000,
          },
          {
            drawer_name: "OMT_App",
            currency_code: "USD",
            opening_amount: 10_000,
            physical_amount: 10_000,
          },
          {
            drawer_name: "OMT_App",
            currency_code: "LBP",
            opening_amount: 100_000_000,
            physical_amount: 100_000_000,
          },
        ],
      },
    ]);

  it("names it in plain words and counts drawers instead of adding them together", async () => {
    setup();
    render(<CheckpointTimeline />);

    const row = await rowWith("Initial drawer amounts setup");
    expect(row.textContent).not.toContain("AGGREGATED");
    expect(row.textContent).toContain("All drawers");
    expect(row.textContent).toContain("2 drawers");
    expect(row.textContent).not.toContain("$20,000.00");
  });

  it("groups the details under a heading per drawer", async () => {
    setup();
    render(<CheckpointTimeline />);

    const details = openDetails(await rowWith("Initial drawer amounts setup"));
    expect(details.textContent).not.toContain("AGGREGATED");
    expect(within(details).getByText("General")).toBeTruthy();
    expect(within(details).getByText("OMT App")).toBeTruthy();
  });
});
