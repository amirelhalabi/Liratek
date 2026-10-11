/**
 * lira-web-053 — OMT statement commission types (LIRA-256), over REST.
 * Desktop twin: lira-256-omt-statement-commission-types.spec.ts.
 *
 * OMT's balance SMS sometimes covers only some commission types ("INCLUDES
 * INTRA SHARES"). This spec proves, on the real backend:
 *  1. The statement check (`?covered=INTRA`) subtracts only the INTRA
 *     transfer's commission; with no choice it subtracts both (today's
 *     figure). `commission_by_type` counts each type.
 *  2. A settlement naming INTRA that includes the Western Union transfer is
 *     REFUSED (it names the transfer) and books nothing.
 *  3. An INTRA-only settlement with `covered_omt_service_types: ["INTRA"]`
 *     succeeds, stamps the choice on the settlement, and the WU transfer
 *     stays queued at gross.
 *  4. Voiding it nets the OMT balance, the Primary Cash Drawer and Profits
 *     "Commission (at settlement)" back to 0.
 *  5. Steps 2–4 again through the OMT account settle sheet's endpoint
 *     (`/settle-account`).
 *
 * Rule 15: deltas around each action, rows matched by identity. Amounts
 * (461 / 517) are unique to this file. Both SENDs are left queued (same
 * precedent as lira-web-052; later specs match by identity). Rule 27: the
 * Profits read uses a wide date window, never "today".
 */
import {
  test,
  expect,
  loginAsAdmin,
  BACKEND_URL,
  unlockProfitsOverRest,
} from "./fixtures";

const INTRA_X = 461;
const INTRA_FEE = 7;
const WU_X = 517;
const WU_FEE = 9;
const INTRA_GROSS = INTRA_X + INTRA_FEE; // 468

type SupplierRow = { id: number; provider: string | null };
type BalanceRow = { supplier_id: number; total_usd: number };
type UnsettledRow = {
  id: number;
  settlement_id: number | null;
  commission: number;
};
type ByType = {
  omt_service_type: string;
  commission_usd: number;
  commission_lbp: number;
  count: number;
};
type Statement = {
  unsettled_commission_usd: number;
  expected_usd: number;
  gross_owed_usd: number;
  covered_omt_service_types: string[] | null;
  commission_by_type: ByType[];
};
type RecentTxn = {
  id: number;
  source_table: string;
  source_id: number | null;
  metadata_json: string | null;
};

test("lira-web-053 OMT statement commission types: the check subtracts only covered types, a settlement refuses uncovered transfers, and a covered settle → void nets to 0 on both settle endpoints", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  // ── Profits gate — never replaces an already-set password ─────────────
  await unlockProfitsOverRest(page, auth);

  const suppliers = await (
    await page.request.get(`${BACKEND_URL}/api/suppliers`, { headers: auth })
  ).json();
  expect(suppliers.success, JSON.stringify(suppliers)).toBeTruthy();
  const omt = (suppliers.suppliers as SupplierRow[]).find(
    (s) => s.provider === "OMT",
  );
  expect(omt, "OMT supplier not found").toBeTruthy();
  const omtId = omt!.id;

  const statement = async (covered?: string): Promise<Statement> => {
    const q = covered ? `?covered=${covered}` : "";
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/${omtId}/account-expected-statement${q}`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.statement as Statement;
  };
  const countOf = (s: Statement, type: string) =>
    s.commission_by_type.find((t) => t.omt_service_type === type)?.count ?? 0;

  const owedUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/suppliers/balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return (
      (r.balances as BalanceRow[]).find((b) => b.supplier_id === omtId)
        ?.total_usd ?? 0
    );
  };
  const pcdUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
        headers: auth,
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances.omtDrawer.usd as number;
  };
  const commissionAtSettlementUsd = async (): Promise<number> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/profits/summary?from=2000-01-01&to=2100-01-01`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return (
      (r.data?.financial_services?.commission_at_settlement_usd as number) ?? 0
    );
  };
  const unsettledOmt = async (): Promise<UnsettledRow[]> => {
    const r = await (
      await page.request.get(
        `${BACKEND_URL}/api/suppliers/unsettled?provider=OMT`,
        { headers: auth },
      )
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.transactions ?? [];
  };
  const settlementTxnFor = async (ledgerId: number): Promise<RecentTxn> => {
    const recent = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/recent?type=SUPPLIER_SETTLEMENT&limit=100`,
        { headers: auth },
      )
    ).json();
    expect(recent.success, JSON.stringify(recent)).toBeTruthy();
    const txn = (recent.transactions as RecentTxn[]).find(
      (t) => t.source_table === "supplier_ledger" && t.source_id === ledgerId,
    );
    expect(txn, "SUPPLIER_SETTLEMENT transaction not found").toBeTruthy();
    return txn!;
  };
  const send = async (
    x: number,
    fee: number,
    type: string,
  ): Promise<number> => {
    const r = await (
      await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
        headers: auth,
        data: {
          provider: "OMT",
          serviceType: "SEND",
          amount: x,
          currency: "USD",
          omtServiceType: type,
          omtFee: fee,
          payments: [{ method: "CASH", currencyCode: "USD", amount: x + fee }],
        },
      })
    ).json();
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.id as number;
  };

  // ── 1. The statement check filters by type ──────────────────────────────
  const beforeIntra = await statement("INTRA");
  const beforeAll = await statement();
  expect(beforeAll.covered_omt_service_types).toBeNull();

  const intraId = await send(INTRA_X, INTRA_FEE, "INTRA");
  const wuId = await send(WU_X, WU_FEE, "WESTERN_UNION");
  const queue = await unsettledOmt();
  const intraC = queue.find((r) => r.id === intraId)!.commission;
  const wuC = queue.find((r) => r.id === wuId)!.commission;
  expect(intraC).toBeGreaterThan(0);
  expect(wuC).toBeGreaterThan(0);

  const afterIntra = await statement("INTRA");
  const afterAll = await statement();
  expect(afterIntra.covered_omt_service_types).toEqual(["INTRA"]);
  expect(
    afterIntra.unsettled_commission_usd - beforeIntra.unsettled_commission_usd,
  ).toBeCloseTo(intraC, 4);
  expect(
    afterAll.unsettled_commission_usd - beforeAll.unsettled_commission_usd,
  ).toBeCloseTo(intraC + wuC, 4);
  // ── 2. per-type counts ──
  expect(countOf(afterAll, "INTRA") - countOf(beforeAll, "INTRA")).toBe(1);
  expect(
    countOf(afterAll, "WESTERN_UNION") - countOf(beforeAll, "WESTERN_UNION"),
  ).toBe(1);

  // Runs steps 2–4 through one settle endpoint.
  const refuseThenSettleThenVoid = async (
    via: "settle" | "settle-account",
    commission: number,
  ) => {
    const net = Math.round((INTRA_GROSS - commission) * 100) / 100;
    const body = (ids: number[], amount: number) =>
      via === "settle"
        ? {
            financial_service_ids: ids,
            amount_usd: amount,
            amount_lbp: 0,
            commission_usd: commission,
            commission_lbp: 0,
            entry_mode: "LUMP",
            payments: [{ method: "CASH", currency_code: "USD", amount }],
            covered_omt_service_types: ["INTRA"],
          }
        : {
            direction: "PAY",
            selections: ids.map((id) => ({ kind: "FINANCIAL_SERVICE", id })),
            amount_usd: amount,
            amount_lbp: 0,
            commission_usd: commission,
            commission_lbp: 0,
            entry_mode: "LUMP",
            payments: [{ method: "CASH", currency_code: "USD", amount }],
            covered_omt_service_types: ["INTRA"],
          };
    const url = `${BACKEND_URL}/api/suppliers/${omtId}/${via}`;

    // ── 3. refused: the WU transfer is not in this statement ──
    const owedBeforeRefusal = await owedUsd();
    const both = INTRA_GROSS + WU_X + WU_FEE - commission;
    const refused = await (
      await page.request.post(url, {
        headers: auth,
        data: body([intraId, wuId], both),
      })
    ).json();
    expect(refused.success, JSON.stringify(refused)).toBe(false);
    expect(String(refused.error)).toContain(`#${wuId}`);
    expect((await owedUsd()) - owedBeforeRefusal).toBeCloseTo(0, 2);

    // ── 4. INTRA-only settle ──
    const owedBefore = await owedUsd();
    const pcdBefore = await pcdUsd();
    const commissionBefore = await commissionAtSettlementUsd();
    const settled = await (
      await page.request.post(url, {
        headers: auth,
        data: body([intraId], net),
      })
    ).json();
    expect(settled.success, JSON.stringify(settled)).toBeTruthy();
    const ledgerId = settled.id as number;

    const queueAfter = await unsettledOmt();
    expect(queueAfter.find((r) => r.id === intraId)).toBeUndefined();
    const wuRow = queueAfter.find((r) => r.id === wuId);
    expect(wuRow, "WU transfer left the queue").toBeTruthy();
    expect(wuRow!.settlement_id).toBeNull();
    expect((await pcdUsd()) - pcdBefore).toBeCloseTo(-net, 2);
    expect((await commissionAtSettlementUsd()) - commissionBefore).toBeCloseTo(
      commission,
      2,
    );

    const txn = await settlementTxnFor(ledgerId);
    const meta = JSON.parse(txn.metadata_json ?? "{}") as {
      covered_omt_service_types?: string[];
    };
    expect(meta.covered_omt_service_types).toEqual(["INTRA"]);

    // ── 5. void → every delta back to 0 ──
    const voidRes = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${txn.id}/void`,
        {
          headers: auth,
        },
      )
    ).json();
    expect(voidRes.success, JSON.stringify(voidRes)).toBeTruthy();
    expect((await owedUsd()) - owedBefore).toBeCloseTo(0, 2);
    expect((await pcdUsd()) - pcdBefore).toBeCloseTo(0, 2);
    expect((await commissionAtSettlementUsd()) - commissionBefore).toBeCloseTo(
      0,
      2,
    );
    const requeued = (await unsettledOmt()).find((r) => r.id === intraId);
    expect(requeued, "INTRA transfer did not re-join the queue").toBeTruthy();
    expect(requeued!.settlement_id).toBeNull();
  };

  await refuseThenSettleThenVoid("settle", 1.11);
  await refuseThenSettleThenVoid("settle-account", 1.23);
});
