/** @jest-environment jsdom */
/**
 * LIRA-331 — closing a supplier return sends the same payload in English and
 * Arabic, for every outcome (Credited with USD + LBP credit, Replaced,
 * Rejected with a note) — research R9, rule 28d. Controls are found by
 * position/type, never by label text, so one script runs in both languages.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
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
  api.listSupplierReturns.mockResolvedValue([ret]);
  api.closeSupplierReturn.mockResolvedValue({ success: true, data: ret });
});

afterEach(async () => {
  await i18n.changeLanguage("en");
  jest.clearAllMocks();
});

const OUTCOME_INDEX = { CREDITED: 0, REPLACED: 1, REJECTED: 2 } as const;

async function close(
  outcome: keyof typeof OUTCOME_INDEX,
): Promise<Record<string, unknown>> {
  const { container, unmount } = render(<SupplierReturns />);
  await screen.findByTestId("supplier-return-row");
  const row = screen.getByTestId("supplier-return-row");
  const buttons = row.querySelectorAll("button");
  fireEvent.click(buttons[buttons.length - 1]);
  const radios = container.querySelectorAll('input[type="radio"]');
  fireEvent.click(radios[OUTCOME_INDEX[outcome]]);
  const fields = Array.from(
    container.querySelectorAll('input:not([type="radio"])'),
  );
  if (outcome === "CREDITED") {
    fireEvent.change(fields[0], { target: { value: "4.5" } });
    fireEvent.change(fields[1], { target: { value: "90000" } });
  }
  fireEvent.change(fields[fields.length - 1], {
    target: { value: "bad batch" },
  });
  const formButtons = Array.from(container.querySelectorAll("button")).filter(
    (b) => !row.contains(b),
  );
  fireEvent.click(formButtons[0]);
  await waitFor(() => expect(api.closeSupplierReturn).toHaveBeenCalledTimes(1));
  const payload = api.closeSupplierReturn.mock.calls[0][0];
  unmount();
  api.closeSupplierReturn.mockClear();
  return payload;
}

it.each(["CREDITED", "REPLACED", "REJECTED"] as const)(
  "%s: same payload in English and Arabic",
  async (outcome) => {
    await i18n.changeLanguage("en");
    const en = await close(outcome);
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    const ar = await close(outcome);
    expect(ar).toEqual(en);
    expect(en.outcome).toBe(outcome);
    if (outcome === "CREDITED") {
      expect(en).toMatchObject({ credit_usd: 4.5, credit_lbp: 90000 });
    }
  },
);

it("Arabic digits typed in a credit become the same number", async () => {
  const { container } = render(<SupplierReturns />);
  await screen.findByTestId("supplier-return-row");
  const row = screen.getByTestId("supplier-return-row");
  const buttons = row.querySelectorAll("button");
  fireEvent.click(buttons[buttons.length - 1]);
  fireEvent.click(container.querySelectorAll('input[type="radio"]')[0]);
  const fields = container.querySelectorAll('input:not([type="radio"])');
  fireEvent.change(fields[0], { target: { value: "٤٫٥" } });
  const formButtons = Array.from(container.querySelectorAll("button")).filter(
    (b) => !row.contains(b),
  );
  fireEvent.click(formButtons[0]);
  await waitFor(() => expect(api.closeSupplierReturn).toHaveBeenCalledTimes(1));
  expect(api.closeSupplierReturn.mock.calls[0][0]).toMatchObject({
    credit_usd: 4.5,
  });
});

it("shows Arabic when the language is ar", async () => {
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  render(<SupplierReturns />);
  expect(await screen.findByText("تسجيل الرد")).toBeInTheDocument();
});
