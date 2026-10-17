/** @jest-environment jsdom */
/**
 * LIRA-331 — the notification settings payload must not depend on the
 * display language, and a poll interval typed in Arabic-Indic digits must
 * save as the same number.
 *
 * NOT RUN when written (owner paused test runs until every LIRA-331 agent
 * finishes). The digit case would have failed before this change: the field
 * passed "٣٠٠٠٠" straight to Number(), which is NaN, so the save was refused.
 * Not proven failing-first.
 */
import { render, fireEvent, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import NotificationsConfig from "../NotificationsConfig";

const mockApi = {
  getAllSettings: jest.fn(),
  updateSetting: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

async function runFlow(interval: string) {
  jest.clearAllMocks();
  mockApi.getAllSettings.mockResolvedValue([
    { key_name: "notifications_poll_interval_ms", value: "60000" },
    { key_name: "notifications_warn_low_stock", value: "1" },
  ]);
  mockApi.updateSetting.mockResolvedValue({ success: true });
  const { unmount, container } = render(<NotificationsConfig />);
  const field = document.getElementById(
    "notifications-poll-interval",
  ) as HTMLInputElement;
  await waitFor(() => expect(field.value).toBe("60000"));
  fireEvent.change(field, { target: { value: interval } });
  fireEvent.click(container.querySelector('input[type="checkbox"]')!);
  const buttons = container.querySelectorAll(".justify-end button");
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(mockApi.updateSetting).toHaveBeenCalledTimes(2));
  const calls = mockApi.updateSetting.mock.calls.map((c) => [...c]);
  unmount();
  return calls;
}

async function inLanguage(lang: "en" | "ar", interval: string) {
  await loadLanguage(lang);
  await i18n.changeLanguage(lang);
  return runFlow(interval);
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("NotificationsConfig — saves the same in English and Arabic", () => {
  it("interval and low-stock toggle", async () => {
    const en = await inLanguage("en", "30000");
    const ar = await inLanguage("ar", "30000");
    expect(ar).toEqual(en);
    expect(en).toEqual([
      ["notifications_poll_interval_ms", "30000"],
      ["notifications_warn_low_stock", "0"],
    ]);
  });

  it("an interval typed in Arabic-Indic digits saves as the same number", async () => {
    const en = await inLanguage("en", "30000");
    const ar = await inLanguage("ar", "٣٠٠٠٠");
    expect(ar).toEqual(en);
  });
});
