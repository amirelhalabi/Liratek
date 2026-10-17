/** @jest-environment jsdom */
/**
 * LIRA-331 FR-004: the Login page offers English / العربية before sign-in.
 *
 * Rendered inside the REAL LanguageProvider, so a click on the switch goes
 * through the same path a cashier's does: device language → i18next →
 * <html dir>. The switch only exists while Arabic is previewable (OD-4).
 *
 * Rule 25: `useApi` and `useAuth` return module-level (stable) objects.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const publicAuthInfo = jest.fn();
jest.mock("@/api/backendApi", () => ({
  publicAuthInfo: (...args: unknown[]) => publicAuthInfo(...args),
  isElectron: () => false,
}));

const mockApi = {
  getMyPreferences: jest.fn(),
  setMyLanguage: jest.fn(),
};
const auth = { login: jest.fn(), isAuthenticated: false };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => auth,
}));
jest.mock("../context/AuthContext", () => ({
  useAuth: () => auth,
}));
jest.mock("@/hooks/useShopName", () => ({ useShopName: () => "" }));
const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));
jest.mock("@/shared/components/PasswordInput", () => ({
  __esModule: true,
  default: () => <input data-testid="password" />,
}));
jest.mock("@liratek/ui", () => ({
  TextInput: () => <input data-testid="username" />,
  useApi: () => mockApi,
}));
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Login from "../pages/Login";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { i18n } from "@/i18n/setup";

beforeEach(() => {
  localStorage.clear();
  publicAuthInfo.mockReset().mockResolvedValue({
    success: true,
    data: {
      enabled: false,
      selfServeEnabled: false,
      turnstileSiteKey: null,
      platformHost: false,
      baseDomain: null,
      shopName: null,
    },
  });
});

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
  document.documentElement.setAttribute("dir", "ltr");
  document.documentElement.setAttribute("lang", "en");
});

function renderLogin() {
  return render(
    <LanguageProvider>
      <Login />
    </LanguageProvider>,
  );
}

it("switches the sign-in page to Arabic, right to left", async () => {
  localStorage.setItem("liratek_arabic_preview", "1");
  renderLogin();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();

  fireEvent.click(await screen.findByTestId("language-switch-ar"));

  expect(
    await screen.findByRole("button", { name: "تسجيل الدخول" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(document.documentElement.getAttribute("dir")).toBe("rtl"),
  );
});

it("offers no switch while Arabic is not previewable", async () => {
  renderLogin();
  await waitFor(() => expect(publicAuthInfo).toHaveBeenCalled());
  expect(screen.queryByTestId("language-switch")).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
});
