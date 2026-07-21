/**
 * E2E: LIRA-126 — owner-notes money flows: three newest features that are
 * currently unit/repo-tested only, proven end-to-end through the real app.
 *
 * 1. LIRA-080a — Accounts page paper entry (`debt:add-account-entry`,
 *    `moveCash` toggle): moveCash:false posts a no-cash ACCOUNT_ADJUSTMENT;
 *    the omitted/true control call proves the toggle actually differentiates
 *    (DebtRepository.addAccountCashEntry, packages/core/src/repositories/DebtRepository.ts:1167).
 * 2. LIRA-080b — Suppliers page paper ADJUSTMENT (`suppliers:add-ledger-entry`,
 *    entry_type "ADJUSTMENT", signed amount, no drawer_name): posts a
 *    no-cash SUPPLIER_ADJUSTMENT (SupplierRepository.addLedgerEntry,
 *    packages/core/src/repositories/SupplierRepository.ts:315).
 * 3. LIRA-085 — a cash-moved partner Record Tx (`partners:record-transaction`,
 *    moveCash:true → PARTNER_PAYMENT) reversed via the generic
 *    `transactions:refund` nets the partner balance AND the drawer back to
 *    the pre-record snapshot exactly
 *    (TransactionRepository._reversePartnerSettlementLedger,
 *    packages/core/src/repositories/TransactionRepository.ts:2205); a second
 *    refund attempt is rejected (already refunded).
 * 4. LIRA-078 — `transactions:refund`'s optional `refundLegs` override
 *    redirects a sale refund's cash-back to a different drawer instead of
 *    mirroring the original CASH leg
 *    (TransactionRepository._reversePayments / _validateRefundLegOverride,
 *    packages/core/src/repositories/TransactionRepository.ts:1928/1864); a
 *    mismatched-total override is rejected and moves nothing.
 *
 * Every action is IPC-driven via page.evaluate(window.api.*) — same style as
 * lira-092-supplier-payment-void.spec.ts and
 * lira-123-auto-debt-scenarios.spec.ts. Assertion discipline (CLAUDE.md rule
 * 15, shared accumulating DB across the whole suite): every check is a DELTA
 * snapshotted immediately before/after the action, and every row is matched
 * by IDENTITY (source_table + source_id from the mutation's own response),
 * never getRecent()[0] or table position.
 *
 * Adaptation note (see individual tests for detail): the paper
 * ACCOUNT_ADJUSTMENT transaction summary does NOT carry the client's name
 * (unlike SUPPLIER_ADJUSTMENT, which does) — so test 1 matches its row by
 * `source_id === ledgerId` (the id the IPC call itself returns) instead of a
 * summary substring. This is a strictly more rigorous identity match than
 * string-matching would have been.
 */

import { test, expect, seedClient, seedProduct } from "./fixtures";

test.describe.configure({ retries: 0 });

// ─── IPC surface used by this spec ───────────────────────────────────────────

type DrawerBalance = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
  usdtBalance: number;
};
type DebtorRow = {
  id: number;
  full_name: string;
  total_debt_usd: number;
  total_debt_lbp: number;
};
type SupplierBalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};
type PartnerBalance = { usd: number; lbp: number; usdt: number };
type PaymentMethodRow = {
  id: number;
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer: number;
  is_active: number;
};
type Api = {
  api: {
    recharge: { getDrawerBalances: () => Promise<DrawerBalance[]> };
    debt: {
      getDebtors: () => Promise<DebtorRow[]>;
      addAccountEntry: (data: {
        direction: "credit" | "debt";
        clientId: number;
        amountUSD: number;
        amountLBP: number;
        note?: string;
        moveCash?: boolean;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    suppliers: {
      create: (data: {
        name: string;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalanceRow[]>;
      addLedgerEntry: (data: {
        supplier_id: number;
        entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
        amount_usd: number;
        amount_lbp: number;
        note?: string;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    partners: {
      create: (data: { name: string }) => Promise<{
        success: boolean;
        data?: { id: number; name: string };
        error?: string;
      }>;
      getBalance: (partnerId: number) => Promise<PartnerBalance>;
      recordTransaction: (data: {
        partnerId: number;
        transactionType: string;
        amount: number;
        currency: string;
        direction: "DEBIT" | "CREDIT";
        notes?: string;
        moveCash?: boolean;
      }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
    };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<unknown>;
      refund: (
        id: number,
        refundLegs?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
        }>,
      ) => Promise<{ success: boolean; refundId?: number; error?: string }>;
    };
    sales: {
      process: (
        data: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    inventory: {
      getProduct: (
        id: number,
      ) => Promise<{ id: number; stock_quantity: number } | null>;
    };
    paymentMethods: { list: () => Promise<PaymentMethodRow[]> };
  };
};

test.describe("LIRA-126 — owner-notes money flows", () => {
  test("LIRA-080a: Accounts paper entry (moveCash:false) leaves the drawer untouched; the moveCash:true control call proves the toggle differentiates", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const clientName = `L126 Acct ${ts}`;
    const clientId = await seedClient(appPage, {
      name: clientName,
      phone: `70${String(ts).slice(-6)}`,
    });

    const result = await appPage.evaluate(async (clientId: number) => {
      const w = window as unknown as Api;

      const drawer = async () => {
        const all = await w.api.recharge.getDrawerBalances();
        const g = all.find((d) => d.name === "General");
        return { usd: g?.usdBalance ?? 0, lbp: g?.lbpBalance ?? 0 };
      };
      const debtOf = async () => {
        const rows = await w.api.debt.getDebtors();
        const row = rows.find((r) => r.id === clientId);
        return { usd: row?.total_debt_usd ?? 0, lbp: row?.total_debt_lbp ?? 0 };
      };

      const AMOUNT = 25.5;

      // ── Paper entry: direction "debt" (cash advance), moveCash:false ──────
      const drawerBaseline = await drawer();
      const debtBaseline = await debtOf();

      const paper = await w.api.debt.addAccountEntry({
        direction: "debt",
        clientId,
        amountUSD: AMOUNT,
        amountLBP: 0,
        moveCash: false,
        note: "L126 paper cash advance",
      });
      if (!paper.success || paper.id == null) {
        throw new Error(`paper addAccountEntry failed: ${paper.error}`);
      }
      const ledgerId = paper.id;

      const drawerAfterPaper = await drawer();
      const debtAfterPaper = await debtOf();

      // Identity: the ACCOUNT_ADJUSTMENT row wrapping THIS ledger row (the
      // paper summary carries no client name — source_id is the rigorous match).
      const recentRaw = await w.api.transactions.getRecent(50, {
        source_table: "debt_ledger",
      });
      const recent = (
        Array.isArray(recentRaw)
          ? recentRaw
          : ((recentRaw as { transactions?: unknown[] })?.transactions ?? [])
      ) as Array<{
        id: number;
        type: string;
        source_id?: number | null;
        payments?: unknown[];
      }>;
      const txn = recent.find((t) => t.source_id === ledgerId);
      if (!txn) throw new Error("ACCOUNT_ADJUSTMENT transaction not found");

      // ── Control: same call, moveCash omitted (defaults true) — must move ──
      const drawerBeforeControl = await drawer();
      const control = await w.api.debt.addAccountEntry({
        direction: "debt",
        clientId,
        amountUSD: AMOUNT,
        amountLBP: 0,
        note: "L126 control cash advance",
      });
      if (!control.success) {
        throw new Error(`control addAccountEntry failed: ${control.error}`);
      }
      const drawerAfterControl = await drawer();

      return {
        ledgerId,
        debtDeltaPaperUsd: debtAfterPaper.usd - debtBaseline.usd,
        debtDeltaPaperLbp: debtAfterPaper.lbp - debtBaseline.lbp,
        drawerDeltaPaperUsd: drawerAfterPaper.usd - drawerBaseline.usd,
        drawerDeltaPaperLbp: drawerAfterPaper.lbp - drawerBaseline.lbp,
        txnType: txn.type,
        txnPaymentsLen: txn.payments?.length ?? -1,
        drawerDeltaControlUsd: drawerAfterControl.usd - drawerBeforeControl.usd,
      };
    }, clientId);

    expect(result.ledgerId).not.toBeNull();
    expect(result.debtDeltaPaperUsd).toBeCloseTo(25.5, 2);
    expect(result.debtDeltaPaperLbp).toBeCloseTo(0, 0);
    expect(result.drawerDeltaPaperUsd).toBeCloseTo(0, 2);
    expect(result.drawerDeltaPaperLbp).toBeCloseTo(0, 0);

    expect(result.txnType).toBe("ACCOUNT_ADJUSTMENT");
    expect(result.txnPaymentsLen).toBe(0);

    // direction "debt" = shop gives the customer a cash advance → drawer OUT.
    expect(result.drawerDeltaControlUsd).toBeCloseTo(-25.5, 2);
  });

  test("LIRA-080b: Suppliers paper ADJUSTMENT moves the balance, never the drawer", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const supplierName = `L126 Supplier ${ts}`;

    const result = await appPage.evaluate(async (supplierName: string) => {
      const w = window as unknown as Api;

      const drawer = async () => {
        const all = await w.api.recharge.getDrawerBalances();
        const g = all.find((d) => d.name === "General");
        return { usd: g?.usdBalance ?? 0, lbp: g?.lbpBalance ?? 0 };
      };

      const created = await w.api.suppliers.create({ name: supplierName });
      if (!created.success || created.id == null) {
        throw new Error(`supplier create failed: ${created.error}`);
      }
      const supplierId = created.id;

      const balanceOf = async () =>
        (await w.api.suppliers.getBalances(true)).find(
          (s) => s.supplier_id === supplierId,
        )?.total_usd ?? 0;

      const balanceBaseline = await balanceOf();
      const drawerBaseline = await drawer();

      const AMOUNT = 42.5; // CREDIT direction: shop owes the supplier more.
      const adj = await w.api.suppliers.addLedgerEntry({
        supplier_id: supplierId,
        entry_type: "ADJUSTMENT",
        amount_usd: AMOUNT,
        amount_lbp: 0,
        note: "L126 paper supplier credit",
      });
      if (!adj.success || adj.id == null) {
        throw new Error(`supplier ADJUSTMENT failed: ${adj.error}`);
      }
      const entryId = adj.id;

      const balanceAfter = await balanceOf();
      const drawerAfter = await drawer();

      const recent = await w.api.transactions.getRecent(50, {
        source_table: "supplier_ledger",
      });
      const list = (
        Array.isArray(recent)
          ? recent
          : ((recent as { transactions?: unknown[] })?.transactions ?? [])
      ) as Array<{
        id: number;
        type: string;
        source_id?: number | null;
        summary?: string | null;
        payments?: unknown[];
      }>;
      const txn = list.find((t) => t.source_id === entryId);
      if (!txn) throw new Error("SUPPLIER_ADJUSTMENT transaction not found");

      return {
        entryId,
        balanceDelta: balanceAfter - balanceBaseline,
        drawerDeltaUsd: drawerAfter.usd - drawerBaseline.usd,
        drawerDeltaLbp: drawerAfter.lbp - drawerBaseline.lbp,
        txnType: txn.type,
        txnSummary: txn.summary ?? "",
        txnPaymentsLen: txn.payments?.length ?? -1,
      };
    }, supplierName);

    expect(result.entryId).not.toBeNull();
    expect(result.balanceDelta).toBeCloseTo(42.5, 2);
    expect(result.drawerDeltaUsd).toBeCloseTo(0, 2);
    expect(result.drawerDeltaLbp).toBeCloseTo(0, 0);

    expect(result.txnType).toBe("SUPPLIER_ADJUSTMENT");
    expect(result.txnSummary).toMatch(/paper, no cash moved/i);
    expect(result.txnSummary).toContain(supplierName);
    expect(result.txnPaymentsLen).toBe(0);
  });

  test("LIRA-085: a cash-moved partner payment, refunded, nets balance + drawer to exactly 0; double-refund is blocked", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const partnerName = `L126 Partner ${ts}`;

    const result = await appPage.evaluate(async (partnerName: string) => {
      const w = window as unknown as Api;

      const drawer = async () => {
        const all = await w.api.recharge.getDrawerBalances();
        const g = all.find((d) => d.name === "General");
        return { usd: g?.usdBalance ?? 0, lbp: g?.lbpBalance ?? 0 };
      };

      const created = await w.api.partners.create({ name: partnerName });
      if (!created.success || created.data?.id == null) {
        throw new Error(`partner create failed: ${created.error}`);
      }
      const partnerId = created.data.id;

      const balanceOf = () => w.api.partners.getBalance(partnerId);

      const balanceBaseline = await balanceOf();
      const drawerBaseline = await drawer();

      // "ADJUSTMENT" + moveCash:true is the exact PFT-7 "Add Credit / Debt"
      // path the Partners page UI locks to for a cash-moved manual entry
      // (RecordTxModal, frontend/src/features/partners/pages/Partners/index.tsx) —
      // partner_ledger.transaction_type is NOT NULL, so a bare Record Tx call
      // must still supply it.
      const recorded = await w.api.partners.recordTransaction({
        partnerId,
        transactionType: "ADJUSTMENT",
        amount: 100,
        currency: "USD",
        direction: "CREDIT",
        moveCash: true,
        notes: "L126 cash-moved partner credit",
      });
      if (!recorded.success || recorded.data?.id == null) {
        throw new Error(`recordTransaction failed: ${recorded.error}`);
      }
      const entryId = recorded.data.id;

      const balanceAfterRecord = await balanceOf();
      const drawerAfterRecord = await drawer();

      // Identity: the PARTNER_PAYMENT row wrapping THIS partner_ledger row.
      const findTxn = async () => {
        const recent = await w.api.transactions.getRecent(50, {
          source_table: "partner_ledger",
        });
        const list = (
          Array.isArray(recent)
            ? recent
            : ((recent as { transactions?: unknown[] })?.transactions ?? [])
        ) as Array<{
          id: number;
          type: string;
          source_id?: number | null;
          reverses_id?: number | null;
        }>;
        return list;
      };

      const list1 = await findTxn();
      const txn = list1.find(
        (t) => t.source_id === entryId && t.type === "PARTNER_PAYMENT",
      );
      if (!txn) throw new Error("PARTNER_PAYMENT transaction not found");

      const refund1 = await w.api.transactions.refund(txn.id);

      const balanceAfterRefund = await balanceOf();
      const drawerAfterRefund = await drawer();

      const refund2 = await w.api.transactions.refund(txn.id);

      const list2 = await findTxn();
      const refundRow = list2.find(
        (t) => t.type === "REFUND" && t.reverses_id === txn.id,
      );

      return {
        drawerDeltaRecord: drawerAfterRecord.usd - drawerBaseline.usd,
        balanceDeltaRecord: balanceAfterRecord.usd - balanceBaseline.usd,
        refund1Ok: refund1.success === true,
        refund1Error: refund1.error ?? null,
        drawerDeltaAfterRefund: drawerAfterRefund.usd - drawerBaseline.usd,
        balanceDeltaAfterRefund: balanceAfterRefund.usd - balanceBaseline.usd,
        refund2Ok: refund2.success === true,
        refund2Error: refund2.error ?? null,
        refundRowFound: !!refundRow,
      };
    }, partnerName);

    // CREDIT + moveCash:true → cash comes IN (+drawer); balance = DEBIT−CREDIT,
    // so a CREDIT row moves the balance by −amount.
    expect(result.drawerDeltaRecord).toBeCloseTo(100, 2);
    expect(result.balanceDeltaRecord).toBeCloseTo(-100, 2);

    expect(result.refund1Error).toBeNull();
    expect(result.refund1Ok).toBe(true);
    expect(result.drawerDeltaAfterRefund).toBeCloseTo(0, 2);
    expect(result.balanceDeltaAfterRefund).toBeCloseTo(0, 2);
    expect(result.refundRowFound).toBe(true);

    expect(result.refund2Ok).toBe(false);
    expect(result.refund2Error).toMatch(/already been refunded/i);
  });

  test("LIRA-078: transactions.refund's refundLegs override redirects the cash-back drawer; a mismatched-total override is rejected and moves nothing", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const productId = await seedProduct(appPage, {
      name: `L126 Prod ${ts}`,
      cost_price: 3,
      sell_price: 10,
      quantity: 5,
    });
    const productId2 = await seedProduct(appPage, {
      name: `L126 Prod2 ${ts}`,
      cost_price: 2,
      sell_price: 8,
      quantity: 5,
    });

    const result = await appPage.evaluate(
      async (args: { productId: number; productId2: number }) => {
        const w = window as unknown as Api;

        const drawerOf = async (name: string) => {
          const all = await w.api.recharge.getDrawerBalances();
          const d = all.find((x) => x.name === name);
          return { usd: d?.usdBalance ?? 0, lbp: d?.lbpBalance ?? 0 };
        };

        // Pick a live, active, drawer-affecting NON-cash payment method — the
        // fresh DB's payment_methods rows, read at runtime (never hardcoded).
        const methods = await w.api.paymentMethods.list();
        const wallet = methods.find(
          (m) =>
            m.code !== "CASH" && m.affects_drawer === 1 && m.is_active === 1,
        );
        if (!wallet) throw new Error("no active wallet payment method found");

        const findSaleTxn = async (saleId: number) => {
          const recent = await w.api.transactions.getRecent(50, {
            source_table: "sales",
            type: "SALE",
          });
          const list = (
            Array.isArray(recent)
              ? recent
              : ((recent as { transactions?: unknown[] })?.transactions ?? [])
          ) as Array<{ id: number; source_id?: number | null }>;
          return list.find((t) => t.source_id === saleId);
        };

        // ── Sale 1: $10 CASH, refunded via the wallet override ─────────────
        const generalBaseline = await drawerOf("General");
        const walletBaseline = await drawerOf(wallet.drawer_name);

        const sale1 = await w.api.sales.process({
          client_id: null,
          items: [{ product_id: args.productId, quantity: 1, price: 10 }],
          total_amount: 10,
          discount: 0,
          final_amount: 10,
          payment_usd: 10,
          payment_lbp: 0,
          exchange_rate: 89000,
        });
        if (!sale1.success || sale1.id == null) {
          throw new Error(`sale1 failed: ${sale1.error}`);
        }

        const generalAfterSale = await drawerOf("General");
        const walletAfterSale = await drawerOf(wallet.drawer_name);
        const productAfterSale = await w.api.inventory.getProduct(
          args.productId,
        );

        const txn1 = await findSaleTxn(sale1.id);
        if (!txn1) throw new Error("SALE transaction (sale1) not found");

        const refund1 = await w.api.transactions.refund(txn1.id, [
          { method: wallet.code, currencyCode: "USD", amount: 10 },
        ]);

        const generalAfterRefund1 = await drawerOf("General");
        const walletAfterRefund1 = await drawerOf(wallet.drawer_name);
        const productAfterRefund1 = await w.api.inventory.getProduct(
          args.productId,
        );

        // ── Sale 2: $8 CASH, refund attempted with a MISMATCHED override ───
        const sale2 = await w.api.sales.process({
          client_id: null,
          items: [{ product_id: args.productId2, quantity: 1, price: 8 }],
          total_amount: 8,
          discount: 0,
          final_amount: 8,
          payment_usd: 8,
          payment_lbp: 0,
          exchange_rate: 89000,
        });
        if (!sale2.success || sale2.id == null) {
          throw new Error(`sale2 failed: ${sale2.error}`);
        }

        const generalAfterSale2 = await drawerOf("General");
        const walletAfterSale2 = await drawerOf(wallet.drawer_name);

        const txn2 = await findSaleTxn(sale2.id);
        if (!txn2) throw new Error("SALE transaction (sale2) not found");

        const refund2 = await w.api.transactions.refund(txn2.id, [
          { method: wallet.code, currencyCode: "USD", amount: 5 },
        ]);

        const generalAfterAttempt = await drawerOf("General");
        const walletAfterAttempt = await drawerOf(wallet.drawer_name);

        return {
          saleDeltaGeneral: generalAfterSale.usd - generalBaseline.usd,
          saleDeltaWallet: walletAfterSale.usd - walletBaseline.usd,
          stockAfterSale: productAfterSale?.stock_quantity ?? null,
          refund1Ok: refund1.success === true,
          refund1Error: refund1.error ?? null,
          generalDeltaAfterRefund1:
            generalAfterRefund1.usd - generalAfterSale.usd,
          walletDeltaAfterRefund1: walletAfterRefund1.usd - walletAfterSale.usd,
          stockAfterRefund1: productAfterRefund1?.stock_quantity ?? null,
          refund2Ok: refund2.success === true,
          refund2Error: refund2.error ?? null,
          generalDeltaAfterAttempt:
            generalAfterAttempt.usd - generalAfterSale2.usd,
          walletDeltaAfterAttempt:
            walletAfterAttempt.usd - walletAfterSale2.usd,
        };
      },
      { productId, productId2 },
    );

    // Sale 1 books normally: General +10, wallet untouched, stock 5 → 4.
    expect(result.saleDeltaGeneral).toBeCloseTo(10, 2);
    expect(result.saleDeltaWallet).toBeCloseTo(0, 2);
    expect(result.stockAfterSale).toBe(4);

    expect(result.refund1Error).toBeNull();
    expect(result.refund1Ok).toBe(true);

    // The override redirects the refund: General stays at its post-sale
    // level; the wallet drawer takes the −10 instead. Stock restores to 5.
    expect(result.generalDeltaAfterRefund1).toBeCloseTo(0, 2);
    expect(result.walletDeltaAfterRefund1).toBeCloseTo(-10, 2);
    expect(result.stockAfterRefund1).toBe(5);

    // Sale 2 + mismatched override ($5 vs $8 paid): rejected, nothing moves.
    expect(result.refund2Ok).toBe(false);
    expect(result.refund2Error).toMatch(/do not match/i);
    expect(result.generalDeltaAfterAttempt).toBeCloseTo(0, 2);
    expect(result.walletDeltaAfterAttempt).toBeCloseTo(0, 2);
  });
});
