/** @jest-environment jsdom */
/**
 * LIRA-331 — module and drawer-limit payloads must not depend on the display
 * language. Drives the real ModulesManager through a module toggle, a
 * keyboard reorder and the drawer-limit save once in English and once in
 * Arabic, and asserts the captured api calls are deep-equal (module keys and
 * setting values, never a label).
 *
 * Selectors are anchored on stored data (module labels from the server, shown
 * as stored), input ids and structure.
 *
 * Written before ModulesManager was converted: it passed against the
 * unconverted component (not failing-first — a guard against future drift).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import ModulesManager from "../ModulesManager";

const mockSetModuleEnabled = jest.fn();
const mockReorder = jest.fn();
const mockUpdateSetting = jest.fn();

// Module-level: one stable identity (rule 25).
const mockApi = {
  getToggleableModules: jest.fn(),
  getConfiguredDrawerNames: jest.fn(),
  getCurrenciesByModule: jest.fn(),
  getFullCurrenciesByDrawer: jest.fn(),
  setModuleEnabled: mockSetModuleEnabled,
  reorderModules: mockReorder,
  getAllSettings: jest.fn(),
  updateSetting: mockUpdateSetting,
  // The two embedded managers only need to load.
  getPaymentMethods: jest.fn(),
  getServiceProviders: jest.fn(),
  getSuppliers: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const MODULES = [
  { key: "pos", label: "Point of Sale", icon: "x", route: "/pos", sort_order: 1, is_enabled: 1, admin_only: 0, is_system: 0 },
  { key: "debts", label: "Debts", icon: "x", route: "/debts", sort_order: 2, is_enabled: 1, admin_only: 0, is_system: 0 },
  { key: "loto", label: "Loto", icon: "x", route: "/loto", sort_order: 3, is_enabled: 0, admin_only: 0, is_system: 0 },
];

function row(label: string): HTMLElement {
  return screen.getByText(label).closest("tr") as HTMLElement;
}

async function runFlow(): Promise<unknown[][]> {
  jest.clearAllMocks();
  mockApi.getToggleableModules.mockResolvedValue(MODULES);
  mockApi.getConfiguredDrawerNames.mockResolvedValue(["General"]);
  mockApi.getCurrenciesByModule.mockResolvedValue([{ code: "USD" }]);
  mockApi.getFullCurrenciesByDrawer.mockResolvedValue([]);
  mockApi.getAllSettings.mockResolvedValue([
    { key_name: "drawer_limit_general", value: "1000" },
    { key_name: "drawer_limit_omt", value: "500" },
  ]);
  mockApi.getPaymentMethods.mockResolvedValue([]);
  mockApi.getServiceProviders.mockResolvedValue([]);
  mockApi.getSuppliers.mockResolvedValue([]);
  mockSetModuleEnabled.mockResolvedValue({ success: true });
  mockReorder.mockResolvedValue({ success: true });
  mockUpdateSetting.mockResolvedValue({ success: true });

  const { unmount } = render(<ModulesManager />);
  await screen.findByText("Loto");

  // 1. Enable Loto: its status button is the row's only button.
  fireEvent.click(row("Loto").querySelector("button")!);
  await waitFor(() => expect(mockSetModuleEnabled).toHaveBeenCalledTimes(1));

  // 2. Select Debts and move it up with the keyboard.
  fireEvent.click(row("Debts"));
  fireEvent.keyDown(window, { key: "ArrowUp" });
  await waitFor(() => expect(mockReorder).toHaveBeenCalledTimes(1));

  // 3. Drawer limits: new values, then the section's last button (save).
  await waitFor(() =>
    expect(document.getElementById("drawerLimitGeneral")).not.toBeNull(),
  );
  const general = document.getElementById("drawerLimitGeneral")!;
  fireEvent.change(general, { target: { value: "2500" } });
  fireEvent.change(document.getElementById("drawerLimitOMT")!, {
    target: { value: "750" },
  });
  const section = general.closest(".space-y-4") as HTMLElement;
  const buttons = section.querySelectorAll("button");
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledTimes(2));

  const calls = [
    ...mockSetModuleEnabled.mock.calls.map((c) => ["enable", ...c]),
    ...mockReorder.mock.calls.map((c) => ["reorder", ...c]),
    ...mockUpdateSetting.mock.calls.map((c) => ["setting", ...c]),
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

describe("ModulesManager — payloads are identical in English and Arabic", () => {
  it("module toggle, reorder and drawer limits", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);
    expect(en).toEqual([
      ["enable", "loto", true],
      ["reorder", ["debts", "pos", "loto"]],
      ["setting", "drawer_limit_general", "2500"],
      ["setting", "drawer_limit_omt", "750"],
    ]);
  });
});
