/** @jest-environment jsdom */
/**
 * LIRA-331 — the WhatsApp integration settings must save the same in English
 * and Arabic (operator-typed text only; no label may leak into a value).
 *
 * NOT RUN when written (owner paused test runs until every LIRA-331 agent
 * finishes). Not failing-first: a drift guard written after conversion.
 */
import { render, fireEvent, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import IntegrationsConfig from "../IntegrationsConfig";

const mockApi = {
  getAllSettings: jest.fn(),
  updateSetting: jest.fn(),
  sendWhatsAppTestMessage: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

async function runFlow() {
  jest.clearAllMocks();
  mockApi.getAllSettings.mockResolvedValue([]);
  mockApi.updateSetting.mockResolvedValue({ success: true });
  jest.spyOn(window, "alert").mockImplementation(() => undefined);
  const { unmount, container } = render(<IntegrationsConfig />);
  await waitFor(() =>
    expect(document.getElementById("whatsAppPhoneNumberId")).not.toBeNull(),
  );
  // The access token is the panel's first text-like input (PasswordInput).
  const token = container.querySelector(
    'input[type="password"], input[type="text"]',
  ) as HTMLInputElement;
  fireEvent.change(token, { target: { value: "EAAG-token" } });
  fireEvent.change(document.getElementById("whatsAppPhoneNumberId")!, {
    target: { value: "1234567890" },
  });
  // Save is the panel's last button.
  const buttons = container.querySelectorAll("button");
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(mockApi.updateSetting).toHaveBeenCalledTimes(2));
  const calls = mockApi.updateSetting.mock.calls.map((c) => [...c]);
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
  jest.restoreAllMocks();
});

describe("IntegrationsConfig — saves the same in English and Arabic", () => {
  it("access token and phone number id", async () => {
    const en = await inLanguage("en");
    const ar = await inLanguage("ar");
    expect(ar).toEqual(en);
    expect(en).toEqual([
      ["whatsapp_api_key", "EAAG-token"],
      ["whatsapp_phone_number_id", "1234567890"],
    ]);
  });
});
