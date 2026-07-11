/**
 * E2E: LIRA-080 (B2) — Debts Excel import: totals equal the fixture, always
 *
 * The import had no dedup: re-importing the same file (the natural flow when
 * users retry after fixing phones in the cleanup modal) re-inserted every
 * entry for existing clients, multiplying the ledger and inflating the Debts
 * dashboard totals ($116k reading as billions after enough retries).
 *
 * This spec imports a KNOWN fixture via IPC, asserts the client's totals
 * equal the fixture sums exactly, then re-imports the SAME fixture and
 * asserts the totals did NOT change (duplicates skipped).
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type ImportResult = {
  clientsCreated: number;
  clientsSkipped: number;
  entriesImported: number;
  duplicatesSkipped: number;
  errors: string[];
};

type Api = {
  api: {
    clients: {
      importDebts: (
        data: Array<{
          name: string;
          phone: string;
          entries: Array<{
            date: string | null;
            amount_usd: number;
            amount_lbp: number;
            description: string;
            type: "debt" | "payment";
          }>;
        }>,
      ) => Promise<{
        success: boolean;
        error?: string;
        result?: ImportResult;
      }>;
    };
    debt: {
      getDebtors: () => Promise<
        Array<{
          id: number;
          full_name: string;
          phone_number: string | null;
          total_debt_usd: number;
          total_debt_lbp: number;
        }>
      >;
    };
  };
};

test.describe("LIRA-080 (B2) — debt import totals", () => {
  test("import books exact fixture sums; re-import changes nothing", async ({
    appPage,
  }) => {
    const ts = Date.now();
    // Unique client per run — identity in the shared accumulating DB.
    const name = `B2 IMPORT ${ts}`;
    const phone = `76${String(ts).slice(-6)}`;

    // Fixture: $150 + 2,700,000 LBP of debt, $50 payment → net $100 / 2.7M.
    const fixture = [
      {
        name,
        phone,
        entries: [
          {
            date: "2024-01-05T00:00:00.000Z",
            amount_usd: 150,
            amount_lbp: 0,
            description: "phone",
            type: "debt" as const,
          },
          {
            date: "2024-01-20T00:00:00.000Z",
            amount_usd: 0,
            amount_lbp: 2_700_000,
            description: "groceries",
            type: "debt" as const,
          },
          {
            date: "2024-02-01T00:00:00.000Z",
            amount_usd: 50,
            amount_lbp: 0,
            description: "cash",
            type: "payment" as const,
          },
        ],
      },
    ];

    const run = (data: typeof fixture) =>
      appPage.evaluate(
        async ({ data, name }) => {
          const w = window as unknown as Api;
          const res = await w.api.clients.importDebts(data);
          const debtor =
            (await w.api.debt.getDebtors()).find((d) => d.full_name === name) ??
            null;
          return { res, debtor };
        },
        { data, name },
      );

    // ── First import: totals equal the fixture sums EXACTLY ─────────────────
    const first = await run(fixture);
    expect(first.res.error ?? null).toBeNull();
    expect(first.res.success).toBe(true);
    expect(first.res.result?.entriesImported).toBe(3);
    expect(first.res.result?.duplicatesSkipped).toBe(0);

    expect(first.debtor).not.toBeNull();
    expect(first.debtor!.total_debt_usd).toBeCloseTo(100, 2); // 150 − 50
    expect(first.debtor!.total_debt_lbp).toBeCloseTo(2_700_000, 2);

    // ── Re-import the SAME file: nothing changes (pre-B2: totals doubled) ───
    const second = await run(fixture);
    expect(second.res.error ?? null).toBeNull();
    expect(second.res.success).toBe(true);
    expect(second.res.result?.entriesImported).toBe(0);
    expect(second.res.result?.duplicatesSkipped).toBe(3);

    expect(second.debtor!.total_debt_usd).toBeCloseTo(100, 2);
    expect(second.debtor!.total_debt_lbp).toBeCloseTo(2_700_000, 2);
  });
});
