/**
 * Landing-page demo recording (LANDING_PAGE_PLAN.md, Phase 3a).
 *
 * Two steps, run in order:
 *   1. "seed"  — creates the fictional products. Its recording is ignored.
 *   2. "tour"  — the 40-60 second walk-through that becomes demo.mp4.
 *
 * Every name and number here is invented. Never seed from a real shop's data:
 * this video is published on liratek.shop.
 *
 * The pauses are deliberate pacing so a viewer can read each screen; they are
 * not synchronisation, which is why they use waitForTimeout.
 *
 * The exchange step only types an amount and does not confirm it, so the
 * closing dashboard shows just the sale and the transfer.
 */
import type { Page } from "@playwright/test";
import { test, expect, gotoAndSettle, loginAsAdmin } from "../e2e-web/fixtures";

const PRODUCTS = [
  { name: "USB-C Charger 20W", cost: "4", price: "9", stock: "40" },
  { name: "Clear Phone Case", cost: "1.5", price: "5", stock: "80" },
  {
    name: "Tempered Glass Screen Protector",
    cost: "0.8",
    price: "4",
    stock: "120",
  },
  { name: "Wireless Earbuds", cost: "9", price: "19", stock: "25" },
];

// Bilingual caption bar, drawn by the page itself so it is part of the
// recording. Installed as an init script so it survives full reloads.
async function installCaptions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __demoCaption?: (en: string, ar: string) => void;
    };
    w.__demoCaption = (en: string, ar: string) => {
      let bar = document.getElementById("demo-caption");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "demo-caption";
        bar.setAttribute(
          "style",
          [
            "position:fixed",
            "left:50%",
            "bottom:28px",
            "transform:translateX(-50%)",
            "z-index:2147483647",
            "pointer-events:none",
            "background:rgba(4,8,30,0.92)",
            "border:1px solid #10b981",
            "border-radius:14px",
            "padding:12px 26px",
            "text-align:center",
            "color:#fff",
            "font-family:Inter,system-ui,sans-serif",
            "box-shadow:0 10px 40px rgba(0,0,0,.5)",
            "max-width:80vw",
          ].join(";"),
        );
        document.body.appendChild(bar);
      }
      bar.innerHTML = "";
      const line1 = document.createElement("div");
      line1.textContent = en;
      line1.setAttribute("style", "font-size:24px;font-weight:700");
      const line2 = document.createElement("div");
      line2.textContent = ar;
      line2.setAttribute("dir", "rtl");
      line2.setAttribute(
        "style",
        "font-size:21px;margin-top:2px;color:#a7f3d0",
      );
      bar.append(line1, line2);
    };
  });
}

async function caption(page: Page, en: string, ar: string): Promise<void> {
  await page.evaluate(
    ([e, a]) =>
      (
        window as unknown as { __demoCaption: (en: string, ar: string) => void }
      ).__demoCaption(e, a),
    [en, ar] as const,
  );
}

// Route chunks load lazily; gotoAndSettle only waits for API calls, so also
// wait for the app's "Loading experience..." placeholder to go away.
async function show(page: Page, route: string): Promise<void> {
  // Hide the previous step's caption so it never sits on the next screen.
  await page.evaluate(() => {
    document.getElementById("demo-caption")?.remove();
  });
  await gotoAndSettle(page, route);
  await expect(page.locator("text=Loading experience")).toHaveCount(0, {
    timeout: 20_000,
  });
  await pause(page, 700);
}

async function pause(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

test.describe.serial("landing demo", () => {
  test.describe("seed", () => {
    // Recorded too (video is a config-level option), but the encoder only
    // reads the "tour" recording.
    test("seed fictional products", async ({ page }) => {
      await loginAsAdmin(page);

      for (const p of PRODUCTS) {
        await gotoAndSettle(page, "/#/products");
        await page.locator("button").filter({ hasText: "Add Product" }).click();
        await expect(page.locator("#product-name")).toBeVisible();
        await page.locator("#product-name").fill(p.name);
        await page.locator("#product-cost-price").fill(p.cost);
        await page.locator("#product-retail-price").fill(p.price);
        await page.locator("#product-stock").fill(p.stock);
        await page.getByRole("button", { name: /Save Product/i }).click();
        await expect(page.locator(`text=${p.name}`).first()).toBeVisible({
          timeout: 10_000,
        });
      }
    });
  });

  test.describe("tour", () => {
    test("record the walk-through", async ({ page }) => {
      await installCaptions(page);

      // 1. Sign in
      await page.goto("/#/login");
      await caption(
        page,
        "Every shop signs in at its own address",
        "كل محل يدخل من عنوانه الخاص",
      );
      await page
        .locator('input[placeholder="Enter username"]')
        .pressSequentially("admin", { delay: 90 });
      await page
        .locator('input[type="password"]')
        .pressSequentially("admin123", { delay: 70 });
      await pause(page, 600);
      await page.click('button[type="submit"]');
      await page.waitForURL((url) => !url.hash.includes("/login"));

      // 2. Dashboard
      await show(page, "/#/");
      await caption(
        page,
        "Your day at a glance — dollars and lira",
        "يومك بنظرة واحدة — بالدولار والليرة",
      );
      await pause(page, 3500);

      // 3. A sale
      await show(page, "/#/pos");
      await caption(page, "Sell in seconds", "بيع خلال ثوانٍ");
      const search = page.getByPlaceholder(
        "Search products by name or barcode...",
      );
      await search.pressSequentially("charger", { delay: 80 });
      await page.locator("text=USB-C Charger 20W").first().click();
      await search.fill("");
      await search.pressSequentially("case", { delay: 80 });
      await page.locator("text=Clear Phone Case").first().click();
      await pause(page, 1200);
      await page.getByRole("button", { name: /Proceed to Checkout/i }).click();
      await caption(
        page,
        "Pay in USD, LBP — or both",
        "ادفع بالدولار أو بالليرة — أو بالاثنين",
      );
      await pause(page, 3000);
      await page.getByRole("button", { name: /Complete Sale/i }).click();
      await expect(page.locator("text=Cart is empty")).toBeVisible({
        timeout: 10_000,
      });
      await pause(page, 1000);

      // 4. OMT transfer
      await show(page, "/#/omt-whish");
      await caption(
        page,
        "OMT and Whish transfers, fees worked out",
        "تحويلات OMT وWhish مع حساب العمولة",
      );
      await page
        .locator("button")
        .filter({ hasText: /OMT/ })
        .filter({ hasText: /↑/ })
        .first()
        .click();
      const amount = page.locator("#service-amount");
      await amount.pressSequentially("150", { delay: 120 });
      await pause(page, 2500);
      await page.getByRole("button", { name: /Record Send/i }).click();
      await expect(amount).toHaveValue("", { timeout: 10_000 });
      await pause(page, 800);

      // 5. Currency exchange
      await show(page, "/#/exchange");
      await caption(
        page,
        "Currency exchange at your rate",
        "صرف العملات بسعرك",
      );
      await page.locator("button").filter({ hasText: /^USD$/ }).first().click();
      await page.locator("button").filter({ hasText: /^LBP$/ }).nth(1).click();
      const receive = page.locator('input[placeholder="0.00"]').first();
      await receive.pressSequentially("100", { delay: 120 });
      await pause(page, 3000);

      // 6. Recharges
      await show(page, "/#/recharge");
      await caption(page, "MTC and Alfa recharges", "شحن MTC وAlfa");
      await pause(page, 3000);

      // 7. Close
      await show(page, "/#/");
      await caption(
        page,
        "LiraTek — your whole shop in one place",
        "LiraTek — محلك كله في مكان واحد",
      );
      await pause(page, 3000);
    });
  });
});
