/** @jest-environment jsdom */
/**
 * SendInviteModal (LIRA-267 US1) — the super admin emails a sign-up link.
 *
 *   1. The payload is the schema's own shape (rule 24: parsed through
 *      `createSignupInvitationSchema`), and an empty shop name is OMITTED,
 *      never sent as "".
 *   2. A 409 is shown INLINE, with the server's words. requestJson throws a
 *      plain `{ status, message: { code, message, details } }` object, not an
 *      Error — an `instanceof Error` check would swap "This email already has
 *      a shop: cornertech" for a useless fallback. The mocks reject with that
 *      real shape for exactly that reason.
 *   3. Success closes the modal.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createSignupInvitationSchema } from "@liratek/core";

const createMutate = jest.fn();
// Rule 25: one stable mutation object.
const createMutation = { mutateAsync: createMutate, isPending: false };
jest.mock("../../hooks/useSignupInvitations", () => ({
  useCreateSignupInvitationMutation: () => createMutation,
}));

import { SendInviteModal } from "../SendInviteModal";

const onClose = jest.fn();

function renderModal() {
  return render(<SendInviteModal isOpen onClose={onClose} />);
}

const email = () => screen.getByTestId("send-invite-email") as HTMLInputElement;
const shop = () => screen.getByTestId("send-invite-shop") as HTMLInputElement;
const submit = () => screen.getByTestId("send-invite-submit") as HTMLButtonElement;

beforeEach(() => {
  createMutate.mockReset();
  onClose.mockReset();
  createMutate.mockResolvedValue({ id: 1, email: "owner@shop.com" });
});

it("is disabled until an email is entered", () => {
  renderModal();
  expect(submit()).toBeDisabled();
  fireEvent.change(email(), { target: { value: "owner@shop.com" } });
  expect(submit()).toBeEnabled();
});

it("sends the schema's payload, with the shop name when given", async () => {
  renderModal();
  fireEvent.change(email(), { target: { value: " Owner@Shop.com " } });
  fireEvent.change(shop(), { target: { value: "Cell City" } });
  fireEvent.click(submit());

  await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
  const payload = createMutate.mock.calls[0]![0] as Record<string, unknown>;
  expect(createSignupInvitationSchema.parse(payload)).toEqual({
    email: "owner@shop.com",
    shopNameHint: "Cell City",
  });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

it("omits an empty shop name instead of sending an empty string", async () => {
  renderModal();
  fireEvent.change(email(), { target: { value: "owner@shop.com" } });
  fireEvent.change(shop(), { target: { value: "   " } });
  fireEvent.click(submit());

  await waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
  const payload = createMutate.mock.calls[0]![0] as Record<string, unknown>;
  expect("shopNameHint" in payload).toBe(false);
});

it("shows the duplicate-shop 409 inline and stays open", async () => {
  createMutate.mockRejectedValue({
    status: 409,
    message: {
      code: "EMAIL_ALREADY_HAS_SHOP",
      message: "This email already has a shop: cornertech",
      details: { slug: "cornertech" },
    },
  });
  renderModal();
  fireEvent.change(email(), { target: { value: "owner@shop.com" } });
  fireEvent.click(submit());

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This email already has a shop: cornertech",
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(submit()).toBeEnabled();
});

it("shows the email-not-configured 409 inline", async () => {
  createMutate.mockRejectedValue({
    status: 409,
    message: {
      code: "EMAIL_NOT_CONFIGURED",
      message:
        "Email is not configured on this server, so an invite cannot be sent",
    },
  });
  renderModal();
  fireEvent.change(email(), { target: { value: "owner@shop.com" } });
  fireEvent.click(submit());

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Email is not configured",
  );
});
