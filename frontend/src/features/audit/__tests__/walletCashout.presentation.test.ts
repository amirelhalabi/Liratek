/**
 * LIRA-192 (OMT open-credit account, §8.7) — WALLET_CASHOUT presentation.
 *
 * `TRANSACTION_PRESENTATION` is typed `Record<TransactionType, …>` (see
 * transactionPresentation.ts's module doc), so it fails to COMPILE until
 * WALLET_CASHOUT is classified — that is the primary guard, enforced by
 * `yarn typecheck`, not by a runtime test. These tests pin the actual
 * VALUES chosen (label, fixed "out" direction, action-gating membership,
 * filter visibility) so a future edit that silently changes them is caught.
 *
 * Rule 17 note for the reviewer: this test is guarding an ADDITION, not a
 * fix to a pre-existing bug, so there is no "buggy code" revision to revert
 * it against — the failing-first proof here is structural: delete the
 * WALLET_CASHOUT entry from TRANSACTION_PRESENTATION (or from
 * ACTIONABLE_TYPES) and confirm this file fails (a compile error for the
 * former, an assertion failure for the latter), then restore it.
 */
import {
  TRANSACTION_PRESENTATION,
  presentationFor,
} from "../transactionPresentation";
import { getCashFlowDirection } from "../cashFlow";
import { ACTIONABLE_TYPES, FILTER_GROUPS } from "../auditConstants";

describe("WALLET_CASHOUT presentation", () => {
  it("has a fixed label and 'out' direction — the OMT_App drawer only ever decreases", () => {
    expect(TRANSACTION_PRESENTATION.WALLET_CASHOUT).toEqual({
      label: "OMT App Cash-Out",
      color: "text-rose-300",
      direction: "out",
    });
  });

  it("presentationFor resolves the same entry for a raw row type string", () => {
    expect(presentationFor("WALLET_CASHOUT")).toBe(
      TRANSACTION_PRESENTATION.WALLET_CASHOUT,
    );
  });

  it("getCashFlowDirection returns 'out' with no metadata at all — direction needs no dynamic case", () => {
    expect(getCashFlowDirection("WALLET_CASHOUT")).toBe("out");
    expect(getCashFlowDirection("WALLET_CASHOUT", null)).toBe("out");
    expect(getCashFlowDirection("WALLET_CASHOUT", "not-json{")).toBe("out");
  });
});

describe("WALLET_CASHOUT action gating", () => {
  it("is in ACTIONABLE_TYPES — it must be voidable (rule 20: it stamps a commission that becomes profit at settlement)", () => {
    expect(ACTIONABLE_TYPES.has("WALLET_CASHOUT")).toBe(true);
  });
});

describe("WALLET_CASHOUT filter entry", () => {
  it("has a Type-filter dropdown entry in the Drawer & Top-ups group", () => {
    const group = FILTER_GROUPS.find((g) => g.group === "Drawer & Top-ups");
    expect(group).toBeDefined();
    expect(group?.options).toContainEqual({
      label: "OMT App Cash-Out",
      type: "WALLET_CASHOUT",
    });
  });
});
