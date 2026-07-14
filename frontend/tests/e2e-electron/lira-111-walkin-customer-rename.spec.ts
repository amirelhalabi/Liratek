/**
 * E2E: LIRA-111 (T5/RCP-1) — rename the walk-in customer on a completed sale.
 *
 * A walk-in sale has no client record; its typed customer name lives on the
 * unified transaction (rule 11), never on the `sales` row. RCP-1 lets the
 * operator rename that customer after the sale (Sale Detail → edit), and the
 * change must be READ back the same way it is WRITTEN — otherwise a reprint
 * shows the stale "Walk-in Customer".
 *
 * Verified end-to-end through the same IPC the modal uses:
 *   - a walk-in sale's name comes back via sales.get (from the transaction),
 *   - updateMetadata renames it (writing the transaction, not sales),
 *   - the rename is visible on both sales.get AND the transaction row,
 *   - a client-LINKED sale ignores the rename (gate: client_id IS NULL).
 *
 * Rule 17: pre-RCP-1, sales.get returned no client_name (findById, SELECT *
 * on a table with no such column) and updateMetadata accepted only `note` —
 * so the read assertion returned null/"" and the rename was a no-op.
 */

import { test, expect } from "./fixtures";
import { seedProduct } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    sales: {
      process: (
        d: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
      get: (id: number) => Promise<{
        id: number;
        client_id: number | null;
        client_name: string | null;
        client_phone: string | null;
      } | null>;
      updateMetadata: (d: {
        id: number;
        note?: string;
        client_name?: string;
        client_phone?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    clients: {
      create: (c: {
        full_name: string;
        phone_number: string;
        whatsapp_opt_in: number;
      }) => Promise<{ success?: boolean; id?: number }>;
    };
    transactions: {
      getRecent: (
        n: number,
      ) => Promise<
        Array<{
          id: number;
          type: string;
          source_id: number | null;
          summary: string | null;
        }>
      >;
      getById: (
        id: number,
      ) => Promise<{ id: number; client_name: string | null }>;
    };
  };
};

test.describe("LIRA-111 — walk-in customer rename on a completed sale", () => {
  test("renames a walk-in sale's customer (persists to the transaction, gated to walk-ins)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const productId = await seedProduct(appPage, {
      name: `L111 item ${ts}`,
      cost_price: 5,
      sell_price: 20,
      quantity: 10,
    });

    const result = await appPage.evaluate(
      async ({ productId, ts }) => {
        const w = window as unknown as Api;

        // ── Anonymous walk-in sale: NO name typed → client_id stays null and
        // the customer lives only on the transaction. (Typing a name at
        // checkout auto-creates a client — lira-094 — so that is NOT a
        // walk-in and is covered by the gate case below.) ──
        const saleRes = await w.api.sales.process({
          client_id: null,
          items: [{ product_id: productId, quantity: 1, price: 20 }],
          total_amount: 20,
          discount: 0,
          final_amount: 20,
          payment_usd: 20,
          payment_lbp: 0,
          exchange_rate: 90000,
        });
        const saleId = saleRes.id as number;
        const afterCreate = await w.api.sales.get(saleId);

        // Rename the anonymous walk-in.
        const renamed = `L111 Renamed ${ts}`;
        const upd = await w.api.sales.updateMetadata({
          id: saleId,
          client_name: renamed,
          client_phone: "76123999",
        });
        const afterRename = await w.api.sales.get(saleId);

        // The unified transaction row carries the new name (Transactions view).
        const txnRow = (await w.api.transactions.getRecent(80)).find(
          (t) => t.type === "SALE" && t.source_id === saleId,
        );
        const txnFull = txnRow
          ? await w.api.transactions.getById(txnRow.id)
          : null;

        // ── Gate: a NAMED sale auto-links a client (client_id set), so a
        // per-sale rename must be IGNORED (it would fork the client's name). ──
        const namedRes = await w.api.sales.process({
          client_id: null,
          client_name: `L111 Named ${ts}`,
          client_phone: `71${String(ts).slice(-6)}`,
          items: [{ product_id: productId, quantity: 1, price: 20 }],
          total_amount: 20,
          discount: 0,
          final_amount: 20,
          payment_usd: 20,
          payment_lbp: 0,
          exchange_rate: 90000,
        });
        const namedId = namedRes.id as number;
        const namedBefore = await w.api.sales.get(namedId);
        await w.api.sales.updateMetadata({
          id: namedId,
          client_name: "HACKED NAME",
        });
        const namedAfter = await w.api.sales.get(namedId);

        return {
          saleOk: saleRes.success,
          updOk: upd.success,
          createdName: afterCreate?.client_name ?? null,
          createdClientId: afterCreate?.client_id ?? null,
          renamedName: afterRename?.client_name ?? null,
          renamedPhone: afterRename?.client_phone ?? null,
          txnName: txnFull?.client_name ?? null,
          namedClientId: namedBefore?.client_id ?? null,
          namedBeforeName: namedBefore?.client_name ?? null,
          namedAfterName: namedAfter?.client_name ?? null,
          expectRenamed: renamed,
        };
      },
      { productId, ts },
    );

    expect(result.saleOk).toBe(true);
    expect(result.updOk).toBe(true);
    // Anonymous sale: no client record, no name at create.
    expect(result.createdClientId).toBeNull();
    expect(result.createdName).toBeNull();
    // Rename persisted, read back the same way it was written (from the txn).
    expect(result.renamedName).toBe(result.expectRenamed);
    expect(result.renamedPhone).toBe("76123999");
    expect(result.txnName).toBe(result.expectRenamed);
    // Gate: the named sale became a client, so the rename was ignored.
    expect(result.namedClientId).not.toBeNull();
    expect(result.namedAfterName).toBe(result.namedBeforeName);
    expect(result.namedAfterName).not.toBe("HACKED NAME");
  });
});
