/**
 * E2E: LIRA-063 — OMT App / Whish App: make client name / phone optional
 *
 * Validates the fix in OmtWhishAppTransferForm.tsx: the SEND/RECEIVE
 * "Proceed to Pay" flow no longer blocks on empty sender/receiver name+phone.
 *
 * Flow under test:
 *   - Open Recharge → OMT App provider, SEND (defaults)
 *   - Leave Sender Name AND Sender Phone empty
 *   - Enter an amount and Proceed to Pay
 *   - Before the fix this raised an alert and the PaymentSheet never opened;
 *     after the fix the sheet opens and the payment confirms.
 *   - The transaction is then created with NO client, and propagates to the
 *     Audit → Transactions table where the first (newest) row shows the
 *     OMT App Send transaction with the Client column rendered as "—".
 *
 * Uses the shared Electron instance / fresh DB (same as the other specs).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const AMOUNT_USD = "25";

test.describe("LIRA-063 — OMT App / Whish App optional client name/phone", () => {
  test("OMT App SEND with empty name/phone: proceeds, creates txn, shows '—' client in first table row", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    // ── Select the OMT App provider tab ──────────────────────────────────────
    const omtAppTab = appPage
      .locator("button")
      .filter({ hasText: /^OMT App$/ })
      .first();
    await expect(omtAppTab).toBeVisible({ timeout: 8_000 });
    // force:true matches goToRechargeForm — bypasses transient header z-layer
    // interception right after navigation.
    await omtAppTab.click({ force: true });

    // The OMT/Whish transfer form renders with SEND + USD by default.
    const amountInput = appPage.locator("#transfer-amount");
    await expect(amountInput).toBeVisible({ timeout: 8_000 });

    // Be explicit about SEND (it is the default, but guard against leakage).
    const sendTab = appPage
      .locator("button")
      .filter({ hasText: /^Send$/ })
      .first();
    if (await sendTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sendTab.click();
    }

    // ── The crux of LIRA-063: name + phone are left EMPTY ───────────────────
    await expect(appPage.locator("#sender-name")).toHaveValue("");
    await expect(appPage.locator("#sender-phone")).toHaveValue("");

    await amountInput.fill(AMOUNT_USD);

    // Proceed to Pay must be enabled (gated only on a valid amount now).
    const proceedBtn = appPage.getByRole("button", { name: /Proceed to Pay/i });
    await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
    await proceedBtn.click();

    // PaymentSheet opening (the "Pay $X" confirm button appearing) is the
    // regression check: before the fix, an alert fired and the sheet stayed
    // closed because name/phone were empty.
    const confirmBtn = appPage
      .locator("button")
      .filter({ hasText: /^Pay / })
      .last();
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Sheet closes once the submit fires.
    await expect(confirmBtn).toBeHidden({ timeout: 8_000 });

    // ── Wait for the transaction to commit (avoids racing the table load) ────
    // Newest transaction must be the OMT App SEND with no client attached.
    await expect
      .poll(() => readNewestOmtAppSend(appPage), { timeout: 10_000 })
      .toBe("FINANCIAL_SERVICE|OMT_APP|SEND|null");

    // ── Verify propagation in the Transactions table (first row) ─────────────
    await navigateTo(appPage, "/audit");

    // Target the OMT App Send row by its Type cell — NOT tbody tr.first(): a
    // successful send also writes a sibling SUPPLIER PAYMENT row (auto TOP_UP)
    // whose created_at can be a wall-clock second newer, so it may sort above the
    // send row. Filter by the Type label to select the send row deterministically.
    const sendRow = appPage
      .locator("tbody tr")
      .filter({ hasText: "OMT App Send" })
      .first();
    // Type column (3rd cell): "OMT App Send"
    await expect(sendRow.locator("td").nth(2)).toContainText("OMT App Send", {
      timeout: 10_000,
    });
    // Client column (4th cell): no client → em dash
    await expect(sendRow.locator("td").nth(3)).toHaveText("—");
    // Amount column (5th cell): the $25 transfer
    await expect(sendRow.locator("td").nth(4)).toContainText("$25");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // LIRA-063 gap scenarios (IPC-driven). The above DOM test only covers ONE
  // combo (OMT_APP SEND, empty). These exercise the remaining combos and the
  // never-tested "persisted-when-provided" path, all through real main-process
  // IPC over the shared per-worker DB. They run AFTER the DOM test so the
  // ordered worker DB stays intact.
  //
  // VERIFIED against packages/core/src/repositories/FinancialServiceRepository.ts
  // (createTransaction):
  //   - omt:add-transaction → { success:true, id } (FinancialServiceResult).
  //   - omt:get-by-id → raw financial_services row (findById, no {success} wrap).
  //     Its client_id column is written ONCE at INSERT from
  //     senderClientId/receiverClientId/clientId (line ~505) and is NEVER
  //     back-stamped. So with only name+phone (no id) supplied, the
  //     financial_services row keeps client_id = null but DOES persist
  //     sender_name/sender_phone (SEND) or receiver_name/receiver_phone (RECEIVE).
  //   - The auto-created client (resolvedPrimaryClientId) is stamped onto the
  //     UNIFIED transactions row's client_id only (line ~609). So the
  //     "client_id non-null when provided" invariant is proven via
  //     transactions.getRecent (matched on source_id), NOT omt.getById.
  //   - Provider spelling is WHISH_APP everywhere (the WISH_APP typo was renamed
  //     + migrated in v105). OMT_APP/WHISH_APP are cost/price providers but here
  //     they run the legacy (cost-omitted) flow, which does not touch General for
  //     either SEND or RECEIVE, so no drawer funding is required.

  test("all four {OMT_APP,WHISH_APP}×{SEND,RECEIVE} combos with empty name/phone: success, client_id/name/phone null", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      const combos: Array<{
        provider: "OMT_APP" | "WHISH_APP";
        serviceType: "SEND" | "RECEIVE";
      }> = [
        { provider: "OMT_APP", serviceType: "SEND" },
        { provider: "OMT_APP", serviceType: "RECEIVE" },
        { provider: "WHISH_APP", serviceType: "SEND" },
        { provider: "WHISH_APP", serviceType: "RECEIVE" },
      ];

      const out: Array<{
        provider: string;
        serviceType: string;
        success: boolean;
        error: string | null;
        id: number | null;
        // omt.getById (financial_services row) — name/phone must be null too.
        fsClientId: number | null | "missing";
        fsClientName: string | null | "missing";
        fsPhoneNumber: string | null | "missing";
        fsSenderName: string | null | "missing";
        fsSenderPhone: string | null | "missing";
        fsReceiverName: string | null | "missing";
        fsReceiverPhone: string | null | "missing";
      }> = [];

      for (const combo of combos) {
        // No clientId, no name, no phone → optional path (the LIRA-063 fix).
        const res = await w.api.omt.addTransaction({
          provider: combo.provider,
          serviceType: combo.serviceType,
          amount: 12,
          currency: "USD",
          commission: 0,
          paidByMethod: "CASH",
        });

        const id = res?.id ?? null;
        const fs = id != null ? await w.api.omt.getById(id) : null;

        out.push({
          provider: combo.provider,
          serviceType: combo.serviceType,
          success: res?.success === true,
          error: res?.error ?? null,
          id,
          fsClientId: fs ? fs.client_id : "missing",
          fsClientName: fs ? fs.client_name : "missing",
          fsPhoneNumber: fs ? fs.phone_number : "missing",
          fsSenderName: fs ? fs.sender_name : "missing",
          fsSenderPhone: fs ? fs.sender_phone : "missing",
          fsReceiverName: fs ? fs.receiver_name : "missing",
          fsReceiverPhone: fs ? fs.receiver_phone : "missing",
        });
      }

      return out;
    });

    // Exactly the four combos, all created.
    expect(result).toHaveLength(4);
    for (const row of result) {
      expect(row.error).toBeNull();
      expect(row.success).toBe(true);
      expect(row.id).not.toBeNull();
      // No client was supplied or auto-created → every client linkage is null
      // on the financial_services row (omt.getById).
      expect(row.fsClientId).toBeNull();
      expect(row.fsClientName).toBeNull();
      expect(row.fsPhoneNumber).toBeNull();
      expect(row.fsSenderName).toBeNull();
      expect(row.fsSenderPhone).toBeNull();
      expect(row.fsReceiverName).toBeNull();
      expect(row.fsReceiverPhone).toBeNull();
    }
  });

  test("provided name/phone is persisted (auto-create) for OMT_APP SEND and WHISH_APP RECEIVE", async ({
    appPage,
  }) => {
    // Unique phones (distinctive 11-char strings) so the auto-create branch is
    // taken rather than matching an earlier auto-created client in the shared DB.
    const SEND_NAME = "L063 Sender Persisted";
    const SEND_PHONE = "03063771001";
    const RECV_NAME = "L063 Receiver Persisted";
    const RECV_PHONE = "03063772002";

    const result = await appPage.evaluate(
      async (p: {
        sendName: string;
        sendPhone: string;
        recvName: string;
        recvPhone: string;
      }) => {
        const w = window as unknown as Api;

        // Confirm the phones don't already exist as clients (so a match would be
        // an auto-create, never a pre-existing collision). clients:get-all
        // matches phone_number LIKE %query% and returns a raw array.
        const preSendClient = await w.api.clients.getAll(p.sendPhone);
        const preRecvClient = await w.api.clients.getAll(p.recvPhone);

        // ── OMT_APP SEND with sender name + phone ───────────────────────────────
        const sendRes = await w.api.omt.addTransaction({
          provider: "OMT_APP",
          serviceType: "SEND",
          amount: 18,
          currency: "USD",
          commission: 0,
          paidByMethod: "CASH",
          senderName: p.sendName,
          senderPhone: p.sendPhone,
        });
        const sendId = sendRes?.id ?? null;
        const sendFs = sendId != null ? await w.api.omt.getById(sendId) : null;

        // ── WHISH_APP RECEIVE with receiver name + phone ────────────────────────
        const recvRes = await w.api.omt.addTransaction({
          provider: "WHISH_APP",
          serviceType: "RECEIVE",
          amount: 22,
          currency: "USD",
          commission: 0,
          paidByMethod: "CASH",
          receiverName: p.recvName,
          receiverPhone: p.recvPhone,
        });
        const recvId = recvRes?.id ?? null;
        const recvFs = recvId != null ? await w.api.omt.getById(recvId) : null;

        // The auto-created client_id lands on the UNIFIED transactions row
        // (resolvedPrimaryClientId), not on the financial_services row. Find each
        // unified row by its source_id (= the financial_services id we captured),
        // never by index 0.
        const recent = await w.api.transactions.getRecent(50, {
          source_table: "financial_services",
        });
        const list = Array.isArray(recent)
          ? recent
          : ((recent as { transactions?: unknown[] })?.transactions ?? []);
        const txns = list as Array<{
          source_id?: number | null;
          client_id?: number | null;
        }>;
        const sendTxn = txns.find((t) => t.source_id === sendId);
        const recvTxn = txns.find((t) => t.source_id === recvId);

        // Post-create client lookups — the auto-created clients must now exist.
        const postSendClient = await w.api.clients.getAll(p.sendPhone);
        const postRecvClient = await w.api.clients.getAll(p.recvPhone);

        return {
          sendOk: sendRes?.success === true,
          sendError: sendRes?.error ?? null,
          sendId,
          // financial_services row persists the sender name/phone verbatim.
          sendFsSenderName: sendFs ? sendFs.sender_name : "missing",
          sendFsSenderPhone: sendFs ? sendFs.sender_phone : "missing",

          recvOk: recvRes?.success === true,
          recvError: recvRes?.error ?? null,
          recvId,
          // financial_services row persists the receiver name/phone verbatim.
          recvFsReceiverName: recvFs ? recvFs.receiver_name : "missing",
          recvFsReceiverPhone: recvFs ? recvFs.receiver_phone : "missing",

          // Auto-created client_id proven via the unified transaction row.
          sendTxnClientId: sendTxn ? (sendTxn.client_id ?? null) : "missing",
          recvTxnClientId: recvTxn ? (recvTxn.client_id ?? null) : "missing",

          // Delta on the clients table: absent before, present after.
          sendClientCountBefore: preSendClient.length,
          sendClientCountAfter: postSendClient.length,
          recvClientCountBefore: preRecvClient.length,
          recvClientCountAfter: postRecvClient.length,
        };
      },
      {
        sendName: SEND_NAME,
        sendPhone: SEND_PHONE,
        recvName: RECV_NAME,
        recvPhone: RECV_PHONE,
      },
    );

    // Both transactions created.
    expect(result.sendError).toBeNull();
    expect(result.sendOk).toBe(true);
    expect(result.sendId).not.toBeNull();
    expect(result.recvError).toBeNull();
    expect(result.recvOk).toBe(true);
    expect(result.recvId).not.toBeNull();

    // Provided name/phone persisted on the financial_services row (omt.getById).
    expect(result.sendFsSenderName).toBe(SEND_NAME);
    expect(result.sendFsSenderPhone).toBe(SEND_PHONE);
    expect(result.recvFsReceiverName).toBe(RECV_NAME);
    expect(result.recvFsReceiverPhone).toBe(RECV_PHONE);

    // client_id non-null (auto-create) on the unified transaction row.
    expect(result.sendTxnClientId).not.toBe("missing");
    expect(typeof result.sendTxnClientId).toBe("number");
    expect(result.recvTxnClientId).not.toBe("missing");
    expect(typeof result.recvTxnClientId).toBe("number");

    // Delta proof: the unique phones did NOT exist as clients before, and the
    // transaction auto-created exactly them (count 0 → ≥1).
    expect(result.sendClientCountBefore).toBe(0);
    expect(result.sendClientCountAfter).toBeGreaterThan(0);
    expect(result.recvClientCountBefore).toBe(0);
    expect(result.recvClientCountAfter).toBeGreaterThan(0);
  });
});

/**
 * Local Api surface for the IPC-driven LIRA-063 gap scenarios. electron.d.ts's
 * omt.addTransaction type is stale, so we cast `window as unknown as Api` and
 * declare exactly the channels these tests use (verified against
 * electron-app/preload.ts + handlers/omtHandlers.ts).
 */
type FinancialServiceRow = {
  id: number;
  client_id: number | null;
  client_name: string | null;
  phone_number: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
};

type Api = {
  api: {
    omt: {
      // preload binding accepts the rich CreateFinancialServiceData shape; we
      // only pass the subset these tests exercise.
      addTransaction: (data: {
        provider:
          | "OMT"
          | "WHISH"
          | "BOB"
          | "OTHER"
          | "iPick"
          | "Katsh"
          | "WHISH_APP"
          | "OMT_APP"
          | "BINANCE";
        serviceType: "SEND" | "RECEIVE";
        amount: number;
        currency?: string;
        commission?: number;
        paidByMethod?: string;
        clientId?: number;
        clientName?: string;
        phoneNumber?: string;
        senderName?: string;
        senderPhone?: string;
        receiverName?: string;
        receiverPhone?: string;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
      // omt:get-by-id returns the raw financial_services row (or null).
      getById: (id: number) => Promise<FinancialServiceRow | null>;
    };
    transactions: {
      // getRecent returns a RAW array (handle the {transactions} envelope defensively).
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    clients: {
      // clients:get-all returns a RAW array of client rows (matches
      // full_name/phone_number LIKE %search%).
      getAll: (search?: string) => Promise<Array<{ id: number }>>;
    };
  };
};

/**
 * Returns a "type|provider|service_type|client_id" fingerprint of the newest
 * transaction via IPC, so the test can wait for the SEND to be persisted.
 */
async function readNewestOmtAppSend(appPage: Page): Promise<string> {
  return appPage.evaluate(async () => {
    const res = await (
      window as unknown as {
        api: {
          transactions: {
            getRecent: (
              limit: number,
              filters?: Record<string, unknown>,
            ) => Promise<unknown>;
          };
        };
      }
    ).api.transactions.getRecent(20, {});
    const list = (
      Array.isArray(res)
        ? res
        : ((res as { transactions?: unknown[] })?.transactions ?? [])
    ) as Array<{
      type?: string;
      metadata_json?: string | null;
      client_id?: number | null;
    }>;
    const fingerprint = (row: {
      type?: string;
      metadata_json?: string | null;
      client_id?: number | null;
    }) => {
      let provider = "";
      let serviceType = "";
      try {
        const meta = JSON.parse(row.metadata_json ?? "{}") as {
          provider?: string;
          service_type?: string;
        };
        provider = meta.provider ?? "";
        serviceType = meta.service_type ?? "";
      } catch {
        /* ignore malformed metadata */
      }
      return `${row.type ?? ""}|${provider}|${serviceType}|${
        row.client_id ?? "null"
      }`;
    };
    // A SUCCESSFUL OMT App SEND writes TWO rows in one DB transaction: the
    // FINANCIAL_SERVICE row AND a sibling SUPPLIER_PAYMENT (auto TOP_UP against the
    // seeded OMT_APP supplier). Their created_at can tie or differ by a wall-clock
    // second, so the unfiltered global-newest [0] is ambiguous (the SUPPLIER_PAYMENT
    // can win). Target the SEND's own FINANCIAL_SERVICE/OMT_APP/SEND row; fall back
    // to the newest so a genuine non-commit still fails with a diagnostic value.
    const target =
      list.find((r) => {
        if (r.type !== "FINANCIAL_SERVICE") return false;
        try {
          const m = JSON.parse(r.metadata_json ?? "{}") as {
            provider?: string;
            service_type?: string;
          };
          return m.provider === "OMT_APP" && m.service_type === "SEND";
        } catch {
          return false;
        }
      }) ?? list[0];
    if (!target) return "none";
    return fingerprint(target);
  });
}
