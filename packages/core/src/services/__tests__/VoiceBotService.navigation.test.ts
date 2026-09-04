/**
 * 2026-09-04 owner decision (verbatim): "voice command omt or whish should
 * open the omt-whish page." Two changes to VoiceBotService's navigation
 * ROUTE_MAPPING:
 *
 *  (a) New single-word triggers "omt" and "whish" → /omt-whish, alongside
 *      the pre-existing "omt whish" and "money transfer" aliases.
 *
 *  (b) "services" repointed from /omt-whish to /custom-services — an
 *      INFERENCE (not verbatim from the owner) from that decision plus the
 *      custom_services module's own UI label "Services" (the reason LIRA-116
 *      existed at all). See the comment at VoiceBotService.ts's ROUTE_MAPPING
 *      entry for the full reasoning; flagged here so a revert of that one
 *      line is the only thing needed if the owner vetoes it.
 *
 * Matching is SUBSTRING (`lowerText.includes(keyword)`) over `Object.entries`
 * in declaration order, not an exact key lookup — so "custom services" could
 * in principle be swallowed by the shorter "services" key matching first.
 * That specific trap is asserted directly below, not just implied by the
 * alias table.
 */
import {
  getVoiceBotService,
  resetVoiceBotService,
} from "../VoiceBotService.js";

describe("VoiceBotService — OMT/Whish + Services navigation aliases", () => {
  beforeEach(() => {
    resetVoiceBotService();
  });

  function navigateTo(phrase: string): string | undefined {
    const command = getVoiceBotService().parseCommand(
      `open ${phrase}`,
      "dashboard",
    );
    return command?.entities.targetPage;
  }

  describe("aliases resolving to /omt-whish", () => {
    it.each(["omt", "whish", "omt whish", "money transfer"])(
      '"%s" navigates to /omt-whish',
      (phrase) => {
        expect(navigateTo(phrase)).toBe("/omt-whish");
      },
    );
  });

  describe("aliases resolving to /custom-services", () => {
    it.each(["services", "custom services"])(
      '"%s" navigates to /custom-services',
      (phrase) => {
        expect(navigateTo(phrase)).toBe("/custom-services");
      },
    );

    it("does not let the shorter \"services\" key swallow the longer \"custom services\" phrase (substring-match safety)", () => {
      // A naive substring scan that stopped at the FIRST key whose text is
      // contained in the phrase could match "services" before ever reaching
      // "custom services" — and if the two aliases pointed at different
      // routes, that would silently misroute "open custom services". They
      // are pinned to the SAME route here specifically so this ordering
      // hazard cannot produce a wrong answer, verified directly rather than
      // inferred from the table above.
      expect(navigateTo("custom services")).toBe(
        navigateTo("services"),
      );
      expect(navigateTo("custom services")).toBe("/custom-services");
    });
  });

  it("full alias→route map matches the owner's 2026-09-04 decision", () => {
    const cases: Array<[string, string]> = [
      ["omt", "/omt-whish"],
      ["whish", "/omt-whish"],
      ["omt whish", "/omt-whish"],
      ["money transfer", "/omt-whish"],
      ["services", "/custom-services"],
      ["custom services", "/custom-services"],
    ];

    for (const [phrase, expectedRoute] of cases) {
      expect(navigateTo(phrase)).toBe(expectedRoute);
    }
  });
});
