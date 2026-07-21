/** @jest-environment jsdom */
/**
 * MobileServicesManager — editable validity-days + credits fields on the
 * item edit path (LIRA W6.b). The list read + update calls go through
 * useApi() (dual transport); count/seed/create/delete/toggle stay
 * desktop-IPC-only (pre-existing gap, not introduced here).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MobileServicesManager from "../MobileServicesManager";
import type { MobileServiceItem } from "@/types/electron";

const mockGetAdminMobileServiceItems = jest.fn();
const mockUpdateMobileServiceItem = jest.fn();
// A STABLE object reference — MobileServicesManager's load() is a
// useCallback depending on [api]; a factory returning a fresh object
// literal per useApi() call would re-trigger the load effect every render.
const mockApi = {
  getAdminMobileServiceItems: mockGetAdminMobileServiceItems,
  updateMobileServiceItem: mockUpdateMobileServiceItem,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const ITEM: MobileServiceItem = {
  id: 1,
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "3.79",
  cost_lbp: 379000,
  sell_lbp: 430000,
  sort_order: 0,
  is_active: 1,
  validity_days: 10,
  credits: null,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

describe("MobileServicesManager — validity/credits (LIRA W6.b)", () => {
  beforeEach(() => {
    mockGetAdminMobileServiceItems.mockReset().mockResolvedValue([ITEM]);
    mockUpdateMobileServiceItem.mockReset().mockResolvedValue({
      success: true,
      data: { ...ITEM, validity_days: 15 },
    });

    (window as any).api = {
      mobileServiceItems: {
        count: jest.fn().mockResolvedValue({ success: true, data: 1 }),
        seed: jest.fn(),
      },
    };
  });

  afterEach(() => {
    delete (window as any).api;
  });

  it("shows the existing validity_days as a chip", async () => {
    render(<MobileServicesManager />);
    expect(await screen.findByText("10d")).toBeInTheDocument();
  });

  it("edits validity_days and submits it through updateMobileServiceItem (dual transport)", async () => {
    render(<MobileServicesManager />);
    await screen.findByText("3.79");

    fireEvent.click(screen.getByTitle("Edit"));

    const validityInput = screen.getByDisplayValue("10");
    fireEvent.change(validityInput, { target: { value: "15" } });

    fireEvent.click(screen.getByLabelText("Save item"));

    await waitFor(() =>
      expect(mockUpdateMobileServiceItem).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ validity_days: 15, credits: null }),
      ),
    );
  });
});
