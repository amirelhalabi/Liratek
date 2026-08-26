import { resolveCartLineMode, shouldAlwaysAddNewLine } from "../cartGate";

describe("resolveCartLineMode", () => {
  it("flag ON with registered units -> unit-picker", () => {
    expect(resolveCartLineMode(1, 3)).toBe("unit-picker");
    expect(resolveCartLineMode(true, 1)).toBe("unit-picker");
  });

  it("flag ON with zero registered units -> none (drift case; no ad-hoc IMEI entry)", () => {
    expect(resolveCartLineMode(1, 0)).toBe("none");
  });

  it("flag OFF -> none, regardless of unit count", () => {
    expect(resolveCartLineMode(0, 5)).toBe("none");
    expect(resolveCartLineMode(null, 5)).toBe("none");
    expect(resolveCartLineMode(undefined, 0)).toBe("none");
    expect(resolveCartLineMode(false, 3)).toBe("none");
  });

  it("never consults category text — the fixed headline trap", () => {
    // resolveCartLineMode's signature doesn't even accept a category, but
    // pin the two flag-driven outcomes a "Headphones" product (the old
    // heuristic's false positive) and a mislabeled real phone category
    // (the old heuristic's false negative) must land on.
    expect(resolveCartLineMode(0, 2)).toBe("none"); // e.g. "Headphones", flag off
    expect(resolveCartLineMode(1, 1)).toBe("unit-picker"); // e.g. "Mobiles", flag on
  });
});

describe("shouldAlwaysAddNewLine", () => {
  it("is true only for unit-picker mode", () => {
    expect(shouldAlwaysAddNewLine("unit-picker")).toBe(true);
    expect(shouldAlwaysAddNewLine("none")).toBe(false);
  });
});
