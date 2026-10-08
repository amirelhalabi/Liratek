/** @jest-environment jsdom */
/**
 * LIRA-291 — the shop sign-in page explains the username field.
 *
 *   - a hint under the field: "Not your email — use the username your admin
 *     gave you";
 *   - typing an "@" shows "Use your username, or Continue with Google";
 *     submitting is still allowed (the server answers as before);
 *   - www's identifier-first page (which takes an email) is unchanged.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const publicAuthInfo = jest.fn();
const googleAuthStatus = jest.fn();
const requestSigninCode = jest.fn();
const verifySigninCode = jest.fn();

jest.mock("@/api/backendApi", () => ({
  publicAuthInfo: (...args: unknown[]) => publicAuthInfo(...args),
  googleAuthStatus: (...args: unknown[]) => googleAuthStatus(...args),
  requestSigninCode: (...args: unknown[]) => requestSigninCode(...args),
  verifySigninCode: (...args: unknown[]) => verifySigninCode(...args),
  ssoExchange: jest.fn(),
  isElectron: () => false,
}));

const navigateAway = jest.fn();
const writeCookie = jest.fn();
let hostname = "localhost";
let cookies = "";
jest.mock("@/features/auth/utils/browserNavigation", () => {
  const actual = jest.requireActual("@/features/auth/utils/browserNavigation");
  return {
    ...actual,
    navigateAway: (url: string) => navigateAway(url),
    currentHostname: () => hostname,
    readCookies: () => cookies,
    writeCookie: (cookie: string) => writeCookie(cookie),
  };
});


const login = jest.fn();
// Rule 25: a stable auth value.
const auth = { login };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => auth,
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => auth,
}));
jest.mock("@/hooks/useShopName", () => ({ useShopName: () => "" }));
const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));
jest.mock("@/shared/components/PasswordInput", () => ({
  __esModule: true,
  default: ({ autoFocus }: { autoFocus?: boolean }) => (
    <input data-testid="password" data-autofocus={String(Boolean(autoFocus))} />
  ),
}));
jest.mock("@liratek/ui", () => ({
  TextInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input
      data-testid="username"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Login from "../Login";

function status(over: Record<string, unknown>) {
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: {
      emailInvitesEnabled: true,
      selfServeEnabled: true,
      turnstileSiteKey: null,
      platformHost: false,
      baseDomain: null,
      shopName: null,
      ...over,
    },
  });
}

beforeEach(() => {
  publicAuthInfo.mockReset();
  googleAuthStatus.mockReset();
  requestSigninCode.mockReset();
  verifySigninCode.mockReset();
  navigateAway.mockReset();
  writeCookie.mockReset();
  login.mockReset();
  cookies = "";
  window.history.replaceState(null, "", "/#/login");
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: {
      enabled: true,
      startUrl: "https://www.liratek.shop/api/auth/google/start",
      shop: null,
    },
  });
});


const HINT = "Not your email — use the username your admin gave you";
const AT_MESSAGE = "Use your username, or Continue with Google";

describe("shop sign-in page: the username hint (LIRA-291)", () => {
  beforeEach(() => {
    hostname = "cornertech.liratek.shop";
    status({ shopName: "CornerTech" });
  });

  it("shows the hint under the username field", async () => {
    render(<Login />);
    expect(await screen.findByText(HINT)).toBeInTheDocument();
    expect(screen.queryByText(AT_MESSAGE)).toBeNull();
  });

  it("an @ in the username shows the message; submitting is still allowed", async () => {
    login.mockResolvedValue({ success: false, error: "Invalid username or password" });
    render(<Login />);
    await screen.findByText(HINT);
    fireEvent.change(screen.getByTestId("username"), {
      target: { value: "rami@gmail.com" },
    });
    expect(await screen.findByText(AT_MESSAGE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0]![0]).toBe("rami@gmail.com");
  });
});

describe("www identifier-first page (LIRA-291: unchanged)", () => {
  it("shows no username hint", async () => {
    hostname = "www.liratek.shop";
    status({ platformHost: true, baseDomain: "liratek.shop" });
    render(<Login />);
    await screen.findByRole("heading", { name: "Sign in to LiraTek" });
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.queryByText(AT_MESSAGE)).toBeNull();
  });
});
