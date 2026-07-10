/** @jest-environment jsdom */

/**
 * FIX 3 (security review) — Disconnect must server-revoke the impersonation
 * session, best-effort.
 *
 * `logout()` (AuthContext) already POSTs /api/auth/logout with the
 * impersonation token BEFORE clearing sessionStorage — see
 * `backendApi.impersonationLogout.test.ts` for that contract. What was
 * missing: if that server call fails (network blip, session already
 * expired), the error propagated out of `handleDisconnect` uncaught, so
 * `navigate("/login")` never ran and the super admin stayed stuck on the
 * impersonated tenant's UI. This suite proves Disconnect (a) still invokes
 * `logout()` (the server revoke) and (b) always redirects to /login
 * regardless of whether that revoke succeeds or throws.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImpersonationBanner } from "../ImpersonationBanner";

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

const mockLogout = jest.fn();
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({
    isImpersonating: true,
    impersonationInfo: {
      active: true,
      tenantId: 2,
      impersonatorId: 1,
      tenantName: "Beta Co",
      username: "beta_admin",
    },
    logout: mockLogout,
  }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe("ImpersonationBanner — Disconnect", () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockLogout.mockReset();
  });

  it("invokes logout() (the server-side session revoke) and then redirects to /login", async () => {
    mockLogout.mockResolvedValue(undefined);
    render(<ImpersonationBanner />);

    fireEvent.click(screen.getByText("Disconnect"));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true });
  });

  it("best-effort: still redirects to /login when the server revoke fails", async () => {
    mockLogout.mockRejectedValue(new Error("network error"));
    render(<ImpersonationBanner />);

    fireEvent.click(screen.getByText("Disconnect"));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true }),
    );
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
