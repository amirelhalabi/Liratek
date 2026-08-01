/** @jest-environment jsdom */
/**
 * CarrierLinesManager (LIRA W6.a) — Settings CRUD for the shop's own
 * alfa/mtc SIM lines. Informational only — no drawer legs, no
 * checkout/closing involvement.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CarrierLinesManager from "../CarrierLinesManager";
import type { CarrierLineEntity } from "@liratek/ui";

const mockGetAdminCarrierLines = jest.fn();
const mockCreateCarrierLine = jest.fn();
const mockArchiveCarrierLine = jest.fn();
// A STABLE object reference — CarrierLinesManager's load() is a
// useCallback depending on [api]; a factory returning a fresh object
// literal per useApi() call would re-trigger the load effect every render.
const mockApi = {
  getAdminCarrierLines: mockGetAdminCarrierLines,
  createCarrierLine: mockCreateCarrierLine,
  updateCarrierLine: jest.fn(),
  archiveCarrierLine: mockArchiveCarrierLine,
  toggleCarrierLineActive: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
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
});
