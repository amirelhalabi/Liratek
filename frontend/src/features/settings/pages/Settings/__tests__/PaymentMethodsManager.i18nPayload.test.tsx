/** @jest-environment jsdom */
/**
 * LIRA-331 — payment-method payloads must not depend on the display language.
 * Drives the real PaymentMethodsManager through create, edit and the active
 * toggle once in English and once in Arabic, and asserts the captured api
 * calls are deep-equal.
 *
 * Selectors are anchored on stored data (codes, shown as stored in both
 * languages), input ids and structure, so the same steps work in both.
 *
 * Written before PaymentMethodsManager was converted: it passed against the
 * unconverted component (not failing-first — a guard against future drift,
 * e.g. a translated seeded label leaking into `label`).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import PaymentMethodsManager from "../PaymentMethodsManager";

const mockGetPaymentMethods = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

// Module-level: one stable identity (rule 25).
const mockApi = {
  getPaymentMethods: mockGetPaymentMethods,
  getConfiguredDrawerNames: jest.fn(),
  createPaymentMethod: mockCreate,
  updatePaymentMethod: mockUpdate,
  deletePaymentMethod: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const CASH = {
  id: 1,
  code: "CASH",
  label: "Cash",
  drawer_name: "General",
  affects_drawer: 1,
  sort_order: 0,
  is_system: 1,
  is_active: 1,
};
const OMT = {
  id: 2,
  code: "OMT",
  label: "OMT Wallet",
  drawer_name: "OMT_App",
  affects_drawer: 1,
  sort_order: 1,
  is_system: 0,
  is_active: 1,
};

/** The form's buttons: [save, cancel]. */
function formButtons(): HTMLElement[] {
  const form = document
    .getElementById("payment-method-code")!
    .closest(".space-y-3") as HTMLElement;
  const row = form.lastElementChild as HTMLElement;
  return Array.from(row.querySelectorAll("button"));
}

/** A method row's cells: [code, label, drawer, affects, active, actions]. */
function cells(code: string): HTMLElement[] {
  const row = screen.getByText(code).closest("tr")!;
  return Array.from(row.querySelectorAll("td")) as HTMLElement[];
}

async function runFlow(): Promise<unknown[][]> {
  jest.clearAllMocks();
  mockGetPaymentMethods.mockResolvedValue([CASH, OMT]);
  mockApi.getConfiguredDrawerNames.mockResolvedValue(["General", "OMT_App"]);
  mockCreate.mockResolvedValue({ success: true });
  mockUpdate.mockResolvedValue({ success: true });

  const { unmount } = render(<PaymentMethodsManager />);
  await screen.findByText("OMT");

  // 1. Create: the header's add button is the first button on the panel.
  fireEvent.click(screen.getAllByRole("button")[0]!);
  fireEvent.change(document.getElementById("payment-method-code")!, {
    target: { value: "pay pal" },
  });
  fireEvent.change(document.getElementById("payment-method-label")!, {
    target: { value: " PayPal " },
  });
  fireEvent.click(formButtons()[0]!);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  await screen.findByText("OMT");

  // 2. Edit OMT's label: actions cell → [edit, delete].
  fireEvent.click(cells("OMT")[5]!.querySelectorAll("button")[0]!);
  fireEvent.change(document.getElementById("payment-method-label")!, {
    target: { value: "OMT App" },
  });
  fireEvent.click(formButtons()[0]!);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  await screen.findByText("OMT");

  // 3. Toggle CASH active.
  fireEvent.click(cells("CASH")[4]!.querySelector("button")!);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));

  const calls = [
    ...mockCreate.mock.calls.map((c) => ["create", ...c]),
    ...mockUpdate.mock.calls.map((c) => ["update", ...c]),
  ];
  unmount();
  return calls;
}

async function inLanguage(lang: "en" | "ar") {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow();
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("PaymentMethodsManager — payloads are identical in English and Arabic", () => {
  it("create, edit and active toggle", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);
    // Sanity: the operator's own text and stored codes, never a label.
    expect(en).toEqual([
      [
        "create",
        {
          code: "PAY_PAL",
          label: "PayPal",
          drawer_name: "General",
          affects_drawer: 1,
        },
      ],
      [
        "update",
        2,
        { label: "OMT App", drawer_name: "OMT_App", affects_drawer: 1 },
      ],
      ["update", 1, { is_active: 0 }],
    ]);
  });
});
