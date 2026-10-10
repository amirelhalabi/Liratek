/** @jest-environment jsdom */
/**
 * LIRA-296 (T040) — starting a warranty claim.
 *   - pick Repair / Replace / Refund; staff only get Repair;
 *   - an expired warranty needs an admin and a reason;
 *   - a tracked product's Replace asks which unit is handed over;
 *   - the ONE payload goes through useApi().createWarrantyClaim with the
 *     browser's day (rule 27); a refusal shows its message.
 * `useApi` returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { localDay } from "@/shared/utils/localDay";
import { ClaimModal } from "../ClaimModal";

const api = {
  createWarrantyClaim: jest.fn(),
  productUnits: { getForProduct: jest.fn() },
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => api,
}));

const target = {
  saleItemId: 1000,
  productId: 10,
  productName: "Earbuds",
  state: "COVERED" as const,
  units: [] as { id: number; serial: string | null }[],
};

beforeEach(() => {
  jest.clearAllMocks();
  api.createWarrantyClaim.mockResolvedValue({
    success: true,
    data: { claim: { id: 5, action: "REPAIR" } },
  });
  api.productUnits.getForProduct.mockResolvedValue([{ id: 31, imei: "SN-31" }]);
});

it("staff can only start a repair", () => {
  render(
    <ClaimModal
      target={target}
      isAdmin={false}
      onClose={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("Repair")).toBeEnabled();
  expect(screen.getByLabelText("Replace")).toBeDisabled();
  expect(screen.getByLabelText("Refund")).toBeDisabled();
});

it("sends one payload with the browser's day and reports success", async () => {
  const onDone = jest.fn();
  render(
    <ClaimModal target={target} isAdmin onClose={jest.fn()} onDone={onDone} />,
  );
  fireEvent.click(screen.getByLabelText("Refund"));
  fireEvent.change(screen.getByLabelText("Notes"), {
    target: { value: "left bud dead" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start claim" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(api.createWarrantyClaim).toHaveBeenCalledWith({
    sale_item_id: 1000,
    action: "REFUND",
    notes: "left bud dead",
    client_day: localDay(),
  });
});

it("an expired warranty: only an admin, and only with a reason", async () => {
  const expired = { ...target, state: "EXPIRED" as const };
  const { unmount } = render(
    <ClaimModal
      target={expired}
      isAdmin={false}
      onClose={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  expect(screen.getByText(/expired/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start claim" })).toBeDisabled();
  unmount();
  render(
    <ClaimModal
      target={expired}
      isAdmin
      onClose={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Start claim" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reason for honouring it"), {
    target: { value: "goodwill" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start claim" }));
  await waitFor(() =>
    expect(api.createWarrantyClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        override_reason: "goodwill",
        action: "REPAIR",
      }),
    ),
  );
});

it("a tracked product's Replace asks which unit is handed over", async () => {
  const tracked = { ...target, units: [{ id: 5, serial: "SN-5" }] };
  render(
    <ClaimModal
      target={tracked}
      isAdmin
      onClose={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText("Replace"));
  const pick = await screen.findByLabelText("Replacement unit");
  fireEvent.change(pick, { target: { value: "31" } });
  fireEvent.click(screen.getByRole("button", { name: "Start claim" }));
  await waitFor(() =>
    expect(api.createWarrantyClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REPLACE",
        unit_id: 5,
        replacement_unit_id: 31,
      }),
    ),
  );
});

it("shows the refusal (e.g. out of stock)", async () => {
  api.createWarrantyClaim.mockResolvedValue({
    success: false,
    error: "Earbuds is out of stock — offer a repair or a refund instead.",
    code: "OUT_OF_STOCK",
  });
  render(
    <ClaimModal
      target={target}
      isAdmin
      onClose={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText("Replace"));
  fireEvent.click(screen.getByRole("button", { name: "Start claim" }));
  expect(await screen.findByText(/out of stock/)).toBeInTheDocument();
});

it("a void warranty cannot be claimed at all", () => {
  render(
    <ClaimModal
      target={{ ...target, state: "VOID" }}
      isAdmin
      onClose={jest.fn()}
      onDone={jest.fn()}
    />,
  );
  expect(screen.getByText(/void/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start claim" })).toBeDisabled();
});

it("a repair's own warranty: a repair claim on the job", async () => {
  const onDone = jest.fn();
  render(
    <ClaimModal
      target={{
        maintenanceId: 77,
        productId: null,
        productName: "iPhone screen",
        state: "COVERED",
        units: [],
      }}
      isAdmin
      onClose={jest.fn()}
      onDone={onDone}
    />,
  );
  expect(screen.getByLabelText("Replace")).toBeDisabled();
  expect(screen.getByLabelText("Refund")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Start claim" }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(api.createWarrantyClaim).toHaveBeenCalledWith({
    maintenance_id: 77,
    action: "REPAIR",
    client_day: localDay(),
  });
});
