/** @jest-environment jsdom */
/**
 * LIRA-296 (T040, FR-012) — a line's claim history: date, staff member,
 * action, status and notes, newest first; an admin can void a live claim.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClaimHistory } from "../ClaimHistory";

const api = { getWarrantyClaims: jest.fn(), voidWarrantyClaim: jest.fn() };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => api,
}));

const claim = (over: Record<string, unknown>) => ({
  id: 1,
  sale_item_id: 1000,
  maintenance_id: null,
  unit_id: null,
  action: "REPAIR",
  status: "OPEN",
  override_reason: null,
  notes: "no sound",
  user_id: 1,
  username: "admin",
  repair_job_id: 9,
  replacement_unit_id: null,
  refund_transaction_id: null,
  voided_at: null,
  created_at: "2026-10-10 10:00:00",
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  api.getWarrantyClaims.mockResolvedValue([
    claim({ id: 2, action: "REPLACE", status: "DONE", notes: null }),
    claim({}),
  ]);
  api.voidWarrantyClaim.mockResolvedValue({
    success: true,
    data: claim({ status: "VOIDED" }),
  });
});

it("lists the claims with who, what, status and notes", async () => {
  render(<ClaimHistory saleItemId={1000} isAdmin={false} />);
  expect(await screen.findByText("Replace")).toBeInTheDocument();
  expect(screen.getByText("Repair")).toBeInTheDocument();
  expect(screen.getByText("no sound")).toBeInTheDocument();
  expect(screen.getAllByText("admin").length).toBe(2);
  expect(api.getWarrantyClaims).toHaveBeenCalledWith({ sale_item_id: 1000 });
  expect(screen.queryByRole("button", { name: /void/i })).toBeNull();
});

it("an admin can void a live claim", async () => {
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<ClaimHistory saleItemId={1000} isAdmin />);
  fireEvent.click(
    (await screen.findAllByRole("button", { name: "Void claim" }))[0]!,
  );
  await waitFor(() =>
    expect(api.voidWarrantyClaim).toHaveBeenCalledWith({ claim_id: 2 }),
  );
});

it("says so when there are none", async () => {
  api.getWarrantyClaims.mockResolvedValue([]);
  render(<ClaimHistory saleItemId={1000} isAdmin />);
  expect(
    await screen.findByText("No warranty claims yet."),
  ).toBeInTheDocument();
});
