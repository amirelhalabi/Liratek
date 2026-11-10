import { expect, type Locator } from "@playwright/test";

/**
 * LIRA-370 — the OMT Settle Account sheet settles from the amount on OMT's
 * SMS and opens at the EXPECTED figure (owed − expected commission). Specs
 * whose subject is not the commission (day picking, part-payments, undo)
 * type the SMS as the gross owed instead: a real case (OMT asks exactly what
 * LiraTek shows), which keeps their money commission-free. Call it after
 * picking the days and before reading or typing the payment lines (it
 * re-fills the payment box).
 *
 * The sign follows the prefill: negative = OMT pays the shop.
 *
 * LIRA-378: the sheet now opens with nothing ticked (= no commission), and
 * a gross SMS then books every transfer's expected commission as "owed by
 * OMT" — shared-DB state that later specs (091, 093) would see inside their
 * expected figure. Ticking All types first keeps the pre-LIRA-378 fixture:
 * commission 0, nothing left owed.
 */
export async function smsAtGross(sheet: Locator): Promise<void> {
  await tickAllSmsTypes(sheet);
  for (const c of ["usd", "lbp"] as const) {
    const sms = sheet.getByTestId(`supplier-account-settle-sms-${c}`);
    if ((await sms.count()) === 0) continue;
    const owedText = await sheet
      .getByTestId(`supplier-account-settle-owed-${c}`)
      .first()
      .innerText();
    const owed = Number(owedText.replace(/[^0-9.]/g, ""));
    const prefilled = Number((await sms.inputValue()).replace(/,/g, ""));
    const value = c === "usd" ? owed.toFixed(2) : String(Math.round(owed));
    await sms.fill(prefilled < 0 ? `-${value}` : value);
    await expect(
      sheet.getByTestId(`supplier-account-settle-sms-commission-${c}`),
    ).toContainText(c === "usd" ? "$0.00" : "0 LBP");
  }
}

/**
 * LIRA-378 (owner 2026-11-09) — the OMT Settle Account sheet opens with
 * NOTHING ticked in "Which OMT commission does this SMS include?", which
 * means OMT pays no commission in this SMS (the box opens at the gross
 * owed). Specs whose subject IS the expected commission tick "All types"
 * first — one tick on the group header — to get the pre-LIRA-378 figure
 * (owed − expected commission). The list lives in a portal, so the header
 * is found on the page, not inside the sheet.
 */
export async function tickAllSmsTypes(sheet: Locator): Promise<void> {
  const page = sheet.page();
  await sheet.getByTestId("supplier-account-settle-covered").click();
  await page.getByTestId("supplier-account-settle-covered-group-ALL").click();
  await page.keyboard.press("Escape");
  await expect(sheet.getByTestId("supplier-account-settle-sms-includes")).toBeVisible();
}
