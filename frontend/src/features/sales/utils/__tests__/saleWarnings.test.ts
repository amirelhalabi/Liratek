/**
 * LIRA-296 P3 (T048) — a sale that went through with warnings (a WARN
 * category sold without its unit) tells the cashier, one warning toast per
 * line; a sale without warnings shows none.
 */
import { appEvents } from "@liratek/ui";
import { emitSaleWarnings } from "../saleWarnings";

it("shows each warning as a warning notification", () => {
  const spy = jest.spyOn(appEvents, "emit");
  emitSaleWarnings({
    success: true,
    warnings: ['"ThinkPad" was sold without picking which unit.'],
  });
  expect(spy).toHaveBeenCalledWith(
    "notification:show",
    '"ThinkPad" was sold without picking which unit.',
    "warning",
  );
  spy.mockRestore();
});

it("shows nothing when there are no warnings", () => {
  const spy = jest.spyOn(appEvents, "emit");
  emitSaleWarnings({ success: true });
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

// LIRA-306 T137 (FR-013, O-new-2): an offline PC's oversell comes back as a
// sale warning from core (SalesRepository stockAdvisory) and reaches the
// cashier through this same path — no POS-specific branch. Pins the contract;
// not a failing-first guard (the path already existed).
it("shows the offline stock advisory", () => {
  const spy = jest.spyOn(appEvents, "emit");
  const msg = 'Stock count says 0 for "Charger" — sale recorded. The count will be checked when this PC is back online.';
  emitSaleWarnings({ success: true, warnings: [msg] });
  expect(spy).toHaveBeenCalledWith("notification:show", msg, "warning");
  spy.mockRestore();
});
