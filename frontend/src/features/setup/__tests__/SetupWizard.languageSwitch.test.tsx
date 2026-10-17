/** @jest-environment jsdom */
/**
 * LIRA-331 (FR-004): the desktop first-run wizard is shown before anyone has
 * signed in, so it carries its own English / العربية switch. With the Arabic
 * preview flag on, picking العربية turns the wizard heading Arabic in place.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { i18n } from "@/i18n/setup";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { ARABIC_PREVIEW_KEY } from "@/i18n/arabicGate";
import SetupWizard from "../SetupWizard";

// Rule 25: stable references — a fresh object per call would re-fire effects.
const mockAuth = { isAuthenticated: false };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

const mockApi = {
  getMyPreferences: jest.fn(),
  setMyLanguage: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

describe("SetupWizard language switch", () => {
  beforeEach(() => {
    localStorage.setItem(ARABIC_PREVIEW_KEY, "1");
    sessionStorage.clear();
    // No window.api: StepDetect stops scanning immediately.
  });

  afterEach(async () => {
    localStorage.removeItem(ARABIC_PREVIEW_KEY);
    localStorage.removeItem("liratek_language");
    sessionStorage.clear();
    await i18n.changeLanguage("en");
    // LanguageProvider sets these; do not leak RTL into later tests.
    document.documentElement.setAttribute("dir", "ltr");
    document.documentElement.setAttribute("lang", "en");
  });

  it("shows the English heading by default", () => {
    render(
      <LanguageProvider>
        <SetupWizard />
      </LanguageProvider>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "LiraTek Setup" }),
    ).toBeInTheDocument();
  });

  it("switches the wizard heading to Arabic from the header switch", async () => {
    render(
      <LanguageProvider>
        <SetupWizard />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByTestId("language-switch-ar"));
    expect(
      await screen.findByRole("heading", { level: 1, name: "إعداد LiraTek" }),
    ).toBeInTheDocument();
    // The step body follows the same switch, in place.
    expect(screen.getByText("أهلاً بك في LiraTek")).toBeInTheDocument();
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    // Before sign-in the choice stays on this device only.
    expect(mockApi.setMyLanguage).not.toHaveBeenCalled();
  });
});
