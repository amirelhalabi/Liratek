/** @jest-environment jsdom */
/**
 * Password managers (owner request 2026-10-08).
 *
 * Browsers only offer to save a password, and only autofill it next time,
 * when the sign-in form says what its fields are: a username field with
 * autocomplete="username" and a password field with
 * autocomplete="current-password", both named and inside the submitted
 * <form>. The shared PasswordInput used to hard-code "new-password", which
 * tells the browser "a brand-new password — do not fill the saved one".
 * Sign-up / reset / invite pages keep "new-password" (they create one).
 */

import { render, screen, waitFor } from "@testing-library/react";

const publicAuthInfo = jest.fn();

jest.mock("@/api/backendApi", () => ({
  publicAuthInfo: (...args: unknown[]) => publicAuthInfo(...args),
  isElectron: () => false,
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
jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import Login from "../Login";

beforeEach(() => {
  publicAuthInfo.mockResolvedValue({
    success: true,
    data: {
      selfServeEnabled: false,
      emailInvitesEnabled: false,
      turnstileSiteKey: null,
      platformHost: false,
      baseDomain: null,
      shopName: null,
    },
  });
});

describe("Login form is recognised by password managers", () => {
  it("marks the username field as the account's username", async () => {
    const { container } = render(<Login />);
    await waitFor(() => expect(publicAuthInfo).toHaveBeenCalled());
    const user = container.querySelector(
      'form input[autocomplete="username"]',
    ) as HTMLInputElement | null;
    expect(user).not.toBeNull();
    expect(user?.name).toBe("username");
    expect(user?.id).toBe("username");
  });

  it("marks the password field as the current password, not a new one", async () => {
    const { container } = render(<Login />);
    await waitFor(() => expect(publicAuthInfo).toHaveBeenCalled());
    const pw = container.querySelector(
      'form input[type="password"]',
    ) as HTMLInputElement | null;
    expect(pw).not.toBeNull();
    expect(pw?.getAttribute("autocomplete")).toBe("current-password");
    expect(pw?.name).toBe("password");
    expect(pw?.id).toBe("password");
  });

  it("ties each label to its field", async () => {
    render(<Login />);
    await waitFor(() => expect(publicAuthInfo).toHaveBeenCalled());
    expect(screen.getByLabelText(/username/i)).toHaveAttribute(
      "autocomplete",
      "username",
    );
    expect(screen.getByLabelText(/^password/i)).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });
});
