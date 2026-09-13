// ESM. Live smoke walkthrough — drives 15 real flows against a DEPLOYED
// tenant. See README.md for the selector map and the warning that this WRITES
// REAL RECORDS. Credentials come from the environment only.
//
// Consolidated from ~15 scratch specs. Every selector below was earned by a
// failed run; the comments say which, because each looks arbitrary until you
// know what it cost.
import { test } from "@playwright/test";

const USER = process.env.SMOKE_USER;
const PASS = process.env.SMOKE_PASS;
const S = Date.now().toString().slice(-4);

const results = [];
function record(flow, state, detail) {
  results.push({ flow, state, detail: detail || "" });
  console.log(`[${state}] ${flow}${detail ? " — " + detail : ""}`);
}

// Deliberately a completion PHRASE, not a bare word: an earlier `/sold/i`
// matched the stats label "Tickets Sold 0" and reported a false success for a
// sale that never happened.
const OK_RE =
  /(recorded|created|added|saved|completed|processed|sold)\s+successfully|success(?:fully)?!/i;
const BAD_RE = /failed|invalid|is required|not enough|insufficient|error:/i;
const near = (t, i) => t.slice(Math.max(0, i - 45), i + 60).replace(/\s+/g, " ").trim();

async function verdict(page, flow, note) {
  await page.waitForTimeout(2800);
  const b = (await page.locator("body").innerText().catch(() => "")) || "";
  const good = b.match(OK_RE);
  const bad = b.match(BAD_RE);
  if (good) record(flow, "SUBMITTED", `"${near(b, good.index)}"`);
  else if (bad) record(flow, "REJECTED", `"${near(b, bad.index)}"`);
  else record(flow, "UNCLEAR", note || "no completion message");
}

async function go(page, route) {
  await page.goto(`/#${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
}
async function ph(page, placeholder, value, nth = 0) {
  const el = page.getByPlaceholder(placeholder).nth(nth);
  if (!(await el.isVisible().catch(() => false))) return false;
  await el.fill(String(value)).catch(() => {});
  return true;
}
async function byName(page, field, value) {
  const el = page.locator(`[name="${field}"]`).first();
  if (!(await el.isVisible().catch(() => false))) return false;
  await el.fill(String(value)).catch(() => {});
  return true;
}
async function btn(page, name, which = "first", exact = false) {
  const loc = page.getByRole("button", exact ? { name, exact: true } : { name });
  const b = which === "last" ? loc.last() : loc.first();
  if (!(await b.isVisible().catch(() => false))) return false;
  await b.click().catch(() => {});
  await page.waitForTimeout(1300);
  return true;
}
/** Payment sheets key the amount input per line: [data-testid^="payment-amount-"]. */
async function pay(page, amount) {
  const a = page.locator('[data-testid^="payment-amount-"]').first();
  if (!(await a.isVisible().catch(() => false))) return false;
  await a.fill(String(amount)).catch(() => {});
  await page.waitForTimeout(800);
  return true;
}

test("live smoke — 15 flows", async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) {
      console.log(`  [http ${r.status()}] ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
    }
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|manifest/i.test(m.text())) {
      console.log(`  [console.error] ${m.text().slice(0, 150)}`);
    }
  });

  // ---- login --------------------------------------------------------------
  await page.goto("/#/login", { waitUntil: "domcontentloaded" });
  await page.fill('input[placeholder="Enter username"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  if (!(await page.evaluate(() => localStorage.getItem("liratek.jwt")))) {
    record("login", "FAIL", "no JWT stored");
    return;
  }
  record("login", "OK");

  // ---- 1. client — fields are name=, NOT the "John Doe" placeholder -------
  //        phone must be 8 digits with no spaces.
  try {
    await go(page, "/clients");
    await btn(page, /add client/i);
    await byName(page, "full_name", `Smoke ${S}`);
    await byName(page, "phone_number", `03111${S.slice(0, 3)}`);
    await btn(page, /save client/i);
    await verdict(page, "1. client", "saves without a toast — confirm via /api/clients");
  } catch (e) { record("1. client", "ERROR", String(e).slice(0, 90)); }

  // ---- 2. partner — action is "Create", not "Save" ------------------------
  try {
    await go(page, "/partners");
    await btn(page, /add partner/i);
    await ph(page, "Partner name", `Smoke Partner ${S}`);
    await ph(page, "+961 XX XXX XXX", `03222${S.slice(0, 3)}`);
    await btn(page, /^create$/i, "first", true);
    await verdict(page, "2. partner", "saves without a toast — confirm via /api/partners");
  } catch (e) { record("2. partner", "ERROR", String(e).slice(0, 90)); }

  // ---- 3. product ---------------------------------------------------------
  try {
    await go(page, "/products");
    await btn(page, /add product|new product/i);
    await byName(page, "name", `Smoke Widget ${S}`);
    await byName(page, "cost_price", "1");
    await byName(page, "retail_price", "2");
    await byName(page, "stock_quantity", "50");
    await btn(page, /save product/i);
    await verdict(page, "3. product");
  } catch (e) { record("3. product", "ERROR", String(e).slice(0, 90)); }

  // ---- 4-5. carrier lines -------------------------------------------------
  for (const carrier of ["MTC", "Alfa"]) {
    try {
      await go(page, "/recharge");
      await btn(page, new RegExp(`^${carrier}$`), "first", true);
      if (await btn(page, new RegExp(`add ${carrier} line`, "i"))) {
        await ph(page, "03123456", `03${carrier === "MTC" ? "333" : "444"}${S.slice(0, 3)}`);
        await btn(page, /^add$/i, "first", true);
        await verdict(page, `${carrier} carrier line`, "no toast — check for a carrier-line-N testid");
      } else record(`${carrier} carrier line`, "SKIP", "line already exists");
    } catch (e) { record(`${carrier} carrier line`, "ERROR", String(e).slice(0, 90)); }
  }

  // ---- 6. POS sale (needs stock — flow 3 seeds it) ------------------------
  try {
    await go(page, "/pos");
    await ph(page, "Search products by name or barcode...", "Smoke Widget");
    await page.waitForTimeout(2500);
    const hit = page.locator("button,li,tr").filter({ hasText: /Smoke Widget/ }).first();
    if (await hit.isVisible().catch(() => false)) {
      await hit.click().catch(() => {});
      await page.waitForTimeout(1200);
      await btn(page, /proceed to checkout/i);
      await pay(page, 2);
      await btn(page, /complete sale/i, "last");
      await verdict(page, "6. POS sale");
    } else record("6. POS sale", "BLOCKED", "no product matched — tenant has no stock");
  } catch (e) { record("6. POS sale", "ERROR", String(e).slice(0, 90)); }

  // ---- 7. expense ---------------------------------------------------------
  try {
    await go(page, "/expenses");
    await ph(page, "e.g., Shop rent, Coffee, Repair", `Smoke expense ${S}`);
    await pay(page, 1);
    await btn(page, /record expense|add expense/i);
    await verdict(page, "7. expense");
  } catch (e) { record("7. expense", "ERROR", String(e).slice(0, 90)); }

  // ---- 8. custom service --------------------------------------------------
  try {
    await go(page, "/custom-services");
    await btn(page, /digital account/i);
    const s = page.getByTestId("custom-service-item-search");
    if (await s.isVisible().catch(() => false)) {
      await s.fill(`Netflix ${S}`).catch(() => {});
      await page.waitForTimeout(1200);
    }
    await ph(page, "0.00", "1");
    await pay(page, 1);
    await btn(page, /submit service/i);
    await verdict(page, "8. custom service");
  } catch (e) { record("8. custom service", "ERROR", String(e).slice(0, 90)); }

  // ---- 9. loto — TWO "Sell Ticket" buttons; the submit is the LAST --------
  try {
    await go(page, "/loto");
    await ph(page, "Enter sale amount", "1");
    await pay(page, 1);
    await btn(page, /sell ticket/i, "last");
    await verdict(page, "9. loto ticket");
  } catch (e) { record("9. loto ticket", "ERROR", String(e).slice(0, 90)); }

  // ---- 10. OMT send -------------------------------------------------------
  try {
    await go(page, "/omt-whish");
    await btn(page, /^OMT$/, "first", true);
    await ph(page, "0.00", "1");
    await ph(page, "Sender name", `Sender ${S}`);
    await ph(page, "Sender phone", `03555${S.slice(0, 3)}`);
    await pay(page, 1);
    await btn(page, /record send/i, "last");
    await verdict(page, "10. OMT send");
  } catch (e) { record("10. OMT send", "ERROR", String(e).slice(0, 90)); }

  // ---- 11. Whish send — providers are "WHISH ↑ / ↓" -----------------------
  try {
    await go(page, "/omt-whish");
    await btn(page, /WHISH/i);
    await ph(page, "0.00", "1");
    // Same sender fields as OMT — omitting them leaves the form incomplete and
    // the submit silently does nothing.
    await ph(page, "Sender name", `W Sender ${S}`);
    await ph(page, "Sender phone", `03888${S.slice(0, 3)}`);
    await pay(page, 1);
    await btn(page, /record send/i, "last");
    await verdict(page, "11. Whish send");
  } catch (e) { record("11. Whish send", "ERROR", String(e).slice(0, 90)); }

  // ---- 12-13. recharge — "Proceed to Pay" only REVEALS the submit, which
  //             is labelled with the amount ("Pay 300,000 LBP").
  for (const carrier of ["MTC", "Alfa"]) {
    try {
      await go(page, "/recharge");
      await btn(page, new RegExp(`^${carrier}$`), "first", true);
      await ph(page, "XX XXX XXX", `03${carrier === "MTC" ? "666" : "777"}${S.slice(0, 3)}`);
      await btn(page, /^\$3$/, "first", true);
      await pay(page, 3);
      await btn(page, /proceed to pay/i);
      await page.waitForTimeout(1600);
      await btn(page, /^pay\s+[\d,]/i);
      await verdict(page, `${carrier} recharge`);
    } catch (e) { record(`${carrier} recharge`, "ERROR", String(e).slice(0, 90)); }
  }

  // ---- 14. exchange — the payout dialog PRE-FILLS correctly. Overwriting
  //          its amount creates "Remaining (Debt)". Just confirm.
  try {
    await go(page, "/exchange");
    await ph(page, "0.00", "1");
    await page.waitForTimeout(1500);
    await btn(page, /proceed to payout/i);
    await page.waitForTimeout(1500);
    await btn(page, /^pay\s+[\d,]/i);
    await verdict(page, "14. exchange");
  } catch (e) { record("14. exchange", "ERROR", String(e).slice(0, 90)); }

  // ---- 15. maintenance — the SECOND "0.00" is price-to-client, and the
  //          checkout needs a CUSTOMER before "Complete Sale" will post.
  try {
    await go(page, "/maintenance");
    await ph(page, "e.g., iPhone 13 Pro Max", `Device ${S}`);
    await ph(page, "e.g., Broken Screen, Battery Replacement...", "Smoke issue");
    await ph(page, "0.00", "33", 1);
    await page.waitForTimeout(1200);
    await btn(page, /proceed to checkout/i);
    await page.waitForTimeout(2000);
    const cust = page.getByTestId("client-autocomplete-field").first();
    if (await cust.isVisible().catch(() => false)) {
      await cust.fill(`Cust ${S}`).catch(() => {});
      await page.waitForTimeout(900);
    }
    // The phone is needed too — name alone leaves "Complete Sale" inert.
    await ph(page, "Enter Phone Number...", `03999${S.slice(0, 3)}`);
    await pay(page, 33);
    await btn(page, /complete sale/i, "last");
    await verdict(page, "15. maintenance");
  } catch (e) { record("15. maintenance", "ERROR", String(e).slice(0, 90)); }

  // ---- summary ------------------------------------------------------------
  console.log("\n=============== SMOKE RESULTS ===============");
  for (const r of results) {
    console.log(`${r.state.padEnd(11)} ${r.flow}${r.detail ? "  — " + r.detail : ""}`);
  }
  const ok = results.filter((r) => r.state === "SUBMITTED").length;
  console.log(`\n${ok} submitted / ${results.length - 1} attempted`);
  console.log("An UNCLEAR with no HTTP 4xx/5xx above is usually the harness, not the app.");
  console.log("=============================================\n");
});
