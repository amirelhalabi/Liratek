/**
 * LIRA-323 guard — the Type-filter options tagged `paid_via_drawer` and
 * core's `PAID_VIA_DRAWER_OWN_TUPLES` (what the repository and the client
 * twin treat as a wallet's "own" rows) must be the SAME set, per drawer, in
 * both directions. If a fifth OMT App option is added without its tag, or a
 * tag without the core tuple, the drawer route would add that option's own
 * rows under the wallet's other options (or never add them) — this fails
 * first.
 */
import {
  PAID_VIA_ACCOUNT_OWN_TUPLES,
  PAID_VIA_VOUCHER_OWN_TUPLES,
  PAID_VIA_DRAWERS,
  PAID_VIA_DRAWER_OWN_TUPLES,
  type PaidViaDrawer,
} from "@liratek/core";
import { ALL_FILTER_OPTIONS } from "../auditConstants";

const key = (t: {
  type?: string;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
}) =>
  JSON.stringify([
    t.type ?? null,
    t.provider ?? null,
    t.service_type ?? null,
    t.has_item_key ?? null,
  ]);

describe("paid_via_drawer options ↔ core PAID_VIA_DRAWER_OWN_TUPLES", () => {
  it.each(PAID_VIA_DRAWERS.map((d) => [d]))(
    "%s: tagged options are exactly core's own tuples",
    (drawer) => {
      const tagged = ALL_FILTER_OPTIONS.filter(
        (o) => o.paid_via_drawer === drawer,
      )
        .map(key)
        .sort();
      const own = PAID_VIA_DRAWER_OWN_TUPLES[drawer as PaidViaDrawer]
        .map(key)
        .sort();
      expect(tagged.length).toBeGreaterThan(0);
      expect(tagged).toEqual(own);
    },
  );

  it("no option is tagged with a drawer core does not know", () => {
    for (const o of ALL_FILTER_OPTIONS) {
      if (o.paid_via_drawer) {
        expect(PAID_VIA_DRAWERS).toContain(o.paid_via_drawer);
      }
    }
  });
});

describe("paid_via_account options ↔ core PAID_VIA_ACCOUNT_OWN_TUPLES", () => {
  it("tagged options are exactly core's own tuples (the Debts group)", () => {
    const tagged = ALL_FILTER_OPTIONS.filter((o) => o.paid_via_account)
      .map(key)
      .sort();
    const own = PAID_VIA_ACCOUNT_OWN_TUPLES.map(key).sort();
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged).toEqual(own);
  });
});

describe("paid_via_voucher options ↔ core PAID_VIA_VOUCHER_OWN_TUPLES", () => {
  it("tagged options are exactly core's own tuples (the Vouchers group)", () => {
    const tagged = ALL_FILTER_OPTIONS.filter((o) => o.paid_via_voucher)
      .map(key)
      .sort();
    const own = PAID_VIA_VOUCHER_OWN_TUPLES.map(key).sort();
    expect(tagged.length).toBeGreaterThan(0);
    expect(tagged).toEqual(own);
  });
});
