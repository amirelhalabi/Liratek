/**
 * lira-web-070 — LIRA-329: an OMT send saved over the web app keeps every
 * field on its own transaction (User Story 1 / US4 parity).
 *
 * Sends the Services-page payload — every field the page collects for an
 * OMT SEND (service type, reference, the customer's name and phone, the OMT
 * fee, the "fee included" choice, a note, a cash payment line) — through the
 * same REST route the web app's Services page calls
 * (`POST /api/services/transactions`), then reads the transaction back over
 * REST (`GET /api/transactions/recent` to find it, `GET /api/transactions/:id`
 * for the row) and checks `metadata_json.details`, `payment_snapshot` and the
 * row's own client name/phone.
 *
 * The payload is typed from the core schema's input type and the expected
 * details are run through the kind's own schema (rules 21/24). The row is
 * found by its own identity (source_table + source_id of the send just
 * made, plus a unique reference), never by position (rule 15).
 *
 * The desktop path runs the SAME core repository code
 * (`FinancialServiceRepository.createTransaction`), covered by
 * `FinancialServiceRepository.details.test.ts`; this spec proves the web
 * transport carries the same fields end to end.
 *
 * NOT YET RUN (LIRA-329 phase 3 — the owner asks before e2e runs).
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import {
  omtWhishTransferDetailsSchema,
  paymentSnapshotSchema,
  type CreateFinancialServicePayload,
  type CreateRechargePayload,
} from "@liratek/core";

test("LIRA-329: an OMT send over the web keeps service type, reference, customer, fee, fee choice, note and payment lines on its transaction", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const stamp = Date.now();
  const reference = `L329-${stamp}`;
  const customer = `L329 Sender ${stamp}`;
  const phone = `70${String(stamp).slice(-6)}`;

  // The shape the Services page builds for an OMT SEND (rule 22 — one
  // payload), typed from the shared schema (rule 21).
  const payload: CreateFinancialServicePayload = {
    provider: "OMT",
    serviceType: "SEND",
    amount: 100,
    currency: "USD",
    clientName: customer,
    phoneNumber: phone,
    referenceNumber: reference,
    senderName: customer,
    senderPhone: phone,
    receiverName: "",
    receiverPhone: "",
    omtServiceType: "CASH_TO_BUSINESS",
    omtFee: 3,
    includingFees: false,
    note: "LIRA-329 web parity",
    payments: [{ method: "CASH", currencyCode: "USD", amount: 103 }],
  };

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/services/transactions`, {
      headers: auth,
      data: payload,
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  const fsId = created.id as number;
  expect(fsId).toBeTruthy();

  // Find the unified row by identity: this send's financial_services id.
  const recent = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?provider=OMT&service_type=SEND&limit=50&search=${encodeURIComponent(customer)}`,
      { headers: auth },
    )
  ).json();
  expect(recent.success, JSON.stringify(recent)).toBeTruthy();
  const listed = (
    recent.transactions as Array<{
      id: number;
      source_table: string;
      source_id: number;
    }>
  ).find(
    (t) => t.source_table === "financial_services" && t.source_id === fsId,
  );
  expect(listed, "the send's transaction is listed").toBeTruthy();

  const one = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/${listed!.id}`, {
      headers: auth,
    })
  ).json();
  expect(one.success, JSON.stringify(one)).toBeTruthy();
  const txn = one.transaction as {
    client_name: string | null;
    client_phone: string | null;
    metadata_json: string;
  };
  const meta = JSON.parse(txn.metadata_json) as Record<string, unknown>;

  const expected = {
    v: 1,
    kind: "omt_whish_transfer",
    provider: "OMT",
    direction: "SEND",
    serviceType: "CASH_TO_BUSINESS",
    reference,
    sender: { name: customer, phone },
    omtFee: 3,
    includingFees: false,
    note: "LIRA-329 web parity",
  } as const;
  // Rule 24: the expectation survives the kind's own schema unchanged.
  expect(omtWhishTransferDetailsSchema.parse(expected)).toEqual(expected);
  expect(meta.details).toEqual(expected);

  expect(paymentSnapshotSchema.parse(meta.payment_snapshot)).toEqual({
    lines: [{ method: "CASH", currency: "USD", amount: 103, direction: "IN" }],
  });

  expect(txn.client_name).toBe(customer);
  expect(txn.client_phone).toBe(phone);

  // Existing keys are untouched (reports and filters read them).
  expect(meta).toMatchObject({
    provider: "OMT",
    service_type: "SEND",
    amount: 100,
    currency: "USD",
  });
});

// LIRA-329 phase 4 (T040 groundwork) — a Mobile Recharge sale over the web.
// NOT YET RUN (the owner asks before e2e runs). The shop line is whatever
// the test tenant has (or none — the sale then moves no line), so only the
// fields sent are asserted, with toMatchObject.
test("LIRA-329: an Alfa Gift sale over the web keeps the tier, the customer's phone, the discount and the payment line on its transaction", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const stamp = Date.now();
  const customer = `L329 Gift ${stamp}`;
  const phone = `71${String(stamp).slice(-6)}`;

  // The shape the Recharge page's Alfa Gift submit builds (rule 21: typed
  // from the shared schema's input type).
  const payload: CreateRechargePayload = {
    provider: "Alfa",
    type: "ALFA_GIFT",
    amount: 9,
    cost: 800_000,
    price: 900_000,
    discount: 50_000,
    currency: "LBP",
    paid_by_method: "CASH",
    payments: [{ method: "CASH", currencyCode: "LBP", amount: 850_000 }],
    clientName: customer,
    clientPhone: phone,
    giftTier: { key: "7GB", label: "7 GB" },
    client_day: new Date().toISOString().slice(0, 10),
  };

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
      headers: auth,
      data: payload,
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();
  const rechargeId = created.id as number;

  const recent = await (
    await page.request.get(
      `${BACKEND_URL}/api/transactions/recent?limit=50&search=${encodeURIComponent(customer)}`,
      { headers: auth },
    )
  ).json();
  expect(recent.success, JSON.stringify(recent)).toBeTruthy();
  const listed = (
    recent.transactions as Array<{
      id: number;
      source_table: string;
      source_id: number;
    }>
  ).find((t) => t.source_table === "recharges" && t.source_id === rechargeId);
  expect(listed, "the sale's transaction is listed").toBeTruthy();

  const one = await (
    await page.request.get(`${BACKEND_URL}/api/transactions/${listed!.id}`, {
      headers: auth,
    })
  ).json();
  expect(one.success, JSON.stringify(one)).toBeTruthy();
  const txn = one.transaction as {
    client_name: string | null;
    client_phone: string | null;
    metadata_json: string;
  };
  const meta = JSON.parse(txn.metadata_json) as Record<string, unknown>;

  expect(meta.details).toMatchObject({
    v: 1,
    kind: "telecom_recharge",
    carrier: "ALFA",
    type: "ALFA_GIFT",
    amount: 9,
    giftTier: { key: "7GB", label: "7 GB" },
    discount: { amount: 50_000, currency: "LBP" },
  });
  expect(paymentSnapshotSchema.parse(meta.payment_snapshot)).toEqual({
    lines: [
      { method: "CASH", currency: "LBP", amount: 850_000, direction: "IN" },
    ],
  });
  expect(txn.client_name).toBe(customer);
  expect(txn.client_phone).toBe(phone);
});
