/**
 * CUSTOMER_ACCOUNT (charge-to-account / DEBT) eligibility — the single source of
 * truth for every payment form in the app.
 *
 * The rule, app-wide: a customer is chargeable to account when a **name AND a
 * phone** are both present. The backend creates (or finds) the client from
 * name+phone, so a first-time walk-in is chargeable without a pre-existing
 * client record — and a `clientId` alone is NOT sufficient (it may reference a
 * record with no phone, or the row may not exist yet when the operator is mid
 * sale). Relying on `clientId` is what caused session checkout to fail with
 * "Client is required for CUSTOMER_ACCOUNT cashout".
 *
 * Use these helpers to gate/auto-select CUSTOMER_ACCOUNT everywhere a payment is
 * collected (recharge, KATCH, telecom, crypto, OMT/Whish, custom services, POS
 * checkout, session checkout, PaymentSheet/PaymentDrawer, …) instead of
 * re-deriving the predicate inline.
 */

/** Trim-safe non-empty string check. */
function isPresent(value?: string | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Customer identity inputs that gate the CUSTOMER_ACCOUNT payment method. */
export interface CustomerAccountInfo {
  /**
   * Customer's name. For OMT/Whish this is the sender (SEND) or receiver
   * (RECEIVE); elsewhere it's the typed or selected client name.
   */
  name?: string | null | undefined;
  /** Customer's phone number. */
  phone?: string | null | undefined;
  /** Existing client id, when one has already been selected/resolved. */
  clientId?: number | null | undefined;
}

/**
 * Whether the CUSTOMER_ACCOUNT payment method is usable for this customer:
 * a name AND a phone must both be present. `clientId` is intentionally ignored —
 * name+phone is the info the backend needs to create or identify the client.
 */
export function canChargeToCustomerAccount(info: CustomerAccountInfo): boolean {
  return isPresent(info.name) && isPresent(info.phone);
}

/**
 * Whether a BRAND-NEW (not-yet-saved) customer has enough info to be created and
 * charged to account: no existing client selected, but both name and phone are
 * present. Use this to auto-promote CUSTOMER_ACCOUNT as the default method once
 * the operator finishes typing a new client's name+phone.
 *
 * For an already-selected client, use {@link canChargeToCustomerAccount}.
 */
export function hasNewClientInfo(info: CustomerAccountInfo): boolean {
  return !info.clientId && canChargeToCustomerAccount(info);
}
