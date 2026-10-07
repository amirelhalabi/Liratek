/**
 * Self-test for `expectPostingsMatchRule` (POSTING_INTEGRITY_PLAN.md §7,
 * phase 5). A table-driven assertion that silently passes is worse than none
 * (CLAUDE.md rule 28a), so this pins that it FAILS on a missing posting, an
 * extra posting, a wrong amount and a stray ledger — on hand-built snapshots,
 * no database involved.
 */
import {
  expectPostingsMatchRule,
  expectedPostingsForRule,
  type LedgerSnapshot,
} from "../testHelpers/postingAssert";
import { POSTING_RULES, type PostingRule } from "../../constants/postingRules";

const empty = (): LedgerSnapshot => ({
  drawers: {},
  supplier: {},
  partner: {},
  debt: {},
});

const rule = POSTING_RULES["FS_SYSTEM/SEND/FOR"]; // supplier +(x+f), partner +(x+f), nothing else
const inputs = { x: 100, f: 5, c: 0, currency: "USD" };
const keys = { providerSupplierId: 7, partnerId: 3 };

function snap(over: Partial<LedgerSnapshot>): LedgerSnapshot {
  return { ...empty(), ...over };
}

describe("expectPostingsMatchRule", () => {
  it("passes when the delta is exactly the rule", () => {
    expect(() =>
      expectPostingsMatchRule(
        rule,
        empty(),
        snap({ supplier: { "7|USD": 105 }, partner: { "3|USD": 105 } }),
        inputs,
        keys,
      ),
    ).not.toThrow();
  });

  it("fails on a MISSING posting (the 2026-10-06 bug shape)", () => {
    expect(() =>
      expectPostingsMatchRule(
        rule,
        empty(),
        snap({ partner: { "3|USD": 105 } }),
        inputs,
        keys,
      ),
    ).toThrow();
  });

  it("fails on a wrong amount", () => {
    expect(() =>
      expectPostingsMatchRule(
        rule,
        empty(),
        snap({ supplier: { "7|USD": 100 }, partner: { "3|USD": 105 } }),
        inputs,
        keys,
      ),
    ).toThrow();
  });

  it("fails when a 'none' ledger moves (an extra drawer posting)", () => {
    expect(() =>
      expectPostingsMatchRule(
        rule,
        empty(),
        snap({
          supplier: { "7|USD": 105 },
          partner: { "3|USD": 105 },
          drawers: { "OMT_System|USD": -105 },
        }),
        inputs,
        keys,
      ),
    ).toThrow();
  });

  it("skips an 'unchecked' ledger", () => {
    const loose: PostingRule = {
      ...rule,
      ledgers: { ...rule.ledgers, drawers: { post: "unchecked", reason: "t" } },
    };
    expect(() =>
      expectPostingsMatchRule(
        loose,
        empty(),
        snap({
          supplier: { "7|USD": 105 },
          partner: { "3|USD": 105 },
          drawers: { "OMT_System|USD": -105 },
        }),
        inputs,
        keys,
      ),
    ).not.toThrow();
  });

  it("throws when a role the rule uses has no key", () => {
    expect(() =>
      expectedPostingsForRule(rule, inputs, { providerSupplierId: 7 }),
    ).toThrow(/role "partner"/);
  });

  it("resolves a fixed-currency line regardless of the transaction currency", () => {
    const { expected } = expectedPostingsForRule(
      POSTING_RULES["LOTO/ticket/FOR"],
      { x: 500_000, f: 0, c: 22_250, currency: "LBP" },
      { providerSupplierId: 1, partnerId: 1 },
    );
    expect(expected).toEqual({
      supplier: { "1|LBP": 477_750 },
      partner: { "1|LBP": 500_000 },
    });
  });
});
