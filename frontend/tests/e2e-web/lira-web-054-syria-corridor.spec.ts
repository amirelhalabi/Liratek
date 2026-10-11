/**
 * lira-web-054 — LIRA-305 Syria remittance corridor over REST: a SEND and a
 * RECEIVE (Pay out) through the same partner net each other out, so the
 * Pay out's commission counts on Profits (owner decision Y6/Y14,
 * `docs/plans/OVERNIGHT_DECISIONS_2026-10-11.md` §3); voiding either row
 * re-derives it on the next read and puts every balance back.
 *
 * Failing-first: run against the pre-LIRA-305 backend, step 2's profit delta
 * was 0 (not 3) — see `specs/305-syria-remittance/tasks.md` T005 note.
 *
 * Rule 15: a fresh partner per run, the RECEIVE's transaction found by
 * identity (`source_id`), every assertion a delta from a snapshot taken right
 * before the step. Rule 27: the Profits window is wide, never "today".
 * Desktop twin: `frontend/tests/e2e-electron/lira-305-syria-corridor-netting.spec.ts`.
 */
import {
  test,
  expect,
  loginAsAdmin,
  unlockProfitsOverRest,
  BACKEND_URL,
} from "./fixtures";

test("lira-web-054: Syria corridor — SEND + RECEIVE net out, Pay out commission counts, voids put everything back", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  // ── Profits gate — never replaces an already-set password ─────────────
  await unlockProfitsOverRest(page, auth);

  const ts = Date.now();
  const partner = await (
    await page.request.post(`${BACKEND_URL}/api/partners`, {
      headers: auth,
      data: {
        name: `L-web 7welet souria ${ts}`,
        phone: `Lw54${ts}`.slice(0, 15),
      },
    })
  ).json();
  expect(partner.success, JSON.stringify(partner)).toBeTruthy();
  const partnerId = partner.data.id as number;
  expect(partnerId).toBeTruthy();

  const generalUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances.generalDrawer.usd as number;
  };
  const partnerUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/partners/${partnerId}/balance`,
        {
          headers: auth,
        },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balance.usd as number;
  };
  const customServiceProfitUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/profits/by-module?from=2000-01-01&to=2100-01-01`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    const rows = r.data as Array<{ module: string; profit_usd: number }>;
    return rows.find((m) => m.module === "CUSTOM_SERVICE")?.profit_usd ?? 0;
  };
  const snap = async () => ({
    general: await generalUsd(),
    partner: await partnerUsd(),
    profit: await customServiceProfitUsd(),
  });

  const start = await snap();
  expect(start.partner).toBeCloseTo(0, 2);

  // (1) SEND — Via Partner, the customer pays $103 cash; the shop owes the partner $100.
  let before = start;
  const sent = await (
    await page.request.post(`${BACKEND_URL}/api/custom-services`, {
      headers: auth,
      data: {
        description: `L-web Syria send ${ts}`,
        cost_usd: 100,
        price_usd: 103,
        partnerId,
        partnerMode: "VIA",
        payments: [{ method: "CASH", currency_code: "USD", amount: 103 }],
      },
    })
  ).json();
  expect(sent.success, JSON.stringify(sent)).toBeTruthy();
  const sendId = sent.id as number;
  let now = await snap();
  expect(now.general - before.general).toBeCloseTo(103, 2);
  expect(now.partner - before.partner).toBeCloseTo(-100, 2);
  expect(now.profit - before.profit).toBeCloseTo(3, 2);

  // (2) RECEIVE — Pay out: $100 arrived via the partner, the recipient gets $97.
  // The partner's account is now square (SEND nets RECEIVE), so the $3 counts.
  before = now;
  const received = await (
    await page.request.post(`${BACKEND_URL}/api/custom-services`, {
      headers: auth,
      data: {
        description: `L-web Syria receive ${ts}`,
        price_usd: 100,
        cost_usd: 97,
        partnerId,
        partnerMode: "VIA",
        direction: "OUT",
      },
    })
  ).json();
  expect(received.success, JSON.stringify(received)).toBeTruthy();
  const receiveId = received.id as number;
  now = await snap();
  expect(now.general - before.general).toBeCloseTo(-97, 2);
  expect(now.partner - before.partner).toBeCloseTo(100, 2);
  expect(now.partner).toBeCloseTo(0, 2);
  expect(now.profit - before.profit).toBeCloseTo(3, 2);

  // (3) Void the RECEIVE from the Transactions page route, found by identity.
  before = now;
  const recent = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?limit=50&source_table=custom_services`,
      { headers: auth },
    )
  ).json();
  expect(recent.success, JSON.stringify(recent)).toBeTruthy();
  const rows: Array<{ id: number; source_id: number }> =
    recent.transactions ?? [];
  const receiveTxn = rows.find((r) => r.source_id === receiveId);
  expect(receiveTxn, JSON.stringify(rows.slice(0, 5))).toBeTruthy();
  const voided = await (
    await page.request.post(
      `${BACKEND_URL}/api/transactions/${receiveTxn!.id}/void`,
      { headers: auth, data: {} },
    )
  ).json();
  expect(voided.success, JSON.stringify(voided)).toBeTruthy();
  now = await snap();
  expect(now.general - before.general).toBeCloseTo(97, 2);
  expect(now.partner - before.partner).toBeCloseTo(-100, 2);
  expect(now.profit - before.profit).toBeCloseTo(-3, 2);

  // (4) Void the SEND from the Custom Services history route.
  before = now;
  const deleted = await (
    await page.request.delete(`${BACKEND_URL}/api/custom-services/${sendId}`, {
      headers: auth,
    })
  ).json();
  expect(deleted.success, JSON.stringify(deleted)).toBeTruthy();
  now = await snap();
  expect(now.general - before.general).toBeCloseTo(-103, 2);
  expect(now.partner - before.partner).toBeCloseTo(100, 2);
  expect(now.profit - before.profit).toBeCloseTo(-3, 2);

  // Create + void nets to 0 on every ledger touched (rule 20).
  expect(now.general).toBeCloseTo(start.general, 2);
  expect(now.partner).toBeCloseTo(start.partner, 2);
  expect(now.profit).toBeCloseTo(start.profit, 2);
});
