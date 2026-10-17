/** @jest-environment jsdom */
/**
 * LIRA-331 — service-provider payloads must not depend on the display
 * language. Drives the real ServiceProvidersManager through create, edit
 * (label + account grouping) and the active toggle once in English and once
 * in Arabic, and asserts the captured api calls are deep-equal.
 *
 * Selectors are anchored on stored data (codes), input ids and structure.
 *
 * Written before ServiceProvidersManager was converted: it passed against the
 * unconverted component (not failing-first — a guard against future drift,
 * e.g. the "Standalone" option's label leaking into `account_supplier_id`).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import ServiceProvidersManager from "../ServiceProvidersManager";

const mockGetProviders = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockGetSuppliers = jest.fn();
const mockLink = jest.fn();

// Module-level: one stable identity (rule 25).
const mockApi = {
  getServiceProviders: mockGetProviders,
  createServiceProvider: mockCreate,
  updateServiceProvider: mockUpdate,
  deleteServiceProvider: jest.fn(),
  getSuppliers: mockGetSuppliers,
  updateSupplierAccountLink: mockLink,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const OMT = {
  id: 1,
  code: "OMT",
  label: "OMT",
  drawer_name: "OMT_System",
  is_system_provider: 1,
  sort_order: 0,
  is_active: 1,
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
};
const IPICK = {
  id: 2,
  code: "IPICK",
  label: "iPick",
  drawer_name: "General",
  is_system_provider: 0,
  sort_order: 1,
  is_active: 1,
  is_system: 0,
  created_at: "2026-08-01T00:00:00Z",
};
const SUPPLIERS = [
  { id: 50, name: "OMT", provider: "OMT", is_active: 1, account_supplier_id: null },
  { id: 51, name: "iPick", provider: "IPICK", is_active: 1, account_supplier_id: null },
];

function formButtons(): HTMLElement[] {
  const form = document
    .getElementById("service-provider-code")!
    .closest(".space-y-3") as HTMLElement;
  const row = form.lastElementChild as HTMLElement;
  return Array.from(row.querySelectorAll("button"));
}

/** A provider row's cells, found by its code cell (the first cell). */
function cells(code: string): HTMLElement[] {
  const row = Array.from(document.querySelectorAll("tbody tr")).find(
    (tr) => tr.querySelector("td")?.textContent?.startsWith(code),
  )!;
  return Array.from(row.querySelectorAll("td")) as HTMLElement[];
}

async function runFlow(): Promise<unknown[][]> {
  jest.clearAllMocks();
  mockGetProviders.mockResolvedValue([OMT, IPICK]);
  mockGetSuppliers.mockResolvedValue(SUPPLIERS);
  mockCreate.mockResolvedValue({ success: true, id: 9 });
  mockUpdate.mockResolvedValue({ success: true });
  mockLink.mockResolvedValue({ success: true });

  const { unmount } = render(<ServiceProvidersManager />);
  await screen.findByText("IPICK");

  // 1. Create: the header's add button is the first button on the panel.
  fireEvent.click(screen.getAllByRole("button")[0]!);
  fireEvent.change(document.getElementById("service-provider-code")!, {
    target: { value: "syria" },
  });
  fireEvent.change(document.getElementById("service-provider-label")!, {
    target: { value: " Syria " },
  });
  fireEvent.click(formButtons()[0]!);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  await screen.findByText("IPICK");

  // 2. Edit iPick: new label and grouped under OMT's account.
  fireEvent.click(cells("IPICK")[5]!.querySelectorAll("button")[0]!);
  fireEvent.change(document.getElementById("service-provider-label")!, {
    target: { value: "iPick Cards" },
  });
  fireEvent.change(
    document.getElementById("service-provider-account-parent")!,
    { target: { value: "50" } },
  );
  fireEvent.click(formButtons()[0]!);
  await waitFor(() => expect(mockLink).toHaveBeenCalledTimes(1));
  await screen.findByText("IPICK");

  // 3. Toggle OMT active.
  fireEvent.click(cells("OMT")[4]!.querySelector("button")!);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));

  const calls = [
    ...mockCreate.mock.calls.map((c) => ["create", ...c]),
    ...mockUpdate.mock.calls.map((c) => ["update", ...c]),
    ...mockLink.mock.calls.map((c) => ["link", ...c]),
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

describe("ServiceProvidersManager — payloads are identical in English and Arabic", () => {
  it("create, edit with account grouping, and active toggle", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);
    expect(en).toEqual([
      ["create", { code: "SYRIA", label: "Syria" }],
      ["update", 2, { label: "iPick Cards" }],
      ["update", 1, { is_active: 0 }],
      ["link", { supplier_id: 51, account_supplier_id: 50 }],
    ]);
  });
});
