/**
 * MaintenanceJobSchema (desktop IPC) — client_phone canonicalization
 * (LIRA-246b, desktop-parity follow-up).
 *
 * Unlike the core `saveMaintenanceJobSchema` used by REST, this local
 * duplicate never applied a phone-format regex, so a spaced number was never
 * REJECTED on desktop — but it was never NORMALIZED either, so "03 123 456"
 * and "+961 3 123 456" for the exact same line stored as two different
 * strings depending on which format the operator happened to type. Fixed by
 * running the same `normalizeLineNumber` (note #13) the REST schema now
 * uses.
 *
 * Rule 17: proven to fail against the pre-fix schema — `client_phone` was a
 * bare passthrough with no transform, so a spaced input came back unchanged.
 */

import { MaintenanceJobSchema } from "../index";

const base = {
  device_name: "iPhone 13",
  issue_description: "Screen cracked",
  cost_usd: 10,
  price_usd: 50,
};

describe("MaintenanceJobSchema — client_phone canonicalization (LIRA-246b)", () => {
  it("normalizes a spaced local number", () => {
    const parsed = MaintenanceJobSchema.parse({
      ...base,
      client_phone: "03 123 456",
    });
    expect(parsed.client_phone).toBe("03123456");
  });

  it("normalizes an international-prefixed, spaced number to the SAME canonical form as the bare local one", () => {
    const parsed = MaintenanceJobSchema.parse({
      ...base,
      client_phone: "+961 3 123 456",
    });
    expect(parsed.client_phone).toBe("03123456");
  });

  it("leaves a blank phone untouched", () => {
    const parsed = MaintenanceJobSchema.parse({ ...base, client_phone: "" });
    expect(parsed.client_phone).toBe("");
  });

  it("leaves a null phone untouched", () => {
    const parsed = MaintenanceJobSchema.parse({ ...base, client_phone: null });
    expect(parsed.client_phone).toBeNull();
  });
});
