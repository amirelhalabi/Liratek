/** @jest-environment jsdom */
/**
 * LIRA-296 (T040, FR-021) — the defective-items holding (admin): faulty
 * units taken back under a claim, with Write off and Not faulty.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DefectiveItems } from "../DefectiveItems";

const api = { listDefectiveItems: jest.fn(), resolveDefectiveItem: jest.fn() };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => api,
}));

const item = {
  id: 4,
  product_id: 10,
  product_name: "Earbuds",
  unit_id: null,
  serial: null,
  quantity: 1,
  unit_cost_usd: 6,
  warranty_claim_id: 2,
  claim_action: "REFUND",
  sale_item_id: 1000,
  status: "HELD",
  resolved_at: null,
  created_at: "2026-10-10 10:00:00",
};

beforeEach(() => {
  jest.clearAllMocks();
  api.listDefectiveItems.mockResolvedValue([
    item,
    { ...item, id: 5, status: "WRITTEN_OFF" },
  ]);
  api.resolveDefectiveItem.mockResolvedValue({
    success: true,
    data: { ...item, status: "WRITTEN_OFF" },
  });
});

it("lists held items with their cost and claim", async () => {
  render(<DefectiveItems />);
  expect((await screen.findAllByText("Earbuds")).length).toBe(2);
  expect(screen.getAllByText("$6.00").length).toBeGreaterThan(0);
  expect(screen.getByText("Held")).toBeInTheDocument();
  expect(screen.getByText("Written off")).toBeInTheDocument();
});

it("writes off and puts back in stock, only for a held item", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<DefectiveItems />);
  await screen.findAllByText("Earbuds");
  expect(screen.getAllByRole("button", { name: "Write off" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Not faulty" }));
  await waitFor(() =>
    expect(api.resolveDefectiveItem).toHaveBeenCalledWith({
      defective_item_id: 4,
      outcome: "NOT_FAULTY",
    }),
  );
});
