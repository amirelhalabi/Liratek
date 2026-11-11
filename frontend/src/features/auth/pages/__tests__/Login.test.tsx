/**
 * Login — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import Login from "../Login";

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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (publicAuthInfo as unknown as jest.Mock).mockReset();
  electron = false;
  (login as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Login.forgotPassword (LIRA-275)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Login page's "Forgot password?" link (LIRA-275): on the web it leads to
   * /forgot-password; the desktop app has no email reset, so it never shows
   * there. It must not add a second host lookup (the page asks once).
   */

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
});

describe("Login.signupLink (LIRA-267)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Login page's sign-up link (LIRA-267 T055).
   *
   * The link reads **Create your shop** (LIRA-287 wording; was "Sign up") and is shown exactly when a visitor can sign up
   * on their own: self-serve email sign-up is on (Stage B — the shared invite
   * code is gone, so its old `enabled` flag must not show it). Never on
   * desktop, and never when self-serve is off — a link that leads to "not
   * available" reads as a broken app. Invited shops arrive by their email link
   * and never need this one.
   */

  function status(over: Record<string, unknown>) {
    publicAuthInfo.mockResolvedValue({
      success: true,
      data: {
        enabled: false,
        selfServeEnabled: false,
        turnstileSiteKey: null,
        // Owner UX change 2026-10-07: these cases are the COMBINED page
        // (localhost, previews — no host tenancy). A shop's own address never
        // offers sign-up, and www says "Create your shop" instead; both are
        // pinned in Login.hostMode.test.tsx.
        platformHost: false,
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

  // LIRA-287 wording: "Sign in" pairs with "Create your shop" everywhere.
  it("shows 'Create your shop' when self-serve is on", async () => {
    status({ selfServeEnabled: true, turnstileSiteKey: "k" });
    render(<Login />);
    const link = await screen.findByRole("link", { name: "Create your shop" });
    expect(link).toHaveAttribute("href", "/signup");
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
  });

  // Rule 24: was "shows 'Sign up' while only the shared code is on (Stage A)".
  it("hides the link when only the retired shared-code `enabled` flag is on", async () => {
    status({ enabled: true });
    render(<Login />);
    await waitFor(() => expect(publicAuthInfo).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "Create your shop" })).toBeNull();
  });

  it("hides the link when self-serve is off", async () => {
    status({});
    render(<Login />);
    await waitFor(() => expect(publicAuthInfo).toHaveBeenCalledTimes(1));
    // Let the resolved status settle before asserting absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "Create your shop" })).toBeNull();
  });

  it("never asks or shows it on desktop", async () => {
    electron = true;
    status({ selfServeEnabled: true });
    render(<Login />);
    await new Promise((r) => setTimeout(r, 0));
    expect(publicAuthInfo).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Create your shop" })).toBeNull();
  });
});
