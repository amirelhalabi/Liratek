/**
 * Maintenance — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();

const mockSaveMaintenanceJob = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getMaintenanceJobs: mockGetMaintenanceJobs,
    saveMaintenanceJob: mockSaveMaintenanceJob,
    deleteMaintenanceJob: jest.fn(),
    // LIRA-176 7b — status timeline + parts editor, fetched/queried when a
    // job is loaded into the form.
    getMaintenanceStatusHistory: jest.fn().mockResolvedValue([]),
    getProducts: jest.fn().mockResolvedValue([]),
    // useAutoPrintReceipt -> useShopInfo() calls this on mount.
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "staff", role: "staff" } }),
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetMaintenanceJobs as unknown as jest.Mock).mockReset();
  (mockSaveMaintenanceJob as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Maintenance.draftDiscount", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Maintenance draft-save — discount preservation (data-corruption fix)
   *
   * `handleSaveDraft` used to call `buildPricing(cost, price, currency)` with no
   * explicit `finalAmount`, so `buildPricing`'s default (`final = price`) silently
   * dropped any discount that was applied at checkout — resubmitting the FULL
   * price as `final_amount_*` and erasing the stored post-discount value. On a
   * job with money history this also tripped MaintenanceRepository.updateJob's
   * paid-job amount-immutability guard on a notes-only edit, since the bogus
   * final_amount differed from the stored one.
   *
   * This guards:
   *   (a) editing only the notes on a discounted, paid job resubmits the SAME
   *       final_amount_usd that was originally stored (price - discount), so
   *       the guard sees no amount change and the save succeeds.
   *   (b) changing the price recomputes final_amount_usd as the new price minus
   *       the job's existing discount.
   */

  describe("Maintenance draft save — discount preservation", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSaveMaintenanceJob.mockResolvedValue({ success: true });
    });

    it("(a) editing only the notes on a discounted, paid job resubmits the stored post-discount final_amount_usd", async () => {
      // Checked out at price 100, discount 20 -> stored final_amount_usd = 80
      // (this is exactly what handleCheckoutComplete would have written:
      // final = Math.max(0, totalAmount - discount)).
      mockGetMaintenanceJobs.mockResolvedValue([
        {
          id: 1,
          device_name: "iPhone 13",
          issue_description: "Screen replacement",
          status: "Delivered_Paid",
          currency: "USD",
          cost_usd: 10,
          price_usd: 100,
          discount_usd: 20,
          final_amount_usd: 80,
          paid_usd: 80,
          paid_lbp: 0,
        },
      ]);

      render(<Maintenance />);

      await waitFor(() => {
        expect(screen.getByText("iPhone 13")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("iPhone 13").closest("button")!);

      const issueField = await screen.findByLabelText(/Issue Description/i);
      fireEvent.change(issueField, {
        target: { value: "Screen replacement — customer confirmed pickup" },
      });

      fireEvent.click(screen.getByText("Save as Draft"));

      await waitFor(() => {
        expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
      });

      const payload = mockSaveMaintenanceJob.mock.calls[0][0];
      expect(payload.price_usd).toBe(100);
      expect(payload.discount_usd).toBe(20);
      // The regression: this used to come back as 100 (the full price),
      // silently erasing the discount.
      expect(payload.final_amount_usd).toBe(80);
    });

    it("(b) changing the price recomputes final_amount_usd as price - discount", async () => {
      // Not yet paid, so the amount inputs are editable; discount_usd is
      // already on the record (e.g. set by an earlier partial flow) and must
      // be reapplied against the newly typed price.
      mockGetMaintenanceJobs.mockResolvedValue([
        {
          id: 2,
          device_name: "Samsung S21",
          issue_description: "Battery swap",
          status: "Ready",
          currency: "USD",
          cost_usd: 5,
          price_usd: 100,
          discount_usd: 20,
          final_amount_usd: 80,
          paid_usd: 0,
          paid_lbp: 0,
        },
      ]);

      render(<Maintenance />);

      await waitFor(() => {
        expect(screen.getByText("Samsung S21")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Samsung S21").closest("button")!);

      const priceField = await screen.findByLabelText(/Price to Client/i);
      fireEvent.change(priceField, { target: { value: "150" } });

      fireEvent.click(screen.getByText("Save as Draft"));

      await waitFor(() => {
        expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
      });

      const payload = mockSaveMaintenanceJob.mock.calls[0][0];
      expect(payload.price_usd).toBe(150);
      expect(payload.discount_usd).toBe(20);
      expect(payload.final_amount_usd).toBe(130);
    });
  });
});

describe("Maintenance.partsKeyPresence (LIRA-176)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * `buildJobPayload`'s `parts` key presence contract (LIRA-176 phase 8b,
   * item 2) — the ONE `saveMaintenanceJob` payload builder deliberately omits
   * `parts` entirely (never `[]`) when a caller doesn't pass it, because
   * MaintenanceService treats an ABSENT key as "leave parts untouched" and an
   * explicit empty array as "delete every attached part and return its
   * stock". A status transition never touches parts, so its payload must
   * genuinely lack the key — not carry an empty array that LOOKS harmless but
   * would wipe a job's parts on every status click.
   *
   * Also covers item 3: a status transition must preserve an existing
   * discount (via `computeFinalAmount`) rather than resending the raw price —
   * this was the exact bug fixed before phase 7b (see
   * Maintenance.draftDiscount.test.tsx for the draft-save half; this is the
   * status-transition half, never previously covered).
   */

  describe("buildJobPayload — `parts` key presence per save path", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 1 });
    });

    it("status transition ('Start' button): `parts` key is ABSENT, not empty", async () => {
      mockGetMaintenanceJobs.mockResolvedValue([
        {
          id: 10,
          device_name: "Status Transition Job",
          issue_description: "Diagnostics",
          status: "Received",
          currency: "USD",
          cost_usd: 5,
          price_usd: 50,
          discount_usd: 0,
          final_amount_usd: 50,
          paid_usd: 0,
          paid_lbp: 0,
          parts: [],
        },
      ]);

      render(<Maintenance />);
      await waitFor(() => {
        expect(screen.getByText("Status Transition Job")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Mark In Progress"));

      await waitFor(() => {
        expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
      });
      const payload = mockSaveMaintenanceJob.mock.calls[0][0];

      expect(payload.status).toBe("In_Progress");
      // Strict "does not have the property at all" — not `toEqual([])`, not
      // `toBeUndefined()` (which passes for both an absent key AND a key
      // explicitly set to `undefined`, hiding the exact regression this test
      // guards).
      expect(Object.prototype.hasOwnProperty.call(payload, "parts")).toBe(
        false,
      );
    });

    it("status transition preserves an existing discount instead of resending the raw price", async () => {
      // Checked out at price 100, discount 20 -> stored final_amount_usd = 80.
      mockGetMaintenanceJobs.mockResolvedValue([
        {
          id: 11,
          device_name: "Discounted Transition Job",
          issue_description: "Screen replacement",
          status: "Received",
          currency: "USD",
          cost_usd: 10,
          price_usd: 100,
          discount_usd: 20,
          final_amount_usd: 80,
          paid_usd: 0,
          paid_lbp: 0,
          parts: [],
        },
      ]);

      render(<Maintenance />);
      await waitFor(() => {
        expect(
          screen.getByText("Discounted Transition Job"),
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTitle("Mark In Progress"));

      await waitFor(() => {
        expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
      });
      const payload = mockSaveMaintenanceJob.mock.calls[0][0];

      expect(payload.price_usd).toBe(100);
      expect(payload.discount_usd).toBe(20);
      // The regression: resending the raw price would come back as 100,
      // silently erasing the discount on every status click.
      expect(payload.final_amount_usd).toBe(80);
    });

    it("draft save (new job, no parts added): `parts` key is PRESENT as an empty array", async () => {
      mockGetMaintenanceJobs.mockResolvedValue([]);

      render(<Maintenance />);

      const deviceField = await screen.findByLabelText(/Device Name/i);
      fireEvent.change(deviceField, { target: { value: "New Draft Job" } });
      const priceField = await screen.findByLabelText(/Price to Client/i);
      fireEvent.change(priceField, { target: { value: "50" } });

      fireEvent.click(screen.getByText("Save as Draft"));

      await waitFor(() => {
        expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
      });
      const payload = mockSaveMaintenanceJob.mock.calls[0][0];

      expect(Object.prototype.hasOwnProperty.call(payload, "parts")).toBe(true);
      expect(payload.parts).toEqual([]);
    });

    it("draft save on a job WITH a part: `parts` key is present and non-empty", async () => {
      mockGetMaintenanceJobs.mockResolvedValue([
        {
          id: 12,
          device_name: "Draft Job With Part",
          issue_description: "Battery swap",
          status: "Received",
          currency: "USD",
          cost_usd: 5,
          price_usd: 60,
          paid_usd: 0,
          paid_lbp: 0,
          parts: [
            {
              id: 3,
              maintenance_id: 12,
              product_id: 9,
              product_name: "Battery",
              quantity: 2,
              unit_cost_usd: 8,
              unit_price_usd: 15,
              stock_restored: 0,
              created_at: "2026-09-01 10:00:00",
              updated_at: "2026-09-01 10:00:00",
            },
          ],
        },
      ]);

      render(<Maintenance />);
      await waitFor(() => {
        expect(screen.getByText("Draft Job With Part")).toBeInTheDocument();
      });
      fireEvent.click(
        screen.getByText("Draft Job With Part").closest("button")!,
      );

      fireEvent.click(screen.getByText("Save as Draft"));

      await waitFor(() => {
        expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
      });
      const payload = mockSaveMaintenanceJob.mock.calls[0][0];

      expect(Object.prototype.hasOwnProperty.call(payload, "parts")).toBe(true);
      expect(payload.parts).toEqual([
        { id: 3, product_id: 9, quantity: 2, unit_price_usd: 15 },
      ]);
    });
  });
});

describe("Maintenance.savedPartPriceWarning (LIRA-260)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-260 follow-up — the parts price-change warning on a SAVED job.
   *
   * A part line loaded from a saved job used to carry no catalog price, so the
   * amber `PriceChangeWarning` never showed for it. The jobs read now returns
   * each part's product `retail_price` as `catalog_price_usd`; reopening the
   * job must map it into the PartPicker line so a part whose saved price
   * differs from the catalog shows both prices — and the save payload must
   * still NOT carry it (`toPartsPayload` whitelists backend fields).
   *
   * The `useApi` mock returns a fresh object literal per call on purpose
   * (CLAUDE.md rule 25).
   *
   * Rule 17: written before the `handleEdit` mapping change and run against
   * the unfixed code — the warning test failed (no `price-change-warning`).
   */

  function savedJob(partOverrides: Record<string, unknown>) {
    return {
      id: 21,
      device_name: "Saved Job With Part",
      issue_description: "Battery swap",
      status: "Received",
      currency: "USD",
      cost_usd: 5,
      price_usd: 60,
      paid_usd: 0,
      paid_lbp: 0,
      parts: [
        {
          id: 7,
          maintenance_id: 21,
          product_id: 9,
          product_name: "Battery",
          quantity: 1,
          unit_cost_usd: 8,
          unit_price_usd: 15,
          stock_restored: 0,
          created_at: "2026-09-01 10:00:00",
          updated_at: "2026-09-01 10:00:00",
          ...partOverrides,
        },
      ],
    };
  }

  async function reopen() {
    render(<Maintenance />);
    await waitFor(() => {
      expect(screen.getByText("Saved Job With Part")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Saved Job With Part").closest("button")!);
  }

  describe("Maintenance — price warning on a saved job's parts (LIRA-260)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 21 });
    });

    it("reopening a job whose part price differs from the product price shows both prices", async () => {
      mockGetMaintenanceJobs.mockResolvedValue([
        savedJob({ catalog_price_usd: 20 }),
      ]);
      await reopen();

      const warning = await screen.findByTestId("price-change-warning");
      expect(warning).toHaveTextContent("$20.00");
      expect(warning).toHaveTextContent("$15.00");
    });

    it("no warning when the saved part price equals the product price", async () => {
      mockGetMaintenanceJobs.mockResolvedValue([
        savedJob({ catalog_price_usd: 15 }),
      ]);
      await reopen();

      expect(screen.getByDisplayValue("15")).toBeInTheDocument();
      expect(screen.queryByTestId("price-change-warning")).toBeNull();
    });

    it("no warning when the product no longer exists (catalog price null)", async () => {
      mockGetMaintenanceJobs.mockResolvedValue([
        savedJob({ catalog_price_usd: null }),
      ]);
      await reopen();

      expect(screen.getByDisplayValue("15")).toBeInTheDocument();
      expect(screen.queryByTestId("price-change-warning")).toBeNull();
    });

    it("the catalog price is never sent back on save", async () => {
      mockGetMaintenanceJobs.mockResolvedValue([
        savedJob({ catalog_price_usd: 20 }),
      ]);
      await reopen();

      fireEvent.click(screen.getByText("Save as Draft"));
      await waitFor(() => {
        expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
      });
      expect(mockSaveMaintenanceJob.mock.calls[0][0].parts).toEqual([
        { id: 7, product_id: 9, quantity: 1, unit_price_usd: 15 },
      ]);
    });
  });
});
