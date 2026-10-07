/** @jest-environment jsdom */
/**
 * Login page's sign-up link (LIRA-267 T055).
 *
 * The link reads **Sign up** and is shown when a visitor can actually sign
 * up: self-serve email sign-up is on, OR (Stage A only) the shared invite code
 * is still configured. Never on desktop, and never when neither is on — a
 * link that leads to "not available" reads as a broken app.
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

function status(over: Record<string, unknown>) {
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: {
      enabled: false,
      selfServeEnabled: false,
      turnstileSiteKey: null,
      platformHost: true,
      baseDomain: null,
      shopName: null,
      ...over,
    },
  });
}

beforeEach(() => {
  publicAuthInfo.mockReset();
  electron = false;
});

it("shows 'Sign up' when self-serve is on", async () => {
  status({ selfServeEnabled: true, turnstileSiteKey: "k" });
  render(<Login />);
  const link = await screen.findByRole("link", { name: "Sign up" });
  expect(link).toHaveAttribute("href", "/signup");
  expect(screen.queryByText("Create your shop")).toBeNull();
});

it("shows 'Sign up' while only the shared code is on (Stage A)", async () => {
  status({ enabled: true });
  render(<Login />);
  expect(await screen.findByRole("link", { name: "Sign up" })).toBeInTheDocument();
});

it("hides the link when neither is on", async () => {
  status({});
  render(<Login />);
  await waitFor(() => expect(publicAuthInfo).toHaveBeenCalledTimes(1));
  // Let the resolved status settle before asserting absence.
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
});

it("never asks or shows it on desktop", async () => {
  electron = true;
  status({ selfServeEnabled: true });
  render(<Login />);
  await new Promise((r) => setTimeout(r, 0));
  expect(publicAuthInfo).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
});
