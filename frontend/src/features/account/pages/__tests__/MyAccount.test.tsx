/** @jest-environment jsdom */
/**
 * LIRA-291 — "My account" (/account): every signed-in user's own sign-in
 * methods (connect / disconnect Google, set a password) and signed-in
 * devices. Not admin-only: a staff member who joined with Google must be
 * able to reach "Set a password" here. The panels are the SAME components
 * Settings used (one copy each), so this only checks the page assembles them.
 */

import { render, screen } from "@testing-library/react";

jest.mock("@/features/settings/pages/Settings/GoogleAccountPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-signin-methods" />,
}));
jest.mock("@/features/settings/pages/Settings/SignedInDevices", () => ({
  __esModule: true,
  default: () => <div data-testid="panel-devices" />,
}));

import MyAccount from "../MyAccount";

it("is titled 'My account' and shows Sign-in methods and Signed-in devices", () => {
  render(<MyAccount />);
  expect(screen.getByRole("heading", { name: "My account" })).toBeInTheDocument();
  expect(screen.getByTestId("panel-signin-methods")).toBeInTheDocument();
  expect(screen.getByTestId("panel-devices")).toBeInTheDocument();
});
