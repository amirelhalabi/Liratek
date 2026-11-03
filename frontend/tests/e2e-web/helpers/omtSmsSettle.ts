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
 */
export async function smsAtGross(sheet: Locator): Promise<void> {
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
