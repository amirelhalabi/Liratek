/**
 * LIRA-331 T005: server message templates. P1 only needs the renderer; the
 * catalog fills up per area in P2 (T073–T081).
 */
import {
  SERVER_MESSAGES,
  interpolateTemplate,
  renderServerMessage,
} from "../serverMessages.js";

describe("interpolateTemplate", () => {
  it("fills {{params}} with raw values", () => {
    expect(
      interpolateTemplate("Cannot refund {{requested}} - only {{available}} available", {
        requested: 3,
        available: 1,
      }),
    ).toBe("Cannot refund 3 - only 1 available");
  });

  it("leaves a missing param's placeholder visible instead of crashing", () => {
    expect(interpolateTemplate("Pay {{amount}} {{currency}}", { amount: 5 })).toBe(
      "Pay 5 {{currency}}",
    );
    expect(interpolateTemplate("Pay {{amount}}")).toBe("Pay {{amount}}");
  });
});

describe("renderServerMessage", () => {
  it("renders a known key's English template", () => {
    expect(renderServerMessage("generic.saveFailed")).toBe(
      SERVER_MESSAGES["generic.saveFailed"],
    );
  });
});
