/** @jest-environment jsdom */
/**
 * LIRA-296 P3 (T050, US7) — supplier returns (admin): each return with its
 * supplier and status; an open (SENT) return can be closed as Credited
 * (with the credit), Replaced, or Rejected (with a note).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SupplierReturns } from "../SupplierReturns";

const api = {
  listSupplierReturns: jest.fn(),
  closeSupplierReturn: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => api,
}));

const ret = {
  id: 9,
  defective_item_id: 4,
  warranty_claim_id: 2,
  supplier_id: 40,
  supplier_name: "Gadget Wholesale",
  product_id: 10,
  product_name: "Earbuds",
  serial: null,
  unit_cost_usd: 6,
  status: "SENT",
  credit_usd: 0,
  credit_lbp: 0,
  notes: null,
  sent_at: "2026-10-10 10:00:00",
  closed_at: null,
  user_id: 1,
  closed_by: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  api.listSupplierReturns.mockResolvedValue([
    ret,
    { ...ret, id: 8, status: "CREDITED", credit_usd: 4 },
  ]);
  api.closeSupplierReturn.mockResolvedValue({
    success: true,
    data: { ...ret, status: "CREDITED" },
  });
});

it("lists returns with supplier, item and status", async () => {
  render(<SupplierReturns />);
  expect((await screen.findAllByText("Gadget Wholesale")).length).toBe(2);
  expect(screen.getByText("Sent")).toBeInTheDocument();
  expect(screen.getByText("Credited")).toBeInTheDocument();
  // Only the open one can be closed.
  expect(
    screen.getAllByRole("button", { name: "Record answer" }),
  ).toHaveLength(1);
});

it("closes as Credited with the credit amount", async () => {
  render(<SupplierReturns />);
  await screen.findAllByText("Gadget Wholesale");
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  fireEvent.click(screen.getByLabelText("Credited"));
  fireEvent.change(screen.getByLabelText("Credit (USD)"), {
    target: { value: "4" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.closeSupplierReturn).toHaveBeenCalledWith({
      supplier_return_id: 9,
      outcome: "CREDITED",
      credit_usd: 4,
    }),
  );
});

it("closes as Replaced", async () => {
  render(<SupplierReturns />);
  await screen.findAllByText("Gadget Wholesale");
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  fireEvent.click(screen.getByLabelText("Replaced"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.closeSupplierReturn).toHaveBeenCalledWith({
      supplier_return_id: 9,
      outcome: "REPLACED",
    }),
  );
});

it("Rejected needs a note before it can be saved", async () => {
  render(<SupplierReturns />);
  await screen.findAllByText("Gadget Wholesale");
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  fireEvent.click(screen.getByLabelText("Rejected"));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Note"), {
    target: { value: "Water damage" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(api.closeSupplierReturn).toHaveBeenCalledWith({
      supplier_return_id: 9,
      outcome: "REJECTED",
      notes: "Water damage",
    }),
  );
});

it("shows a refusal", async () => {
  api.closeSupplierReturn.mockResolvedValue({
    success: false,
    code: "RETURN_NOT_OPEN",
    error: "This supplier return is already closed.",
  });
  render(<SupplierReturns />);
  await screen.findAllByText("Gadget Wholesale");
  fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
  fireEvent.click(screen.getByLabelText("Replaced"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByText("This supplier return is already closed."),
  ).toBeInTheDocument();
});
