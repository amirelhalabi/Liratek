/**
 * E2E: LIRA-091 (B6b) — Loto supplier-ledger standard sign convention
 *
 * Loto used an INVERTED supplier_ledger sign convention: ticket sales (shop
 * owes Loto) booked NEGATIVE, cash prizes (Loto owes shop) booked POSITIVE —
 * so the Suppliers page (SUM of ledger rows, >0 = "You owe" red) read Loto
 * backwards vs every other supplier.
 *
 * After the fix + migration v119:
 *   - a ticket sale moves the Loto balance by +(sale − commission)
 *   - a cash prize moves it by −prize
 *
 * IPC-driven, delta-asserted per the shared-DB rules (snapshot the Loto
 * balance around each action; never absolute totals).
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<Array<{ supplier_id: number; total_lbp: number }>>;
    };
    loto: {
      sell: (data: {
        sale_amount: number;
        commission_rate?: number;
        payment_method?: string;
        currency?: string;
        sale_date?: string;
      }) => Promise<{ success?: boolean; error?: string } | unknown>;
      cashPrize: {
        create: (data: {
          prize_amount: number;
          prize_date: string;
          ticket_number?: string;
        }) => Promise<{ success?: boolean; error?: string } | unknown>;
      };
    };
  };
};

test.describe("LIRA-091 (B6b) — Loto supplier-ledger sign", () => {
  test("ticket sale moves the Loto balance by +(sale − commission); cash prize by −prize", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const lotoBalance = async (): Promise<number | null> => {
        const loto = (await w.api.suppliers.list("", true)).find(
          (s) => s.provider === "LOTO",
        );
        if (!loto) return null; // supplier not created yet → balance 0
        const b = (await w.api.suppliers.getBalances(true)).find(
          (x) => x.supplier_id === loto.id,
        );
        return b?.total_lbp ?? 0;
      };

      // ── Ticket sale: 200,000 LBP at 5% commission → shop owes Loto 190,000 ──
      const before = (await lotoBalance()) ?? 0;
      const sellRes = (await w.api.loto.sell({
        sale_amount: 200_000,
        commission_rate: 0.05,
        payment_method: "CASH",
        currency: "LBP",
      })) as { success?: boolean; error?: string };
      const afterSale = (await lotoBalance()) ?? 0;

      // ── Cash prize: 60,000 LBP → Loto owes the shop, balance −60,000 ────────
      const prizeRes = (await w.api.loto.cashPrize.create({
        prize_amount: 60_000,
        prize_date: "2026-07-04",
        ticket_number: "L091-PRIZE",
      })) as { success?: boolean; error?: string };
      const afterPrize = (await lotoBalance()) ?? 0;

      // ── Cash prize WITHOUT a ticket number (owner repro 2026-07-13): the
      // field is optional everywhere — the UI submits without it and the
      // repository has a no-ticket fallback note — but lotoCashPrizeSchema
      // required it, so this failed with "ticket_number: Required". The
      // session-basket replay hits the same validation at checkout.
      const prizeNoTicketRes = (await w.api.loto.cashPrize.create({
        prize_amount: 40_000,
        prize_date: "2026-07-04",
      })) as { success?: boolean; error?: string };
      const afterPrizeNoTicket = (await lotoBalance()) ?? 0;

      return {
        sellOk: sellRes?.success !== false,
        sellError: sellRes?.error ?? null,
        prizeOk: prizeRes?.success !== false,
        prizeError: prizeRes?.error ?? null,
        prizeNoTicketOk: prizeNoTicketRes?.success !== false,
        prizeNoTicketError: prizeNoTicketRes?.error ?? null,
        saleDelta: afterSale - before,
        prizeDelta: afterPrize - afterSale,
        prizeNoTicketDelta: afterPrizeNoTicket - afterPrize,
      };
    });

    expect(result.sellError).toBeNull();
    expect(result.sellOk).toBe(true);
    expect(result.prizeError).toBeNull();
    expect(result.prizeOk).toBe(true);
    expect(result.prizeNoTicketError).toBeNull();
    expect(result.prizeNoTicketOk).toBe(true);

    // Standard convention: shop-owes-Loto is POSITIVE.
    // Pre-fix these deltas were −190,000 and +60,000 (inverted).
    expect(result.saleDelta).toBeCloseTo(190_000, 2);
    expect(result.prizeDelta).toBeCloseTo(-60_000, 2);
    expect(result.prizeNoTicketDelta).toBeCloseTo(-40_000, 2);
  });
});
