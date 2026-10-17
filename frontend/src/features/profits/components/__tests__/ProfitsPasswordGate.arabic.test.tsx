/** @jest-environment jsdom */

/**
 * LIRA-331 (T067) — the profits password gate renders in Arabic when the
 * language is `ar`; the English text is unchanged. The password typed is
 * passed to `unlockProfits` as typed — never through `t()`.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { i18n } from "@/i18n/setup";
import { ProfitsPasswordGate } from "../ProfitsPasswordGate";

const mockGetStatus = jest.fn();
const mockUnlock = jest.fn();
const mockLock = jest.fn();

// rule 25 — one stable object for the whole file.
const mockApi = {
  getProfitsPasswordStatus: mockGetStatus,
  unlockProfits: mockUnlock,
  lockProfits: mockLock,
};

jest.mock("@liratek/ui", () => ({
  useApi: () => mockApi,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLock.mockResolvedValue({ success: true });
});

afterEach(() => i18n.changeLanguage("en"));

describe("ProfitsPasswordGate — Arabic UI (LIRA-331)", () => {
  it("keeps the English lock screen unchanged", async () => {
    mockGetStatus.mockResolvedValue({ isSet: true });
    render(
      <ProfitsPasswordGate>
        <div>secret</div>
      </ProfitsPasswordGate>,
    );
    expect(await screen.findByText("Profits are locked")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Profits password")).toBeInTheDocument();
  });

  it("renders the lock screen in Arabic and sends the password as typed", async () => {
    const { loadLanguage } = await import("@/i18n/setup");
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    mockGetStatus.mockResolvedValue({ isSet: true });
    mockUnlock.mockResolvedValue({ success: false, error: "Wrong" });
    render(
      <ProfitsPasswordGate>
        <div>secret</div>
      </ProfitsPasswordGate>,
    );
    expect(await screen.findByText("الأرباح مقفلة")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("كلمة سر الأرباح"), {
      target: { value: "pw-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "فتح القفل" }));
    await waitFor(() => expect(mockUnlock).toHaveBeenCalledWith("pw-123"));
  });

  it("renders the not-set screen in Arabic", async () => {
    const { loadLanguage } = await import("@/i18n/setup");
    await loadLanguage("ar");
    await i18n.changeLanguage("ar");
    mockGetStatus.mockResolvedValue({ isSet: false });
    render(
      <ProfitsPasswordGate>
        <div>secret</div>
      </ProfitsPasswordGate>,
    );
    expect(
      await screen.findByText("لم تُحدَّد كلمة سر الأرباح"),
    ).toBeInTheDocument();
  });
});
