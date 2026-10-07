/** @jest-environment jsdom */
/**
 * Login page's "Forgot password?" link (LIRA-275): on the web it leads to
 * /forgot-password; the desktop app has no email reset, so it never shows
 * there. It must not add a second host lookup (the page asks once).
 */

import { render, screen, waitFor } from "@testing-library/react";

const publicAuthInfo = jest.fn();
let electron = false;

jest.mock("@/api/backendApi", () => ({
  publicAuthInfo: (...args: unknown[]) => publicAuthInfo(...args),
  isElectron: () => electron,
}));

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
  default: () => <input data-testid="password" />,
}));
jest.mock("@liratek/ui", () => ({
  TextInput: () => <input data-testid="username" />,
}));
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Login from "../Login";

beforeEach(() => {
  publicAuthInfo.mockReset();
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: { platformHost: false, baseDomain: null, shopName: "Cell City" },
  });
  electron = false;
});

it("shows 'Forgot password?' on the web, linking to /forgot-password", async () => {
  render(<Login />);
  const link = await screen.findByRole("link", { name: "Forgot password?" });
  expect(link).toHaveAttribute("href", "/forgot-password");
  await waitFor(() => expect(publicAuthInfo).toHaveBeenCalledTimes(1));
});

it("never shows it on desktop", async () => {
  electron = true;
  render(<Login />);
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
});
