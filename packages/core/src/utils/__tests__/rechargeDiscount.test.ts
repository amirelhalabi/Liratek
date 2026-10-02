/**
 * LIRA-185 owner decision #1 follow-up (2026-10-02) — "cap = margin − SMS
 * fee". Pure-function coverage for `maxRechargeDiscount`/`applyRechargeDiscount`'s
 * `extraFee` parameter, which `RechargeRepository.processRecharge` feeds with
 * the CREDIT_TRANSFER SMS cost (converted to the sale's own currency) and
 * every other caller leaves at its default (0, unchanged plain-margin cap).
 * The repository-level proof (real writers, real SMS expense row, real net
 * check) lives in `RechargeRepository.discount.test.ts`; this file is the
 * narrower, faster boundary-math check on the shared helper itself.
 */
import { maxRechargeDiscount, applyRechargeDiscount } from "../rechargeDiscount";

describe("maxRechargeDiscount", () => {
  it("defaults extraFee to 0 — plain margin, unchanged for every existing caller", () => {
    expect(maxRechargeDiscount(300_000, 255_000)).toBe(45_000);
  });

  it("subtracts extraFee from the margin", () => {
    expect(maxRechargeDiscount(300_000, 255_000, 14_400)).toBe(30_600);
  });

  it("never goes negative, even when extraFee alone exceeds the margin", () => {
    expect(maxRechargeDiscount(300_000, 255_000, 100_000)).toBe(0);
  });

  it("never goes negative when cost alone already exceeds price", () => {
    expect(maxRechargeDiscount(100, 150, 0)).toBe(0);
  });
});

describe("applyRechargeDiscount — extraFee-aware cap", () => {
  it("a discount under the SMS-aware cap is accepted at face value", () => {
    const r = applyRechargeDiscount(300_000, 255_000, 20_000, 14_400);
    expect(r).toEqual({ ok: true, chargedPrice: 280_000, discount: 20_000 });
  });

  it("a discount exactly at the SMS-aware cap is accepted", () => {
    const r = applyRechargeDiscount(300_000, 255_000, 30_600, 14_400);
    expect(r).toEqual({ ok: true, chargedPrice: 269_400, discount: 30_600 });
  });

  it("a discount one unit above the SMS-aware cap is rejected, even though it is still under the PLAIN margin", () => {
    const r = applyRechargeDiscount(300_000, 255_000, 30_601, 14_400);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/SMS transfer fee/i);
    expect(!r.ok && r.error).toMatch(/30,600/);
  });

  it("extraFee omitted (0) behaves exactly as the pre-SMS-aware cap — margin alone", () => {
    const r = applyRechargeDiscount(300_000, 255_000, 45_000);
    expect(r).toEqual({ ok: true, chargedPrice: 255_000, discount: 45_000 });
    const over = applyRechargeDiscount(300_000, 255_000, 45_001);
    expect(over.ok).toBe(false);
  });

  it("no discount given (undefined/0) charges the list price regardless of extraFee", () => {
    expect(applyRechargeDiscount(300_000, 255_000, undefined, 14_400)).toEqual(
      { ok: true, chargedPrice: 300_000, discount: 0 },
    );
    expect(applyRechargeDiscount(300_000, 255_000, 0, 14_400)).toEqual({
      ok: true,
      chargedPrice: 300_000,
      discount: 0,
    });
  });
});
