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
