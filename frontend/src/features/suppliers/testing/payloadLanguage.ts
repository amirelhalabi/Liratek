/**
 * LIRA-331 (T049) — helpers for the payload-language guards: run the same
 * write once in English and once in Arabic and compare what reached the
 * mocked API. Shared by the Suppliers and Partners guards.
 *
 * Controls are found by `data-testid` or by data (supplier names, currency
 * and method codes) — never by a label, which changes with the language.
 * The confirm button of the shared `CounterpartySettleModal` has no test id,
 * so it is the last button inside `counterparty-settle-body`.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";

export type GuardLanguage = "en" | "ar";

export async function setGuardLanguage(lang: GuardLanguage): Promise<void> {
  if (lang === "ar") await loadLanguage("ar");
  await i18n.changeLanguage(lang);
}

/** Deep copy of mock calls, so a later run cannot mutate them. */
export function snapshotCalls(calls: unknown[][]): unknown[][] {
  return JSON.parse(JSON.stringify(calls)) as unknown[][];
}

/** Ends one language run: unmount and reset storage the screen remembers. */
export function endRun(): void {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* jsdom always has it */
  }
}

/** The confirm button of a CounterpartySettleModal (modal or inline). */
export function settleConfirmButton(): HTMLButtonElement {
  const bodies = screen.getAllByTestId("counterparty-settle-body");
  const body = bodies[bodies.length - 1]!;
  const buttons = within(body).getAllByRole("button");
  return buttons[buttons.length - 1] as HTMLButtonElement;
}

/** The first payment-amount input of a MultiPaymentInput. */
export function firstPaymentAmount(
  scope: HTMLElement = document.body,
): HTMLInputElement {
  const el = within(scope)
    .getAllByTestId(/^payment-amount-/)
    .find((e) => e.tagName === "INPUT");
  if (!el) throw new Error("no payment-amount input rendered");
  return el as HTMLInputElement;
}

/** The Discount input of a MultiPaymentInput (the summary's only free input). */
export function paymentDiscountInput(): HTMLInputElement {
  const summary = screen.getByTestId("payment-summary");
  const input = Array.from(summary.querySelectorAll("input")).find(
    (el) =>
      !(el.getAttribute("data-testid") ?? "").startsWith("payment-") &&
      el.type !== "checkbox",
  );
  if (!input) throw new Error("no discount input in the payment summary");
  return input as HTMLInputElement;
}
