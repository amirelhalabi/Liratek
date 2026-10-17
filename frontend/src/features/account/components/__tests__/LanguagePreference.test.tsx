/**
 * LIRA-331 T030 — My account → Language, for every role. The choice is saved
 * for the signed-in user through setMyLanguage, with the field name taken
 * from setMyLanguageSchema (rule 24). العربية is not offered while Arabic is
 * hidden (OD-4) unless this device has the owner preview flag.
 *
 * `useApi` returns ONE module-level object (rule 25).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setMyLanguageSchema, type MyPreferences } from "@liratek/core";

const mockGetMyPreferences = jest.fn<Promise<MyPreferences>, []>();
const mockSetMyLanguage = jest.fn();
const mockApi = {
  getMyPreferences: mockGetMyPreferences,
  setMyLanguage: mockSetMyLanguage,
};
jest.mock("@liratek/ui", () => ({ useApi: () => mockApi }));
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: true, user: { id: 7, role: "staff" } }),
}));

import { LanguageProvider } from "@/contexts/LanguageContext";
import LanguagePreference from "../LanguagePreference";
import { i18n } from "@/i18n/setup";

const PREFS: MyPreferences = {
  language: null,
  effectiveLanguage: "en",
  shopDefaultLanguage: "en",
  receiptLanguage: "en",
};

function renderIt() {
  return render(
    <LanguageProvider>
      <LanguagePreference />
    </LanguageProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  mockGetMyPreferences.mockReset().mockResolvedValue(PREFS);
  mockSetMyLanguage.mockReset().mockResolvedValue({ success: true, data: PREFS });
  await i18n.changeLanguage("en");
});

it("hides العربية while Arabic is not ready (OD-4)", async () => {
  renderIt();
  await waitFor(() => expect(mockGetMyPreferences).toHaveBeenCalled());
  expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
  expect(screen.queryByRole("radio", { name: "العربية" })).toBeNull();
});

it("with the preview flag, choosing العربية saves it for the user", async () => {
  localStorage.setItem("liratek_arabic_preview", "1");
  renderIt();
  await waitFor(() => expect(mockGetMyPreferences).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("radio", { name: "العربية" }));
  const expected = setMyLanguageSchema.parse({ language: "ar" });
  await waitFor(() => expect(mockSetMyLanguage).toHaveBeenCalledWith(expected));
  await waitFor(() => expect(document.documentElement.getAttribute("dir")).toBe("rtl"));
});
