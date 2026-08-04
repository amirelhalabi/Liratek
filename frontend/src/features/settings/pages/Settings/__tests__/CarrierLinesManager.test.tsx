/** @jest-environment jsdom */
/**
 * CarrierLinesManager (LIRA W6.a) — Settings CRUD for the shop's own
 * alfa/mtc SIM lines. Informational only — no drawer legs, no
 * checkout/closing involvement.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CarrierLinesManager from "../CarrierLinesManager";
import type { CarrierLineEntity } from "@liratek/ui";
import type { ServiceItem } from "@/features/recharge/hooks/useMobileServiceItems";

const mockGetAdminCarrierLines = jest.fn();
const mockCreateCarrierLine = jest.fn();
const mockArchiveCarrierLine = jest.fn();
const mockSetPrimaryCarrierLine = jest.fn();
const mockSelfChargeTelecomItem = jest.fn();
// A STABLE object reference — CarrierLinesManager's load() is a
// useCallback depending on [api]; a factory returning a fresh object
// literal per useApi() call would re-trigger the load effect every render.
const mockApi = {
  getAdminCarrierLines: mockGetAdminCarrierLines,
  createCarrierLine: mockCreateCarrierLine,
  updateCarrierLine: jest.fn(),
  archiveCarrierLine: mockArchiveCarrierLine,
  toggleCarrierLineActive: jest.fn(),
  setPrimaryCarrierLine: mockSetPrimaryCarrierLine,
  selfChargeTelecomItem: mockSelfChargeTelecomItem,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// CarrierLinesManager also drives the self-charge picker (LIRA-090 §5.2),
// which reads the catalog through this context-backed hook. Default to an
// empty catalog — irrelevant to the "Make primary" tests below — and let
// the self-charge tests override via mockUseMobileServiceItems below.
const mockUseMobileServiceItems = jest.fn<{ items: ServiceItem[] }, []>(
  () => ({ items: [] }),
);
jest.mock("@/features/recharge/hooks/useMobileServiceItems", () => ({
  useMobileServiceItems: () => mockUseMobileServiceItems(),
  formatCatalogItemName: (item: {
    category: string;
    label: string;
    subcategory?: string;
  }) =>
    `${item.category}: ${item.label}${
      item.subcategory ? ` (${item.subcategory})` : ""
    }`,
}));

const EXISTING_LINE: CarrierLineEntity = {
  id: 1,
  carrier: "mtc",
  phone_number: "03111111",
  label: "Line A",
  credits: 10,
  validity_expires_at: "2026-08-01",
  notes: null,
  is_active: 1,
  is_primary: 0,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

describe("CarrierLinesManager", () => {
  beforeEach(() => {
    mockGetAdminCarrierLines.mockReset().mockResolvedValue([EXISTING_LINE]);
    mockCreateCarrierLine.mockReset().mockResolvedValue({
      success: true,
      data: { ...EXISTING_LINE, id: 2, phone_number: "70999999" },
    });
    mockArchiveCarrierLine.mockReset().mockResolvedValue({
      success: true,
      data: { ...EXISTING_LINE, is_active: 0 },
    });
    mockSetPrimaryCarrierLine.mockReset().mockResolvedValue({
      success: true,
      data: { ...EXISTING_LINE, is_primary: 1 },
    });
    mockSelfChargeTelecomItem.mockReset().mockResolvedValue({
      success: true,
      data: { costLbp: 50000, creditsAdded: 5, validityDaysAdded: 30 },
    });
    mockUseMobileServiceItems.mockReset().mockReturnValue({ items: [] });
  });

  it("lists existing carrier lines", async () => {
    render(<CarrierLinesManager />);
    expect(await screen.findByText("03111111")).toBeInTheDocument();
    expect(screen.getByText("Line A")).toBeInTheDocument();
  });

  it("creates a new carrier line via the form", async () => {
    render(<CarrierLinesManager />);
    await screen.findByText("03111111");

    fireEvent.click(screen.getByText("+ Add Line"));
    fireEvent.change(screen.getByPlaceholderText("e.g. 03123456"), {
      target: { value: "70999999" },
    });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() =>
      expect(mockCreateCarrierLine).toHaveBeenCalledWith(
        expect.objectContaining({
          carrier: "mtc",
          phone_number: "70999999",
        }),
      ),
    );
  });

  it("rejects an empty phone number", async () => {
    render(<CarrierLinesManager />);
    await screen.findByText("03111111");

    fireEvent.click(screen.getByText("+ Add Line"));
    fireEvent.click(screen.getByText("Create"));

    expect(
      await screen.findByText("Phone number is required"),
    ).toBeInTheDocument();
    expect(mockCreateCarrierLine).not.toHaveBeenCalled();
  });

  it("archives a line", async () => {
    window.confirm = jest.fn(() => true);
    render(<CarrierLinesManager />);
    await screen.findByText("03111111");

    fireEvent.click(screen.getByText("Archive"));

    await waitFor(() => expect(mockArchiveCarrierLine).toHaveBeenCalledWith(1));
  });

  it("offers 'Make primary' on a non-primary active line and calls the API", async () => {
    render(<CarrierLinesManager />);
    await screen.findByText("03111111");

    fireEvent.click(screen.getByText("Make primary"));

    await waitFor(() =>
      expect(mockSetPrimaryCarrierLine).toHaveBeenCalledWith(1),
    );
    // Refreshes the list after a successful call.
    expect(mockGetAdminCarrierLines).toHaveBeenCalledTimes(2);
  });

  it("shows a Primary badge and hides the action once a line is primary", async () => {
    mockGetAdminCarrierLines
      .mockReset()
      .mockResolvedValue([{ ...EXISTING_LINE, is_primary: 1 }]);
    render(<CarrierLinesManager />);
    await screen.findByText("03111111");

    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.queryByText("Make primary")).not.toBeInTheDocument();
  });

  it("hides 'Make primary' on an archived (inactive) line", async () => {
    mockGetAdminCarrierLines
      .mockReset()
      .mockResolvedValue([{ ...EXISTING_LINE, is_active: 0 }]);
    render(<CarrierLinesManager />);
    await screen.findByText("03111111");

    expect(screen.queryByText("Make primary")).not.toBeInTheDocument();
  });

  it("surfaces a failed 'Make primary' call via the existing error banner", async () => {
    mockSetPrimaryCarrierLine
      .mockReset()
      .mockResolvedValue({ success: false, error: "Nope" });
    render(<CarrierLinesManager />);
    await screen.findByText("03111111");

    fireEvent.click(screen.getByText("Make primary"));

    expect(await screen.findByText("Nope")).toBeInTheDocument();
  });

  // ── Self-charge modal (LIRA-090 §5.2, TELECOM_DAYS_COST_PLAN §6 step 5) ──
  describe("self-charge modal", () => {
    // EXISTING_LINE.carrier === "mtc" — this item is eligible for it.
    const MTC_ITEM = {
      id: 10,
      key: "mtc-item-10",
      provider: "iPick" as const,
      category: "mtc",
      subcategory: "",
      label: "Recharge 5",
      catalogCost: 50000,
      credits: 5,
      validityDays: 30,
      sortOrder: 1,
    };
    // Same shape but a different carrier — must never appear in an "mtc"
    // line's picker.
    const ALFA_ITEM = {
      id: 20,
      key: "alfa-item-20",
      provider: "iPick" as const,
      category: "alfa",
      subcategory: "",
      label: "Recharge 3",
      catalogCost: 40000,
      credits: 3,
      validityDays: 15,
      sortOrder: 2,
    };
    // Right carrier, wrong provider — self-charge only accepts iPick/Katsh
    // (FinancialServiceRepository.selfChargeTelecomItem's own guard), so
    // this must also be filtered out even though the carrier matches.
    const WRONG_PROVIDER_ITEM = {
      id: 30,
      key: "mtc-item-30",
      provider: "WHISH_APP" as const,
      category: "mtc",
      subcategory: "",
      label: "Whish Item",
      catalogCost: 10000,
      credits: 2,
      validityDays: 10,
      sortOrder: 3,
    };

    beforeEach(() => {
      mockUseMobileServiceItems.mockReturnValue({
        items: [MTC_ITEM, ALFA_ITEM, WRONG_PROVIDER_ITEM],
      });
    });

    it("opens the modal from the line row", async () => {
      render(<CarrierLinesManager />);
      await screen.findByText("03111111");

      fireEvent.click(screen.getByText("Charge item to this line"));

      expect(
        await screen.findByText("Charge Item to This Line"),
      ).toBeInTheDocument();
    });

    it("filters the item picker to the line's carrier (and its eligible provider)", async () => {
      render(<CarrierLinesManager />);
      await screen.findByText("03111111");

      fireEvent.click(screen.getByText("Charge item to this line"));
      await screen.findByText("Charge Item to This Line");

      // Eligible mtc/iPick item is offered.
      expect(screen.getByText(/mtc: Recharge 5/)).toBeInTheDocument();
      // Different carrier (alfa) and wrong provider (WHISH_APP) are not.
      expect(screen.queryByText(/alfa: Recharge 3/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Whish Item/)).not.toBeInTheDocument();
    });

    it("shows the credits and validity days the line will gain before confirming", async () => {
      render(<CarrierLinesManager />);
      await screen.findByText("03111111");

      fireEvent.click(screen.getByText("Charge item to this line"));
      await screen.findByText("Charge Item to This Line");

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "10" },
      });

      expect(await screen.findByText("+$5")).toBeInTheDocument();
      expect(screen.getByText("+30 days")).toBeInTheDocument();
    });

    it("sends the exact documented payload when confirmed", async () => {
      render(<CarrierLinesManager />);
      await screen.findByText("03111111");

      fireEvent.click(screen.getByText("Charge item to this line"));
      await screen.findByText("Charge Item to This Line");

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "10" },
      });
      fireEvent.click(screen.getByText("Confirm Charge"));

      await waitFor(() =>
        expect(mockSelfChargeTelecomItem).toHaveBeenCalledWith({
          mobileServiceItemId: 10,
          carrierLineId: 1,
        }),
      );
    });

    it("surfaces a failed self-charge to the operator instead of failing silently", async () => {
      mockSelfChargeTelecomItem.mockReset().mockResolvedValue({
        success: false,
        error: "iPick drawer insufficient",
      });
      render(<CarrierLinesManager />);
      await screen.findByText("03111111");

      fireEvent.click(screen.getByText("Charge item to this line"));
      await screen.findByText("Charge Item to This Line");

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "10" },
      });
      fireEvent.click(screen.getByText("Confirm Charge"));

      expect(
        await screen.findByText("iPick drawer insufficient"),
      ).toBeInTheDocument();
      // Modal stays open so the operator can retry — it does not silently close.
      expect(screen.getByText("Charge Item to This Line")).toBeInTheDocument();
    });
  });
});
