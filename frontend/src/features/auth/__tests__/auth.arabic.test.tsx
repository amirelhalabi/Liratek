/** @jest-environment jsdom */
/**
 * LIRA-331 T032: every screen before sign-in renders its own words in Arabic
 * once the language is "ar" (the English text is pinned by the existing
 * tests of each page). Codes and server messages are not translated here.
 *
 * Mocks return stable references (rule 25).
 */
import { render, screen } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";

let electron = false;
const publicAuthInfo = jest.fn();
const googleAuthStatus = jest.fn();
jest.mock("@/api/backendApi", () => ({
  isElectron: () => electron,
  publicAuthInfo: (...a: unknown[]) => publicAuthInfo(...a),
  googleAuthStatus: (...a: unknown[]) => googleAuthStatus(...a),
  googleChooseShop: jest.fn(),
  forgotPassword: jest.fn(),
  checkResetToken: jest.fn(),
  resetPassword: jest.fn(),
  verifyUserEmail: jest.fn(),
  checkUserInvitation: jest.fn(),
  acceptUserInvitation: jest.fn(),
  startJoinWithGoogle: jest.fn(),
  requestSigninCode: jest.fn(),
  verifySigninCode: jest.fn(),
  googleSignup: jest.fn(),
  signup: jest.fn(),
  checkSignupInvite: jest.fn(),
  requestSignupLink: jest.fn(),
}));
const themeValue = { theme: "dark" };
jest.mock("@/contexts/ThemeContext", () => ({ useTheme: () => themeValue }));
let search = new URLSearchParams();
const navigate = jest.fn();
jest.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => navigate,
  useSearchParams: () => [search],
}));

import GoogleAuth from "../pages/GoogleAuth";
import ForgotPassword from "../pages/ForgotPassword";
import ResetPassword from "../pages/ResetPassword";
import VerifyEmail from "../pages/VerifyEmail";
import JoinShop from "../pages/JoinShop";
import Signup from "../pages/Signup";
import PlatformSignIn from "../components/PlatformSignIn";

beforeAll(async () => {
  await loadLanguage("ar");
});
beforeEach(async () => {
  electron = false;
  search = new URLSearchParams();
  publicAuthInfo.mockReset().mockResolvedValue({
    success: true,
    data: { selfServeEnabled: true, turnstileSiteKey: null },
  });
  googleAuthStatus.mockReset().mockResolvedValue({
    success: true,
    data: { enabled: true, startUrl: "https://www.example.test/google" },
  });
  await i18n.changeLanguage("ar");
});
afterEach(async () => {
  await i18n.changeLanguage("en");
});

it("Google landing: the refusal reason, by its code", () => {
  window.history.replaceState(null, "", "/#/auth/google?error=cancelled");
  render(<GoogleAuth />);
  expect(
    screen.getByText("تم إلغاء تسجيل الدخول عبر Google."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "تسجيل الدخول" }),
  ).toBeInTheDocument();
});

it("Forgot password (desktop)", () => {
  electron = true;
  render(<ForgotPassword />);
  expect(
    screen.getByRole("heading", { name: "نسيت كلمة المرور" }),
  ).toBeInTheDocument();
});

it("Reset password (desktop)", () => {
  electron = true;
  render(<ResetPassword />);
  expect(
    screen.getByRole("heading", { name: "إعادة تعيين كلمة المرور" }),
  ).toBeInTheDocument();
});

it("Verify email without a token", () => {
  render(<VerifyEmail />);
  expect(
    screen.getByRole("heading", { name: "أكّد بريدك الإلكتروني" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("هذا الرابط غير صالح. اطلب رسالة تأكيد جديدة."),
  ).toBeInTheDocument();
});

it("Join a shop without an invite", () => {
  render(<JoinShop />);
  expect(
    screen.getByRole("heading", { name: "الانضمام إلى متجر" }),
  ).toBeInTheDocument();
});

it("Sign-up request form", async () => {
  render(<Signup />);
  expect(
    await screen.findByRole("heading", { name: "أنشئ متجرك" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "أرسل لي رابط التسجيل" }),
  ).toBeInTheDocument();
});

it("www sign-in, with Continue with Google", async () => {
  render(<PlatformSignIn baseDomain="example.test" canSignUp dark />);
  expect(
    screen.getByRole("heading", { name: "تسجيل الدخول إلى LiraTek" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "المتابعة بالبريد الإلكتروني" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: /المتابعة باستخدام Google/ }),
  ).toBeInTheDocument();
});
