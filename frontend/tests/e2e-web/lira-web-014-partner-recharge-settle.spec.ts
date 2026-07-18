/**
 * lira-web-014 — partner "FOR" mobile recharge + settle + moveCash
 * adjustment, all over REST (the web-transport hardening pass, rule 19c).
 *
 * Guards two REST routes that historically diverged from the IPC envelope
 * contract (500-only error handling, no actor injection):
 *
 *  - POST /api/recharge/process now injects `userId` from the JWT (never
 *    trusted from the client body) and returns the IPC-identical envelope
 *    (HTTP 200, `{ success: false, error }` on a business-rule failure)
 *    instead of a bare HTTP 400.
 *  - POST /api/services/transactions gets the same two fixes (not exercised
 *    directly here — see services.ts — but sharing the identical pattern).
 *
 * Money routing mirrors the desktop lira-115 (PFT-R, full-amount model): a
 * recharge "FOR" a partner takes no counter cash — the FULL price books to
 * partner_ledger as a DEBIT (partner owes the shop), settled later on the
 * Partners page. This spec drives that same core routing over HTTP:
 *
 *   1. create a partner (POST /api/partners)
 *   2. process a $77.31 MTC VOUCHER recharge "FOR" the partner (no payment
 *      legs) → partner balance rises by exactly $77.31 (identity: the FULL
 *      price, not a remainder — PFT-R superseded the old remainder model).
 *   3. settle $77.31 CASH → server computes the CREDIT direction from the
 *      positive balance → balance returns to ~0.
 *   4. record a manual $15 DEBIT ADJUSTMENT with `moveCash: true` → the
 *      ledger balance rises by exactly $15 (this part lands whether or not
 *      moveCash survives — it only gates the drawer side effect), AND the
 *      General drawer is debited by exactly $15 — the load-bearing assert,
 *      only true if partnerRecordTransactionSchema actually carries
 *      `moveCash` through to PartnerService.recordPartnerTransaction's
 *      applyCoverage/recordSettlementMoneyMovement path instead of silently
 *      stripping it.
 *
 * Identity + delta asserts only (rule 15) — the e2e DB accumulates across
 * runs, so every partner is created fresh with a unique name/phone and every
 * assertion is a delta on that partner's own balance, never an absolute
 * cross-run total.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test("partner FOR-recharge books the full price, settles, and a moveCash adjustment lands — all over REST", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const ts = Date.now();
  const NAME = `L-web-014 Partner ${ts}`;

  // Seed partner — unique name/phone, the e2e DB accumulates across runs.
  const partner = await (
    await page.request.post(`${BACKEND_URL}/api/partners`, {
      headers: auth,
      data: { name: NAME, phone: `Lweb014${ts}`.slice(0, 15) },
    })
  ).json();
  expect(partner.success, JSON.stringify(partner)).toBeTruthy();
  const partnerId = partner.data.id as number;
  expect(partnerId).toBeTruthy();

  const balOf = async (): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/partners/${partnerId}/balance`,
        { headers: auth },
      )
    ).json();
    expect(r.success).toBeTruthy();
    return r.balance.usd as number;
  };
  // General drawer: CASH (the settle's settlementMethod, and the moveCash
  // adjustment's implicit default) maps to "General" (FALLBACK_DRAWER_MAP /
  // the payment_methods seed row) — same drawer lira-web-013 already asserts.
  const generalDrawerUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success).toBeTruthy();
    return r.balances.generalDrawer.usd as number;
  };

  const balBefore = await balOf();

  // Action: a $77.31 MTC VOUCHER recharge done "FOR" the partner — no
  // walk-in customer, no counter cash, no `payments` array at all. The FULL
  // price books straight to the partner's tab (PFT-R full-amount model).
  const recharge = await (
    await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
      headers: auth,
      data: {
        provider: "MTC",
        type: "VOUCHER",
        amount: 77.31,
        cost: 50,
        price: 77.31,
        currency: "USD",
        partnerId,
        partnerMode: "FOR",
      },
    })
  ).json();
  expect(recharge.success, JSON.stringify(recharge)).toBeTruthy();

  // Routing: the partner owes the FULL $77.31 — no remainder math, no
  // counter cash collected first (identity: the exact priced amount).
  const balAfterRecharge = await balOf();
  expect(balAfterRecharge - balBefore).toBeCloseTo(77.31, 2);

  // Settle the $77.31 — the server computes CREDIT from the positive
  // balance, netting the partner back to their pre-recharge balance.
  const settled = await (
    await page.request.post(`${BACKEND_URL}/api/partners/settle`, {
      headers: auth,
      data: {
        partnerId,
        amount: 77.31,
        currency: "USD",
        settlementMethod: "CASH",
      },
    })
  ).json();
  expect(settled.success, JSON.stringify(settled)).toBeTruthy();

  const balAfterSettle = await balOf();
  expect(balAfterSettle - balBefore).toBeCloseTo(0, 2);

  // Manual $15 DEBIT ADJUSTMENT with moveCash: true — proves the field
  // survives partnerRecordTransactionSchema into
  // PartnerService.recordPartnerTransaction rather than being silently
  // dropped by the REST validator. The ledger balance delta (+15) lands
  // either way (moveCash only gates the coverage/drawer side effect), so the
  // load-bearing assert is the General drawer: moveCash: true books an
  // auditable PARTNER_PAYMENT (DEBIT = cash OUT to the partner) that a
  // stripped/ignored field would never write. Snapshot bracketed tight to
  // this one call — the settle step above already moved General by +77.31.
  const drawerBeforeAdjustment = await generalDrawerUsd();

  const adjusted = await (
    await page.request.post(`${BACKEND_URL}/api/partners/transactions`, {
      headers: auth,
      data: {
        partnerId,
        transactionType: "ADJUSTMENT",
        amount: 15,
        currency: "USD",
        direction: "DEBIT",
        moveCash: true,
      },
    })
  ).json();
  expect(adjusted.success, JSON.stringify(adjusted)).toBeTruthy();

  const balAfterAdjustment = await balOf();
  expect(balAfterAdjustment - balBefore).toBeCloseTo(15, 2);

  // The load-bearing assert: moveCash survived the REST validator into
  // recordPartnerTransaction → applyCoverage/recordSettlementMoneyMovement,
  // debiting the General drawer by exactly $15 (cash paid OUT to the
  // partner). If the REST validator silently dropped `moveCash`, this delta
  // would be 0 while the balance assert above stayed green regardless.
  const drawerAfterAdjustment = await generalDrawerUsd();
  expect(drawerAfterAdjustment - drawerBeforeAdjustment).toBeCloseTo(-15, 2);
});

/**
 * CQ-11 — partner settlement via split payment legs (MultiPaymentInput),
 * the new capability the Partners page's SettleModal gained this ticket.
 * Both legs are CASH (rather than guessing a second method's seeded drawer
 * name) — the point being proven is the `payments[]` contract itself: legs
 * must sum to `amount`, and the combined drawer delta must equal a single
 * full-amount CASH settle would produce, whether posted as one leg or two.
 */
test("partner settlement via split CASH legs sums correctly and books one combined drawer delta", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const ts = Date.now();
  const NAME = `L-web-014b Partner ${ts}`;

  const partner = await (
    await page.request.post(`${BACKEND_URL}/api/partners`, {
      headers: auth,
      data: { name: NAME, phone: `Lweb014b${ts}`.slice(0, 15) },
    })
  ).json();
  expect(partner.success, JSON.stringify(partner)).toBeTruthy();
  const partnerId = partner.data.id as number;

  const balOf = async (): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/partners/${partnerId}/balance`,
        { headers: auth },
      )
    ).json();
    expect(r.success).toBeTruthy();
    return r.balance.usd as number;
  };
  const generalDrawerUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success).toBeTruthy();
    return r.balances.generalDrawer.usd as number;
  };

  const balBefore = await balOf();

  // Book a $60 debt "FOR" the partner (same PFT-R full-amount routing as the
  // spec above) so there's a real balance to settle in split legs.
  const recharge = await (
    await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
      headers: auth,
      data: {
        provider: "MTC",
        type: "VOUCHER",
        amount: 60,
        cost: 40,
        price: 60,
        currency: "USD",
        partnerId,
        partnerMode: "FOR",
      },
    })
  ).json();
  expect(recharge.success, JSON.stringify(recharge)).toBeTruthy();
  expect((await balOf()) - balBefore).toBeCloseTo(60, 2);

  const drawerBeforeSettle = await generalDrawerUsd();

  // Split settle: $35 + $25 CASH legs (sum to `amount`, both same currency as
  // the settle itself — partnerSettleSchema's structural rules). Supersedes
  // `settlementMethod` for money movement; `settlementMethod` is still
  // required and stamped on the partner_ledger row (never "SPLIT" — CHECK
  // constrained to CASH/OMT/WHISH/BINANCE/CLIENT_ACCOUNT).
  const settled = await (
    await page.request.post(`${BACKEND_URL}/api/partners/settle`, {
      headers: auth,
      data: {
        partnerId,
        amount: 60,
        currency: "USD",
        settlementMethod: "CASH",
        payments: [
          { method: "CASH", currency_code: "USD", amount: 35 },
          { method: "CASH", currency_code: "USD", amount: 25 },
        ],
      },
    })
  ).json();
  expect(settled.success, JSON.stringify(settled)).toBeTruthy();

  // Balance nets back to the pre-recharge level — the split legs cleared the
  // FULL $60, not just one of them.
  expect((await balOf()) - balBefore).toBeCloseTo(0, 2);

  // Both legs route to the same CASH drawer (General); the combined delta
  // must equal exactly what a single one-leg $60 CASH settle would produce
  // (lira-web-014's own settle step, above) — proving two legs aren't
  // double-booked or under-booked against the drawer.
  const drawerAfterSettle = await generalDrawerUsd();
  expect(drawerAfterSettle - drawerBeforeSettle).toBeCloseTo(60, 2);
});
