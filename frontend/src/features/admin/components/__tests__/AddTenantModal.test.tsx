/** @jest-environment jsdom */
/**
 * AddTenantModal — optional contact email (LIRA-267 FR-013b).
 *
 * The email becomes the shop's `contact_email` (one shop per address). It is
 * optional: left blank it must be OMITTED, because `""` fails the schema's
 * email check and would turn an ordinary "Add tenant" into a 400. The payload
 * is checked against `createTenantSchema` itself (rule 24).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createTenantSchema } from "@liratek/core";
import { AddTenantModal } from "../AddTenantModal";

const onSubmit = jest.fn();

function renderAndFill() {
  render(
    <AddTenantModal
      isOpen
      onClose={jest.fn()}
      onSubmit={onSubmit}
      isSubmitting={false}
      error={null}
    />,
  );
  fireEvent.change(screen.getByPlaceholderText("Acme Retail"), {
    target: { value: "Acme Retail" },
  });
  fireEvent.change(screen.getByTestId("add-tenant-admin-username"), {
    target: { value: "owner" },
  });
  fireEvent.change(screen.getByTestId("add-tenant-admin-password"), {
    target: { value: "secret1" },
  });
}

beforeEach(() => {
  onSubmit.mockReset();
  onSubmit.mockResolvedValue(undefined);
});

it("sends the contact email when given", async () => {
  renderAndFill();
  fireEvent.change(screen.getByTestId("add-tenant-contact-email"), {
    target: { value: " Owner@Acme.com " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create tenant" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const parsed = createTenantSchema.parse(onSubmit.mock.calls[0]![0]);
  expect(parsed.contactEmail).toBe("owner@acme.com");
  expect(parsed.slug).toBe("acme-retail");
});

it("omits the contact email when blank", async () => {
  renderAndFill();
  fireEvent.click(screen.getByRole("button", { name: "Create tenant" }));

  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  const payload = onSubmit.mock.calls[0]![0] as Record<string, unknown>;
  expect("contactEmail" in payload).toBe(false);
  expect(createTenantSchema.safeParse(payload).success).toBe(true);
});

it("LIRA-291: the admin password has a show/hide eye and is a new-password field", () => {
  render(
    <AddTenantModal
      isOpen
      onClose={jest.fn()}
      onSubmit={onSubmit}
      isSubmitting={false}
      error={null}
    />,
  );
  // LIRA-291 (FR-012): a password-setting field has a show/hide eye, is a
  // new-password field with a distinct name/id, so a browser can generate
  // and save the password.
  const pw = screen.getByTestId("add-tenant-admin-password") as HTMLInputElement;
  expect(pw.getAttribute("autocomplete")).toBe("new-password");
  expect(pw.name).toBe("add-tenant-admin-password");
  expect(pw.id).toBe("add-tenant-admin-password");
  const eye = screen.getByRole("button", { name: /show password/i });
  fireEvent.click(eye);
  expect(pw.type).toBe("text");
});
