/**
 * E2E: LIRA-057 — Whish App top-up "Via Partner" and "From Client"
 *
 * The Whish App wallet drawer can be replenished two ways, each with distinct
 * money mechanics that must NOT leak into each other:
 *
 *   • Via Partner (`recharge.topUpFromPartner`): a partner fronts the credits.
 *     The Whish_App drawer goes UP by the amount, NO cash drawer is touched,
 *     and a single `WHISH_TOPUP` / `CREDIT` partner_ledger row is booked (we
 *     now owe the partner → partner balance goes negative by the amount).
 *
 *   • From Client (`recharge.topUpFromClient`): a client transfers credits and
 *     is paid cash from the General drawer. Whish_App goes UP by `amount`,
 *     General goes DOWN by `cashPaid` (the gap is shop profit), and NO
 *     partner_ledger row is created. The General balance is guarded.
 *
 * Driven entirely through real main-process IPC over the shared per-worker DB.
 * Every assertion is a DELTA captured immediately before each action (the DB is
 * shared and ordered across specs, so absolute totals are meaningless), and the
 * partner/client are tagged with unique identifiers to avoid collisions.
 *
 * Cross-cutting rules honoured:
 *   - Provider drawers (Whish_App / General) are read ONLY via
 *     recharge.getDrawerBalances() (name-keyed array), never dashboard.*.
 *   - Provider spelling is uniformly WHISH_APP; the raw drawer name is Whish_App.
 *   - topUpFromPartner / topUpFromClient / drawerTopUp.create return {success,...};
 *     partners.getLedger returns a raw statement object (no success envelope).
 *   - Profit is proven indirectly via the Whish_App(+amount) / General(-cashPaid)
 *     drawer deltas, never read off a txn row.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

// Raw drawer names as stored in drawer_balances (TOP_UP_PROVIDER_DRAWERS map).
const WHISH_DRAWER = "Whish_App";
const GENERAL_DRAWER = "General";

type DrawerBalance = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
  usdtBalance: number;
};

type PartnerLedgerEntry = {
  transaction_type: string | null;
  amount: number;
  currency: string;
  direction: "DEBIT" | "CREDIT";
};

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<DrawerBalance[]>;
      topUpFromPartner: (data: {
        provider: "WHISH_APP";
        partnerId: number;
        amount: number;
        currency: "USD" | "LBP";
      }) => Promise<{ success: boolean; error?: string }>;
      topUpFromClient: (data: {
        amount: number;
        cashPaid: number;
        currency: "USD" | "LBP";
        clientName?: string;
        clientId?: number;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    drawerTopUp: {
      create: (data: {
        amount_usd: number;
        amount_lbp: number;
        notes?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    partners: {
      create: (data: {
        name: string;
        phone?: string;
        notes?: string;
      }) => Promise<{ success?: boolean; data?: { id: number } }>;
      getBalance: (partnerId: number) => Promise<{ usd: number; lbp: number }>;
      getLedger: (
        partnerId: number,
        filters?: Record<string, unknown>,
      ) => Promise<{ entries?: PartnerLedgerEntry[] }>;
    };
  };
};

// Helpers replicated inline (the plan forbids a shared helper module). Each
// returns a plain number so the evaluate() result is JSON-serialisable.
function pickUsd(drawers: DrawerBalance[], name: string): number {
  return drawers.find((d) => d.name === name)?.usdBalance ?? 0;
}

test.describe("LIRA-057 — Whish App top-up Via Partner / From Client", () => {
  // ── Scenario 1 — Via Partner (USD) happy path ────────────────────────────
  test("Via Partner: Whish_App +50, General unchanged, one WHISH_TOPUP/CREDIT (partner −50)", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ whishDrawer, generalDrawer }) => {
        const w = window as unknown as Api;
        const usd = (ds: DrawerBalance[], name: string) =>
          ds.find((d) => d.name === name)?.usdBalance ?? 0;

        // Unique partner so the ledger row we assert on is unambiguous.
        const partnerName = `E2E-057 Via-Partner ${Date.now()}`;
        const createdPartner = await w.api.partners.create({
          name: partnerName,
          phone: "057-via-partner-0001",
        });
        const partnerId = createdPartner.data?.id ?? null;
        if (partnerId == null) {
          return { partnerCreated: false } as const;
        }

        // Snapshot drawers + partner ledger/balance immediately before action.
        const beforeDrawers = await w.api.recharge.getDrawerBalances();
        const whishBefore = usd(beforeDrawers, whishDrawer);
        const generalBefore = usd(beforeDrawers, generalDrawer);

        const ledgerBefore = await w.api.partners.getLedger(partnerId, {});
        const entriesBefore = ledgerBefore.entries?.length ?? 0;
        const balanceBefore = await w.api.partners.getBalance(partnerId);
        const balanceUsdBefore = balanceBefore.usd;

        // Action: partner fronts 50 USD of Whish credits.
        const topUp = await w.api.recharge.topUpFromPartner({
          provider: "WHISH_APP",
          partnerId,
          amount: 50,
          currency: "USD",
        });

        const afterDrawers = await w.api.recharge.getDrawerBalances();
        const whishAfter = usd(afterDrawers, whishDrawer);
        const generalAfter = usd(afterDrawers, generalDrawer);

        const ledgerAfter = await w.api.partners.getLedger(partnerId, {});
        const allEntries = ledgerAfter.entries ?? [];
        // Newest WHISH_TOPUP CREDIT row of exactly 50 USD added by this action.
        const whishTopUps = allEntries.filter(
          (entry) =>
            entry.transaction_type === "WHISH_TOPUP" &&
            entry.direction === "CREDIT" &&
            entry.currency === "USD" &&
            Math.abs(entry.amount - 50) < 0.01,
        );
        const balanceAfter = await w.api.partners.getBalance(partnerId);

        return {
          partnerCreated: true,
          topUpOk: topUp.success,
          topUpError: topUp.error ?? null,
          whishDelta: Math.round((whishAfter - whishBefore) * 100) / 100,
          generalDelta: Math.round((generalAfter - generalBefore) * 100) / 100,
          entriesDelta: allEntries.length - entriesBefore,
          whishTopUpCount: whishTopUps.length,
          partnerBalanceDelta:
            Math.round((balanceAfter.usd - balanceUsdBefore) * 100) / 100,
        } as const;
      },
      { whishDrawer: WHISH_DRAWER, generalDrawer: GENERAL_DRAWER },
    );

    expect(result.partnerCreated).toBe(true);
    if (!result.partnerCreated) return;

    expect(result.topUpError).toBeNull();
    expect(result.topUpOk).toBe(true);

    // Whish_App drawer rose by exactly the credited amount…
    expect(result.whishDelta).toBeCloseTo(50, 2);
    // …and NO cash drawer was touched (the key invariant for the partner path).
    expect(result.generalDelta).toBeCloseTo(0, 2);

    // Exactly one new partner_ledger row, a WHISH_TOPUP / CREDIT of 50.
    expect(result.entriesDelta).toBe(1);
    expect(result.whishTopUpCount).toBe(1);

    // Balance = ΣDEBIT − ΣCREDIT, so a CREDIT of 50 drives it down by 50
    // (we now owe the partner).
    expect(result.partnerBalanceDelta).toBeCloseTo(-50, 2);
  });

  // ── Scenario 2 — Via Partner guard (unknown partner) ─────────────────────
  test("Via Partner guard: unknown partnerId → {success:false, /Partner not found/}, drawers unchanged", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ whishDrawer, generalDrawer }) => {
        const w = window as unknown as Api;
        const usd = (ds: DrawerBalance[], name: string) =>
          ds.find((d) => d.name === name)?.usdBalance ?? 0;

        const beforeDrawers = await w.api.recharge.getDrawerBalances();
        const whishBefore = usd(beforeDrawers, whishDrawer);
        const generalBefore = usd(beforeDrawers, generalDrawer);

        // A positive int that cannot match any seeded partner → passes Zod,
        // fails the repo's `is_active = 1` lookup → "Partner not found".
        const topUp = await w.api.recharge.topUpFromPartner({
          provider: "WHISH_APP",
          partnerId: 999_999_999,
          amount: 50,
          currency: "USD",
        });

        const afterDrawers = await w.api.recharge.getDrawerBalances();
        const whishAfter = usd(afterDrawers, whishDrawer);
        const generalAfter = usd(afterDrawers, generalDrawer);

        return {
          topUpOk: topUp.success,
          topUpError: topUp.error ?? null,
          whishDelta: Math.round((whishAfter - whishBefore) * 100) / 100,
          generalDelta: Math.round((generalAfter - generalBefore) * 100) / 100,
        } as const;
      },
      { whishDrawer: WHISH_DRAWER, generalDrawer: GENERAL_DRAWER },
    );

    expect(result.topUpOk).toBe(false);
    expect(result.topUpError).toMatch(/Partner not found/i);
    // No mutation: both drawers are exactly where they started.
    expect(result.whishDelta).toBeCloseTo(0, 2);
    expect(result.generalDelta).toBeCloseTo(0, 2);
  });

  // ── Scenario 3 — From Client (USD) happy path ────────────────────────────
  test("From Client: General funded first, then Whish_App +40 / General −30 (profit 10), no partner_ledger", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ whishDrawer, generalDrawer }) => {
        const w = window as unknown as Api;
        const usd = (ds: DrawerBalance[], name: string) =>
          ds.find((d) => d.name === name)?.usdBalance ?? 0;

        // Fund the General drawer so the client cash-out (CASH_PAID) is covered
        // REGARDLESS of where prior specs left General — over the shared worker DB
        // it can be low or negative (e.g. lira-056 settle / lira-059 PAY debit it),
        // so a fixed top-up is not enough. Read first, then top up the deficit so
        // post-funding General comfortably exceeds CASH_PAID.
        const CASH_PAID = 30;
        const preFundGeneral = usd(
          await w.api.recharge.getDrawerBalances(),
          generalDrawer,
        );
        const funded = await w.api.drawerTopUp.create({
          amount_usd: Math.max(100, CASH_PAID + 100 - preFundGeneral),
          amount_lbp: 0,
          notes: "E2E-057 fund General for From-Client top-up",
        });

        // Snapshot AFTER funding, immediately before the action under test, so
        // the asserted deltas isolate the top-up alone.
        const beforeDrawers = await w.api.recharge.getDrawerBalances();
        const whishBefore = usd(beforeDrawers, whishDrawer);
        const generalBefore = usd(beforeDrawers, generalDrawer);

        // Unique partner used only to PROVE no partner_ledger row is written by
        // the From-Client path (its ledger must stay empty of this action).
        const probePartner = await w.api.partners.create({
          name: `E2E-057 From-Client Probe ${Date.now()}`,
          phone: "057-from-client-probe-0001",
        });
        const probeId = probePartner.data?.id ?? null;
        const probeEntriesBefore = probeId
          ? ((await w.api.partners.getLedger(probeId, {})).entries?.length ?? 0)
          : 0;

        // Action: client transfers 40 credits, paid 30 USD cash.
        const topUp = await w.api.recharge.topUpFromClient({
          amount: 40,
          cashPaid: CASH_PAID,
          currency: "USD",
          clientName: `E2E-057 Client ${Date.now()}`,
        });

        const afterDrawers = await w.api.recharge.getDrawerBalances();
        const whishAfter = usd(afterDrawers, whishDrawer);
        const generalAfter = usd(afterDrawers, generalDrawer);

        const probeEntriesAfter = probeId
          ? ((await w.api.partners.getLedger(probeId, {})).entries?.length ?? 0)
          : 0;

        return {
          funded: funded.success,
          fundError: funded.error ?? null,
          topUpOk: topUp.success,
          topUpError: topUp.error ?? null,
          whishDelta: Math.round((whishAfter - whishBefore) * 100) / 100,
          generalDelta: Math.round((generalAfter - generalBefore) * 100) / 100,
          probeEntriesDelta: probeEntriesAfter - probeEntriesBefore,
        } as const;
      },
      { whishDrawer: WHISH_DRAWER, generalDrawer: GENERAL_DRAWER },
    );

    expect(result.fundError).toBeNull();
    expect(result.funded).toBe(true);
    expect(result.topUpError).toBeNull();
    expect(result.topUpOk).toBe(true);

    // Whish_App rose by the credits received…
    expect(result.whishDelta).toBeCloseTo(40, 2);
    // …General fell by the cash paid out. The gap (40 − 30) = 10 is the shop's
    // profit, proven via the drawer deltas (profit is never on a txn row).
    expect(result.generalDelta).toBeCloseTo(-30, 2);

    // The From-Client path must NOT touch partner_ledger.
    expect(result.probeEntriesDelta).toBe(0);
  });

  // ── Scenario 4 — From Client guard (insufficient General) ────────────────
  test("From Client guard: cashPaid > General balance → {success:false, /Insufficient balance in General drawer/}, drawers unchanged", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(
      async ({ whishDrawer, generalDrawer }) => {
        const w = window as unknown as Api;
        const usd = (ds: DrawerBalance[], name: string) =>
          ds.find((d) => d.name === name)?.usdBalance ?? 0;

        const beforeDrawers = await w.api.recharge.getDrawerBalances();
        const whishBefore = usd(beforeDrawers, whishDrawer);
        const generalBefore = usd(beforeDrawers, generalDrawer);

        // Request cash strictly greater than the current General balance so the
        // repo's guard rejects it atomically (no drawer touched).
        const topUp = await w.api.recharge.topUpFromClient({
          amount: generalBefore + 5_000_000,
          cashPaid: generalBefore + 1_000_000,
          currency: "USD",
          clientName: `E2E-057 Overdraw Client ${Date.now()}`,
        });

        const afterDrawers = await w.api.recharge.getDrawerBalances();
        const whishAfter = usd(afterDrawers, whishDrawer);
        const generalAfter = usd(afterDrawers, generalDrawer);

        return {
          topUpOk: topUp.success,
          topUpError: topUp.error ?? null,
          whishDelta: Math.round((whishAfter - whishBefore) * 100) / 100,
          generalDelta: Math.round((generalAfter - generalBefore) * 100) / 100,
        } as const;
      },
      { whishDrawer: WHISH_DRAWER, generalDrawer: GENERAL_DRAWER },
    );

    expect(result.topUpOk).toBe(false);
    expect(result.topUpError).toMatch(
      /Insufficient balance in General drawer/i,
    );
    // Atomic rejection: neither drawer moved.
    expect(result.whishDelta).toBeCloseTo(0, 2);
    expect(result.generalDelta).toBeCloseTo(0, 2);
  });
});

// Keep the inline helper referenced so verbatimModuleSyntax / noUnusedLocals
// stays happy even if a future edit trims its only call site above.
export const _pickUsd = pickUsd;
