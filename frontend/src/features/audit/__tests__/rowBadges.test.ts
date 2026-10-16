/**
 * Owner decision 2026-10-16 — the Status, Reverses and Ret. Credits columns
 * left the Transactions table; the rare cases now show as small tags in the
 * Summary cell (`rowBadges`), and a normal active row shows none.
 *
 * Labels, colours and the credits format are the removed cells' own
 * (StatusCell / ReversesCell / ReturnedCreditsCell).
 */
import { returnedCreditsText, rowBadges, rowStatus } from "../rowBadges";

type BadgeInput = Parameters<typeof rowBadges>[0];

const active: BadgeInput = {
  status: "ACTIVE",
  reversed_by_id: null,
  reverses_id: null,
};

const labels = (row: BadgeInput) => rowBadges(row).map((b) => b.label);

describe("rowStatus — the removed Status cell's three states", () => {
  it("VOIDED when the row is voided", () => {
    expect(rowStatus({ status: "VOIDED", reversed_by_id: null })).toBe(
      "VOIDED",
    );
  });

  it("REFUNDED for an ACTIVE original that a refund points back to", () => {
    expect(rowStatus({ status: "ACTIVE", reversed_by_id: 42 })).toBe(
      "REFUNDED",
    );
  });

  it("VOIDED wins over a reversal pointer", () => {
    expect(rowStatus({ status: "VOIDED", reversed_by_id: 42 })).toBe("VOIDED");
  });

  it("ACTIVE otherwise", () => {
    expect(rowStatus({ status: "ACTIVE" })).toBe("ACTIVE");
  });
});

describe("returnedCreditsText — the removed Ret. Credits cell's format", () => {
  it("positive: $ prefix, no decimals forced", () => {
    expect(returnedCreditsText(3)).toBe("$3");
    expect(returnedCreditsText(73.5)).toBe("$73.5");
  });

  it("negative (a void/refund's mirror): a real minus sign before the $", () => {
    expect(returnedCreditsText(-73)).toBe("−$73");
  });
});

describe("rowBadges", () => {
  it("a normal active row gets no badge at all", () => {
    expect(rowBadges(active)).toEqual([]);
  });

  it("a voided row gets the VOIDED badge in the old Status cell's red", () => {
    const [badge] = rowBadges({ ...active, status: "VOIDED" });
    expect(badge).toEqual({
      key: "status",
      label: "VOIDED",
      className:
        "bg-red-900/50 text-red-300 text-[10px] px-1.5 py-0.5 rounded font-medium",
    });
  });

  it("a refunded original (still ACTIVE) gets the REFUNDED badge in rose", () => {
    const [badge] = rowBadges({ ...active, reversed_by_id: 9 });
    expect(badge).toEqual({
      key: "status",
      label: "REFUNDED",
      className:
        "bg-rose-900/50 text-rose-300 text-[10px] px-1.5 py-0.5 rounded font-medium",
    });
  });

  it("a reversal row gets ↩ #<id of the row it reverses>", () => {
    expect(labels({ ...active, reverses_id: 1234 })).toEqual(["↩ #1234"]);
  });

  it("credits returned: +$X credits back", () => {
    expect(labels({ ...active, returned_credits_usd: 3 })).toEqual([
      "+$3 credits back",
    ]);
  });

  it("credits mirrored by a void/refund keep their minus sign", () => {
    expect(labels({ ...active, returned_credits_usd: -3 })).toEqual([
      "−$3 credits back",
    ]);
  });

  it("no credits badge when none were returned (absent or 0)", () => {
    expect(labels(active)).toEqual([]);
    expect(labels({ ...active, returned_credits_usd: 0 })).toEqual([]);
  });

  it("several at once, in order: status, reversal, credits", () => {
    expect(
      labels({
        status: "VOIDED",
        reversed_by_id: null,
        reverses_id: 7,
        returned_credits_usd: -2.5,
      }),
    ).toEqual(["VOIDED", "↩ #7", "−$2.5 credits back"]);
  });

  it("the reversal and credits chips share the table's small slate chip look", () => {
    const chip =
      "bg-slate-700 text-slate-200 text-[10px] px-1.5 py-0.5 rounded font-medium";
    const badges = rowBadges({
      ...active,
      reverses_id: 7,
      returned_credits_usd: 3,
    });
    expect(badges.map((b) => b.className)).toEqual([chip, chip]);
  });
});
