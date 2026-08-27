/** @jest-environment jsdom */
/**
 * CarrierLinesPanel (LIRA W6.a) — compact per-carrier panel: credits +
 * days-remaining, inline quick-update (credits and/or a new expiry).
 * Informational only — no drawer legs, no checkout/closing involvement.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CarrierLinesPanel } from "../CarrierLinesPanel";
import type { CarrierLineEntity } from "@liratek/ui";

const mockGetActiveCarrierLines = jest.fn();
const mockUpdateCarrierLineBalance = jest.fn();
const mockCreateCarrierLine = jest.fn();
const mockRecordCarrierLineUsage = jest.fn();
// A STABLE object reference — CarrierLinesPanel's load() is a useCallback
// depending on [api, carrier]; a factory that returns a fresh object literal
// on every useApi() call would re-trigger the effect on every render.
const mockApi = {
  getActiveCarrierLines: mockGetActiveCarrierLines,
  updateCarrierLineBalance: mockUpdateCarrierLineBalance,
  createCarrierLine: mockCreateCarrierLine,
  recordCarrierLineUsage: mockRecordCarrierLineUsage,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// Mirrors the component's own addDaysToToday() exactly (local Y/M/D, no
// UTC/ISO conversion — a local vs UTC mismatch would flip the date near
// midnight in non-UTC timezones, see docs memory: db-timestamp conventions).
function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const LINE: CarrierLineEntity = {
  id: 1,
  carrier: "mtc",
  phone_number: "03111111",
  label: "Shop Line 1",
  credits: 5,
  validity_expires_at: todayPlus(10),
  notes: null,
  is_active: 1,
  is_primary: 0,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

describe("CarrierLinesPanel", () => {
  beforeEach(() => {
    mockGetActiveCarrierLines.mockReset().mockResolvedValue([LINE]);
    mockUpdateCarrierLineBalance
      .mockReset()
      .mockResolvedValue({ success: true, data: LINE });
    mockCreateCarrierLine.mockReset().mockResolvedValue({
      success: true,
      data: { ...LINE, id: 2 },
    });
    mockRecordCarrierLineUsage.mockReset().mockResolvedValue({
      success: true,
      data: {
        expenseId: 11,
        transactionId: 22,
        creditsUsed: 1.25,
        newCredits: 3.75,
      },
    });
  });

  it("shows an '+ Add line' chip (not empty) when there are no active lines", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([]);
    render(<CarrierLinesPanel carrier="mtc" />);
    expect(await screen.findByTestId("add-carrier-line-mtc")).toHaveTextContent(
      "+ Add MTC line",
    );
  });

  it("add-a-line: opens the inline form, requires a phone number, and creates via useApi().createCarrierLine", async () => {
    mockGetActiveCarrierLines.mockResolvedValue([]);
    render(<CarrierLinesPanel carrier="mtc" />);

    fireEvent.click(await screen.findByTestId("add-carrier-line-mtc"));
    expect(
      await screen.findByTestId("add-carrier-line-form-mtc"),
    ).toBeInTheDocument();

    // Empty phone number is rejected client-side — no API call.
    fireEvent.click(screen.getByText("Add"));
    expect(
      await screen.findByTestId("add-carrier-line-error"),
    ).toHaveTextContent("Phone number is required");
    expect(mockCreateCarrierLine).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("03123456"), {
      target: { value: "03999999" },
    });
    fireEvent.change(screen.getByPlaceholderText("30"), {
      target: { value: "60" },
    });

    fireEvent.click(screen.getByText("Add"));

    await waitFor(() =>
      expect(mockCreateCarrierLine).toHaveBeenCalledWith({
        carrier: "mtc",
        phone_number: "03999999",
        label: null,
        credits: 0,
        validity_expires_at: todayPlus(60),
      }),
    );
    // Reloads the (now non-empty) list after a successful create.
    await waitFor(() =>
      expect(mockGetActiveCarrierLines).toHaveBeenCalledTimes(2),
    );
  });

  it("shows the line's label, credits, and days-remaining", async () => {
    render(<CarrierLinesPanel carrier="mtc" />);
    expect(mockGetActiveCarrierLines).toHaveBeenCalledWith("mtc");
    expect(await screen.findByText("Shop Line 1")).toBeInTheDocument();
    expect(await screen.findByText("$5")).toBeInTheDocument();
    expect(await screen.findByText("10d left")).toBeInTheDocument();
  });

  it("quick-update: 'days from today' resolves to a date and persists credits + validity_expires_at", async () => {
    render(<CarrierLinesPanel carrier="mtc" />);
    fireEvent.click(await screen.findByTestId("carrier-line-1"));

    const daysInput = screen.getByPlaceholderText("30");
    fireEvent.change(daysInput, { target: { value: "15" } });

    const creditsInputs = screen.getAllByRole("spinbutton");
    const creditsInput = creditsInputs[0]!;
    fireEvent.change(creditsInput, { target: { value: "22.5" } });

    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(mockUpdateCarrierLineBalance).toHaveBeenCalledWith(1, {
        credits: 22.5,
        validity_expires_at: todayPlus(15),
      }),
    );
  });

  // ── Record usage (LIRA-145) ───────────────────────────────────────────
  describe("record usage", () => {
    const openUsageForm = async () => {
      render(<CarrierLinesPanel carrier="mtc" />);
      fireEvent.click(await screen.findByTestId("carrier-line-usage-open-1"));
      return {
        newBalance: screen.getByTestId("carrier-line-usage-new-balance"),
        used: screen.getByTestId("carrier-line-usage-used"),
        note: screen.getByTestId("carrier-line-usage-note"),
        preview: screen.getByTestId("carrier-line-usage-preview"),
        submit: screen.getByTestId("carrier-line-usage-submit"),
      };
    };

    it("derives 'credits used' from a typed new balance, and vice versa", async () => {
      const f = await openUsageForm();

      // New balance → used (line holds $5).
      fireEvent.change(f.newBalance, { target: { value: "3.75" } });
      expect(f.used).toHaveValue(1.25);

      // Used → new balance, the same field pair read from the other end.
      fireEvent.change(f.used, { target: { value: "0.3" } });
      expect(f.newBalance).toHaveValue(4.7); // not 4.700000000000001

      // Clearing one clears the derived other rather than leaving a stale figure.
      fireEvent.change(f.newBalance, { target: { value: "" } });
      expect(f.used).toHaveValue(null);
    });

    it("previews the booked amount and gates submit on 0 <= newBalance < current", async () => {
      const f = await openUsageForm();

      // Nothing entered yet: no amount claimed, submit closed.
      expect(f.submit).toBeDisabled();
      expect(f.preview).toHaveTextContent("Enter a new balance below $5");

      fireEvent.change(f.newBalance, { target: { value: "3.75" } });
      expect(f.preview).toHaveTextContent("Records a $1.25 expense");
      expect(f.submit).toBeEnabled();

      // Equal to the current balance = nothing was used.
      fireEvent.change(f.newBalance, { target: { value: "5" } });
      expect(f.submit).toBeDisabled();

      // Above the current balance is a top-up, not a usage.
      fireEvent.change(f.newBalance, { target: { value: "9" } });
      expect(f.submit).toBeDisabled();

      // Negative balances are not a thing.
      fireEvent.change(f.newBalance, { target: { value: "-1" } });
      expect(f.submit).toBeDisabled();
    });

    it("submits the new balance plus the displayed current as expectedCurrentCredits, then reloads", async () => {
      const f = await openUsageForm();

      fireEvent.change(f.newBalance, { target: { value: "3.75" } });
      fireEvent.change(f.note, { target: { value: "customer top-up" } });
      fireEvent.click(f.submit);

      await waitFor(() =>
        expect(mockRecordCarrierLineUsage).toHaveBeenCalledWith({
          carrierLineId: 1,
          newCredits: 3.75,
          expectedCurrentCredits: 5,
          note: "customer top-up",
        }),
      );
      // Success feedback names the amount the SERVER booked, not the local math.
      expect(
        await screen.findByTestId("carrier-line-usage-success"),
      ).toHaveTextContent("Recorded a $1.25 MTC line-usage expense");
      await waitFor(() =>
        expect(mockGetActiveCarrierLines).toHaveBeenCalledTimes(2),
      );
    });

    it("omits an empty note entirely rather than sending '' or undefined", async () => {
      const f = await openUsageForm();

      fireEvent.change(f.newBalance, { target: { value: "4" } });
      fireEvent.change(f.note, { target: { value: "   " } });
      fireEvent.click(f.submit);

      await waitFor(() =>
        expect(mockRecordCarrierLineUsage).toHaveBeenCalledWith({
          carrierLineId: 1,
          newCredits: 4,
          expectedCurrentCredits: 5,
        }),
      );
      // The key is absent, not present-and-undefined (exactOptionalPropertyTypes,
      // and the Zod schema treats a missing note differently from "").
      expect(
        Object.prototype.hasOwnProperty.call(
          mockRecordCarrierLineUsage.mock.calls[0]![0],
          "note",
        ),
      ).toBe(false);
    });

    it("shows the server error on a plain rejection and keeps the form open", async () => {
      mockRecordCarrierLineUsage.mockResolvedValue({
        success: false,
        error:
          "Carrier line #1 is archived — reactivate it before recording usage",
      });
      const f = await openUsageForm();

      fireEvent.change(f.newBalance, { target: { value: "4" } });
      fireEvent.click(f.submit);

      expect(
        await screen.findByTestId("carrier-line-usage-error"),
      ).toHaveTextContent("is archived");
      // Still open, and the operator's figures are untouched.
      expect(screen.getByTestId("carrier-line-usage-new-balance")).toHaveValue(
        4,
      );
      // No reload — nothing changed server-side.
      expect(mockGetActiveCarrierLines).toHaveBeenCalledTimes(1);
    });

    it("on a stale-balance rejection: says the balance changed, clears the figures, and refreshes", async () => {
      mockRecordCarrierLineUsage.mockResolvedValue({
        success: false,
        error:
          "Carrier line #1 balance changed since the form was opened (expected $5, line now holds $2) — reload and try again",
      });
      const f = await openUsageForm();

      fireEvent.change(f.newBalance, { target: { value: "4" } });
      fireEvent.click(f.submit);

      expect(
        await screen.findByTestId("carrier-line-usage-error"),
      ).toHaveTextContent("balance changed since you opened the form");
      // Cleared, so a second click can't re-book against the stale figure.
      await waitFor(() =>
        expect(
          screen.getByTestId("carrier-line-usage-new-balance"),
        ).toHaveValue(null),
      );
      expect(screen.getByTestId("carrier-line-usage-submit")).toBeDisabled();
      await waitFor(() =>
        expect(mockGetActiveCarrierLines).toHaveBeenCalledTimes(2),
      );
    });

    // Regression (adversarial review, MAJOR): the handler used to be
    // try/finally with NO catch, so a transport-level THROW on this money
    // write was completely silent — no error, no success, the form back to
    // idle, and the rejection escaping unhandled. The throw path is real on
    // both transports: in the browser requestJson() throws on every non-2xx
    // (401 expired JWT, 403 role denial, the route's own 500); on the desktop
    // an unregistered IPC channel throws and ipcOrHttp's http() fallback has
    // no backend to reach. Contrast the sibling `{ success: false }` path
    // above, which was always handled.
    it("surfaces a transport-level throw instead of failing silently", async () => {
      mockRecordCarrierLineUsage.mockRejectedValue(
        new Error("Request failed (500)"),
      );
      const f = await openUsageForm();

      fireEvent.change(f.newBalance, { target: { value: "3.75" } });
      fireEvent.click(f.submit);

      const errorEl = await screen.findByTestId("carrier-line-usage-error");
      expect(errorEl).toHaveTextContent("Failed to record usage");
      expect(errorEl).toHaveTextContent("Request failed (500)");
      // Never claims a booking that did not happen.
      expect(
        screen.queryByTestId("carrier-line-usage-success"),
      ).not.toBeInTheDocument();
      // Form stays open, figures untouched, and the button leaves the
      // "Recording…" state so the operator can retry.
      expect(screen.getByTestId("carrier-line-usage-new-balance")).toHaveValue(
        3.75,
      );
      await waitFor(() =>
        expect(screen.getByTestId("carrier-line-usage-submit")).toBeEnabled(),
      );
      expect(screen.getByTestId("carrier-line-usage-submit")).toHaveTextContent(
        "Record",
      );
      // No reload on the throw path: keeping the stale expectedCurrentCredits
      // is what makes the server's concurrency guard reject a re-click after a
      // committed-but-unreported write.
      expect(mockGetActiveCarrierLines).toHaveBeenCalledTimes(1);
    });

    it("falls back to a generic message when the thrown value carries none", async () => {
      mockRecordCarrierLineUsage.mockRejectedValue("boom");
      const f = await openUsageForm();

      fireEvent.change(f.newBalance, { target: { value: "4" } });
      fireEvent.click(f.submit);

      expect(
        await screen.findByTestId("carrier-line-usage-error"),
      ).toHaveTextContent("Failed to record usage — check your connection");
    });
  });
});
