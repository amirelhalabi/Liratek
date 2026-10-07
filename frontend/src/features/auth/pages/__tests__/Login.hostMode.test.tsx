/** @jest-environment jsdom */
/**
 * The platform front door vs each shop's own sign-in page (owner UX changes
 * 2026-10-07; LIRA-287 identifier-first www sign-in).
 *
 *   <slug>.<base>  username + password, "Forgot password?", "Continue with
 *                  Google" (into THIS shop). `?u=<username>` fills the
 *                  username and puts the cursor in the password. A successful
 *                  sign-in remembers the shop in the parent-domain cookie.
 *                  No way to create a shop.
 *   www.<base>     "Sign in to LiraTek": remembered shops ("Continue"),
 *                  Google, and email -> 6-digit code -> "Your shops" (each
 *                  opening that shop's page with the username filled in).
 *                  "Create your shop" is a separate button. NO shop-address
 *                  field and NO visible platform-admin sign-in (that form
 *                  lives at the unlinked #/platform route).
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

/** A `lt_shops` cookie header as a browser would hand it to the page. */
function rememberedCookie(entries: { s: string; n: string; t: string }[]) {
  return `theme=dark; lt_shops=${encodeURIComponent(JSON.stringify(entries))}`;
}

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
  TextInput: ({ value }: { value: string }) => (
    <input data-testid="username" value={value} readOnly />
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

  it("?u=<username> (from www's shop list) fills the username and focuses the password", async () => {
    window.history.replaceState(null, "", "/#/login?u=owner%203");
    render(<Login />);
    await screen.findByRole("link", { name: /continue with google/i });
    expect(screen.getByTestId("username")).toHaveValue("owner 3");
    expect(screen.getByTestId("password")).toHaveAttribute(
      "data-autofocus",
      "true",
    );
  });

  it("without ?u= the username is empty and the password is not focused", async () => {
    render(<Login />);
    await screen.findByRole("link", { name: /continue with google/i });
    expect(screen.getByTestId("username")).toHaveValue("");
    expect(screen.getByTestId("password")).toHaveAttribute(
      "data-autofocus",
      "false",
    );
  });

  it("a successful sign-in remembers this shop in the parent-domain cookie (slug + name only)", async () => {
    cookies = rememberedCookie([
      { s: "beta", n: "Beta", t: "2026-10-01T00:00:00.000Z" },
    ]);
    login.mockResolvedValue({ success: true, role: "admin" });
    render(<Login />);
    await screen.findByRole("link", { name: /continue with google/i });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(writeCookie).toHaveBeenCalledTimes(1));
    const written = writeCookie.mock.calls[0]![0] as string;
    expect(written).toContain("Domain=.liratek.shop");
    const value = JSON.parse(
      decodeURIComponent(written.split(";")[0]!.split("=").slice(1).join("=")),
    ) as { s: string; n: string }[];
    expect(value.map((e) => [e.s, e.n])).toEqual([
      ["cornertech", "CornerTech"],
      ["beta", "Beta"],
    ]);
    expect(Object.keys(value[0]!).sort()).toEqual(["n", "s", "t"]);
  });

  it("a refused sign-in remembers nothing", async () => {
    login.mockResolvedValue({ success: false, error: "Invalid credentials" });
    render(<Login />);
    await screen.findByRole("link", { name: /continue with google/i });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid credentials",
    );
    expect(writeCookie).not.toHaveBeenCalled();
  });
});

describe("on the platform front door (www)", () => {
  beforeEach(() => {
    hostname = "www.liratek.shop";
    status({ platformHost: true, baseDomain: "liratek.shop" });
  });

  it("says 'Sign in to LiraTek' and has no shop-address field and no username form", async () => {
    render(<Login />);
    expect(
      await screen.findByRole("heading", { name: "Sign in to LiraTek" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/shop address/i)).toBeNull();
    expect(screen.queryByTestId("username")).toBeNull();
    expect(screen.queryByTestId("password")).toBeNull();
  });

  it("shows NO platform-admin sign-in", async () => {
    render(<Login />);
    await screen.findByRole("heading", { name: "Sign in to LiraTek" });
    expect(screen.queryByText(/platform admin/i)).toBeNull();
  });

  it("lists remembered shops from the cookie, each continuing to its own sign-in page", async () => {
    cookies = rememberedCookie([
      { s: "cornertech", n: "CornerTech", t: "2026-10-02T00:00:00.000Z" },
      { s: "beta", n: "Beta <b>Phones</b>", t: "2026-10-01T00:00:00.000Z" },
    ]);
    render(<Login />);
    const corner = await screen.findByRole("link", { name: /CornerTech/ });
    expect(corner).toHaveAttribute(
      "href",
      "https://cornertech.liratek.shop/#/login",
    );
    expect(corner).toHaveTextContent(/continue/i);
    // A name is text, never markup.
    expect(
      screen.getByRole("link", { name: /Beta <b>Phones<\/b>/ }),
    ).toHaveAttribute("href", "https://beta.liratek.shop/#/login");
  });

  it("'Forget this shop' removes the row and rewrites the parent-domain cookie", async () => {
    cookies = rememberedCookie([
      { s: "cornertech", n: "CornerTech", t: "2026-10-02T00:00:00.000Z" },
      { s: "beta", n: "Beta", t: "2026-10-01T00:00:00.000Z" },
    ]);
    render(<Login />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Forget CornerTech" }),
    );
    expect(screen.queryByRole("link", { name: /CornerTech/ })).toBeNull();
    expect(writeCookie).toHaveBeenCalledTimes(1);
    const written = writeCookie.mock.calls[0]![0] as string;
    expect(written).toContain("Domain=.liratek.shop");
    expect(decodeURIComponent(written)).not.toContain("cornertech");
    expect(decodeURIComponent(written)).toContain("beta");
  });

  it("email -> code -> 'Your shops', each opening that shop with the username filled in", async () => {
    requestSigninCode.mockResolvedValue({
      success: true,
      data: { message: "If this email has a LiraTek account, we've sent a code." },
    });
    verifySigninCode.mockResolvedValue({
      success: true,
      data: {
        shops: [
          { slug: "beta", name: "Beta Phones", username: "owner 3" },
          { slug: "cornertech", name: "CornerTech", username: "boss" },
        ],
      },
    });
    render(<Login />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "Owner@Gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
    expect(
      await screen.findByText(
        "If this email has a LiraTek account, we've sent a code.",
      ),
    ).toBeInTheDocument();
    expect(requestSigninCode).toHaveBeenCalledWith({ email: "Owner@Gmail.com" });
    // The shops list is never shown before a valid code.
    expect(screen.queryByText("Beta Phones")).toBeNull();

    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123 456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show my shops" }));
    expect(verifySigninCode).toHaveBeenCalledWith({
      email: "Owner@Gmail.com",
      code: "123 456",
    });
    const beta = await screen.findByRole("link", { name: /Beta Phones/ });
    expect(beta).toHaveAttribute(
      "href",
      "https://beta.liratek.shop/#/login?u=owner%203",
    );
    expect(beta).toHaveTextContent("owner 3");
    expect(screen.getByRole("link", { name: /CornerTech/ })).toHaveAttribute(
      "href",
      "https://cornertech.liratek.shop/#/login?u=boss",
    );
  });

  it("a refused code shows the server's message and no shops", async () => {
    requestSigninCode.mockResolvedValue({
      success: true,
      data: { message: "If this email has a LiraTek account, we've sent a code." },
    });
    verifySigninCode.mockResolvedValue({
      success: false,
      code: "SIGNIN_CODE_INVALID",
      error: {
        code: "SIGNIN_CODE_INVALID",
        message:
          "That code is not right or has expired. Check it, or ask for a new one.",
      },
    });
    render(<Login />);
    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "owner@gmail.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
    fireEvent.change(await screen.findByLabelText("6-digit code"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show my shops" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not right or has expired/,
    );
    expect(screen.queryByText(/your shops/i)).toBeNull();
  });

  it("offers Google, forgot password and a separate 'Create your shop' button", async () => {
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
      await screen.findByRole("link", { name: "Create your shop" }),
    ).toHaveAttribute("href", "/signup");
    expect(screen.getByText(/new to liratek\?/i)).toBeInTheDocument();
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

  it("the hidden #/platform route keeps the username form for platform admins", async () => {
    render(<Login adminOnly />);
    expect(await screen.findByTestId("username")).toBeInTheDocument();
    expect(screen.getByTestId("password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("footer has no stray separator when no shop is named", async () => {
    const { container } = render(<Login />);
    await screen.findByRole("heading", { name: "Sign in to LiraTek" });
    expect(container.textContent).toContain("Version");
    expect(container.textContent).not.toContain("•");
  });
});

describe("anywhere else (localhost, previews): today's combined page", () => {
  beforeEach(() => {
    hostname = "localhost";
    status({});
  });

  it("username form plus 'Create your shop', no shop-address field", async () => {
    render(<Login />);
    expect(
      await screen.findByRole("link", { name: "Create your shop" }),
    ).toHaveAttribute("href", "/signup");
    expect(screen.queryByRole("link", { name: "Sign up" })).toBeNull();
    expect(screen.getByTestId("username")).toBeInTheDocument();
    expect(screen.queryByLabelText(/shop address/i)).toBeNull();
    expect(
      await screen.findByText(/create a shop with google/i),
    ).toBeInTheDocument();
  });

  it("never touches the remembered-shops cookie", async () => {
    login.mockResolvedValue({ success: true, role: "admin" });
    render(<Login />);
    await screen.findByRole("link", { name: "Create your shop" });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(writeCookie).not.toHaveBeenCalled();
  });
});
