/**
 * Client phone typed with spaces or dashes (shop-day test 2026-10-16).
 *
 * The Clients form's own placeholder is "03 123 456", yet typing exactly
 * that was refused "Invalid phone number format" on the web app:
 * `phoneNumberSchema` (`/^\+?[0-9]{8,15}$/`) had no tolerance for the
 * spaces the placeholder shows. Formatting is now stripped BEFORE the format
 * check, and the stored value is the digits-only form the web app has always
 * stored. Anything that is not a phone once formatting is gone still fails.
 */
import { createClientSchema, updateClientSchema } from "../client";

const base = { full_name: "Hassan Zein", whatsapp_opt_in: false };

describe("client phone — spaces and dashes are formatting, not errors", () => {
  it.each([
    ["03 123 456", "03123456"],
    ["03-123-456", "03123456"],
    ["70 998 811", "70998811"],
    ["(03) 123.456", "03123456"],
    ["+961 70 123 456", "+96170123456"],
    ["  76554433 ", "76554433"],
  ])("create accepts %p and keeps %p", (typed, stored) => {
    const parsed = createClientSchema.parse({ ...base, phone_number: typed });
    expect(parsed.phone_number).toBe(stored);
  });

  it("update accepts a spaced phone and keeps the digits", () => {
    const parsed = updateClientSchema.parse({
      id: 3,
      phone_number: "03 123 456",
    });
    expect(parsed.phone_number).toBe("03123456");
  });

  it.each(["abc", "03 12", "03 123 456 x", ""])("still refuses %p", (typed) => {
    expect(() =>
      createClientSchema.parse({ ...base, phone_number: typed }),
    ).toThrow("Invalid phone number format");
  });
});
