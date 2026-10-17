/** @jest-environment jsdom */
/**
 * LIRA-331 (FR-006, OD-1): the Arabic landing links to `#/signup?lang=ar`.
 * The sign-up page makes Arabic this device's language at once, so the
 * screen (and the next sign-in screen) opens in Arabic — once Arabic is
 * released (OD-4). Without `lang`, nothing changes.
 */
import { render, waitFor } from "@testing-library/react";

jest.mock("@/api/backendApi", () => ({
  signup: jest.fn(),
  checkSignupInvite: jest.fn(),
  publicAuthInfo: () =>
    Promise.resolve({
      success: true,
      data: { emailInvitesEnabled: true, selfServeEnabled: true, turnstileSiteKey: null },
    }),
  requestSignupLink: jest.fn(),
  googleAuthStatus: () => Promise.resolve({ success: true, data: { enabled: false } }),
  isElectron: () => false,
}));
jest.mock("@/features/auth/components/TurnstileWidget", () => ({
  TurnstileWidget: () => <div data-testid="turnstile-widget" />,
}));

// Rule 25: stable references across renders.
let searchParams = new URLSearchParams("");
const setSearch = jest.fn();
const navigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams, setSearch],
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const mockApi = { getMyPreferences: jest.fn(), setMyLanguage: jest.fn() };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}));

import Signup from "../Signup";
import { LanguageProvider } from "@/contexts/LanguageContext";

beforeEach(() => localStorage.clear());

it("?lang=ar makes Arabic this device's language", async () => {
  searchParams = new URLSearchParams("lang=ar");
  render(
    <LanguageProvider>
      <Signup />
    </LanguageProvider>,
  );
  await waitFor(() => expect(localStorage.getItem("liratek_language")).toBe("ar"));
  expect(mockApi.setMyLanguage).not.toHaveBeenCalled();
});

it("without lang the device language is left alone", async () => {
  searchParams = new URLSearchParams("");
  render(
    <LanguageProvider>
      <Signup />
    </LanguageProvider>,
  );
  await new Promise((r) => setTimeout(r, 20));
  expect(localStorage.getItem("liratek_language")).toBeNull();
});
