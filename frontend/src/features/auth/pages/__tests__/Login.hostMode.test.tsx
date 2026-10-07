/** @jest-environment jsdom */
/**
 * The platform front door vs each shop's own login (owner UX change
 * 2026-10-07).
 *
 *   <slug>.<base>  username + password, "Forgot password?", "Continue with
 *                  Google" (into THIS shop). No way to create a shop.
 *   www.<base>     "Sign in to your shop": a shop address that sends the
 *                  browser to <slug>.<base>/#/login, Google, "Forgot
 *                  password?", "Create your shop" — and the username form only
 *                  behind "Platform admin sign in" (super admins sign in here).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const publicAuthInfo = jest.fn();
const googleAuthStatus = jest.fn();

jest.mock("@/api/backendApi", () => ({
  publicAuthInfo: (...args: unknown[]) => publicAuthInfo(...args),
  googleAuthStatus: (...args: unknown[]) => googleAuthStatus(...args),
  ssoExchange: jest.fn(),
  isElectron: () => false,
}));

const navigateAway = jest.fn();
let hostname = "localhost";
jest.mock("@/features/auth/utils/browserNavigation", () => {
  const actual = jest.requireActual("@/features/auth/utils/browserNavigation");
  return {
    ...actual,
    navigateAway: (url: string) => navigateAway(url),
    currentHostname: () => hostname,
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
  navigateAway.mockReset();
  googleAuthStatus.mockResolvedValue({
    success: true,
    data: {
      enabled: true,
      startUrl: "https://www.liratek.shop/api/auth/google/start",
      shop: null,
    },
  });
});

describe("on a shop's own address", () => {
  beforeEach(() => {
    hostname = "cornertech.liratek.shop";
    status({ shopName: "CornerTech" });
    googleAuthStatus.mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        startUrl: "https://www.liratek.shop/api/auth/google/start",
        shop: "cornertech",
      },
    });
  });

  it("signs in to this shop: username, password, forgot, Google", async () => {
    render(<Login />);
    const google = await screen.findByRole("link", {
      name: /continue with google/i,
    });
    expect(google).toHaveAttribute(
      "href",
      "https://www.liratek.shop/api/auth/google/start?intent=login&shop=cornertech",
    );
    expect(screen.getByTestId("username")).toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/forgot-password");
  });

  it("offers no way to create a shop", async () => {
    render(<Login />);
    await screen.findByRole("link", { name: /continue with google/i });
    await waitFor(() => expect(publicAuthInfo).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
    expect(screen.queryByText(/create a shop with google/i)).toBeNull();
    expect(screen.queryByText(/create your shop/i)).toBeNull();
    expect(screen.queryByLabelText(/shop address/i)).toBeNull();
  });
});

describe("on the platform front door (www)", () => {
  beforeEach(() => {
    hostname = "www.liratek.shop";
    status({ platformHost: true, baseDomain: "liratek.shop" });
  });

  it("asks for the shop address instead of a username", async () => {
    render(<Login />);
    expect(await screen.findByLabelText(/shop address/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in to your shop/i)).toBeInTheDocument();
    expect(screen.queryByTestId("username")).toBeNull();
    expect(screen.queryByTestId("password")).toBeNull();
  });

  it.each([
    ["cornertech"],
    ["CornerTech.liratek.shop"],
    ["https://cornertech.liratek.shop/#/login"],
  ])("Continue with %j goes to that shop's login", async (typed) => {
    render(<Login />);
    const field = await screen.findByLabelText(/shop address/i);
    fireEvent.change(field, { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(navigateAway).toHaveBeenCalledWith(
      "https://cornertech.liratek.shop/#/login",
    );
  });

  it("refuses an address that names no shop, and stays put", async () => {
    render(<Login />);
    const field = await screen.findByLabelText(/shop address/i);
    fireEvent.change(field, { target: { value: "www.liratek.shop" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(navigateAway).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/shop address/i);
  });

  it("offers Google, forgot password and creating a shop", async () => {
    render(<Login />);
    const google = await screen.findByRole("link", {
      name: /continue with google/i,
    });
    expect(google).toHaveAttribute(
      "href",
      "https://www.liratek.shop/api/auth/google/start?intent=login",
    );
    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(
      screen.getByRole("link", { name: "Create your shop" }),
    ).toHaveAttribute("href", "/signup");
    // One door to sign-up on this page, not two.
    expect(screen.queryByText(/create a shop with google/i)).toBeNull();
  });

  it("email sign-up off but Google on: still offers creating a shop with Google", async () => {
    // Owner decision 2026-10-07: creating a shop with Google is open whenever
    // Google is configured. www must not lose its only sign-up door.
    status({
      platformHost: true,
      baseDomain: "liratek.shop",
      selfServeEnabled: false,
    });
    render(<Login />);
    await screen.findByRole("link", { name: /continue with google/i });
    expect(
      await screen.findByRole("link", { name: /create a shop with google/i }),
    ).toHaveAttribute(
      "href",
      "https://www.liratek.shop/api/auth/google/start?intent=signup",
    );
    expect(screen.queryByRole("link", { name: "Create your shop" })).toBeNull();
  });

  it("keeps a way in for platform admins: the username form, on request", async () => {
    render(<Login />);
    const reveal = await screen.findByRole("button", {
      name: /platform admin sign in/i,
    });
    expect(screen.queryByTestId("username")).toBeNull();
    fireEvent.click(reveal);
    expect(screen.getByTestId("username")).toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
  });

  it("footer has no stray separator when no shop is named", async () => {
    const { container } = render(<Login />);
    await screen.findByLabelText(/shop address/i);
    expect(container.textContent).toContain("Version");
    expect(container.textContent).not.toContain("•");
  });
});

describe("anywhere else (localhost, previews): today's combined page", () => {
  beforeEach(() => {
    hostname = "localhost";
    status({});
  });

  it("username form plus 'Sign up', no shop-address field", async () => {
    render(<Login />);
    expect(
      await screen.findByRole("link", { name: "Sign up" }),
    ).toHaveAttribute("href", "/signup");
    expect(screen.getByTestId("username")).toBeInTheDocument();
    expect(screen.queryByLabelText(/shop address/i)).toBeNull();
    expect(
      await screen.findByText(/create a shop with google/i),
    ).toBeInTheDocument();
  });
});
