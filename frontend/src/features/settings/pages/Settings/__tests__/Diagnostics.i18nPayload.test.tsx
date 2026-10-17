/** @jest-environment jsdom */
/**
 * LIRA-331 — the auto-backup settings payload must not depend on the display
 * language. Drives the real Diagnostics backup-settings form once in English
 * and once in Arabic and asserts the captured `updateSetting` calls are
 * deep-equal — including Arabic-Indic digits typed into the interval and
 * keep-count fields, which must save as the same numbers.
 *
 * Selectors are structure only (the settings box's checkboxes, inputs and
 * button), so the same steps work in both languages.
 *
 * Written before Diagnostics was converted. The English/Arabic case passed
 * against the unconverted component (not failing-first — a drift guard).
 * The Arabic-digit case FAILED first: the old number fields read "١٢" as
 * empty (0), so the save was refused and nothing was written.
 */
import { render, fireEvent, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import Diagnostics from "../Diagnostics";

const mockUpdateSetting = jest.fn();
// Module-level: one stable identity (rule 25).
const mockApi = { updateSetting: mockUpdateSetting };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

async function runFlow(interval: string, keep: string) {
  jest.clearAllMocks();
  mockUpdateSetting.mockResolvedValue({ success: true });
  const { unmount, container } = render(<Diagnostics />);

  // The auto-backup box is the one holding both checkboxes.
  const box = container
    .querySelector('input[type="checkbox"]')!
    .closest(".space-y-3") as HTMLElement;
  const [enable, verify] = Array.from(
    box.querySelectorAll('input[type="checkbox"]'),
  );
  fireEvent.click(enable!); // on → off
  fireEvent.click(verify!); // off → on
  const [intervalInput, keepInput] = Array.from(
    box.querySelectorAll('input:not([type="checkbox"])'),
  );
  fireEvent.change(intervalInput!, { target: { value: interval } });
  fireEvent.change(keepInput!, { target: { value: keep } });
  fireEvent.click(box.querySelector("button")!);
  await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalledTimes(4));

  const calls = mockUpdateSetting.mock.calls.map((c) => [...c]);
  unmount();
  return calls;
}

async function inLanguage(lang: "en" | "ar", interval: string, keep: string) {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow(interval, keep);
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Diagnostics — auto-backup settings save the same in English and Arabic", () => {
  it("toggles, interval and keep count", async () => {
    const en = await inLanguage("en", "12", "14");
    const ar = await inLanguage("ar", "12", "14");
    expect(ar).toEqual(en);
    expect(en).toEqual([
      ["auto_backup_enabled", "0"],
      ["auto_backup_interval_hours", "12"],
      ["auto_backup_keep_count", "14"],
      ["auto_backup_verify_enabled", "1"],
    ]);
  });

  it("Arabic-Indic digits save as the same numbers", async () => {
    const en = await inLanguage("en", "12", "14");
    const ar = await inLanguage("ar", "١٢", "١٤");
    expect(ar).toEqual(en);
  });
});
