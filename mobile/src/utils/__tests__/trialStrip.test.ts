/**
 * LIRA-332 US5 — the phone's trial strip: the same states and words as the
 * web banner (contracts/ui-trial.md), and the same WhatsApp link builder.
 * The decision lives in a pure module (`utils/trialStrip.ts`); the
 * `TrialStrip` component only draws it and opens `url` with Linking.
 *
 * Not proven failing-first (new contract).
 */

import { buildActivationWhatsAppUrl } from "@liratek/core/utils/activationLink";

import { trialStripModel, type TrialStatus } from "../trialStrip";

const SHOP = { name: "Abou Ali Phones", address: "abouali.liratek.shop" };
const URL = buildActivationWhatsAppUrl({ shopName: SHOP.name, shopAddress: SHOP.address });

function trial(daysLeft: number): TrialStatus {
  return {
    standing: "trial",
    trial: {
      endsAt: "2026-11-01T22:00:00.000Z",
      lastDay: "2026-11-01",
      daysLeft,
      endsSoon: daysLeft <= 3,
      ended: false,
    },
    shop: SHOP,
  };
}

describe("trialStripModel", () => {
  it("12 days left", () => {
    expect(trialStripModel(trial(12))).toEqual({
      tone: "neutral",
      text: "Free trial: 12 days left",
      button: "Contact us to activate",
      url: URL,
    });
  });

  it("the last day", () => {
    expect(trialStripModel(trial(1))).toMatchObject({
      tone: "warning",
      text: "Last day of your free trial (ends tonight, 2026-11-01).",
    });
  });

  it("ends soon (3 days)", () => {
    expect(trialStripModel(trial(3))).toMatchObject({
      tone: "warning",
      text: "Your free trial ends soon: 3 days left, last day 2026-11-01.",
    });
  });

  it("ended", () => {
    expect(
      trialStripModel({
        standing: "trial_ended",
        trial: { ...trial(0).trial!, daysLeft: 0, ended: true },
        shop: SHOP,
      }),
    ).toEqual({
      tone: "danger",
      text: "Your free trial has ended. You can still sign in, see and export everything. To keep adding sales and records, contact LiraTek on WhatsApp to activate.",
      button: "Contact LiraTek on WhatsApp",
      url: URL,
    });
  });

  it.each([
    ["active", { standing: "active", trial: null, shop: SHOP }],
    ["grace", { standing: "grace", trial: null, shop: SHOP }],
    ["null", null],
  ] as const)("%s → nothing", (_label, status) => {
    expect(trialStripModel(status as TrialStatus | null)).toBeNull();
  });
});
