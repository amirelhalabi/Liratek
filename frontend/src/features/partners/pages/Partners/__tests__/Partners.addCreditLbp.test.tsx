/** @jest-environment jsdom */
/**
 * LIRA-120 (re-opens LIRA-097) — Partners page "Add Credit / Debt" currency
 * picker.
 *
 * LIRA-097 was closed as "already working" purely because the `options`
 * array on the Currency `<Select>` in `RecordTxModal` contains `{USD, LBP}`
 * (frontend/src/features/partners/pages/Partners/index.tsx:811-814). That
 * options array was never wrong — the earlier version of THIS test proved
 * it by fully mocking `<Select>` as a native `<select>` element, which
 * bypasses the real control entirely. Reading an options array is not
 * testing a control: the owner reported the real dropdown never opens (the
 * trigger's arrow flips; no list appears), so LBP was in practice
 * unreachable. Root cause (LIRA-120, see
 * frontend/src/shared/components/__tests__/Select.modalStacking.test.tsx
 * and packages/ui/src/components/ui/Select.tsx): the shared `<Select>`
 * portals its option list into ONE div shared by every Select in the app,
 * and that div had no z-index of its own — so a Select opened inside a
 * modal backdrop with a HIGHER explicit z-index (this page's local `Modal`,
 * used by `RecordTxModal`, is `z-[60]`; Select's own panel is `z-50`)
 * rendered its list behind that backdrop. Fixed in Select.tsx; this test
 * now exercises the REAL `<Select>` (not mocked) end-to-end: open the
 * modal, click the real currency trigger, select the real "LBP" option
 * from the real rendered list, and confirm the booked entry carries
 * `currency: "LBP"`.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Partners from "../index";

const mockGetAllBalances = jest.fn();
const mockGetLedger = jest.fn();
const mockRecordTransaction = jest.fn();

jest.mock("@liratek/ui", () => {
  // Keep the REAL Select/Modal/DecimalInput/etc. — only `useApi` needs a
  // stub (no ApiProvider is mounted in this test), and CounterpartySettleModal
  // is left real too since it's cheap to import and never actually opened here.
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      partners: {
        getAllBalances: mockGetAllBalances,
        getLedger: mockGetLedger,
        recordTransaction: mockRecordTransaction,
        settle: jest.fn(),
        writeOff: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deactivate: jest.fn(),
        activate: jest.fn(),
        getBalance: jest.fn(),
      },
    }),
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

const PARTNER = {
  id: 1,
  name: "Acme Partner",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  usd: 0,
  lbp: 0,
  usdt: 0,
};

describe("Partners page — Add Credit/Debt LBP currency (LIRA-097 / LIRA-120)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBalances.mockResolvedValue([PARTNER]);
    mockGetLedger.mockResolvedValue({
      entries: [],
      balance: { usd: 0, lbp: 0, usdt: 0 },
      breakdown: null,
    });
    mockRecordTransaction.mockResolvedValue({
      success: true,
      data: { id: 42 },
    });
  });

  it("opens the REAL currency dropdown, selects LBP from the REAL rendered list, and books the entry in LBP", async () => {
    render(<Partners />);

    fireEvent.click(await screen.findByText("Acme Partner"));

    // Exactly one "Add Credit / Debt" control exists before the modal opens
    // — the DetailPanel action button.
    const openButton = await screen.findByRole("button", {
      name: "Add Credit / Debt",
    });
    fireEvent.click(openButton);

    await screen.findByText(/Add Credit \/ Debt – Acme Partner/);

    // The REAL headlessui trigger — accessible name is the currently
    // selected option's label ("USD" by default). Not a mocked <select>.
    const currencyTrigger = screen.getByRole("button", { name: "USD" });
    fireEvent.click(currencyTrigger);

    // The REAL option list must actually render as a queryable listbox with
    // an "LBP" option — not just exist as a prop on a mocked component.
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();
    const lbpOption = screen.getByRole("option", { name: "LBP" });

    fireEvent.click(lbpOption);

    // The trigger's accessible name now reflects the real selection.
    await screen.findByRole("button", { name: "LBP" });

    const amountInput = screen.getByPlaceholderText("0.00");
    fireEvent.change(amountInput, { target: { value: "50000" } });

    // Now TWO "Add Credit / Debt" controls exist (action button + modal
    // submit button) — the submit button is the modal's, rendered last.
    const buttons = screen.getAllByRole("button", {
      name: "Add Credit / Debt",
    });
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => expect(mockRecordTransaction).toHaveBeenCalled());
    const payload = mockRecordTransaction.mock.calls[0][0];
    expect(payload.currency).toBe("LBP");
    expect(payload.amount).toBe(50000);
    expect(payload.partnerId).toBe(1);
    expect(payload.transactionType).toBe("ADJUSTMENT");
  });
});
