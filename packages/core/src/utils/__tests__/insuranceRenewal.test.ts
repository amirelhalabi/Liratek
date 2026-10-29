/**
 * LIRA-360 — insurance renewal reminders: expiry day, window, renewal rule.
 *
 * RULE 17 — written before `utils/insuranceRenewal.ts` existed.
 */
import {
  insuranceExpiryDay,
  selectInsuranceRenewals,
  type InsuranceRenewalCandidate,
} from "../insuranceRenewal";

const TODAY = "2026-10-29";

let nextId = 1;
function row(
  over: Partial<InsuranceRenewalCandidate> = {},
): InsuranceRenewalCandidate {
  return {
    id: nextId++,
    client_id: null,
    client_name: "Ali",
    phone_number: "70123456",
    description: "Insurance",
    insurance_type: "COMPULSORY",
    sale_day: "2025-11-03",
    renewal_dismissed_at: null,
    ...over,
  };
}

describe("insuranceExpiryDay", () => {
  it("is the sale day plus one calendar year", () => {
    expect(insuranceExpiryDay("2025-11-03")).toBe("2026-11-03");
  });
  it("clamps 29 February to 28 February", () => {
    expect(insuranceExpiryDay("2024-02-29")).toBe("2025-02-28");
  });
});

describe("selectInsuranceRenewals — window", () => {
  it.each([
    ["2025-11-06", null],
    ["2025-11-05", 7],
    ["2025-10-29", 0],
    ["2025-10-28", -1],
    ["2025-06-01", -150],
    ["2024-02-29", -608],
  ])("sale %s → days_left %s", (sale_day, daysLeft) => {
    const out = selectInsuranceRenewals([row({ sale_day })], TODAY);
    if (daysLeft === null) {
      expect(out).toEqual([]);
    } else {
      expect(out).toHaveLength(1);
      expect(out[0].days_left).toBe(daysLeft);
      expect(out[0].expiry_day).toBe(insuranceExpiryDay(sale_day));
    }
  });

  it("drops a dismissed insurance", () => {
    expect(
      selectInsuranceRenewals(
        [row({ renewal_dismissed_at: "2026-10-20 10:00:00" })],
        TODAY,
      ),
    ).toEqual([]);
  });

  it("sorts most overdue first, then soonest", () => {
    const a = row({ sale_day: "2025-11-02", phone_number: "71000001" });
    const b = row({ sale_day: "2025-06-01", phone_number: "71000002" });
    const c = row({ sale_day: "2025-10-30", phone_number: "71000003" });
    expect(
      selectInsuranceRenewals([a, b, c], TODAY).map((r) => r.id),
    ).toEqual([b.id, c.id, a.id]);
  });
});

describe("selectInsuranceRenewals — renewal", () => {
  it("a later same-type sale to the same saved client renews", () => {
    const old = row({ client_id: 5, phone_number: null });
    const renewal = row({
      client_id: 5,
      phone_number: null,
      sale_day: "2026-10-25",
    });
    expect(selectInsuranceRenewals([old, renewal], TODAY)).toEqual([]);
  });

  it("matches a walk-in by phone whatever the format", () => {
    const old = row({ phone_number: "70123456" });
    const renewal = row({
      phone_number: "+961 70 123 456",
      sale_day: "2026-10-25",
    });
    expect(selectInsuranceRenewals([old, renewal], TODAY)).toEqual([]);
  });

  it("a different type does not renew", () => {
    const old = row({ insurance_type: "COMPULSORY" });
    const life = row({ insurance_type: "LIFE", sale_day: "2026-10-25" });
    expect(
      selectInsuranceRenewals([old, life], TODAY).map((r) => r.id),
    ).toEqual([old.id]);
  });

  it("an untyped older sale is renewed by any type", () => {
    const old = row({ insurance_type: null });
    const life = row({ insurance_type: "LIFE", sale_day: "2026-10-25" });
    expect(selectInsuranceRenewals([old, life], TODAY)).toEqual([]);
  });

  it("an untyped later sale does not renew a typed one", () => {
    const old = row({ insurance_type: "COMPULSORY" });
    const later = row({ insurance_type: null, sale_day: "2026-10-25" });
    expect(
      selectInsuranceRenewals([old, later], TODAY).map((r) => r.id),
    ).toEqual([old.id]);
  });

  it("a different customer does not renew", () => {
    const old = row({ phone_number: "70123456" });
    const other = row({ phone_number: "03111222", sale_day: "2026-10-25" });
    expect(
      selectInsuranceRenewals([old, other], TODAY).map((r) => r.id),
    ).toEqual([old.id]);
  });

  it("no name and no phone never matches anyone", () => {
    const old = row({ client_name: null, phone_number: null });
    const later = row({
      client_name: null,
      phone_number: null,
      sale_day: "2026-10-25",
    });
    expect(
      selectInsuranceRenewals([old, later], TODAY).map((r) => r.id),
    ).toEqual([old.id]);
  });

  it("two old unrenewed sales of the same type list only the newest", () => {
    const older = row({ sale_day: "2024-10-01" });
    const newer = row({ sale_day: "2025-10-01" });
    expect(
      selectInsuranceRenewals([older, newer], TODAY).map((r) => r.id),
    ).toEqual([newer.id]);
  });

  it("same sale day: the higher id is the later sale", () => {
    const first = row({ sale_day: "2025-10-01" });
    const second = row({ sale_day: "2025-10-01" });
    expect(
      selectInsuranceRenewals([second, first], TODAY).map((r) => r.id),
    ).toEqual([second.id]);
  });

  it("a dismissed later sale still counts as the renewal", () => {
    const old = row({});
    const renewal = row({
      sale_day: "2026-10-25",
      renewal_dismissed_at: "2026-10-26 09:00:00",
    });
    expect(selectInsuranceRenewals([old, renewal], TODAY)).toEqual([]);
  });
});
