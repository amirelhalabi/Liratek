/** @jest-environment jsdom */
/**
 * LIRA-331 (T048) — the closing screens send the SAME payloads whatever
 * language the screen is shown in. Translating labels must never leak into
 * what is stored: drawer names, currency codes, notes, the initial-setup
 * note and the (English) closing report are data, not UI text.
 *
 * Every payload each screen hands the api is captured once in English and
 * once in Arabic (with Arabic proven loaded), then deep-compared:
 *   1. single-drawer checkpoint, General (cash count + note + the report
 *      PDF and its report_path update),
 *   2. single-drawer checkpoint, MTC (add a line, then per-line credits and
 *      validity),
 *   3. the "all drawers" checkpoint window (one drawer's own Save),
 *   4. Initial Drawer Amounts (add a currency to General, then save).
 *
 * Not failing-first (guard against future drift): it passed before the
 * module was converted.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { i18n } from "@/i18n/setup";
import CheckpointModal from "../pages/Checkpoint";
import AllDrawersCheckpointModal from "../pages/Checkpoint/AllDrawersCheckpointModal";
import { InitialDrawerAmountsModal } from "../components/InitialDrawerAmountsModal";

let mockLanguage: "en" | "ar" = "en";

const MTC_LINE = {
  id: 7,
  carrier: "mtc",
  phone_number: "03123456",
  label: null,
  credits: 25,
  validity_expires_at: "2026-11-01",
  is_primary: 1,
};

// Rule 25: ONE stable adapter object for every hook that calls useApi().
const mockApi = {
  getCurrencies: jest.fn(),
  getCountableDrawerCurrencies: jest.fn(),
  getSystemExpectedBalancesDynamic: jest.fn(),
  getActiveCarrierLines: jest.fn(),
  createCarrierLine: jest.fn(),
  partners: { getAll: jest.fn() },
  createCheckpoint: jest.fn(),
  setDrawerCurrencies: jest.fn(),
  getDailyStatsSnapshot: jest.fn(),
  generatePDF: jest.fn(),
  updateDailyClosing: jest.fn(),
  getRates: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/contexts/LanguageContext", () => ({
  ...jest.requireActual("@/contexts/LanguageContext"),
  useLanguage: () => ({
    language: mockLanguage,
    dir: mockLanguage === "ar" ? "rtl" : "ltr",
    arabicAvailable: true,
    setLanguage: async () => {},
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1 } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: jest.fn(),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({ isModuleEnabled: () => true }),
}));

jest.mock("@/contexts/CurrencyContext", () => ({
  useCurrencyContext: () => ({
    activeCurrencies: [
      { code: "USD", name: "US Dollar", is_active: 1 },
      { code: "LBP", name: "Lebanese Pound", is_active: 1 },
      { code: "EUR", name: "Euro", is_active: 1 },
    ],
    getDecimals: (code: string) => (code === "LBP" ? 0 : 2),
  }),
}));

function resetApi() {
  jest.clearAllMocks();
  mockApi.getCurrencies.mockResolvedValue([
    { id: 1, code: "USD", name: "US Dollar", symbol: "$", is_active: 1 },
    { id: 2, code: "LBP", name: "Lebanese Pound", symbol: "LBP", is_active: 1 },
  ]);
  mockApi.getCountableDrawerCurrencies.mockResolvedValue({
    General: ["USD", "LBP"],
    OMT_System: ["USD", "LBP"],
    OMT_App: ["USD"],
    MTC: ["USD"],
  });
  mockApi.getSystemExpectedBalancesDynamic.mockResolvedValue({
    General: { USD: 100, LBP: 500_000 },
    OMT_System: { USD: 40, LBP: 0 },
    OMT_App: { USD: 12 },
    MTC: { USD: 25 },
  });
  mockApi.getActiveCarrierLines.mockResolvedValue([]);
  mockApi.createCarrierLine.mockResolvedValue({ success: true });
  mockApi.partners.getAll.mockResolvedValue([]);
  mockApi.createCheckpoint.mockResolvedValue({ success: true, id: 9 });
  mockApi.setDrawerCurrencies.mockResolvedValue({ success: true });
  mockApi.getDailyStatsSnapshot.mockResolvedValue({
    salesCount: 3,
    totalSalesUSD: 120,
    totalSalesLBP: 900_000,
    debtPaymentsUSD: 10,
    debtPaymentsLBP: 0,
    totalExpensesUSD: 5,
    totalExpensesLBP: 0,
    totalProfitUSD: 40,
    totalProfitLBP: 90_000,
  });
  mockApi.generatePDF.mockResolvedValue({ success: true, path: "/r.pdf" });
  mockApi.updateDailyClosing.mockResolvedValue({ success: true });
  mockApi.getRates.mockResolvedValue([
    { to_code: "LBP", market_rate: 89500, buy_rate: 89000, sell_rate: 90000 },
  ]);
}

/** Every call the screen made to a write/report api, in order. */
function captured() {
  return {
    createCheckpoint: mockApi.createCheckpoint.mock.calls,
    createCarrierLine: mockApi.createCarrierLine.mock.calls,
    setDrawerCurrencies: mockApi.setDrawerCurrencies.mock.calls,
    getDailyStatsSnapshot: mockApi.getDailyStatsSnapshot.mock.calls,
    // The PDF file name ends in Date.now(); the rest must match exactly.
    generatePDF: mockApi.generatePDF.mock.calls.map(([html, name]) => [
      html,
      String(name).replace(/_\d+\.pdf$/, "_<now>.pdf"),
    ]),
    updateDailyClosing: mockApi.updateDailyClosing.mock.calls,
  };
}

async function generalCheckpoint() {
  render(<CheckpointModal isOpen drawerName="General" onClose={jest.fn()} />);
  const usd = await screen.findByLabelText("USD");
  await waitFor(() => expect((usd as HTMLInputElement).value).toBe("100"));
  fireEvent.change(usd, { target: { value: "95" } });
  fireEvent.change(document.getElementById("checkpoint-notes")!, {
    target: { value: "Short 5 after lunch" },
  });
  const save = screen.getByTestId("checkpoint-save");
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(mockApi.updateDailyClosing).toHaveBeenCalled());
}

async function mtcCheckpoint() {
  mockApi.getActiveCarrierLines
    .mockResolvedValueOnce([])
    .mockResolvedValue([MTC_LINE]);
  render(<CheckpointModal isOpen drawerName="MTC" onClose={jest.fn()} />);
  await screen.findByTestId("checkpoint-add-line-MTC");
  fireEvent.change(screen.getByTestId("checkpoint-add-line-phone-MTC"), {
    target: { value: "03123456" },
  });
  fireEvent.change(screen.getByTestId("checkpoint-add-line-credits-MTC"), {
    target: { value: "25" },
  });
  fireEvent.click(screen.getByTestId("checkpoint-add-line-submit-MTC"));
  await waitFor(() =>
    expect(document.getElementById("MTC-credits-7")).not.toBeNull(),
  );
  fireEvent.change(document.getElementById("MTC-credits-7")!, {
    target: { value: "20" },
  });
  fireEvent.change(document.getElementById("MTC-validity-7")!, {
    target: { value: "2026-11-15" },
  });
  const save = screen.getByTestId("checkpoint-save");
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(mockApi.createCheckpoint).toHaveBeenCalled());
  await waitFor(() => expect(mockApi.updateDailyClosing).toHaveBeenCalled());
}

async function allDrawersCheckpoint() {
  render(
    <AllDrawersCheckpointModal
      isOpen
      drawers={[
        { name: "General", countedToday: false },
        { name: "OMT_System", countedToday: false },
      ]}
      onClose={jest.fn()}
    />,
  );
  const omt = screen.getByTestId("checkpoint-drawer-OMT_System");
  const usd = await within(omt).findByLabelText("USD");
  await waitFor(() => expect((usd as HTMLInputElement).value).toBe("40"));
  fireEvent.change(usd, { target: { value: "35" } });
  const save = within(omt).getByTestId("checkpoint-save-OMT_System");
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(mockApi.updateDailyClosing).toHaveBeenCalled());
}

async function initialAmounts() {
  const onSaved = jest.fn();
  render(<InitialDrawerAmountsModal onClose={jest.fn()} onSaved={onSaved} />);
  const picker = await screen.findByTestId(
    "initial-drawer-add-currency-General",
  );
  fireEvent.change(picker, { target: { value: "EUR" } });
  const save = screen.getByTestId("initial-drawer-save");
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
}

async function capture(lang: "en" | "ar", scenario: () => Promise<void>) {
  resetApi();
  mockLanguage = lang;
  if (lang === "ar") {
    const { loadLanguage } = await import("@/i18n/setup");
    await loadLanguage("ar");
  }
  await i18n.changeLanguage(lang);
  expect(i18n.t("closing:timeline.title")).toBe(
    lang === "ar" ? "عمليات العدّ" : "Checkpoints",
  );
  // A key only this module's catalog holds — proves the worktree's own
  // Arabic file is the one loaded.
  expect(i18n.t("closing:save.balanced")).toBe(
    lang === "ar" ? "حفظ العدّ — مطابق" : "Save Checkpoint — Balanced",
  );
  await scenario();
  const calls = captured();
  cleanup();
  return calls;
}

beforeAll(() => {
  // Only the clock is fixed (the report's date lines and the PDF name), so
  // waitFor's real timers keep working.
  jest.useFakeTimers({
    now: new Date("2026-10-17T10:30:00"),
    doNotFake: [
      "nextTick",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "hrtime",
      "performance",
    ],
  });
});

afterAll(() => {
  jest.useRealTimers();
});

afterEach(async () => {
  mockLanguage = "en";
  await i18n.changeLanguage("en");
});

describe("closing payloads do not depend on the screen language", () => {
  it.each([
    ["single-drawer checkpoint (General)", generalCheckpoint],
    ["single-drawer checkpoint (MTC lines)", mtcCheckpoint],
    ["all-drawers checkpoint window", allDrawersCheckpoint],
    ["initial drawer amounts", initialAmounts],
  ])("%s", async (_name, scenario) => {
    const en = await capture("en", scenario);
    expect(en.createCheckpoint).toHaveLength(1);
    const ar = await capture("ar", scenario);
    expect(ar).toEqual(en);
  });
});
