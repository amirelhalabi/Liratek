/**
 * E2E: Secondary OMT/WHISH system must NOT pollute the supplier ledger / page
 *
 * Only the shop's PRIMARY (base) system owes its provider directly and belongs
 * on the Suppliers page. The SECONDARY system runs via a partner — its
 * obligation lives in partner_ledger, and it must NOT also create a
 * supplier_ledger entry, NOR appear on the Suppliers page.
 *
 * Base system defaults to OMT (system_settings.shop_base_system), so WHISH is
 * the secondary system here.
 *
 * Flow (driven through real main-process IPC):
 *   1. Create a partner.
 *   2. Create a WHISH SEND THROUGH that partner via window.api.omt.addTransaction.
 *   3. Assert the Whish supplier ledger gained NO auto entry, but the partner
 *      ledger DID.
 *   4. Assert the Suppliers page (default list) hides WHISH while still listing
 *      the base OMT supplier.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    omt: {
      addTransaction: (
        data: Record<string, unknown>,
      ) => Promise<{ success?: boolean; id?: number }>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getLedger: (
        supplierId: number,
        limit?: number,
      ) => Promise<Array<{ entry_type: string; note: string | null }>>;
    };
    partners: {
      create: (data: {
        name: string;
        phone?: string;
        notes?: string;
      }) => Promise<{ success?: boolean; data?: { id: number } }>;
      getLedger: (
        partnerId: number,
        filters?: Record<string, unknown>,
      ) => Promise<{ entries?: Array<{ transaction_type: string; amount: number }> }>;
    };
  };
};

test.describe("Secondary OMT/WHISH system — no supplier-ledger pollution", () => {
  test("WHISH (secondary) SEND via partner books partner-only, hidden from Suppliers page", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      // Base = OMT → WHISH is secondary. Find both suppliers (include inactive
      // so the now-hidden WHISH is still resolvable by id).
      const allSuppliers = await w.api.suppliers.list("", true);
      const whish = allSuppliers.find((s) => s.provider === "WHISH");
      const omt = allSuppliers.find((s) => s.provider === "OMT");

      // 1. Create a partner to route the secondary-system transaction through.
      // partners:create returns { success, data: { id, ... } }.
      const created = await w.api.partners.create({ name: "E2E Secondary Partner" });
      const partnerId = created.data?.id;

      // 2. WHISH SEND THROUGH the partner.
      const txn = await w.api.omt.addTransaction({
        provider: "WHISH",
        serviceType: "SEND",
        amount: 100,
        currency: "USD",
        commission: 0,
        whishFee: 0,
        partnerId,
        partnerMode: "THROUGH",
        paidByMethod: "CASH",
      });

      // 3. Ledgers.
      const whishLedger = whish
        ? await w.api.suppliers.getLedger(whish.id, 50)
        : [];
      // partners:get-ledger returns a statement { partner, balance, breakdown, entries }.
      const partnerStatement =
        partnerId != null ? await w.api.partners.getLedger(partnerId) : undefined;

      // 4. Default suppliers list (page) — should hide the secondary WHISH.
      const visibleSuppliers = await w.api.suppliers.list("", false);

      return {
        txnOk: txn?.success ?? true,
        partnerId: partnerId ?? null,
        foundWhish: !!whish,
        foundOmt: !!omt,
        whishAutoEntries: whishLedger.filter((l) =>
          (l.note ?? "").startsWith("Auto:"),
        ).length,
        partnerEntries: partnerStatement?.entries?.length ?? 0,
        visibleProviders: visibleSuppliers.map((s) => s.provider),
      };
    });

    expect(result.txnOk).not.toBe(false);
    expect(result.foundWhish).toBe(true);
    expect(result.foundOmt).toBe(true);
    expect(result.partnerId).not.toBeNull();

    // Secondary system: NO supplier-ledger pollution, but the partner ledger captured it.
    expect(result.whishAutoEntries).toBe(0);
    expect(result.partnerEntries).toBeGreaterThan(0);

    // Suppliers page hides the secondary system, keeps the base system.
    expect(result.visibleProviders).not.toContain("WHISH");
    expect(result.visibleProviders).toContain("OMT");
  });
});

// Keep a typed reference to Page so the import is always used.
export type _SecondarySystemSpecPage = Page;
