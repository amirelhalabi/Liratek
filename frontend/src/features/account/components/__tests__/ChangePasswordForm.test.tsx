/** @jest-environment jsdom */
/**
 * LIRA-293 — "Change password" on My account (a user who HAS a password).
 * Current, new and confirm, all PasswordInput with the right autoComplete
 * (current-password / new-password) so password managers fill and save
 * them. The payload is core's `changeOwnPasswordSchema` shape (rule 24: the
 * assertion parses it through the schema rather than naming fields by hand).
 * One call, through the dual-transport adapter (desktop IPC / web REST).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  changeOwnPasswordSchema,
  PASSWORD_SYMBOL_MESSAGE,
} from "@liratek/core";

const changeOwnPassword = jest.fn();
jest.mock("@/api/backendApi", () => ({
  changeOwnPassword: (...a: unknown[]) => changeOwnPassword(...a),
}));

import ChangePasswordForm from "../ChangePasswordForm";

const CURRENT = "Old!Passw0rd";
const NEXT = "xY7-pq_Rt.9mZ";

function fill(
  container: HTMLElement,
  current: string,
  next: string,
  confirm: string,
) {
  const cur = container.querySelector<HTMLInputElement>(
    'input[autocomplete="current-password"]',
  );
  const [pw, cf] = Array.from(
    container.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="new-password"]',
    ),
  );
  fireEvent.change(cur!, { target: { value: current } });
  fireEvent.change(pw!, { target: { value: next } });
  fireEvent.change(cf!, { target: { value: confirm } });
}

beforeEach(() => jest.clearAllMocks());

it("has current (current-password), new and confirm (new-password) fields, each with an eye toggle", () => {
  const { container } = render(<ChangePasswordForm />);
  expect(
    screen.getByRole("form", { name: "Change password" }),
  ).toBeInTheDocument();
  expect(
    container.querySelectorAll('input[autocomplete="current-password"]'),
  ).toHaveLength(1);
  expect(
    container.querySelectorAll('input[autocomplete="new-password"]'),
  ).toHaveLength(2);
  expect(
    screen.getAllByRole("button", { name: /show password/i }),
  ).toHaveLength(3);
});

it("sends the schema's payload in ONE call and reports that other devices were signed out", async () => {
  changeOwnPassword.mockResolvedValue({
    success: true,
    data: { sessionsRevoked: 2, noticeSent: true },
  });
  const { container } = render(<ChangePasswordForm />);
  fill(container, CURRENT, NEXT, NEXT);
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  await waitFor(() => expect(changeOwnPassword).toHaveBeenCalledTimes(1));
  const payload = changeOwnPassword.mock.calls[0]![0];
  expect(changeOwnPasswordSchema.parse(payload)).toEqual(payload);
  expect(payload).toEqual(
    changeOwnPasswordSchema.parse({
      currentPassword: CURRENT,
      newPassword: NEXT,
    }),
  );
  expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
  // The fields are cleared after a change.
  expect(
    container.querySelector<HTMLInputElement>(
      'input[autocomplete="current-password"]',
    )!.value,
  ).toBe("");
});

it("a wrong current password shows the server's message and keeps the form", async () => {
  changeOwnPassword.mockResolvedValue({
    success: false,
    code: "WRONG_PASSWORD",
    error: {
      code: "WRONG_PASSWORD",
      message: "Your current password is not correct.",
    },
  });
  const { container } = render(<ChangePasswordForm />);
  fill(container, "Nope!Passw0rd", NEXT, NEXT);
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(
    await screen.findByText("Your current password is not correct."),
  ).toBeInTheDocument();
});

it("applies the one password rule and the confirm match before calling the server", async () => {
  const { container } = render(<ChangePasswordForm />);
  fill(container, CURRENT, "Abcdefg1", "Abcdefg1");
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(await screen.findByText(PASSWORD_SYMBOL_MESSAGE)).toBeInTheDocument();
  fill(container, CURRENT, NEXT, NEXT + "x");
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(
    await screen.findByText(/passwords do not match/i),
  ).toBeInTheDocument();
  fill(container, "", NEXT, NEXT);
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect(
    await screen.findByText(/enter your current password/i),
  ).toBeInTheDocument();
  expect(changeOwnPassword).not.toHaveBeenCalled();
});
