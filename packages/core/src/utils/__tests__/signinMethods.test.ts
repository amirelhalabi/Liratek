/**
 * LIRA-291 — the one wording for a user's sign-in methods (Settings → Users).
 * Pure, so the browser bundle can use it (rule 29).
 */
import { signinMethodLabel } from "../signinMethods";
import * as browserEntry from "../../browser";

describe("signinMethodLabel (LIRA-291)", () => {
  it.each([
    [{ hasPassword: true, google: false }, "Password"],
    [{ hasPassword: false, google: true }, "Google"],
    [{ hasPassword: true, google: true }, "Password + Google"],
  ])("%j -> %s", (input, label) => {
    expect(signinMethodLabel(input)).toBe(label);
  });

  it("a user with neither (only possible right after an admin disconnect) reads as no method", () => {
    expect(signinMethodLabel({ hasPassword: false, google: false })).toBe(
      "None",
    );
  });

  it("is exported from the browser entry", () => {
    expect(
      (browserEntry as Record<string, unknown>).signinMethodLabel,
    ).toBe(signinMethodLabel);
  });
});
