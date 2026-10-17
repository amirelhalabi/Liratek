/** @jest-environment jsdom */
/**
 * LIRA-331 — carrier-line payloads must not depend on the display language.
 * Drives the real CarrierLinesManager through create (every field) and edit
 * once in English and once in Arabic, and asserts the captured api calls are
 * deep-equal — including Arabic-Indic digits typed into Credits, which must
 * reach the payload as the same number.
 *
 * Selectors are anchored on stored data (phone numbers) and structure.
 *
 * Written before CarrierLinesManager was converted. The first case passed
 * against the unconverted component (not failing-first — a guard against
 * future drift, e.g. a translated carrier option leaking into `carrier`).
 * The Arabic-digit case FAILED first: the old `type="number"` field dropped
 * "٢٥.٧٥" and booked credits 0 instead of 25.75.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import CarrierLinesManager from "../CarrierLinesManager";

const mockGetLines = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockSetPrimary = jest.fn();

// Module-level: one stable identity (rule 25).
const mockApi = {
  getAdminCarrierLines: mockGetLines,
  createCarrierLine: mockCreate,
  updateCarrierLine: mockUpdate,
  archiveCarrierLine: jest.fn(),
  toggleCarrierLineActive: jest.fn(),
  setPrimaryCarrierLine: mockSetPrimary,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const LINE = {
  id: 7,
  carrier: "mtc",
  phone_number: "03111222",
  label: "Shop 1",
  credits: 12.5,
  validity_expires_at: "2026-12-01",
  notes: null,
  is_primary: 0,
  is_active: 1,
};

/** The form: [carrier select, phone, label, credits, date, notes]. */
function formFields(): HTMLElement[] {
  const form = document.querySelector(".grid.grid-cols-2") as HTMLElement;
  return Array.from(form.querySelectorAll("select, input"));
}

function formButtons(): HTMLElement[] {
  const grid = document.querySelector(".grid.grid-cols-2") as HTMLElement;
  return Array.from(grid.nextElementSibling!.querySelectorAll("button"));
}

async function runFlow(credits: string): Promise<unknown[][]> {
  jest.clearAllMocks();
  mockGetLines.mockResolvedValue([LINE]);
  mockCreate.mockResolvedValue({ success: true });
  mockUpdate.mockResolvedValue({ success: true });
  mockSetPrimary.mockResolvedValue({ success: true });

  const { unmount } = render(<CarrierLinesManager />);
  await screen.findByText("03111222");

  // 1. Create: the header's add button is the first button on the panel.
  fireEvent.click(screen.getAllByRole("button")[0]!);
  const [carrier, phone, label, creditsInput, date, notes] = formFields();
  fireEvent.change(carrier!, { target: { value: "alfa" } });
  fireEvent.change(phone!, { target: { value: " 71000111 " } });
  fireEvent.change(label!, { target: { value: "Counter" } });
  fireEvent.change(creditsInput!, { target: { value: credits } });
  fireEvent.change(date!, { target: { value: "2027-01-15" } });
  fireEvent.change(notes!, { target: { value: "spare SIM" } });
  fireEvent.click(formButtons()[0]!);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  await screen.findByText("03111222");

  // 2. Edit the existing line's label: actions cell → [edit, primary, archive].
  const row = screen.getByText("03111222").closest("tr")!;
  const actions = row.querySelectorAll("td")[7]!;
  fireEvent.click(actions.querySelectorAll("button")[0]!);
  fireEvent.change(formFields()[2]!, { target: { value: "Shop 1 (main)" } });
  fireEvent.click(formButtons()[0]!);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  await screen.findByText("03111222");

  // 3. Make it primary.
  const row2 = screen.getByText("03111222").closest("tr")!;
  fireEvent.click(row2.querySelectorAll("td")[7]!.querySelectorAll("button")[1]!);
  await waitFor(() => expect(mockSetPrimary).toHaveBeenCalledTimes(1));

  const calls = [
    ...mockCreate.mock.calls.map((c) => ["create", ...c]),
    ...mockUpdate.mock.calls.map((c) => ["update", ...c]),
    ...mockSetPrimary.mock.calls.map((c) => ["primary", ...c]),
  ];
  unmount();
  return calls;
}

async function inLanguage(lang: "en" | "ar", credits: string) {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow(credits);
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("CarrierLinesManager — payloads are identical in English and Arabic", () => {
  it("create, edit and make primary", async () => {
    const en = await inLanguage("en", "25.75");
    const ar = await inLanguage("ar", "25.75");
    expect(ar).toEqual(en);
    expect(en).toEqual([
      [
        "create",
        {
          carrier: "alfa",
          phone_number: "71000111",
          label: "Counter",
          credits: 25.75,
          validity_expires_at: "2027-01-15",
          notes: "spare SIM",
        },
      ],
      [
        "update",
        7,
        {
          carrier: "mtc",
          phone_number: "03111222",
          label: "Shop 1 (main)",
          credits: 12.5,
          validity_expires_at: "2026-12-01",
          notes: null,
        },
      ],
      ["primary", 7],
    ]);
  });

  it("Arabic-Indic digits typed into Credits reach the payload as the same number", async () => {
    const en = await inLanguage("en", "25.75");
    const ar = await inLanguage("ar", "٢٥.٧٥");
    expect(ar).toEqual(en);
  });
});
