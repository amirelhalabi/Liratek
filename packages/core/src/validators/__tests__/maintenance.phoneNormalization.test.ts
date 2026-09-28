/**
 * saveMaintenanceJobSchema — client_phone normalization (LIRA-246b)
 *
 * A phone typed as "03 123 456" or "+961 3 654 321" (both real formats the
 * live maintenance form accepts) was rejected outright with "Invalid phone
 * number format" on web: `client_phone` validated against
 * `optionalPhoneNumberSchema` (`/^\+?[0-9]{8,15}$/`), which has no tolerance
 * for spaces. The fix normalizes with `normalizeLineNumber`
 * (`packages/core/src/utils/phoneNumber.ts`, the "keep the leading 0"
 * canonical-storage normalizer from note #13) BEFORE the regex runs, so a
 * spaced/prefixed number is canonicalized first and only genuine garbage is
 * rejected.
 *
 * Rule 17: proven to fail against the pre-fix schema — `client_phone` had no
 * transform at all, so parsing a spaced number threw ZodError("Invalid phone
 * number format") instead of returning a normalized string.
 */

import { saveMaintenanceJobSchema } from "../maintenance";

const base = {
  device_name: "iPhone 13",
  price_usd: 50,
};

describe("saveMaintenanceJobSchema — client_phone normalization (LIRA-246b)", () => {
  it("normalizes a spaced local number instead of rejecting it", () => {
    const parsed = saveMaintenanceJobSchema.parse({
      ...base,
      client_phone: "03 123 456",
    });
    expect(parsed.client_phone).toBe("03123456");
  });

  it("normalizes an international-prefixed, spaced number instead of rejecting it", () => {
    const parsed = saveMaintenanceJobSchema.parse({
      ...base,
      client_phone: "+961 3 654 321",
    });
    expect(parsed.client_phone).toBe("03654321");
  });

  it("still accepts a blank phone (no phone left)", () => {
    const parsed = saveMaintenanceJobSchema.parse({
      ...base,
      client_phone: "",
    });
    expect(parsed.client_phone).toBe("");
  });

  it("still accepts an omitted phone", () => {
    const parsed = saveMaintenanceJobSchema.parse({ ...base });
    expect(parsed.client_phone).toBeUndefined();
  });

  it("still rejects a value that isn't phone-shaped at all", () => {
    expect(() =>
      saveMaintenanceJobSchema.parse({ ...base, client_phone: "not-a-phone" }),
    ).toThrow();
  });
});
