/**
 * LIRA-309 (US2, T026) — expiry alerts for lines held for sale.
 *
 * Owner rule 2026-10-11: amber 3 days before expiry, red during the 5-day
 * grace ("N days left to save it"), and once lost a red "write off?" prompt
 * until the owner writes it off. Sold lines and lines with no expiry raise
 * nothing. Shop lines keep their own existing alerts (carrierLineAlerts.ts,
 * 7 days) — untouched here.
 *
 * Written before the module existed; first run failed with "Cannot find
 * module '../resaleLineAlerts'".
 */
import type { ResaleLineRow } from "@liratek/core";
import {
  computeResaleLineAlerts,
  resaleLineAlertText,
} from "../resaleLineAlerts";

const TODAY = "2026-10-12";

function addDays(n: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function line(over: Partial<ResaleLineRow>): ResaleLineRow {
  return {
    product_id: 1,
    phone_number: "70444202",
    name: "Alfa line 70 444 202",
    category: "Phone Lines",
    cost_price_usd: 12,
    selling_price_usd: 20,
    stock_quantity: 1,
    is_unsold: 1,
    resale_line_id: 1,
    carrier: "alfa",
    credits: 0,
    validity_expires_at: addDays(2),
    ...over,
  };
}

describe("computeResaleLineAlerts (LIRA-309)", () => {
  it("fires at 3 days left, not at 4", () => {
    expect(computeResaleLineAlerts([line({ validity_expires_at: addDays(3) })], TODAY, true)).toEqual([
      expect.objectContaining({ kind: "expiring", daysLeft: 3, productId: 1 }),
    ]);
    expect(computeResaleLineAlerts([line({ validity_expires_at: addDays(4) })], TODAY, true)).toEqual([]);
  });

  it("is red in grace with the days left to save it", () => {
    const [a] = computeResaleLineAlerts([line({ validity_expires_at: addDays(-2) })], TODAY, true);
    expect(a).toEqual(expect.objectContaining({ kind: "grace", daysToSave: 3 }));
    expect(resaleLineAlertText(a)).toBe(
      "Line for sale 70444202 (Alfa) expired — 3 days left to save it",
    );
  });

  it("asks to write off a lost line", () => {
    const [a] = computeResaleLineAlerts([line({ validity_expires_at: addDays(-6) })], TODAY, true);
    expect(a.kind).toBe("lost");
    expect(resaleLineAlertText(a)).toBe("Line for sale 70444202 (Alfa) is lost — write it off?");
  });

  it("words an expiring line plainly", () => {
    const [a] = computeResaleLineAlerts([line({})], TODAY, true);
    expect(resaleLineAlertText(a)).toBe("Line for sale 70444202 (Alfa) expires in 2 days");
    const [today] = computeResaleLineAlerts([line({ validity_expires_at: TODAY })], TODAY, true);
    expect(resaleLineAlertText(today)).toBe("Line for sale 70444202 (Alfa) expires today");
  });

  it("raises nothing for a sold line, a line with no expiry, or with recharge off", () => {
    expect(computeResaleLineAlerts([line({ is_unsold: 0 })], TODAY, true)).toEqual([]);
    expect(computeResaleLineAlerts([line({ validity_expires_at: null })], TODAY, true)).toEqual([]);
    expect(computeResaleLineAlerts([line({})], TODAY, false)).toEqual([]);
  });

  it("gives every alert a stable key per line, status and day (for the bell)", () => {
    const [a] = computeResaleLineAlerts([line({ product_id: 9 })], TODAY, true);
    expect(a.key).toBe("resale:9:expiring:2026-10-12");
  });
});
