/**
 * LIRA-333 T005 (FR-015) — WhatsAppService uses the ONE shared phone rule
 * (`toWhatsAppNumber`), so it no longer mangles `00961…` or foreign numbers,
 * and refuses an invalid number without calling the API.
 */
const mockGetSettingValue = jest.fn();
jest.mock("../../repositories/index.js", () => ({
  getSettingsRepository: () => ({ getSettingValue: mockGetSettingValue }),
}));

import { WhatsAppService } from "../WhatsAppService.js";

describe("WhatsAppService phone rule (FR-015)", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.1" }] }),
    });
    (global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
    mockGetSettingValue.mockImplementation((key: string) =>
      key === "whatsapp_api_key" ? "token" : "phone-id",
    );
  });

  function sentTo(): string {
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as {
      to: string;
    };
    return body.to;
  }

  it("sends 0096176901610 as 96176901610", async () => {
    await new WhatsAppService().sendMessage("0096176901610", "hi");
    expect(sentTo()).toBe("96176901610");
  });

  it("keeps a foreign number's country code", async () => {
    await new WhatsAppService().sendTemplate("+33 6 12 34 56 78", "hello");
    expect(sentTo()).toBe("33612345678");
  });

  it("refuses an invalid number without calling the API", async () => {
    const result = await new WhatsAppService().sendMessage("abc", "hi");
    expect(result).toEqual({ success: false, error: "Invalid phone number" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
