/**
 * lira-web-071 — Shop Day: one realistic day of a phone shop, run through the
 * REAL UI over the web transport (owner decision 2026-10-16).
 *
 * The scenario, its numbering and its bug list are docs/testing/SHOP_DAY.md;
 * every `test` below is one step there ("0.1", "1.1", …), inside ONE
 * `test.describe.serial`, so a failure names the step. The page is opened and
 * logged in ONCE for the whole day (rate limits — SHOP_DAY §6).
 *
 * What each step checks (rule 15 — identity + deltas, never position):
 *  - the drawers moved by the right amount (snapshot before, delta after);
 *  - the transaction, found by id-above-the-snapshot + its details `kind` +
 *    a value only this run typed, carries `metadata_json.details` with the
 *    entered fields (field names from the core schema — rule 24: every
 *    expected `details` object is run through `transactionDetailsSchema`);
 *  - its `payment_snapshot` lines with the right direction;
 *  - client name / phone on the row;
 *  - the Transactions page Details panel shows the key labels.
 *
 * Open bugs (SHOP_DAY §5) are asserted as their FIXED behaviour through
 * `bugCheck(N, …)` (shopDayHelpers.ts), NOT `expect.soft`: under
 * `describe.serial` a soft failure still fails its test, and a failed test
 * skips every later step — so one open bug would hide the rest of the day.
 * `bugCheck` records the failure (and annotates the step) instead; the LAST
 * test, "open bugs", fails listing every one. The expected wording of
 * fix-dependent checks lives in ONE place, `FIXED` in shopDayHelpers.ts.
 * Hard `expect`s are what holds today; if one of those fails, `serial`
 * skips the rest of the day — by design (the owner's choice).
 *
 * Runs on the local fresh web-test DB (never the test tenant). The DB
 * accumulates across the suite, so every name, phone, product, note and
 * reference carries this run's stamp, and setup creates what the day needs
 * through the UI (products, stock, IMEIs, clients, partners, shop lines,
 * wallet top-ups). REST is used only for reads, and for the exchange-rate
 * preconditions (see step 0.0 — they have a Settings UI, but restoring them
 * is not a step of the day).
 *
 * Written before it was run: the owner is asked before e2e runs. Selectors
 * come from the 2026-10-16 cashier-agent runs (steps-A.md, ledgers) and, for
 * the customer session (Part 8) and the setup forms, from reading the source
 * only — unverified until the first run.
 */
import fs from "node:fs";
import * as XLSXns from "xlsx";
import type { Locator, Page } from "@playwright/test";
import { test, expect, closeAutoCheckpoint } from "./fixtures";
import {
  rechargeProviderTab,
  selectRechargeProvider,
} from "../e2e-electron/helpers/rechargeTabs";
import {
  transactionDetailsSchema,
  type CreateFinancialServicePayload,
  type PartnerSettleInput,
  type RecordWrongNumberInput,
  type SaleProcessPayload,
  type SaleRefundItemPayload,
  type SetRateData,
  type TransactionDetails,
} from "@liratek/core";
import {
  FIXED,
  addLine,
  bugCheck,
  bugCheckAsync,
  clearRoundUpExtra,
  clientByName,
  clientDebt,
  closeDetails,
  drawers,
  expectLegMovedDrawer,
  expectMoved,
  expectPanelLabels,
  expectPayoutLine,
  expectSnapLine,
  findTxn,
  getJson,
  isWholeUnit,
  lastTxnId,
  openBugList,
  openDetails,
  openShopDay,
  partnerBalance,
  partnerIdByName,
  payAmount,
  payCurrency,
  payLine,
  payMethod,
  phoneOf,
  pickClientOption,
  postJson,
  splitOn,
  supplierBalance,
  topModal,
  txnsSince,
  waitPost,
  type ShopDay,
  type Txn,
} from "./shopDayHelpers";

// xlsx ships CommonJS only; under Node's ESM loader the namespace may only
// carry `default`.
const XLSX =
  (XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns;

// ── Rule 24: expected details go through the schema ──────────────────────
type ZodLike = {
  shape?: Record<string, ZodLike>;
  element?: ZodLike;
  unwrap?: () => ZodLike;
};

/** Every key the expectation names must exist in the kind's schema (nested
 *  objects and arrays of objects included): a misspelt field fails HERE
 *  instead of silently matching nothing. Partial on purpose — starred
 *  fields the step does not check may be left out. */
function expectSchemaKeys(node: ZodLike, value: unknown, where: string): void {
  let n: ZodLike | undefined = node;
  while (n && !n.shape && !n.element && n.unwrap) n = n.unwrap();
  if (!n || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (n.element)
      for (const v of value) expectSchemaKeys(n.element, v, `${where}[]`);
    return;
  }
  if (!n.shape) return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    expect(Object.keys(n.shape), `schema key ${where}.${k}`).toContain(k);
    expectSchemaKeys(n.shape[k], v, `${where}.${k}`);
  }
}

function detailsOf(
  partial: { kind: TransactionDetails["kind"] } & Record<string, unknown>,
): Record<string, unknown> {
  const option = (
    transactionDetailsSchema.options as unknown as ZodLike[]
  ).find(
    (o) =>
      (o.shape?.kind as unknown as { value?: string } | undefined)?.value ===
      partial.kind,
  );
  expect(option, `schema for kind ${partial.kind}`).toBeTruthy();
  const full = { v: 1, ...partial };
  expectSchemaKeys(option!, full, partial.kind);
  return full;
}

function expectDetails(
  t: Txn,
  partial: { kind: TransactionDetails["kind"] } & Record<string, unknown>,
): void {
  expect(t.details, `#${t.id} details`).toMatchObject(detailsOf(partial));
}

// ── Day state shared across the serial steps ─────────────────────────────
let day: ShopDay;
let page: Page;
const S: Record<string, string> = {};
const ids: Record<string, number> = {};
let iphoneImeis: [string, string] = ["", ""];

const PRODUCTS = {
  iphone: { key: "iPhone 15 128GB", cost: 690, price: 799, category: "Phones" },
  magsafe: {
    key: "iPhone 15 Clear MagSafe Case",
    cost: 4,
    price: 12,
    category: "Accessories",
  },
  charger: {
    key: "Apple 20W charger",
    cost: 9,
    price: 19,
    category: "Chargers",
  },
  glass: {
    key: "iPhone 15 Tempered Glass",
    cost: 1,
    price: 5,
    category: "Accessories",
  },
  a55: {
    key: "Galaxy A55 Clear Case",
    cost: 2,
    price: 6,
    category: "Accessories",
  },
  cable: { key: "USB-C cable", cost: 2.5, price: 7, category: "Accessories" },
} as const;
type ProductKey = keyof typeof PRODUCTS;
const STOCK: Record<ProductKey, number> = {
  iphone: 2,
  magsafe: 10,
  charger: 5,
  glass: 10,
  a55: 5,
  cable: 10,
};
const pname = (k: ProductKey) => `${PRODUCTS[k].key} SD${day.stamp}`;

async function go(route: string, ready: Locator | string): Promise<void> {
  await page.goto(`/#${route}`);
  const loc = typeof ready === "string" ? page.getByText(ready).first() : ready;
  await expect(loc).toBeVisible({ timeout: 20_000 });
}

test.describe.serial("lira-web-071 Shop Day", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    day = await openShopDay(browser);
    page = day.page;
    const st = day.stamp;
    Object.assign(S, {
      rami: `Rami Haddad ${st}`,
      nour: `Nour Khalil ${st}`,
      hassan: `Hassan Zein ${st}`,
      karim: `Karim Saab ${st}`,
      walid: `Walid Mansour ${st}`,
      fadi: `Fadi Nassar ${st}`,
      ali: `Ali Hamdan ${st}`,
      joe: `Joe Karam ${st}`,
      rana: `Rana Saleh ${st}`,
      abuFadi: `Abu Fadi ${st}`,
      samir: `Samir Aoun ${st}`,
      maya: `Maya Fares ${st}`,
      marc: `Marc Dubois ${st}`,
      georges: `Georges Khoury ${st}`,
      sessionCustomer: `Session Walkin ${st}`,
      flow: `Flow Partner ${st}`,
      smoke: `Smoke Partner ${st}`,
    });
    // 15-digit IMEIs unique to this run.
    iphoneImeis = [`35693803${st}1`, `35693803${st}2`];
  });

  test.beforeEach(() => {
    test.setTimeout(180_000);
  });

  test.afterAll(async () => {
    if (!day) return;
    // Never leave an active customer session for later specs.
    const list = await getJson<{ sessions?: Array<{ id: number }> }>(
      day,
      "/api/sessions/active-list",
    ).catch(() => ({ sessions: [] }));
    for (const s of list.sessions ?? []) {
      await postJson(day, `/api/sessions/${s.id}/close`).catch(() => null);
    }
    await day.context.close();
  });

  // ══ Part 0 — Opening ═══════════════════════════════════════════════════

  test("0.0 preconditions: rates 89,000 / 89,500, EUR 1.16 / 1.18", async () => {
    // REST, not UI: restoring the rates the day's amounts assume is a
    // precondition, not a step of the day (an earlier spec may have moved
    // them on the shared DB). SHOP_DAY §2 "Preconditions".
    const want: SetRateData[] = [
      {
        to_code: "LBP",
        market_rate: 89_500,
        buy_rate: 89_000,
        sell_rate: 90_000,
        is_stronger: 1,
      },
      {
        to_code: "EUR",
        market_rate: 1.18,
        buy_rate: 1.16,
        sell_rate: 1.2,
        is_stronger: -1,
      },
    ];
    const r = await getJson<{
      success: boolean;
      rates: Array<{
        to_code: string;
        market_rate: number;
        buy_rate: number;
        sell_rate: number;
      }>;
    }>(day, "/api/rates");
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    for (const w of want) {
      const cur = r.rates.find((x) => x.to_code === w.to_code);
      if (
        !cur ||
        cur.market_rate !== w.market_rate ||
        cur.buy_rate !== w.buy_rate ||
        cur.sell_rate !== w.sell_rate
      ) {
        const set = await postJson(day, "/api/rates", w);
        expect(set.success, JSON.stringify(set)).toBeTruthy();
      }
    }
    // The app reads rates at load.
    await page.reload();
    await closeAutoCheckpoint(page);
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
  });

  test("0.1 opening drawer amounts (Initial Drawer Amounts)", async () => {
    const set = await getJson<{ success: boolean; isSet: boolean }>(
      day,
      "/api/closing/has-initial-balances-set",
    );
    if (set.isSet) {
      // Accumulated suite DB: money has already moved, so the Dashboard
      // prompt never shows (it is armed only while every drawer is 0).
      test.info().annotations.push({
        type: "skipped-ui",
        description:
          "drawers already have money — no Initial Drawer Amounts prompt",
      });
    } else {
      await go("/", page.getByTestId("page-alerts-trigger"));
      await page.getByTestId("page-alerts-trigger").click();
      await page.getByTestId("page-alerts-row-initial-balances").click();
      await expect(page.getByText("Initial Drawer Amounts")).toBeVisible();
      const modal = topModal(page);
      const inputs = modal.locator('input[placeholder="0"]:visible');
      // An all-zero save is accepted and leaves the warning (SHOP_DAY 0.1).
      await expect(inputs).toHaveCount(6);
      // Order on screen: General USD, General LBP, OMT LBP, OMT USD, Whish LBP, Whish USD.
      const values = [500, 20_000_000, 10_000_000, 300, 5_000_000, 200];
      for (let i = 0; i < values.length; i++) {
        await inputs.nth(i).fill(String(values[i]));
      }
      const cp = waitPost(page, "/api/closing/checkpoint");
      await modal.getByRole("button", { name: "Save Amounts" }).click();
      const { body, request } = await cp;
      expect(body.success, JSON.stringify(body)).toBeTruthy();
      expect(request).toMatchObject({
        drawer_name: "AGGREGATED",
        notes: "Initial drawer amounts setup",
      });
      const amounts = request.amounts as Array<{
        drawer_name: string;
        currency_code: string;
        expected_amount: number;
        physical_amount: number;
      }>;
      expect(
        amounts.find(
          (a) => a.drawer_name === "General" && a.currency_code === "USD",
        ),
      ).toMatchObject({ expected_amount: 500, physical_amount: 500 });
    }
    const after = await getJson<{ isSet: boolean }>(
      day,
      "/api/closing/has-initial-balances-set",
    );
    expect(after.isSet).toBe(true);
    const cp = await getJson<{ isSet: boolean }>(
      day,
      "/api/closing/has-starting-checkpoint",
    );
    expect(cp.isSet).toBe(true);
  });

  test("0.1b setup: partners Flow Partner and Smoke Partner (Partners page)", async () => {
    for (const [name, n] of [
      [S.flow, 1],
      [S.smoke, 2],
    ] as const) {
      await go("/partners", page.getByRole("button", { name: "Add Partner" }));
      await page.getByRole("button", { name: "Add Partner" }).click();
      const modal = topModal(page);
      await modal.getByPlaceholder("Partner name").fill(name);
      await modal.getByPlaceholder("+961 XX XXX XXX").fill(phoneOf(day, n));
      const created = waitPost(page, "/api/partners");
      await modal.getByRole("button", { name: "Create" }).click();
      const { body } = await created;
      expect(body.success, JSON.stringify(body)).toBeTruthy();
    }
    ids.flow = await partnerIdByName(day, S.flow);
    ids.smoke = await partnerIdByName(day, S.smoke);
  });

  /** Inventory → Add Product, then Adjust stock +N (and the IMEI step for
   *  a Phones-category product). */
  async function createAndStock(k: ProductKey): Promise<void> {
    const p = PRODUCTS[k];
    await go("/products", page.getByRole("button", { name: "Add Product" }));
    await page.getByRole("button", { name: "Add Product" }).click();
    await expect(page.locator("#product-name")).toBeVisible();
    await page.locator("#product-name").fill(pname(k));
    await page.locator("#product-category").fill(p.category);
    await page.locator("#product-cost-price").fill(String(p.cost));
    await page.locator("#product-retail-price").fill(String(p.price));
    await page.locator("#product-stock").fill("0");
    const saved = waitPost(page, "/api/inventory/products");
    await page.getByRole("button", { name: /Save Product/i }).click();
    const { body } = await saved;
    expect(body.success, JSON.stringify(body)).toBeTruthy();

    // Adjust stock: +N at the prefilled unit cost.
    const search = page.getByPlaceholder("Search by name, barcode...");
    await expect(search).toBeVisible();
    await search.fill(pname(k));
    await page
      .getByRole("button", { name: `Adjust stock for ${pname(k)}` })
      .click();
    await page.getByRole("button", { name: "Add / remove (+/-)" }).click();
    await page.getByPlaceholder("+10 or -5").fill(String(STOCK[k]));
    await page
      .getByPlaceholder(/Physical recount, damaged goods/)
      .fill(`Morning delivery SD${day.stamp}`);
    const recv = waitPost(page, "/receive-stock");
    await page.getByRole("button", { name: "Apply Adjustment" }).click();
    const r = await recv;
    expect(r.body.success, JSON.stringify(r.body)).toBeTruthy();
    expect(r.request).toMatchObject({
      quantity: STOCK[k],
      unit_cost_usd: p.cost,
    });

    if (k === "iphone") {
      await expect(page.getByTestId("stock-intake-step")).toBeVisible();
      let last: Record<string, unknown> = {};
      for (const imei of iphoneImeis) {
        const reg = waitPost(page, "/api/product-units/register");
        await page.getByTestId("imei-add-input").fill(imei);
        await page.getByTestId("imei-add-button").click();
        last = (await reg).body;
        expect(last.success, JSON.stringify(last)).toBeTruthy();
      }
      // After the 2nd IMEI the units match the stock count.
      // REST envelope: { success, data: { units, drift } }.
      expect(last).toMatchObject({ data: { drift: { matches: true } } });
      await page.getByRole("button", { name: "Done" }).click();
    }
  }

  test("0.2 stock intake: iPhone 15 128GB +2 at $690, two IMEI units (Inventory)", async () => {
    await createAndStock("iphone");
  });

  test("0.3 stock intake: the 5 accessories (Inventory)", async () => {
    for (const k of ["magsafe", "charger", "glass", "a55", "cable"] as const) {
      await createAndStock(k);
    }
  });

  test("0.4 clients: Rami, Nour, Hassan (Clients page)", async () => {
    const people: Array<[string, number, string]> = [
      [S.rami, 1, "Regular, buys accessories"],
      [S.nour, 2, ""],
      [S.hassan, 3, "Repairs customer"],
    ];
    for (const [name, n, notes] of people) {
      await go("/clients", page.getByRole("button", { name: "Add Client" }));
      await page.getByRole("button", { name: "Add Client" }).click();
      await page.locator("input[name=full_name]").fill(name);
      await page.locator("input[name=phone_number]").fill(phoneOf(day, n));
      if (notes) await page.locator("textarea[name=notes]").fill(notes);
      const created = waitPost(page, "/api/clients");
      await page.getByRole("button", { name: "Save Client" }).click();
      const { body } = await created;
      expect(body.success, JSON.stringify(body)).toBeTruthy();
    }
    ids.rami = (await clientByName(day, S.rami)).id;
    ids.nour = (await clientByName(day, S.nour)).id;
    ids.hassan = (await clientByName(day, S.hassan)).id;
  });

  test("0.5 shop lines with credits (Phone Lines → Shop lines)", async () => {
    // The fresh DB has no carrier lines; the day needs an MTC and an Alfa line.
    for (const [carrier, n, credits] of [
      ["mtc", 12, 150],
      ["alfa", 13, 150],
    ] as const) {
      await go("/phone-lines", page.getByRole("tab", { name: "Shop lines" }));
      await page.getByRole("tab", { name: "Shop lines" }).click();
      await page.getByRole("button", { name: "+ Add Line" }).click();
      const form = page
        .locator("form, div", { hasText: "New Carrier Line" })
        .last();
      await form.locator("select").first().selectOption(carrier);
      await form.getByPlaceholder("e.g. 03123456").fill(phoneOf(day, n));
      await form
        .getByPlaceholder("e.g. Shop Line 1")
        .fill(`SD ${carrier} ${day.stamp}`);
      // LIRA-331: Credits is a text field with a decimal keypad (it accepts
      // Arabic-Indic digits), no longer type="number".
      await form
        .locator('input[inputmode="decimal"]')
        .first()
        .fill(String(credits));
      await form.locator('input[type="date"]').fill("2026-12-31");
      const saved = waitPost(page, "/api/carrier-lines");
      await form.getByRole("button", { name: "Create" }).click();
      const { body } = await saved;
      expect(body.success, JSON.stringify(body)).toBeTruthy();
    }
  });

  test("0.6 wallet top-ups: Katsh, iPick, OMT App $200 supplier credit", async () => {
    const drawerOf: Record<string, string> = {
      Katsh: "Katsh",
      iPick: "iPick",
      "OMT App": "OMT_App",
    };
    const providerOf: Record<string, string> = {
      Katsh: "Katsh",
      iPick: "iPick",
      "OMT App": "OMT_APP",
    };
    for (const tab of ["Katsh", "iPick", "OMT App"]) {
      await go("/recharge", rechargeProviderTab(page, tab));
      // Wait until the tab is ACTIVE: the switch is a transition, and a
      // Top-Up clicked before it lands opens the previous provider's window
      // (CI once booked Katsh twice here). The heading proves which one.
      await selectRechargeProvider(page, tab);
      const before = await lastTxnId(day);
      const d0 = await drawers(day);
      await page
        .getByRole("button", { name: /^Top-?Up$/ })
        .first()
        .click();
      const modal = topModal(page);
      await expect(modal).toContainText(`Top Up ${tab} Drawer`);
      await modal.getByPlaceholder("0.00").fill("200");
      const res = waitPost(page, "/api/recharge/top-up-from-supplier");
      await modal
        .getByRole("button", { name: "Confirm Supplier Credit" })
        .click();
      const { body } = await res;
      expect(body.success, JSON.stringify(body)).toBeTruthy();
      const t = await findTxn(
        day,
        before,
        "wallet_topup",
        (x) => x.details?.provider === providerOf[tab],
      );
      expectDetails(t, {
        kind: "wallet_topup",
        provider: providerOf[tab],
        source: "SUPPLIER",
      });
      expectMoved(await drawers(day), d0, drawerOf[tab], "USD", 200);
    }
  });

  test("0.7 Whish App top-up via partner (Flow Partner) $300", async () => {
    await go(
      "/recharge",
      page.getByRole("button", { name: "Whish App", exact: true }).first(),
    );
    await page
      .getByRole("button", { name: "Whish App", exact: true })
      .first()
      .click();
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const p0 = await partnerBalance(day, ids.flow);
    await page
      .getByRole("button", { name: /^Top-?Up$/ })
      .first()
      .click();
    const modal = topModal(page);
    await modal
      .getByRole("button", { name: "Via Partner", exact: true })
      .click();
    await modal
      .getByRole("button", { name: /Direct \(no partner\)|Select partner/ })
      .first()
      .click();
    await page.getByRole("option", { name: S.flow }).click();
    await modal.getByPlaceholder("0.00").fill("300");
    const res = waitPost(page, "/api/recharge/top-up-from-partner");
    await modal.getByRole("button", { name: "Top Up via Partner" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "wallet_topup",
      (x) => x.details?.source === "PARTNER",
    );
    expectDetails(t, {
      kind: "wallet_topup",
      provider: "WHISH_APP",
      source: "PARTNER",
      partner: { id: ids.flow, mode: "VIA" },
    });
    expectMoved(await drawers(day), d0, "Whish_App", "USD", 300);
    // We owe the partner $300 (negative = the shop owes).
    const p1 = await partnerBalance(day, ids.flow);
    expect(p1.usd - p0.usd).toBeCloseTo(-300, 2);
  });

  // ══ Part 1 — POS ═══════════════════════════════════════════════════════

  async function posAdd(k: ProductKey, qty = 1): Promise<void> {
    const search = page.getByPlaceholder(
      "Search products by name or barcode...",
    );
    await search.fill(pname(k));
    const main = page.locator("main");
    await expect(main.getByText(pname(k)).first()).toBeVisible({
      timeout: 10_000,
    });
    await main.getByRole("button", { name: /Add/ }).first().click();
    for (let i = 1; i < qty; i++) {
      await main
        .getByRole("button", { name: "Increase quantity" })
        .last()
        .click();
    }
    await search.fill("");
  }

  async function checkout(): Promise<Locator> {
    await page.getByRole("button", { name: /Proceed to Checkout/ }).click();
    const modal = page.getByTestId("checkout-modal");
    await expect(modal).toBeVisible();
    return modal;
  }

  test("1.1 POS: iPhone (IMEI, 12m warranty) + 2 cases to Rami, split $700 + 11,500,000 LBP with change", async () => {
    await go(
      "/pos",
      page.getByPlaceholder("Search products by name or barcode..."),
    );
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await posAdd("iphone");
    await page.getByRole("button", { name: "edit" }).first().click();
    await page.getByLabel(`Warranty months for ${pname("iphone")}`).fill("12");
    await page.getByRole("button", { name: "Save warranty" }).click();
    await page
      .locator("main select")
      .first()
      .selectOption({ label: iphoneImeis[0] });
    await posAdd("magsafe", 2);
    const modal = await checkout();
    await pickClientOption(
      page,
      modal.getByPlaceholder("Search Name or Phone..."),
      S.rami,
    );
    await splitOn(modal);
    // Picking a client flips line 1 to Customer Account (owner Q3: keep) — reset.
    await payLine(modal, 0, "CASH", 700, "USD");
    await addLine(modal);
    await payLine(modal, 1, "CASH", 11_500_000, "LBP");
    await expect(modal.getByTestId("return-change")).toBeVisible();
    const sale = waitPost(page, "/api/sales/process");
    await modal.getByTestId("checkout-complete-btn").click();
    const { body, request } = await sale;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const items = request.items as Array<Record<string, unknown>>;
    expect(items.find((i) => i.imei === iphoneImeis[0])).toMatchObject({
      warranty_months: 12,
    });

    const t = await findTxn(
      day,
      before,
      "pos_sale",
      (x) => x.client_name === S.rami,
    );
    ids.sale1Txn = t.id;
    expect(t.type).toBe("SALE");
    expect(t.client_phone).toBe(phoneOf(day, 1));
    const its = (t.details?.items ?? []) as Array<Record<string, unknown>>;
    expect(its.find((i) => i.imei === iphoneImeis[0])).toMatchObject({
      unitPrice: 799,
      unitCost: 690,
      warrantyMonths: 12,
    });
    expect(its.find((i) => i.imei === iphoneImeis[0])?.unitId).toBeTruthy();
    expect(its.find((i) => i.quantity === 2)).toMatchObject({ unitPrice: 12 });
    expectSnapLine(t, "CASH", "USD", 700, "IN");
    expectSnapLine(t, "CASH", "LBP", 11_500_000, "IN");
    expectSnapLine(t, "CASH", "USD", 6, "OUT");
    expectSnapLine(t, "CASH", "LBP", 20_000, "OUT");
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "USD", 694);
    expectMoved(d1, d0, "General", "LBP", 11_480_000);

    const panel = await openDetails(day, t.id, S.rami);
    await expectPanelLabels(panel, ["Items", "Client"]);
    await expect(panel).toContainText(iphoneImeis[0]);
    await closeDetails(panel);
  });

  test("1.2 POS walk-in: charger + cable to typed Karim Saab, 2,400,000 LBP", async () => {
    await go(
      "/pos",
      page.getByPlaceholder("Search products by name or barcode..."),
    );
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await posAdd("charger");
    await posAdd("cable");
    const modal = await checkout();
    await modal.getByPlaceholder("Search Name or Phone...").fill(S.karim);
    await modal.getByPlaceholder("Enter Phone Number...").fill(phoneOf(day, 4));
    await payMethod(modal, 0).selectOption("CASH");
    await payCurrency(modal, 0).selectOption("LBP");
    await payAmount(modal, 0).fill("2400000");
    // LIRA-334: $0.97 over a $26 total is within the $5 round-up — "+ Extra"
    // fills in; the cashier clears it to hand the change back.
    await clearRoundUpExtra(modal);
    const sale = waitPost(page, "/api/sales/process");
    await modal.getByTestId("checkout-complete-btn").click();
    const { body, request } = await sale;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    expect(request).toMatchObject({
      client_name: S.karim,
      client_phone: phoneOf(day, 4),
    } satisfies Partial<SaleProcessPayload>);

    const t = await findTxn(
      day,
      before,
      "pos_sale",
      (x) => x.client_name === S.karim,
    );
    ids.walkinSaleTxn = t.id;
    expect(t.client_phone).toBe(phoneOf(day, 4));
    expect(t.client_id, "walk-in auto-created as a client").toBeTruthy();
    expectSnapLine(t, "CASH", "LBP", 2_400_000, "IN");
    // Change is whatever the box handed back (bug 26 is unconfirmed); the
    // drawer must agree with the snapshot to the pound.
    const changeLbp = (t.snapshot?.change_returned ?? [])
      .filter((c) => c.currency === "LBP")
      .reduce((s, c) => s + c.amount, 0);
    ids.walkinChangeLbp = changeLbp;
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "LBP", 2_400_000 - changeLbp);
    expectMoved(d1, d0, "General", "USD", 0);
  });

  test("1.3 POS: 2 A55 cases + glass to Nour, − $2 discount, paid $20", async () => {
    await go(
      "/pos",
      page.getByPlaceholder("Search products by name or barcode..."),
    );
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await posAdd("a55", 2);
    await posAdd("glass");
    const modal = await checkout();
    await pickClientOption(
      page,
      modal.getByPlaceholder("Search Name or Phone..."),
      S.nour,
    );
    await payMethod(modal, 0).selectOption("CASH");
    await modal.getByTestId("discount-mode-discount").click();
    // POS's discount field has no label of its own (DiscountLine draws the
    // word beside it); use its testid.
    await modal.getByTestId("checkout-discount-input").fill("2");
    await payAmount(modal, 0).fill("20");
    await modal.getByTestId("return-usd").fill("5");
    const sale = waitPost(page, "/api/sales/process");
    await modal.getByTestId("checkout-complete-btn").click();
    expect((await sale).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "pos_sale",
      (x) => x.client_name === S.nour,
    );
    expectDetails(t, {
      kind: "pos_sale",
      discount: { amount: 2, currency: "USD" },
    });
    expectSnapLine(t, "CASH", "USD", 20, "IN");
    expectSnapLine(t, "CASH", "USD", 5, "OUT");
    expectMoved(await drawers(day), d0, "General", "USD", 15);
  });

  test("1.4 Voucher $10 for Hassan, then POS 2 cases paid gift card $10 + cash $14", async () => {
    await go("/vouchers", page.getByPlaceholder("Search or enter client name"));
    await pickClientOption(
      page,
      page.getByPlaceholder("Search or enter client name"),
      S.hassan,
    );
    await page.getByPlaceholder("0.00").first().fill("10");
    await page.getByPlaceholder("e.g. Birthday gift").fill("Birthday gift");
    const v = waitPost(page, "/api/vouchers");
    await page.getByRole("button", { name: "Create Voucher" }).click();
    expect((await v).body.success).toBeTruthy();

    await go(
      "/pos",
      page.getByPlaceholder("Search products by name or barcode..."),
    );
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await posAdd("magsafe", 2);
    const modal = await checkout();
    await pickClientOption(
      page,
      modal.getByPlaceholder("Search Name or Phone..."),
      S.hassan,
    );
    await splitOn(modal);
    await payMethod(modal, 0).selectOption("GIFT_CARD");
    await payAmount(modal, 0).fill("10");
    await addLine(modal);
    await payLine(modal, 1, "CASH", 14, "USD");
    const sale = waitPost(page, "/api/sales/process");
    await modal.getByTestId("checkout-complete-btn").click();
    const { body, request } = await sale;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const pays = request.payments as Array<Record<string, unknown>>;
    expect(pays.find((p) => p.method === "GIFT_CARD")?.voucher_code).toMatch(
      /^GIFT-/,
    );
    const t = await findTxn(
      day,
      before,
      "pos_sale",
      (x) => x.client_name === S.hassan,
    );
    const codes = t.details?.giftCardCodes as string[] | undefined;
    expect(codes?.[0]).toMatch(/^GIFT-/);
    expectMoved(await drawers(day), d0, "General", "USD", 14);
  });

  // ══ Part 2 — OMT / Whish system ════════════════════════════════════════

  async function pickService(label: RegExp): Promise<void> {
    await page
      .getByRole("button", { name: /\(.*\)$/ })
      .filter({ hasText: /OMT fee|% of/ })
      .first()
      .click();
    await page.getByText(label).last().click();
  }

  test("2.1 OMT send Cash to Business $200, fee $4, sender + reference, paid $210", async () => {
    await go("/omt-whish", page.getByRole("button", { name: /OMT\s*↑/ }));
    await page.getByRole("button", { name: /OMT\s*↑/ }).click();
    await pickService(/^Cash to Business/);
    const before = await lastTxnId(day);
    const ref = `C2B-${day.stamp}`;
    await page.getByPlaceholder("0.00").nth(0).fill("200");
    await page.getByTestId("service-omt-fee-input").fill("4");
    await page.locator("#service-sender-name").fill(S.fadi);
    await page.getByPlaceholder("Sender phone").fill(phoneOf(day, 5));
    await page.getByPlaceholder("Optional").first().fill(ref);
    await payMethod(page, 0).selectOption("CASH");
    await payAmount(page, 0).fill("210");
    await page.getByTestId("return-usd").fill("6");
    const res = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: "Record Send" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "omt_whish_transfer",
      (x) => x.details?.reference === ref,
    );
    expectDetails(t, {
      kind: "omt_whish_transfer",
      provider: "OMT",
      direction: "SEND",
      serviceType: "CASH_TO_BUSINESS",
      reference: ref,
      sender: { name: S.fadi, phone: phoneOf(day, 5) },
      omtFee: 4,
      includingFees: false,
    });
    expect(t.details?.receiver, "C2B has no receiver").toBeUndefined();
    expectSnapLine(t, "CASH", "USD", 6, "OUT");
    const sib = (await txnsSince(day, before)).find(
      (x) => x.type === "SUPPLIER_PAYMENT" && x.meta.is_auto === true,
    );
    expect(sib, "auto SUPPLIER_PAYMENT sibling").toBeTruthy();

    const panel = await openDetails(day, t.id, S.fadi);
    await expectPanelLabels(panel, [
      "Reference",
      "Sender",
      "OMT fee",
      "Fees included",
    ]);
    await closeDetails(panel);
  });

  test("2.2 Whish receive $100 through Smoke Partner, fee $2 included, payout $98 [bug 1]", async () => {
    await go("/omt-whish", page.getByRole("button", { name: /WHISH\s*↓/ }));
    await page.getByRole("button", { name: /WHISH\s*↓/ }).click();
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const p0 = await partnerBalance(day, ids.smoke);
    const ref = `WH-${day.stamp}`;
    await page
      .getByRole("button", { name: /Select partner/ })
      .first()
      .click();
    await page.getByRole("option", { name: S.smoke }).click();
    await page.getByPlaceholder("0.00").nth(0).fill("100");
    await page.getByTestId("service-including-fees-toggle").check();
    await page.getByTestId("service-whish-fee-input").fill("2");
    await page.locator("#service-receiver-name").fill(S.ali);
    await page.getByPlaceholder("Receiver phone").fill(phoneOf(day, 6));
    await page.getByPlaceholder("Optional").first().fill(ref);
    await payMethod(page, 0).selectOption("CASH");
    const res = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: "Record Receive" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "omt_whish_transfer",
      (x) => x.details?.reference === ref,
    );
    expectDetails(t, {
      kind: "omt_whish_transfer",
      provider: "WHISH",
      direction: "RECEIVE",
      partner: { id: ids.smoke, mode: "THROUGH" },
      receiver: { name: S.ali, phone: phoneOf(day, 6) },
      whishFee: 2,
      includingFees: true,
    });
    expectPayoutLine(t, "CASH", "USD", 98); // bug 1
    expect((await partnerBalance(day, ids.smoke)).usd - p0.usd).toBeCloseTo(
      100,
      2,
    );
    // The $98 left whichever drawer its leg names, by exactly the legs.
    await expectLegMovedDrawer(day, before, d0, "CASH", "USD", 98, -1);

    const panel = await openDetails(day, t.id, S.ali);
    await expectPanelLabels(panel, ["Receiver", "Whish fee", "Partner"]);
    await bugCheckAsync(1, "panel shows the $98 payout as Out", () =>
      expect(
        panel.locator("tbody tr", { hasText: "98" }).first(),
      ).toContainText(FIXED.payoutDirectionLabel, { timeout: 2_000 }),
    );
    await closeDetails(panel);
  });

  test("2.3 OMT Online Brokerage $50 with Binance fee $0.50 charged to the customer", async () => {
    await go("/omt-whish", page.getByRole("button", { name: /OMT\s*↑/ }));
    await page.getByRole("button", { name: /OMT\s*↑/ }).click();
    await pickService(/^Online Brokerage/);
    const before = await lastTxnId(day);
    const ref = `BRK-${day.stamp}`;
    await page.getByPlaceholder("0.00").nth(0).fill("50");
    await pickClientOption(page, page.locator("#service-sender-name"), S.rami);
    await page.getByPlaceholder("Optional").first().fill(ref);
    await page.getByText("Charge BINANCE fee to customer").click();
    await page.getByPlaceholder("e.g., BINANCE-Main").fill("BINANCE-Main");
    await page.getByPlaceholder("0.00").last().fill("0.5");
    // The UI auto-adds a Customer Account line for the fee — pay it in cash.
    const n = await page.locator('[data-testid^="payment-method-"]').count();
    for (let i = 0; i < n; i++) await payMethod(page, i).selectOption("CASH");
    const res = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: "Record Send" }).click();
    const { body, request } = await res;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    expect(request).toMatchObject({
      omtFee: 0.5,
      payFee: true,
    } satisfies Partial<CreateFinancialServicePayload>);
    expect(request.itemKey).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "omt_whish_transfer",
      (x) => x.details?.reference === ref,
    );
    expectDetails(t, {
      kind: "omt_whish_transfer",
      serviceType: "ONLINE_BROKERAGE",
      brokerage: { payFee: true, fee: 0.5 },
    });
    expect(
      (t.details?.brokerage as Record<string, unknown>).supplierItemKey,
    ).toBeTruthy();
    expect(t.client_name).toBe(S.rami);
  });

  test("2.4 OMT Intra $100 paid from the Whish wallet with the automatic 1% method fee [bug 13]", async () => {
    await go("/omt-whish", page.getByRole("button", { name: /OMT\s*↑/ }));
    await page.getByRole("button", { name: /OMT\s*↑/ }).click();
    await pickService(/^Intra/);
    const before = await lastTxnId(day);
    const ref = `INT-${day.stamp}`;
    await page.getByPlaceholder("0.00").nth(0).fill("100");
    await pickClientOption(page, page.locator("#service-sender-name"), S.nour);
    await page.getByPlaceholder("Optional").first().fill(ref);
    await payMethod(page, 0).selectOption("WHISH");
    let res = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: "Record Send" }).click();
    let r = await res;
    // bug 13: with the automatic method fee the send must be accepted.
    bugCheck(
      13,
      `wallet send with method fee accepted: ${JSON.stringify(r.body)}`,
      () => expect(r.body.success).toBe(true),
    );
    if (!r.body.success) {
      // Workaround so the rest of the day runs: method fee 0 (SHOP_DAY 2.4).
      await page.getByPlaceholder("0.00").last().fill("0");
      res = waitPost(page, "/api/services/transactions");
      await page.getByRole("button", { name: "Record Send" }).click();
      r = await res;
      expect(r.body.success, JSON.stringify(r.body)).toBeTruthy();
    }
    const t = await findTxn(
      day,
      before,
      "omt_whish_transfer",
      (x) => x.details?.reference === ref,
    );
    expectDetails(t, {
      kind: "omt_whish_transfer",
      serviceType: "INTRA",
      reference: ref,
    });
    expect(
      t.snapshot?.lines.some(
        (l) => l.method === "WHISH" && l.direction === "IN",
      ),
    ).toBe(true);
    // bug 13: the method fee is saved on the details.
    bugCheck(13, "paymentMethodFee saved on the details", () =>
      expect(t.details?.paymentMethodFee).toMatchObject({ amount: 1 }),
    );
  });

  // ══ Part 3 — Mobile Recharge ═══════════════════════════════════════════

  async function rechargeTab(name: string): Promise<void> {
    await go(
      "/recharge",
      page.getByRole("button", { name, exact: true }).first(),
    );
    await page.getByRole("button", { name, exact: true }).first().click();
  }

  async function rechargePay(): Promise<Record<string, unknown>> {
    const pay = page.getByRole("button", { name: /^Pay / });
    await expect(pay).toBeEnabled({ timeout: 10_000 });
    const res = waitPost(page, "/api/recharge");
    await pay.click();
    const { body } = await res;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    return body;
  }

  test("3.1 MTC $6 credit to a number, Rami, paid 1,000,000 LBP, 350,000 back, 50,000 to his account", async () => {
    await rechargeTab("MTC");
    const before = await lastTxnId(day);
    const debt0 = await clientDebt(day, ids.rami);
    const number = `03${day.stamp}`;
    await page.getByPlaceholder("XX XXX XXX").fill(number);
    await page.getByRole("button", { name: "$6", exact: true }).click();
    await page.getByRole("button", { name: /Proceed to Pay/ }).click();
    await pickClientOption(
      page,
      page.getByPlaceholder("Search client by name..."),
      S.rami,
    );
    await payMethod(page, 0).selectOption("CASH");
    await payCurrency(page, 0).selectOption("LBP");
    await payAmount(page, 0).fill("1000000");
    // LIRA-334: 400,000 over a 600,000 LBP total is within the 450,000 LBP
    // round-up — "+ Extra" fills in; clear it to give change.
    await clearRoundUpExtra(page);
    await page.getByTestId("return-lbp").fill("350000");
    await expect(page.getByTestId("change-to-account-summary")).toContainText(
      "50,000",
    );
    await rechargePay();
    const t = await findTxn(
      day,
      before,
      "telecom_recharge",
      (x) => x.details?.phone === number,
    );
    expectDetails(t, {
      kind: "telecom_recharge",
      carrier: "MTC",
      type: "CREDIT_TRANSFER",
      phone: number,
      amount: 6,
      defaultPrice: 600_000,
    });
    expect(t.details?.carrierLineId).toBeTruthy();
    expect(t.client_name).toBe(S.rami);
    expectSnapLine(t, "CASH", "LBP", 1_000_000, "IN");
    expectSnapLine(t, "CASH", "LBP", 350_000, "OUT");
    expectSnapLine(t, "CUSTOMER_ACCOUNT", "LBP", 50_000, "OUT");
    expect((await clientDebt(day, ids.rami)).lbp - debt0.lbp).toBeCloseTo(
      -50_000,
      -2,
    );
  });

  test("3.2 Alfa Days 1 month, typed cost $3.5 / price $6, paid $10, $3 back, $1 kept", async () => {
    // A fresh load drops the client the sheet kept from 3.1 (SHOP_DAY 3.2).
    await page.reload();
    await closeAutoCheckpoint(page);
    await rechargeTab("Alfa");
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await page.getByRole("button", { name: "Days", exact: true }).click();
    await page.getByRole("button", { name: "1mo", exact: true }).click();
    await page.getByPlaceholder("0.00").nth(0).fill("3.5");
    await page.getByPlaceholder("0.00").nth(1).fill("6");
    await page.getByRole("button", { name: /Proceed to Pay/ }).click();
    await payMethod(page, 0).selectOption("CASH");
    await payCurrency(page, 0).selectOption("USD");
    await payAmount(page, 0).fill("10");
    // LIRA-334: $4 over a $6 price is within the $5 round-up — clear it.
    await clearRoundUpExtra(page);
    await page.getByTestId("return-usd").fill("3");
    await expect(page.getByTestId("keep-change-summary")).toContainText("$1");
    await rechargePay();
    const t = await findTxn(
      day,
      before,
      "telecom_recharge",
      (x) => x.details?.type === "DAYS" && x.details?.carrier === "ALFA",
    );
    expectDetails(t, {
      kind: "telecom_recharge",
      typed: { costUsd: 3.5, priceUsd: 6 },
      days: 30,
    });
    expect(t.snapshot?.kept?.usd).toBeCloseTo(1, 2);
    expectMoved(await drawers(day), d0, "General", "USD", 7);
  });

  test("3.3 Alfa Gift 7 GB to Maya Fares (name only), − 50,000 LBP discount", async () => {
    await rechargeTab("Alfa Gift");
    const before = await lastTxnId(day);
    await page.getByText("7 GB", { exact: true }).click();
    await page.getByRole("button", { name: "Pay", exact: true }).click();
    await page.getByPlaceholder("Client name (optional)").fill(S.maya);
    await page.getByTestId("discount-mode-discount").click();
    await page.getByLabel("Discount", { exact: true }).fill("50000");
    await payMethod(page, 0).selectOption("CASH");
    await rechargePay();
    const t = await findTxn(
      day,
      before,
      "telecom_recharge",
      (x) => x.client_name === S.maya,
    );
    expectDetails(t, {
      kind: "telecom_recharge",
      type: "ALFA_GIFT",
      giftTier: { key: "7GB" },
      discount: { amount: 50_000, currency: "LBP" },
    });
    expect(t.client_id, "name only — no client").toBeNull();
  });

  test("3.4 basket: Katsh alfa 4.5 + mtc 3.79 + Katsh bill 500,000 + iPick 30d → Joe Karam, one auto session [bug 8]", async () => {
    await rechargeTab("Katsh");
    const before = await lastTxnId(day);
    const search = page.getByPlaceholder(/Search Katsh items/i);
    for (const label of ["4.5", "3.79"]) {
      await search.fill(label);
      await page.getByText("10d validity").first().click();
    }
    await search.fill("");
    await page.getByPlaceholder("0", { exact: true }).first().fill("500000");
    await page.getByRole("button", { name: /^Add Bill$/ }).click();
    await expect(page.getByText(/Pending: 500,000 LBP/)).toBeVisible();
    await page
      .getByRole("button", { name: "iPick", exact: true })
      .first()
      .click();
    await page.getByText("30d validity").first().click();
    await page.getByRole("button", { name: /Proceed to Pay/ }).click();
    await expect(page.getByTestId("payment-sheet-items")).toBeVisible();
    await page.getByPlaceholder("Search client by name...").fill(S.joe);
    await page
      .getByPlaceholder("Phone number (registers a new client)")
      .fill(phoneOf(day, 7));
    // The amount is auto-filled with the total; reset the method to cash.
    await payMethod(page, 0).selectOption("CASH");
    const checkout = waitPost(page, "/api/recharge-basket/checkout");
    await page.getByRole("button", { name: /^Pay / }).click();
    const { body } = await checkout;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const sessionId = body.sessionId as number;
    expect(sessionId).toBeGreaterThan(0);
    ids.basketSession = sessionId;

    const rows = (await txnsSince(day, before)).filter(
      (x) => x.details?.paid_in_session === sessionId,
    );
    const kinds = rows.map((r) => String(r.details?.kind)).sort();
    expect(kinds).toEqual([
      "catalog_sale",
      "catalog_sale",
      "catalog_sale",
      "provider_bill",
    ]);
    for (const r of rows) {
      expect(r.client_name).toBe(S.joe);
      expect(r.client_phone).toBe(phoneOf(day, 7));
      expect(r.snapshot?.session_id).toBe(sessionId);
    }
    for (const r of rows.filter((x) => x.details?.kind === "catalog_sale")) {
      const items = (r.details?.items ?? []) as Array<Record<string, unknown>>;
      // bug 8: every catalog item carries a readable label.
      bugCheck(8, `#${r.id} catalog items carry a label`, () =>
        expect(items.every((i) => typeof i.label === "string")).toBe(true),
      );
    }
    const ipick = rows.find((r) => r.details?.provider === "iPick");
    expect(ipick, "iPick card row").toBeTruthy();
    ids.ipickBasketTxn = ipick!.id;
    const active = await getJson<{ sessions?: unknown[] }>(
      day,
      "/api/sessions/active-list",
    );
    expect(active.sessions ?? []).toHaveLength(0);
  });

  test("3.4b For Partner order lists partners and books on the partner [bug 14]", async () => {
    await rechargeTab("Katsh");
    const before = await lastTxnId(day);
    const p0 = await partnerBalance(day, ids.smoke);
    await page.getByPlaceholder(/Search Katsh items/i).fill("4.5");
    await page.getByText("10d validity").first().click();
    await page.getByTestId("katsh-for-partner-toggle").check();
    // bug 14: the picker lists partners.
    const none = page.getByText(FIXED.noPartnersText);
    const noPartners = await none.isVisible();
    bugCheck(14, "For Partner lists partners", () =>
      expect(noPartners).toBe(false),
    );
    if (await none.isVisible()) {
      // Leave no picked item behind for the next steps.
      await page.reload();
      await closeAutoCheckpoint(page);
      return;
    }
    const pick = page.getByRole("button", { name: /Select partner/ });
    if ((await pick.count()) > 0) {
      await pick.first().click();
      await page.getByRole("option", { name: S.smoke }).click();
    }
    const order = waitPost(page, "/api/recharge-basket/partner-order");
    await page.getByRole("button", { name: /Submit to Partner/i }).click();
    const { body } = await order;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const t = await findTxn(day, before, "catalog_sale", (x) => {
      const p = x.details?.partner as { id?: number } | undefined;
      return p?.id === ids.smoke;
    });
    expect((t.details?.partner as { mode: string }).mode).toBe("FOR");
    // The partner owes the card's selling price (LBP catalog).
    expect((await partnerBalance(day, ids.smoke)).lbp - p0.lbp).toBeGreaterThan(
      0,
    );
  });

  test("3.5 Whish App send $50 for Rana, paid $60, $10 back", async () => {
    await rechargeTab("Whish App");
    await page
      .locator("button")
      .filter({ hasText: /^Transfer$/ })
      .first()
      .click();
    const before = await lastTxnId(day);
    await page.locator("#transfer-amount").fill("50");
    await page.getByPlaceholder("Sender name").fill(S.rana);
    await page.getByPlaceholder("Sender phone").fill(phoneOf(day, 8));
    await page.getByRole("button", { name: /Proceed to Pay/ }).click();
    await payMethod(page, 0).selectOption("CASH");
    await payCurrency(page, 0).selectOption("USD");
    await payAmount(page, 0).fill("60");
    await page.getByTestId("return-usd").fill("10");
    const res = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: /^Pay / }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "wallet_transfer",
      (x) => x.client_name === S.rana,
    );
    expectDetails(t, {
      kind: "wallet_transfer",
      provider: "WHISH_APP",
      direction: "SEND",
    });
    expectSnapLine(t, "CASH", "USD", 10, "OUT");
  });

  test("3.6 Whish App receive $80, fee $1.50 added by the sender, to Hassan, payout cash [bug 1]", async () => {
    await rechargeTab("Whish App");
    await page
      .locator("button")
      .filter({ hasText: /^Transfer$/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Receive", exact: true })
      .first()
      .click();
    const before = await lastTxnId(day);
    await page.locator("#transfer-amount").fill("80");
    await page.getByPlaceholder("0.80 (auto)").fill("1.5");
    await page.getByTestId("fee-mode-sender").click();
    await pickClientOption(
      page,
      page.getByPlaceholder("Receiver name"),
      S.hassan,
    );
    await page.getByRole("button", { name: /Proceed to Pay/ }).click();
    const n = await page.locator('[data-testid^="payment-method-"]').count();
    for (let i = 0; i < n; i++) await payMethod(page, i).selectOption("CASH");
    const res = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: /^Pay / }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "wallet_transfer",
      (x) => x.client_name === S.hassan,
    );
    expectDetails(t, {
      kind: "wallet_transfer",
      direction: "RECEIVE",
      feePaidBy: "SENDER",
      providerFee: 1.5,
      cashoutMethod: "CASH",
    });
    expect(t.client_id).toBe(ids.hassan);
    expectPayoutLine(t, "CASH", "USD", 80); // bug 1
  });

  test("3.7 Binance cash out 150 USDT, fee $3 deducted, Walid, payout $147 [bug 1]", async () => {
    await rechargeTab("Binance");
    await page
      .locator("button")
      .filter({ hasText: /^Cash Out$/ })
      .first()
      .click();
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const ref = `TRC20-${day.stamp}`;
    await page.locator("#crypto-amount").fill("150");
    await page.getByPlaceholder("0.00").nth(1).fill("3");
    await page.getByTestId("crypto-fee-mode-deducted").click();
    await page.getByPlaceholder("Optional").first().fill(S.walid);
    await page.getByPlaceholder("Registers new client").fill(phoneOf(day, 9));
    await page.getByPlaceholder("Wallet, reference...").fill(ref);
    await page
      .getByRole("button", { name: "Confirm Cash Out", exact: true })
      .click();
    const n = await page.locator('[data-testid^="payment-method-"]').count();
    for (let i = 0; i < n; i++) await payMethod(page, i).selectOption("CASH");
    const res = waitPost(page, "/api/services/transactions");
    await page.getByRole("button", { name: /Confirm Cash Out \$/ }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "crypto_transfer",
      (x) => x.details?.walletOrReference === ref,
    );
    expectDetails(t, {
      kind: "crypto_transfer",
      direction: "RECEIVE",
      amountUsdt: 150,
      fee: 3,
      feePaidBy: "DEDUCTED",
      walletOrReference: ref,
    });
    expect(t.client_name).toBe(S.walid);
    expectPayoutLine(t, "CASH", "USD", 147); // bug 1
    expectMoved(await drawers(day), d0, "Binance", "USDT", 150);
    await expectLegMovedDrawer(day, before, d0, "CASH", "USD", 147, -1);
  });

  test("3.8 Binance send 40 USDT, fee $1, Karim, paid 3,700,000 LBP", async () => {
    await rechargeTab("Binance");
    await page
      .locator("button")
      .filter({ hasText: /^Send Crypto$/ })
      .first()
      .click();
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const ref = `TX-${day.stamp}`;
    await page.locator("#crypto-amount").fill("40");
    await page.getByPlaceholder("0.00").nth(1).fill("1");
    const name = page.getByPlaceholder("Optional").first();
    await name.pressSequentially(S.karim.slice(0, 8), { delay: 20 });
    await page
      .getByRole("button", { name: new RegExp(S.karim) })
      .first()
      .click();
    await page.getByPlaceholder("Wallet, reference...").fill(ref);
    await page.getByRole("button", { name: /Proceed to Pay/ }).click();
    await payMethod(page, 0).selectOption("CASH");
    await payCurrency(page, 0).selectOption("LBP");
    await payAmount(page, 0).fill("3700000");
    // LIRA-334: ≈ $0.57 over the $41 total is within the $5 round-up — clear
    // it, or the change box (and its "all in LBP" button) never opens.
    await clearRoundUpExtra(page);
    await page.getByTestId("return-all-lbp").click();
    const res = waitPost(page, "/api/services/transactions");
    await page
      .getByRole("button", { name: /^Pay |Confirm Payment/ })
      .last()
      .click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "crypto_transfer",
      (x) => x.details?.walletOrReference === ref,
    );
    expectDetails(t, {
      kind: "crypto_transfer",
      direction: "SEND",
      amountUsdt: 40,
      fee: 1,
    });
    expect(t.client_name).toBe(S.karim);
    expectSnapLine(t, "CASH", "LBP", 3_700_000, "IN");
    const d1 = await drawers(day);
    expectMoved(d1, d0, "Binance", "USDT", -40);
  });

  test("3.9 Whish App credits bought from Nour: 100, fee $3 included, payout $97 [bug 1]", async () => {
    await rechargeTab("Whish App");
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await page
      .getByRole("button", { name: /^Top-?Up$/ })
      .first()
      .click();
    const modal = topModal(page);
    await modal.getByRole("button", { name: "From Client" }).click();
    await modal.getByPlaceholder("0.00").first().fill("100");
    await modal.getByPlaceholder("1.00 (auto)").fill("3");
    await modal.getByText("Fee included in amount").click();
    await pickClientOption(
      page,
      modal.getByPlaceholder(/client/i).first(),
      S.nour,
    );
    const res = waitPost(page, "/api/recharge/top-up-from-client");
    await modal
      .getByRole("button", { name: "Buy Credits from Client" })
      .click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "wallet_topup",
      (x) => x.details?.source === "CLIENT",
    );
    expectDetails(t, {
      kind: "wallet_topup",
      source: "CLIENT",
      includingFees: true,
      fee: 3,
    });
    expect(t.client_name).toBe(S.nour);
    expectPayoutLine(t, "CASH", "USD", 97); // bug 1
    await expectLegMovedDrawer(day, before, d0, "CASH", "USD", 97, -1);
  });

  // ══ Part 4 — Repair ════════════════════════════════════════════════════

  test("4.1 repair in LBP with a part, LBP discount, 50,000 kept on Hassan's account [bug 4 label]", async () => {
    await go("/maintenance", page.getByPlaceholder("e.g., iPhone 13 Pro Max"));
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const issue = `Cracked back glass and front screen flickers green after a drop; Face ID stopped working, customer wants data kept SD${day.stamp}`;
    await page
      .getByPlaceholder("e.g., iPhone 13 Pro Max")
      .fill("iPhone 13 Pro Max");
    await page
      .getByPlaceholder("e.g., Broken Screen, Battery Replacement...")
      .fill(issue);
    await page.getByPlaceholder("No warranty").fill("3");
    await page
      .getByRole("button", { name: "LBP", exact: true })
      .first()
      .click();
    await page.getByPlaceholder("0", { exact: true }).nth(0).fill("1300000");
    await page.getByPlaceholder("0", { exact: true }).nth(1).fill("5400000");
    await page.getByText("Search all categories").click();
    await page.getByPlaceholder("Search all products...").fill(pname("glass"));
    await page.getByText(pname("glass")).first().click();
    await page.getByRole("button", { name: /Proceed to Checkout/ }).click();
    const modal = page.getByTestId("checkout-modal");
    await expect(modal).toBeVisible();
    // bug 25: the client arrives empty at checkout — pick Hassan here.
    await pickClientOption(
      page,
      modal.getByPlaceholder("Search Name or Phone..."),
      S.hassan,
    );
    await payMethod(modal, 0).selectOption("CASH");
    await payCurrency(modal, 0)
      .selectOption("LBP")
      .catch(() => undefined);
    await modal.getByTestId("discount-mode-discount").click();
    await modal.getByLabel("Discount", { exact: true }).fill("345000");
    await payAmount(modal, 0).fill("6000000");
    await modal.getByTestId("return-lbp").fill("450000");
    const res = waitPost(page, "/api/maintenance");
    await modal.getByTestId("checkout-complete-btn").click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "maintenance_job",
      (x) => x.details?.issue === issue,
    );
    expectDetails(t, {
      kind: "maintenance_job",
      device: "iPhone 13 Pro Max",
      issue,
      warrantyMonths: 3,
      repairCost: { lbp: 1_300_000 },
      discount: { amount: 345_000, currency: "LBP" },
    });
    expect(t.details?.warrantyUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parts = (t.details?.parts ?? []) as Array<Record<string, unknown>>;
    expect(parts[0]).toMatchObject({ name: pname("glass"), unitCost: 1 });
    expect(t.client_id).toBe(ids.hassan);
    expectSnapLine(t, "CASH", "LBP", 6_000_000, "IN");
    expectSnapLine(t, "CASH", "LBP", 450_000, "OUT");
    expectSnapLine(t, "CUSTOMER_ACCOUNT", "LBP", 50_000, "OUT");
    expectMoved(await drawers(day), d0, "General", "LBP", 5_550_000);

    const panel = await openDetails(day, t.id, S.hassan);
    await expectPanelLabels(panel, [
      "Device",
      "Issue",
      "Warranty months",
      "Parts",
    ]);
    await expect(panel).toContainText(issue);
    // bug 4: the status reads in plain words.
    await bugCheckAsync(4, "maintenance status in plain words", () =>
      expect(panel).toContainText(FIXED.deliveredPaidLabel, { timeout: 2_000 }),
    );
    await closeDetails(panel);
  });

  // ══ Part 5 — Exchange ══════════════════════════════════════════════════

  test("5.1 exchange $100 → LBP at a typed 88,500, Walid, paid 8,800,000, 50,000 kept", async () => {
    await go("/exchange", page.getByTestId("exchange-swap-button"));
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await page.getByRole("button", { name: "USD", exact: true }).nth(0).click();
    await page.getByRole("button", { name: "LBP", exact: true }).nth(1).click();
    await page.getByPlaceholder("0.00").first().fill("100");
    await page.getByTestId("exchange-direct-rate-input").fill("88500");
    await pickClientOption(
      page,
      page.getByPlaceholder("Walk-in Client").first(),
      S.walid,
    );
    await page.getByRole("button", { name: /Proceed to Payout/ }).click();
    await page
      .locator('[data-testid^="payment-amount-"]')
      .last()
      .fill("8800000");
    await expect(page.getByText(/Change kept \(profit\)/)).toBeVisible();
    const res = waitPost(page, "/api/exchange/transactions");
    await page.getByRole("button", { name: /^Pay/ }).last().click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "exchange",
      (x) => x.client_name === S.walid,
    );
    expectDetails(t, { kind: "exchange", from: "USD", to: "LBP" });
    const legs = (t.details?.legs ?? []) as Array<Record<string, unknown>>;
    expect(legs[0]).toMatchObject({
      rate: 88_500,
      marketRate: 89_500,
      overridden: true,
    });
    expect(t.snapshot?.kept?.lbp).toBeCloseTo(50_000, -2);
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "USD", 100);
    expectMoved(d1, d0, "General", "LBP", -8_800_000);
  });

  test("5.2 exchange 50 EUR → LBP via USD, Marc Dubois [bug 6]", async () => {
    await go("/exchange", page.getByTestId("exchange-swap-button"));
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await page.getByRole("button", { name: "More" }).first().click();
    await page.getByPlaceholder("Search currency...").fill("EUR");
    await page.getByRole("button", { name: /EUR/ }).last().click();
    await page.getByRole("button", { name: "LBP", exact: true }).nth(1).click();
    await page.getByPlaceholder("0.00").first().fill("50");
    await page.getByPlaceholder("Walk-in Client").first().fill(S.marc);
    await page.getByRole("button", { name: /Proceed to Payout/ }).click();
    const res = waitPost(page, "/api/exchange/transactions");
    await page.getByRole("button", { name: /^Pay/ }).last().click();
    const { body, request } = await res;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "exchange",
      (x) => x.client_name === S.marc,
    );
    expectDetails(t, { kind: "exchange", from: "EUR", to: "LBP", via: "USD" });
    const legs = (t.details?.legs ?? []) as Array<Record<string, unknown>>;
    expect(legs).toHaveLength(2);
    // Leg 1's profit staying 0 is by design (owner 2026-10-16), so it is
    // not checked here. Only the amount_usd float noise is still open.
    bugCheck(6, `amount_usd in whole cents (${t.amount_usd})`, () =>
      expect(isWholeUnit(t.amount_usd, "USD")).toBe(true),
    );
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "EUR", 50);
    expectMoved(d1, d0, "General", "LBP", -Number(request.amountOut));
  });

  // ══ Part 6 — Loto ══════════════════════════════════════════════════════

  test("6.1 Loto ticket 500,000 LBP, typed Abu Fadi, paid $6, 34,000 LBP back", async () => {
    await go("/loto", page.getByPlaceholder("Enter sale amount"));
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await page.getByPlaceholder("Enter sale amount").fill("500000");
    await page.getByPlaceholder("Client name (optional)").fill(S.abuFadi);
    await page
      .getByPlaceholder("Phone", { exact: true })
      .fill(phoneOf(day, 11));
    await payMethod(page, 0).selectOption("CASH");
    await payCurrency(page, 0).selectOption("USD");
    await payAmount(page, 0).fill("6");
    // LIRA-334: 34,000 over a 500,000 LBP ticket is within the round-up —
    // clear it to give the change.
    await clearRoundUpExtra(page);
    await page.getByTestId("return-lbp").fill("34000");
    const res = waitPost(page, "/api/loto/sell");
    await page.getByRole("button", { name: "Sell Ticket" }).last().click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "loto_sale",
      (x) => x.client_name === S.abuFadi,
    );
    expectDetails(t, { kind: "loto_sale", saleAmount: 500_000 });
    expect(t.client_id, "typed walk-in auto-created").toBeTruthy();
    expectSnapLine(t, "CASH", "USD", 6, "IN");
    expectSnapLine(t, "CASH", "LBP", 34_000, "OUT");
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "USD", 6);
    expectMoved(d1, d0, "General", "LBP", -34_000);
  });

  test("6.2 Loto cash prize 2,000,000 LBP, ticket number [bug 1]", async () => {
    await go("/loto", page.getByRole("button", { name: "Cash Prize" }));
    await page.getByRole("button", { name: "Cash Prize" }).click();
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const ticket = `LT-${day.stamp}`;
    await page.getByPlaceholder("Enter prize amount").fill("2000000");
    await page
      .getByPlaceholder("Winning ticket number (optional)")
      .fill(ticket);
    const res = waitPost(page, "/api/loto/cash-prizes");
    await page.getByRole("button", { name: "Record Cash Prize" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "loto_prize",
      (x) => x.details?.ticketNumber === ticket,
    );
    expectDetails(t, { kind: "loto_prize", ticketNumber: ticket });
    expect(t.details?.prizeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expectPayoutLine(t, "CASH", "LBP", 2_000_000); // bug 1
    expectMoved(await drawers(day), d0, "General", "LBP", -2_000_000);
  });

  // ══ Part 7 — Custom Services and Hold Money ════════════════════════════

  async function csCategory(name: string): Promise<void> {
    await go(
      "/custom-services",
      page.getByRole("button", { name, exact: true }),
    );
    await page.getByRole("button", { name, exact: true }).click();
  }

  test("7.1 Custom Service Repair typed WITHOUT Enter, $8/$25, Rami, split $15 + 900,000 LBP [bug 11]", async () => {
    await csCategory("Repair");
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const desc = `Charging port replacement - Galaxy A52 SD${day.stamp}`;
    const note = `Customer waits; port was corroded SD${day.stamp}`;
    // Typed, NOT committed with Enter — the cashier's natural flow (bug 11).
    await page.getByTestId("custom-service-item-search").fill(desc);
    await page.locator("#svc-cost").fill("8");
    await page.locator("#svc-price").fill("25");
    await pickClientOption(page, page.locator("#svc-client"), S.rami);
    await page.locator("#svc-note").fill(note);
    await splitOn(page);
    await payLine(page, 0, "CASH", 15, "USD");
    await addLine(page);
    await payLine(page, 1, "CASH", 900_000, "LBP");
    // LIRA-334: 10,000 LBP (≈ $0.11) over the $25 price is within the $5
    // round-up — clear it to give the change.
    await clearRoundUpExtra(page);
    await page.getByTestId("return-lbp").fill("10000");
    const res = waitPost(page, "/api/custom-services");
    await page.getByRole("button", { name: "Submit Service" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "custom_service",
      (x) => x.details?.note === note,
    );
    // bug 11: the typed description is kept.
    bugCheck(11, "description typed without Enter is kept", () =>
      expect(t.details?.description).toBe(desc),
    );
    expectDetails(t, { kind: "custom_service", note, price: { usd: 25 } });
    expect(t.client_id).toBe(ids.rami);
    expectSnapLine(t, "CASH", "LBP", 10_000, "OUT");
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "USD", 15);
    expectMoved(d1, d0, "General", "LBP", 890_000);
  });

  test("7.2 Custom Service Repair in LBP, typed Samir (no phone, no client)", async () => {
    await csCategory("Repair");
    const before = await lastTxnId(day);
    const desc = `Screen replacement - iPhone 11 SD${day.stamp}`;
    const search = page.getByTestId("custom-service-item-search");
    await search.fill(desc);
    await search.press("Enter");
    await expect(page.locator("#svc-description")).toHaveValue(desc);
    await page
      .getByRole("button", { name: "LBP", exact: true })
      .first()
      .click();
    await page.locator("#svc-cost").fill("2500000");
    await page.locator("#svc-price").fill("4500000");
    await page.locator("#svc-client").fill(S.samir);
    await page
      .locator("#svc-note")
      .fill("Customer brings the phone back tomorrow");
    await payMethod(page, 0).selectOption("CASH");
    const res = waitPost(page, "/api/custom-services");
    await page.getByRole("button", { name: "Submit Service" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "custom_service",
      (x) => x.details?.description === desc,
    );
    expectDetails(t, {
      kind: "custom_service",
      description: desc,
      price: { lbp: 4_500_000 },
    });
    expect(t.client_name).toBe(S.samir);
    expect(t.client_id).toBeNull();
  });

  test("7.3 Custom Service Other via Flow Partner, $30/$45, Hassan, paid $50, $5 back", async () => {
    await csCategory("Other");
    const before = await lastTxnId(day);
    const p0 = await partnerBalance(day, ids.flow);
    const desc = `Board-level repair Galaxy S21 (no power) - partner lab SD${day.stamp}`;
    const search = page.getByTestId("custom-service-item-search");
    await search.fill(desc);
    await search.press("Enter");
    await page.getByTestId("custom-service-via-partner-toggle").click();
    const pick = page.getByRole("button", { name: /Select partner/ });
    if ((await pick.count()) > 0) {
      await pick.first().click();
      await page.getByRole("option", { name: S.flow }).click();
    }
    await page.locator("#svc-cost").fill("30");
    await page.locator("#svc-price").fill("45");
    await pickClientOption(page, page.locator("#svc-client"), S.hassan);
    await payLine(page, 0, "CASH", 50, "USD");
    // LIRA-334 does not apply: a Via Partner service offers no "+ Extra", so
    // the exact-$5 overpay opens the change box straight away.
    await page.getByTestId("return-usd").fill("5");
    const res = waitPost(page, "/api/custom-services");
    await page.getByRole("button", { name: "Submit Service" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "custom_service",
      (x) => x.details?.description === desc,
    );
    expectDetails(t, {
      kind: "custom_service",
      partner: { id: ids.flow, mode: "VIA" },
    });
    expect((await partnerBalance(day, ids.flow)).usd - p0.usd).toBeCloseTo(
      -30,
      2,
    );
  });

  test("7.4 Hold Money $200 + 1,000,000 LBP for Georges, received split cash [bug 12]", async () => {
    await csCategory("Hold Money");
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const notes = `Deposit for used car deal, collects Friday SD${day.stamp}`;
    await page.locator("#hold-client").fill(S.georges);
    await page.locator("#hold-phone").fill(phoneOf(day, 0));
    await page.locator("#hold-note").fill(notes);
    // Amounts first: the payment panel remounts when they change.
    await page.locator("#hold-usd").fill("200");
    await page.locator("#hold-lbp").fill("1000000");
    // bug 12: the method list is not empty.
    const options = payMethod(page, 0).locator("option");
    const methodCount = await options.count();
    bugCheck(12, "Hold Money method list is not empty", () =>
      expect(methodCount).toBeGreaterThan(0),
    );
    await splitOn(page);
    await payLine(page, 0, "CASH", 200, "USD");
    await addLine(page);
    await payLine(page, 1, "CASH", 1_000_000, "LBP");
    const res = waitPost(page, "/api/hold-money");
    await page.getByTestId("hold-money-submit").click();
    const { body } = await res;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "hold_money",
      (x) => x.details?.notes === notes,
    );
    expectDetails(t, { kind: "hold_money", action: "CREATE", notes });
    expect(t.client_name).toBe(S.georges);
    ids.holdTxn = t.id;
    const holdId = (body.id ??
      (body.data as { id?: number } | undefined)?.id ??
      t.source_id) as number;
    expect(holdId).toBeTruthy();
    ids.hold = holdId;
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "USD", 200);
    expectMoved(d1, d0, "General", "LBP", 1_000_000);
  });

  async function holdPickup(usd: number, lbp: number): Promise<Txn> {
    await csCategory("Hold Money");
    const before = await lastTxnId(day);
    await page.getByTestId(`hold-collect-${ids.hold}`).click();
    const sheet = page.getByTestId("hold-money-pickup-sheet");
    await expect(sheet).toBeVisible();
    await sheet.getByTestId("hold-pickup-usd").fill(String(usd));
    await sheet.getByTestId("hold-pickup-lbp").fill(String(lbp));
    if (usd > 0 && lbp > 0) {
      await splitOn(sheet);
      await payLine(sheet, 0, "CASH", usd, "USD");
      await addLine(sheet);
      await payLine(sheet, 1, "CASH", lbp, "LBP");
    } else {
      await payLine(sheet, 0, "CASH", usd || lbp, usd ? "USD" : "LBP");
    }
    const res = waitPost(page, `/api/hold-money/${ids.hold}/collect`);
    await sheet.getByTestId("hold-money-pickup-submit").click();
    expect((await res).body.success).toBeTruthy();
    return findTxn(
      day,
      before,
      "hold_money",
      (x) => x.details?.action === "COLLECT",
    );
  }

  test("7.5 Hold pickup $100 cash (partial) [bug 1]", async () => {
    const d0 = await drawers(day);
    const t = await holdPickup(100, 0);
    expect(t.client_name).toBe(S.georges);
    expectPayoutLine(t, "CASH", "USD", 100); // bug 1
    expectMoved(await drawers(day), d0, "General", "USD", -100);
  });

  test("7.6 Hold final pickup $100 + 1,000,000 LBP", async () => {
    const d0 = await drawers(day);
    const t = await holdPickup(100, 1_000_000);
    expectPayoutLine(t, "CASH", "LBP", 1_000_000); // bug 1
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "USD", -100);
    expectMoved(d1, d0, "General", "LBP", -1_000_000);
  });

  // ══ Part 8 — Customer session ══════════════════════════════════════════
  // Unverified selectors (no cashier run reached checkout on 2026-10-16).
  // The customer is started WITHOUT a phone so unreturned change is KEPT
  // (with a client it would go to their account instead).

  const sess = {
    id: 0,
    before: 0,
    d0: {} as Awaited<ReturnType<typeof drawers>>,
  };
  const sessionButton = () =>
    page
      .locator("button")
      .filter({ hasText: /Session - / })
      .first();

  test("8.1 session: start a customer session (name only)", async () => {
    sess.before = await lastTxnId(day);
    sess.d0 = await drawers(day);
    await go(
      "/pos",
      page.getByPlaceholder("Search products by name or barcode..."),
    );
    await page
      .getByRole("button", { name: /New Customer/ })
      .first()
      .click();
    await page.locator("#customer-name").fill(S.sessionCustomer);
    await page.locator("#customer-notes").fill("Walk-in, phone + recharge");
    const started = waitPost(page, "/api/sessions/start");
    await page.getByRole("button", { name: "Start Session" }).click();
    sess.id = (await started).body.sessionId as number;
    expect(sess.id).toBeGreaterThan(0);
    await expect(sessionButton()).toBeVisible({ timeout: 20_000 });
    const active = await getJson<{ sessions?: Array<{ id: number }> }>(
      day,
      "/api/sessions/active-list",
    );
    expect((active.sessions ?? []).map((x) => x.id)).toContain(sess.id);
  });

  test("8.2 session: POS cable + charger into the session cart", async () => {
    await go(
      "/pos",
      page.getByPlaceholder("Search products by name or barcode..."),
    );
    await posAdd("cable");
    await posAdd("charger");
    await page.getByRole("button", { name: /Add to Session Cart/i }).click();
    await expect(
      page.locator("button").filter({ hasText: "items: 1" }),
    ).toBeVisible();
  });

  test("8.3 session: MTC $3 credit into the session cart", async () => {
    await rechargeTab("MTC");
    await page.getByPlaceholder("XX XXX XXX").fill(phoneOf(day, 14));
    await page.getByRole("button", { name: "$3", exact: true }).click();
    await page.getByRole("button", { name: /Add to Cart/i }).click();
    await expect(
      page.locator("button").filter({ hasText: "items: 2" }),
    ).toBeVisible();
  });

  test("8.4 session: Katsh alfa 4.5 into the session cart; For Partner hidden", async () => {
    await rechargeTab("Katsh");
    // For Partner is hidden during a session.
    await expect(page.getByTestId("katsh-for-partner-toggle")).toHaveCount(0);
    await page.getByPlaceholder(/Search Katsh items/i).fill("4.5");
    await page.getByText("10d validity").first().click();
    await page
      .getByRole("button", { name: /Add to Cart|Proceed to Pay/i })
      .first()
      .click();
    await expect(
      page.locator("button").filter({ hasText: "items: 3" }),
    ).toBeVisible();
  });

  test("8.5 session checkout: Whish Wallet $10 + Cash $40, + $1 extra, change kept", async () => {
    // The session panel opens on click, not hover (owner 2026-10-16).
    await sessionButton().click();
    await page.getByRole("button", { name: /Checkout \(3 items?\)/i }).click();
    await expect(page.getByText("Session Checkout")).toBeVisible();
    const pay = page.getByTestId("multi-payment-input");
    // The $1 extra is typed BEFORE paying: a typed extra is the cashier's own,
    // so the LIRA-334 round-up never fills over it — the change box opens as
    // before.
    await pay.getByTestId("discount-mode-extra").click();
    await pay.getByLabel("Extra", { exact: true }).fill("1");
    await splitOn(pay);
    await payLine(pay, 0, "WHISH", 10, "USD");
    await addLine(pay);
    await payLine(pay, 1, "CASH", 40, "USD");
    await pay.getByTestId("change-keep-all").click();
    await expect(pay.getByTestId("keep-change-summary")).toBeVisible();
    const done = waitPost(page, "/api/sessions/checkout");
    await page.getByRole("button", { name: "Confirm Checkout" }).click();
    expect((await done).body.success).toBeTruthy();
    await expect(page.getByText("Checkout Complete")).toBeVisible({
      timeout: 15_000,
    });

    const rows = await txnsSince(day, sess.before);
    const inSession = rows.filter(
      (r) =>
        r.details?.paid_in_session === sess.id ||
        r.session_id === sess.id ||
        (r.details?.kind === "session_sibling" &&
          r.details?.sessionId === sess.id),
    );
    const items = inSession.filter(
      (r) => r.details?.kind !== "session_sibling",
    );
    expect(items.length, "one row per cart item").toBeGreaterThanOrEqual(3);
    for (const r of items) expect(r.client_name).toBe(S.sessionCustomer);
    const roles = inSession
      .filter((r) => r.details?.kind === "session_sibling")
      .map((r) => r.details?.role);
    expect(roles).toEqual(expect.arrayContaining(["EXTRA", "KEPT_CHANGE"]));
    const active = await getJson<{ sessions?: unknown[] }>(
      day,
      "/api/sessions/active-list",
    );
    expect(active.sessions ?? []).toHaveLength(0);
    // The $40 cash went into the drawer its leg names, by exactly the legs.
    await expectLegMovedDrawer(day, sess.before, sess.d0, "CASH", "USD", 40, 1);
  });

  // ══ Part 9 — Money and accounts ════════════════════════════════════════

  test("9.1 expense: Bill $18.50, handed $20, $1 back, $0.50 kept [bug 1]", async () => {
    await go("/expenses", page.locator("#expense-description"));
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const desc = `Generator subscription October, 5A line - receipt #A-${day.stamp}`;
    await page.locator("#expense-description").fill(desc);
    await page.getByRole("button", { name: "Shop Supply" }).click();
    await page.getByRole("option", { name: "Bill" }).click();
    await page.locator("#expense-bill-amount").fill("18.5");
    await page.getByTestId("expense-bill-currency-USD").click();
    await payLine(page, 0, "CASH", 20, "USD");
    await page.getByTestId("return-usd").fill("1");
    await expect(page.getByTestId("keep-change-summary")).toBeVisible();
    const res = waitPost(page, "/api/expenses");
    await page.getByRole("button", { name: "Record Expense" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "expense",
      (x) => x.details?.description === desc,
    );
    expectDetails(t, {
      kind: "expense",
      category: "Bill",
      description: desc,
      billAmount: { amount: 18.5, currency: "USD" },
    });
    expect(t.details?.expenseDate).toBeTruthy();
    expectPayoutLine(t, "CASH", "USD", 20); // bug 1: the $20 handed is OUT
    expect(t.snapshot?.kept?.usd).toBeCloseTo(0.5, 2);
    expect(t.amount_usd).toBeCloseTo(-19, 2);
    expectMoved(await drawers(day), d0, "General", "USD", -19);
  });

  test("9.2 Accounts: cash advance (debt) $30 to Nour [bug 1]", async () => {
    await go("/debts", page.getByRole("button", { name: "Add Credit / Debt" }));
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const debt0 = await clientDebt(day, ids.nour);
    const note = `Cash advance to Nour until Friday payday SD${day.stamp}`;
    await page.getByRole("button", { name: "Add Credit / Debt" }).click();
    const modal = topModal(page);
    await modal.getByRole("button", { name: "Debt", exact: true }).click();
    await pickClientOption(
      page,
      modal.getByPlaceholder("Search client by name or phone..."),
      S.nour,
    );
    await modal.getByPlaceholder("0.00").first().fill("30");
    await modal.getByPlaceholder("Optional note...").fill(note);
    await expect(
      modal.getByTestId("account-cash-moved-toggle").locator("input"),
    ).toBeChecked();
    const res = waitPost(page, "/api/debts/account-entry");
    await modal.getByRole("button", { name: "Add Debt" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "account_entry",
      (x) => x.details?.note === note,
    );
    expectDetails(t, { kind: "account_entry", action: "DEBT_CASH_OUT", note });
    expect(t.client_name).toBe(S.nour);
    expectPayoutLine(t, "CASH", "USD", 30); // bug 1
    expect((await clientDebt(day, ids.nour)).usd - debt0.usd).toBeCloseTo(
      30,
      2,
    );
    expectMoved(await drawers(day), d0, "General", "USD", -30);
  });

  test("9.3 Accounts: Nour settles $25 cash + $5 forgiven with a reason", async () => {
    await go("/debts", page.getByPlaceholder("Search client..."));
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const debt0 = await clientDebt(day, ids.nour);
    const note = `Repaid from salary, rest forgiven SD${day.stamp}`;
    const reason = "Loyal customer - $5 off the advance";
    await page.getByPlaceholder("Search client...").fill(S.nour);
    await page
      .getByRole("button", { name: new RegExp(S.nour) })
      .first()
      .click();
    await page.getByRole("button", { name: "Settle Debt" }).click();
    // Lower the payment BEFORE the forgive, or Confirm stays disabled.
    await payLine(page, 0, "CASH", 25, "USD");
    await page.getByTestId("debt-forgive-usd").fill("5");
    await page.getByTestId("debt-forgive-reason").fill(reason);
    await page.locator("#repay-note").fill(note);
    const res = waitPost(page, "/api/debts/repayments");
    await page.getByRole("button", { name: "Confirm Payment" }).click();
    expect((await res).body.success).toBeTruthy();
    const rep = await findTxn(
      day,
      before,
      "account_entry",
      (x) => x.details?.action === "REPAYMENT" && x.details?.note === note,
    );
    expectDetails(rep, {
      kind: "account_entry",
      discount: { amount: 5, currency: "USD" },
    });
    expectSnapLine(rep, "CASH", "USD", 25, "IN");
    expect(rep.client_name).toBe(S.nour);
    // The forgiven $5 is its own row, its note = the reason.
    const disc = await findTxn(
      day,
      before,
      "account_entry",
      (x) => x.details?.action === "WRITE_OFF" && x.details?.note === reason,
    );
    expect(disc.client_name).toBe(S.nour);
    expect((await clientDebt(day, ids.nour)).usd - debt0.usd).toBeCloseTo(
      -30,
      2,
    );
    expectMoved(await drawers(day), d0, "General", "USD", 25);
  });

  test("9.4 Suppliers: pay Katsh $80 cash with a note [bug 1, bug 4 name]", async () => {
    await go("/suppliers", page.getByTestId("supplier-tile-Katsh"));
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const s0 = await supplierBalance(day, "Katsh");
    const note = `Partial settlement of Katsh float, handed to rep Georges SD${day.stamp}`;
    await page.getByTestId("supplier-tile-Katsh").click();
    await page.getByRole("button", { name: "Pay / Receive" }).click();
    await page.getByRole("button", { name: "Pay Supplier" }).click();
    await payLine(page, 0, "CASH", 80, "USD");
    await page.getByPlaceholder("Payment to supplier…").fill(note);
    const res = waitPost(page, `/api/suppliers/${s0.id}/cashflow`);
    await page.getByRole("button", { name: "Record Payment" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "supplier_entry",
      (x) => x.details?.note === note,
    );
    expectDetails(t, {
      kind: "supplier_entry",
      supplierId: s0.id,
      action: "PAY",
      note,
    });
    expectPayoutLine(t, "CASH", "USD", 80); // bug 1
    expect((await supplierBalance(day, "Katsh")).usd - s0.usd).toBeCloseTo(
      -80,
      2,
    );
    expectMoved(await drawers(day), d0, "General", "USD", -80);

    const panel = await openDetails(day, t.id, "");
    // bug 4: the supplier by name, not "ID #27".
    await bugCheckAsync(4, "panel names the supplier", () =>
      expect(panel).toContainText(FIXED.supplierNameKatsh, { timeout: 2_000 }),
    );
    await closeDetails(panel);
  });

  test("9.5 Partners: settle Flow Partner $200 cash + $100 Whish [bug 16, bug 1]", async () => {
    await go(
      "/partners",
      page.getByRole("button", { name: new RegExp(S.flow) }),
    );
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const p0 = await partnerBalance(day, ids.flow);
    const note = `Paid back the Whish App float: $200 cash + $100 Whish SD${day.stamp}`;
    await page
      .getByRole("button", { name: new RegExp(S.flow) })
      .first()
      .click();
    await page.getByRole("button", { name: "Settle", exact: true }).click();
    const modal = page.getByTestId("counterparty-settle-modal");
    await expect(modal).toBeVisible();
    await splitOn(modal);
    await payLine(modal, 0, "CASH", 200);
    await addLine(modal);
    await payLine(modal, 1, "WHISH", 100);
    await modal.getByPlaceholder("Optional notes...").fill(note);
    const res = waitPost(page, "/api/partners/settle");
    await modal.getByRole("button", { name: "Confirm Settlement" }).click();
    const { body, request } = await res;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    // bug 16: a Cash + Whish split is not tagged CASH-only.
    expect(request).toMatchObject({
      partnerId: ids.flow,
    } satisfies Partial<PartnerSettleInput>);
    // bug 16 is fixed server-side (the page still sends the first leg's
    // method): the ledger row's settlement method must read SPLIT.
    const ledger = await getJson<{
      success: boolean;
      statement: { entries: Array<Record<string, unknown>> };
    }>(day, `/api/partners/${ids.flow}/ledger`);
    expect(ledger.success, JSON.stringify(ledger)).toBeTruthy();
    const settleRow = ledger.statement.entries.find((e) => e.notes === note);
    bugCheck(16, "Cash + Whish settle saved as SPLIT, not CASH", () =>
      expect(settleRow?.settlement_method).toBe(FIXED.splitSettlementMethod),
    );
    const t = await findTxn(
      day,
      before,
      "partner_entry",
      (x) => x.details?.note === note,
    );
    expectDetails(t, {
      kind: "partner_entry",
      partnerId: ids.flow,
      action: "SETTLE",
      note,
    });
    expectPayoutLine(t, "CASH", "USD", 200); // bug 1
    expectPayoutLine(t, "WHISH", "USD", 100); // bug 1
    expect((await partnerBalance(day, ids.flow)).usd - p0.usd).toBeCloseTo(
      300,
      2,
    );
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "USD", -200);
    expectMoved(d1, d0, "Whish_App", "USD", -100);
  });

  test("9.6 Partners: write off $15 owed by Smoke Partner, with a reason [bug 4 amount]", async () => {
    await go(
      "/partners",
      page.getByRole("button", { name: new RegExp(S.smoke) }),
    );
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    const p0 = await partnerBalance(day, ids.smoke);
    const reason = `Agreed to absorb the $15 Whish fee dispute SD${day.stamp}`;
    await page
      .getByRole("button", { name: new RegExp(S.smoke) })
      .first()
      .click();
    await page.getByRole("button", { name: "Write off", exact: true }).click();
    const modal = topModal(page);
    await modal.getByPlaceholder("0.00").fill("15");
    await modal.getByPlaceholder("Optional reason...").fill(reason);
    const res = waitPost(page, "/api/partners/write-off");
    await modal.getByRole("button", { name: "Write off", exact: true }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "partner_entry",
      (x) => x.details?.reason === reason,
    );
    expectDetails(t, {
      kind: "partner_entry",
      partnerId: ids.smoke,
      action: "WRITE_OFF",
      reason,
    });
    expect((await partnerBalance(day, ids.smoke)).usd - p0.usd).toBeCloseTo(
      -15,
      2,
    );
    expectMoved(await drawers(day), d0, "General", "USD", 0);
  });

  test("9.7 OMT App top-up: transfer $15 from General", async () => {
    await rechargeTab("OMT App");
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await page
      .getByRole("button", { name: /^Top-?Up$/ })
      .first()
      .click();
    const modal = topModal(page);
    await modal.getByTestId("topup-funding-transfer").click();
    await modal.getByRole("button", { name: "USD", exact: true }).click();
    await modal.getByPlaceholder("0.00").fill("15");
    const res = waitPost(page, "/api/recharge/top-up-app");
    await modal.getByRole("button", { name: "Confirm Top-Up" }).click();
    expect((await res).body.success).toBeTruthy();
    const t = await findTxn(
      day,
      before,
      "wallet_topup",
      (x) =>
        x.details?.provider === "OMT_APP" && x.details?.source === "DRAWER",
    );
    expectDetails(t, {
      kind: "wallet_topup",
      provider: "OMT_APP",
      source: "DRAWER",
    });
    const d1 = await drawers(day);
    expectMoved(d1, d0, "General", "USD", -15);
    expectMoved(d1, d0, "OMT_App", "USD", 15);
  });

  // ══ Part 10 — Reversals ════════════════════════════════════════════════

  test("10.1 void the walk-in sale (Karim, $26)", async () => {
    const before = await lastTxnId(day);
    const d0 = await drawers(day);
    await go("/audit", page.getByPlaceholder(/Search summary, client, user/));
    const box = page.getByPlaceholder(/Search summary, client, user/);
    await box.fill(S.karim);
    await box.press("Enter");
    const row = page
      .getByTestId("data-table")
      .locator("tbody tr", { hasText: S.karim })
      .filter({ has: page.getByRole("button", { name: "Void", exact: true }) })
      .first();
    const res = waitPost(page, `/api/transactions/${ids.walkinSaleTxn}/void`);
    await row.getByRole("button", { name: "Void", exact: true }).click();
    expect((await res).body.success).toBeTruthy();
    expect(day.dialogs.some((d) => /Void this transaction/.test(d))).toBe(true);
    const rev = await findTxn(
      day,
      before,
      "reversal",
      (x) => x.details?.originalTransactionId === ids.walkinSaleTxn,
    );
    expect(rev.client_name).toBe(S.karim);
    expect(rev.client_phone).toBe(phoneOf(day, 4));
    expect(rev.amount_usd).toBeCloseTo(-26, 2);
    expectMoved(
      await drawers(day),
      d0,
      "General",
      "LBP",
      -(2_400_000 - ids.walkinChangeLbp),
    );
    // Row tags: VOIDED on the original, ↩ on the reversal.
    await expect(
      page
        .getByTestId("data-table")
        .locator("tbody tr", { hasText: S.karim })
        .getByTestId("row-badge")
        .filter({ hasText: "VOIDED" })
        .first(),
    ).toBeVisible();
  });

  test("10.2 refund ONE iPhone from Rami's sale, marked defective [bug 2, bug 15]", async () => {
    const before = await lastTxnId(day);
    await go("/pos", page.getByText("Today's Sales"));
    await page
      .getByRole("button")
      .filter({ hasText: S.rami })
      .filter({ hasText: "823" })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: /^Sale #/ })).toBeVisible();
    const line = page
      .locator("div", { hasText: pname("iphone") })
      .filter({ has: page.getByTitle("Refund item") })
      .last();
    await line.getByTitle("Refund item").click();
    const qty = page.getByRole("button", { name: /^Refund 1x$/ });
    if (await qty.isVisible().catch(() => false)) await qty.click();
    await expect(page.getByText(/Refund — Choose Return Method/)).toBeVisible();
    await page
      .getByTestId("refund-units-section")
      .getByLabel("Defective")
      .check();
    const res = waitPost(page, "/refund-item");
    await page.getByRole("button", { name: "Confirm Refund" }).click();
    const { body, request } = await res;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    expect(request).toMatchObject({
      refundQuantity: 1,
    } satisfies Partial<SaleRefundItemPayload>);
    expect(
      (request.unitExtras as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ is_defective: true });
    const rev = await findTxn(
      day,
      before,
      "reversal",
      (x) => x.details?.originalTransactionId === ids.sale1Txn,
    );
    expect(rev.client_name).toBe(S.rami);
    // bug 15: return lines in whole cents / whole pounds.
    for (const p of rev.payments ?? []) {
      bugCheck(
        15,
        `return line ${p.amount} ${p.currency_code} in whole units`,
        () => expect(isWholeUnit(p.amount, p.currency_code)).toBe(true),
      );
    }
    // bug 15: the summary names the product.
    bugCheck(15, "refund summary names the product", () =>
      expect(rev.summary ?? "").toContain(pname("iphone")),
    );
    const units = (rev.details?.refundUnits ?? []) as Array<{
      flags?: string[];
    }>;
    expect(units.length).toBe(1);

    // bug 2: the original sale is tagged as partly refunded; the refund row ↩.
    await go("/audit", page.getByPlaceholder(/Search summary, client, user/));
    const box = page.getByPlaceholder(/Search summary, client, user/);
    await box.fill(S.rami);
    await box.press("Enter");
    const badges = page.getByTestId("data-table").getByTestId("row-badge");
    await bugCheckAsync(2, "refund row points at its sale (↩)", () =>
      expect(
        badges.filter({ hasText: `↩ #${ids.sale1Txn}` }).first(),
      ).toBeVisible({ timeout: 5_000 }),
    );
    await bugCheckAsync(2, "sale tagged PARTLY REFUNDED", () =>
      expect(
        badges.filter({ hasText: FIXED.partlyRefundedTag }).first(),
      ).toBeVisible({ timeout: 5_000 }),
    );
  });

  // ══ Part 11 — Wrong number ═════════════════════════════════════════════

  test("11.1 wrong number on the iPick basket card [bug 20]", async () => {
    const before = await lastTxnId(day);
    await go("/audit", page.getByPlaceholder(/Search summary, client, user/));
    const box = page.getByPlaceholder(/Search summary, client, user/);
    await box.fill(S.joe);
    await box.press("Enter");
    const row = page
      .getByTestId("data-table")
      .locator("tbody tr", { hasText: /iPick/i })
      .filter({ has: page.getByRole("button", { name: /Wrong number/ }) })
      .first();
    await row.getByRole("button", { name: /Wrong number/ }).click();
    const panel = page.getByTestId("wrong-number-panel");
    // bug 20: the screen does not hang loading.
    await expect(panel, "bug 20: wrong-number form loads").toBeVisible({
      timeout: 15_000,
    });
    const wrong = phoneOf(day, 20);
    await page.locator("#wn-wrong").fill(wrong);
    await page.locator("#wn-right").fill(phoneOf(day, 7));
    const res = waitPost(page, "/api/wrong-numbers");
    await page.getByRole("button", { name: "Record wrong number" }).click();
    const { body, request } = await res;
    expect(body.success, JSON.stringify(body)).toBeTruthy();
    expect(request).toMatchObject({
      wrong_number: wrong,
      right_number: phoneOf(day, 7),
    } satisfies Partial<RecordWrongNumberInput>);
    const t = await findTxn(
      day,
      before,
      "wrong_number",
      (x) => x.details?.rightNumber === phoneOf(day, 7),
    );
    expectDetails(t, {
      kind: "wrong_number",
      wrongNumber: wrong,
      rightNumber: phoneOf(day, 7),
    });
    // The original sale is unchanged.
    const orig = (await txnsSince(day, ids.ipickBasketTxn - 1)).find(
      (x) => x.id === ids.ipickBasketTxn,
    );
    expect(orig?.status).toBe("ACTIVE");
    ids.wrongNumberTxn = t.id;
  });

  // ══ Part 12 — Export ═══════════════════════════════════════════════════

  test("12.1 Excel export: 4 sheets, today's void, refund and wrong number present [bug 3]", async () => {
    await go("/audit", page.getByPlaceholder(/Search summary, client, user/));
    const box = page.getByPlaceholder(/Search summary, client, user/);
    await box.fill("");
    await box.press("Enter");
    await expect(page.getByTestId("export-excel-btn")).toBeVisible({
      timeout: 15_000,
    });
    const dl = page.waitForEvent("download");
    await page.getByTestId("export-excel-btn").click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(
      /^transactions-\d{2}-\d{2}-\d{4}\.xlsx$/,
    );
    const file = test.info().outputPath("shop-day-export.xlsx");
    await download.saveAs(file);
    const wb = XLSX.read(fs.readFileSync(file), { type: "buffer" });
    // Export template (owner decision 2026-10-16).
    expect(wb.SheetNames).toEqual([
      "Summary",
      "Transactions",
      "Payments",
      "Details",
    ]);
    const sheetIds = (name: string) =>
      new Set(
        (
          XLSX.utils.sheet_to_json(wb.Sheets[name]) as Array<
            Record<string, unknown>
          >
        )
          .map((r) => Number(r["Txn #"]))
          .filter((n) => Number.isFinite(n)),
      );
    const details = sheetIds("Details");
    const payments = sheetIds("Payments");
    const voidRev = (await txnsSince(day, ids.walkinSaleTxn)).find(
      (x) =>
        x.details?.kind === "reversal" &&
        x.details?.originalTransactionId === ids.walkinSaleTxn,
    );
    const refundRev = (await txnsSince(day, ids.sale1Txn)).find(
      (x) =>
        x.details?.kind === "reversal" &&
        x.details?.originalTransactionId === ids.sale1Txn,
    );
    for (const id of [voidRev?.id, refundRev?.id, ids.wrongNumberTxn]) {
      expect(id).toBeTruthy();
      expect(details.has(id!), `Details sheet has #${id}`).toBe(true);
    }
    const txSheet = XLSX.utils.sheet_to_json(wb.Sheets.Transactions) as Array<
      Record<string, unknown>
    >;
    expect(txSheet.length, "Transactions sheet has rows").toBeGreaterThan(0);
    // bug 3: reversals also appear in the Payments sheet.
    bugCheck(3, "void in the Payments sheet", () =>
      expect(payments.has(voidRev!.id)).toBe(true),
    );
    bugCheck(3, "refund in the Payments sheet", () =>
      expect(payments.has(refundRev!.id)).toBe(true),
    );
  });

  // ── Accounts export → import (LIRA-330) ──────────────────────────────
  // The Accounts file is the debt-import template. Imported back into the
  // shop it came from it must be refused (it would double every balance);
  // imported as new clients ("another shop") every row must keep its amount
  // and its exact time.

  /** One ledger row as a comparable key: UTC time to the second + amounts. */
  const ledgerKeys = (
    rows: Array<{
      created_at: string;
      amount_usd: number;
      amount_lbp: number | null;
    }>,
  ) =>
    rows
      .map((r) => {
        const raw = r.created_at;
        const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)
          ? raw
          : `${raw.replace(" ", "T")}Z`;
        const t = new Date(iso).toISOString().slice(0, 19);
        return `${t} ${r.amount_usd.toFixed(2)} ${(r.amount_lbp ?? 0).toFixed(0)}`;
      })
      .sort();
  const historyOf = async (clientId: number) =>
    (
      await getJson<{
        history: Array<{
          created_at: string;
          amount_usd: number;
          amount_lbp: number | null;
        }>;
      }>(day, `/api/debts/clients/${clientId}/history`)
    ).history;
  const importFile = async (file: string): Promise<string[]> => {
    await go("/debts", page.getByRole("button", { name: "Import Excel" }));
    const from = day.dialogs.length;
    await page
      .locator('input[type="file"][accept=".xlsx,.xls"]')
      .setInputFiles(file);
    await expect
      .poll(() => day.dialogs.slice(from).some((d) => d.startsWith("alert:")), {
        timeout: 60_000,
      })
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "Import Excel" }),
    ).toBeEnabled();
    return day.dialogs.slice(from);
  };
  let accountsFile = "";
  let copyFile = "";
  const copies: Array<{ original: number; name: string }> = [];

  test("12.2 Accounts export: import template, one page per client, balances match", async () => {
    await go("/debts", page.getByRole("button", { name: "Export Excel" }));
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Excel" }).click();
    const download = await dl;
    expect(download.suggestedFilename()).toMatch(
      /^accounts-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    accountsFile = test.info().outputPath("shop-day-accounts.xlsx");
    await download.saveAs(accountsFile);
    const wb = XLSX.read(fs.readFileSync(accountsFile), { type: "buffer" });
    expect(wb.SheetNames[0]).toBe("List Name");
    expect(
      (wb.Custprops as Record<string, unknown> | undefined)
        ?.LiraTekAccountsExport,
    ).toBe("1");
    // Today's account clients: each has a page whose balance = the shop's.
    for (const key of ["nour", "rami", "hassan"] as const) {
      const name = S[key]!;
      const sheet = wb.SheetNames.map((n) => wb.Sheets[n]!).find(
        (ws) => ws.B1?.v === name,
      );
      expect(sheet, `page for ${name}`).toBeTruthy();
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet!, {
        header: 1,
        defval: "",
      });
      expect(rows[1]!.slice(0, 4)).toEqual([
        "DATE",
        "USD",
        "LBP",
        "DESCRIPTION",
      ]);
      const bal = (label: string) =>
        Number(rows.find((r) => r[3] === label)?.[4]);
      const shop = await clientDebt(day, (await clientByName(day, name)).id);
      expect(bal("Balance Remaining in USD")).toBeCloseTo(shop.usd, 2);
      expect(bal("Balance Remaining in LBP")).toBeCloseTo(shop.lbp, 0);
    }
  });

  test("12.3 Accounts import of that file into the same shop is refused, nothing changes", async () => {
    expect(accountsFile).toBeTruthy();
    const ids3 = await Promise.all(
      (["nour", "rami", "hassan"] as const).map(
        async (k) => (await clientByName(day, S[k]!)).id,
      ),
    );
    const before = await Promise.all(ids3.map((id) => clientDebt(day, id)));
    const said = await importFile(accountsFile);
    expect(said.join("\n")).toMatch(/already in this shop/);
    expect(said.some((d) => d.startsWith("confirm:"))).toBe(false);
    expect(await Promise.all(ids3.map((id) => clientDebt(day, id)))).toEqual(
      before,
    );
  });

  test("12.4 Accounts import as another shop: same balances, every row keeps its time", async () => {
    // "Another shop" = today's clients under new names and phones, so none
    // of them exists here. Everything else in the file is left as exported.
    const wb = XLSX.read(fs.readFileSync(accountsFile), {
      type: "buffer",
      cellDates: true,
    });
    const keep: string[] = [];
    let n = 21; // phoneOf 21…29 are unused by the day
    for (const sheetName of wb.SheetNames.slice(1)) {
      const ws = wb.Sheets[sheetName]!;
      const name = String(ws.B1?.v ?? "");
      if (!name.endsWith(day.stamp) || n > 29) continue;
      const original = await clientByName(day, name);
      if ((await historyOf(original.id)).length === 0) continue;
      const copy = `Copy ${name}`;
      ws.B1 = { t: "s", v: copy };
      ws.D1 = { t: "s", v: phoneOf(day, n++) };
      copies.push({ original: original.id, name: copy });
      keep.push(sheetName);
    }
    expect(copies.length, "today has account clients to copy").toBeGreaterThan(
      2,
    );
    const list = XLSX.utils.aoa_to_sheet([
      ["NAME", "Phone "],
      ...keep.map((k) => [wb.Sheets[k]!.B1!.v, wb.Sheets[k]!.D1!.v]),
    ]);
    const out = XLSX.utils.book_new();
    out.Custprops = wb.Custprops; // the export's marker travels with the file
    XLSX.utils.book_append_sheet(out, list, "List Name");
    for (const k of keep) XLSX.utils.book_append_sheet(out, wb.Sheets[k]!, k);
    copyFile = test.info().outputPath("shop-day-accounts-copy.xlsx");
    XLSX.writeFile(out, copyFile);

    const said = await importFile(copyFile);
    expect(said.find((d) => d.startsWith("alert:"))).toMatch(
      new RegExp(`Clients created: ${copies.length}`),
    );
    for (const c of copies) {
      const made = await clientByName(day, c.name);
      expect(await clientDebt(day, made.id), c.name).toEqual(
        await clientDebt(day, c.original),
      );
      // Amounts are signed per row; the times are the originals' own.
      expect(ledgerKeys(await historyOf(made.id)), c.name).toEqual(
        ledgerKeys(await historyOf(c.original)),
      );
    }
  });

  test("12.5 Accounts import of the same copy again is refused, nothing doubles", async () => {
    expect(copyFile).toBeTruthy();
    const madeIds = await Promise.all(
      copies.map(async (c) => (await clientByName(day, c.name)).id),
    );
    const before = await Promise.all(madeIds.map((id) => clientDebt(day, id)));
    const said = await importFile(copyFile);
    expect(said.join("\n")).toMatch(/already in this shop/);
    expect(await Promise.all(madeIds.map((id) => clientDebt(day, id)))).toEqual(
      before,
    );
  });

  // ══ Open bugs ══════════════════════════════════════════════════════════

  test("open bugs (SHOP_DAY §5): every fixed-behaviour check passed", () => {
    // Each entry names its bug, step and check. Empty once the fixes land.
    expect(openBugList()).toEqual([]);
  });
});
