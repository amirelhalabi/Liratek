/**
 * LIRA-331 T017 — LanguageContext: the device language before sign-in, the
 * user's own language after it, <html dir/lang>, no remount on a switch, and
 * the OD-4 dark-ship gate (Arabic hidden until P2 unless previewed).
 *
 * `useApi` returns ONE module-level object (rule 25).
 */
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { useState } from "react";
import type { MyPreferences } from "@liratek/core";

const mockGetMyPreferences = jest.fn<Promise<MyPreferences>, []>();
const mockSetMyLanguage = jest.fn();
const mockApi = {
  getMyPreferences: mockGetMyPreferences,
  setMyLanguage: mockSetMyLanguage,
};
jest.mock("@liratek/ui", () => ({ useApi: () => mockApi }));

let mockAuth = { isAuthenticated: false, user: null as null | { id: number } };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

import { LanguageProvider, useLanguage } from "../LanguageContext";
import { i18n } from "@/i18n/setup";

function prefs(over: Partial<MyPreferences>): MyPreferences {
  return {
    language: null,
    effectiveLanguage: "en",
    shopDefaultLanguage: "en",
    receiptLanguage: "en",
    ...over,
  };
}

function Probe() {
  const { language, setLanguage, arabicAvailable } = useLanguage();
  const [draft, setDraft] = useState("");
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="available">{String(arabicAvailable)}</span>
      <input data-testid="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={() => void setLanguage("ar")}>ar</button>
      <button onClick={() => void setLanguage("en")}>en</button>
    </div>
  );
}

const html = document.documentElement;
let navigatorLanguage: jest.SpyInstance;

beforeEach(async () => {
  localStorage.clear();
  mockAuth = { isAuthenticated: false, user: null };
  mockGetMyPreferences.mockReset();
  mockSetMyLanguage.mockReset().mockResolvedValue({ success: true });
  navigatorLanguage = jest.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");
  html.removeAttribute("dir");
  html.removeAttribute("lang");
  await i18n.changeLanguage("en");
});

afterEach(() => navigatorLanguage.mockRestore());

describe("OD-4 gate: Arabic is hidden until it is ready", () => {
  it("shows English even when the browser, the device and the user all say Arabic", async () => {
    navigatorLanguage.mockReturnValue("ar-LB");
    localStorage.setItem("liratek_language", "ar");
    mockAuth = { isAuthenticated: true, user: { id: 1 } };
    mockGetMyPreferences.mockResolvedValue(prefs({ language: "ar", effectiveLanguage: "ar" }));
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(mockGetMyPreferences).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByTestId("available")).toHaveTextContent("false");
    expect(screen.getByTestId("lang")).toHaveTextContent("en");
    expect(html.getAttribute("dir")).toBe("ltr");
    expect(html.getAttribute("lang")).toBe("en");
  });
});

describe("with the owner preview flag", () => {
  beforeEach(() => localStorage.setItem("liratek_arabic_preview", "1"));

  it("before sign-in: the device's last language", async () => {
    localStorage.setItem("liratek_language", "ar");
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(html.getAttribute("dir")).toBe("rtl"));
    expect(html.getAttribute("lang")).toBe("ar");
    expect(screen.getByTestId("lang")).toHaveTextContent("ar");
  });

  it("first visit: navigator.language starting with ar", async () => {
    navigatorLanguage.mockReturnValue("ar-LB");
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(screen.getByTestId("lang")).toHaveTextContent("ar"));
  });

  it("first visit: anything else is English", async () => {
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await act(async () => {});
    expect(screen.getByTestId("lang")).toHaveTextContent("en");
    expect(html.getAttribute("dir")).toBe("ltr");
  });

  it("after sign-in the user's effective language wins and is cached on the device", async () => {
    localStorage.setItem("liratek_language", "en");
    mockAuth = { isAuthenticated: true, user: { id: 1 } };
    mockGetMyPreferences.mockResolvedValue(prefs({ language: "ar", effectiveLanguage: "ar" }));
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(screen.getByTestId("lang")).toHaveTextContent("ar"));
    expect(localStorage.getItem("liratek_language")).toBe("ar");
  });

  it("setLanguage switches dir/lang, saves it for the user, and keeps typed input", async () => {
    mockAuth = { isAuthenticated: true, user: { id: 1 } };
    mockGetMyPreferences.mockResolvedValue(prefs({}));
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(mockGetMyPreferences).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId("draft"), { target: { value: "half-typed 12" } });
    fireEvent.click(screen.getByText("ar"));
    await waitFor(() => expect(html.getAttribute("dir")).toBe("rtl"));
    expect(mockSetMyLanguage).toHaveBeenCalledWith({ language: "ar" });
    expect(screen.getByTestId("draft")).toHaveValue("half-typed 12");
    expect(i18n.language).toBe("ar");
  });

  it("keeps the cached language when the server cannot be reached", async () => {
    localStorage.setItem("liratek_language", "ar");
    mockAuth = { isAuthenticated: true, user: { id: 1 } };
    mockGetMyPreferences.mockRejectedValue(new Error("offline"));
    render(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(mockGetMyPreferences).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.getByTestId("lang")).toHaveTextContent("ar");
  });
});
