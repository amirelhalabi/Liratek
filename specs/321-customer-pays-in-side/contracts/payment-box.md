# Contract: payment box "Customer pays" section (`@liratek/ui`)

`MultiPaymentInput` / `PaymentSheet` prop `counterFlow`. All new fields are optional; a caller that passes only today's fields gets today's behaviour except where noted.

```ts
counterFlow?: {
  label: string;                 // today; ignored for the title on payout screens (see Labels)
  totalAmount: number;           // what the customer owes, in `currency`
  currency: string;
  onChange: (lines: PaymentLine[]) => void;
  paymentMethods?: PaymentMethod[];
  requiresClient?: boolean;
  hasClient?: boolean;
  // ── new ──
  seedLines?: Array<{ method: string; currencyCode: string; amount: number }>;
      // pre-filled lines; default = one CASH line at totalAmount (today's seed).
      // 2+ lines ⇒ the section opens in split mode.
  lockCurrency?: boolean;        // Exchange: currency select disabled + title "Customer pays — <CUR>"
  maxForgive?: number;           // shortfall the cashier may forgive (cap from isWithinShortfallMax)
  onStateChange?: (s: {
    paid: number;                // in `currency`
    owedToAccount: number;       // CUSTOMER_ACCOUNT lines, in `currency`
    forgiven: number;
    balanced: boolean;           // paid + owedToAccount + forgiven === totalAmount
    overpaid: boolean;           // sum > totalAmount
    needsClient: boolean;        // an account line with no client
    unaccounted: number;         // totalAmount − paid − owedToAccount − forgiven (≥ 0), shown as "Still to settle: X"
  }) => void;
}
```

## Behaviour

- **Single mode** (default with one seed line): one large line, no "+ Add line", no ×. The section header has its own `SplitToggle` (same button and look as the "Shop pays" header's).
- **Split mode**: rows with ×, "+ Add line". Opens in split mode when `seedLines.length > 1`.
- **Leftover**: typing less than `totalAmount` in single mode adds a leftover line **only when `CUSTOMER_ACCOUNT` is offered** — it switches to split and adds a `CUSTOMER_ACCOUNT` line for the difference. When it is not offered (no client), nothing is added: the section stays single, `unaccounted > 0`, `balanced: false`, so Confirm stays off. The section never fills a gap with cash by itself (US1.3). "+ Add line" fills the remainder: `CUSTOMER_ACCOUNT` when offered, else `CASH`; 0 remainder ⇒ `CASH`.
- **Unaccounted**: while `unaccounted > 0` the section shows "Still to settle: <amount> <CUR>" under its lines (testid `counter-flow-unaccounted`). With no account offered it adds " — pick a client to put it on their account", plus ", or forgive it" when the shortfall is within `maxForgive`.
- **Client picked later**: when the account becomes offered while `unaccounted > 0` and there is no account line, the section adds the `CUSTOMER_ACCOUNT` leftover line (switching to split). When the client is removed, an auto-added account line whose method the cashier has not changed is removed again (never turned into cash). Lines added with "+ Add line" keep their method.
- **Overpay**: never auto-corrected; reported as `overpaid: true`. Pages disable Confirm.
- **Lock**: `lockCurrency` disables every line's currency select (lock icon), new lines inherit `currency`.

`PaymentSheet` also takes `confirmDisabled?: boolean`; pages set it from `onStateChange` (`overpaid || needsClient || !balanced`). The server check stays authoritative.

## Labels and order (payout screens only: `payer === "payout"` and `counterFlow` set)

- Section order: "Customer pays" (IN) **above** "Shop pays" (OUT). DOM order only; testids unchanged (`counter-flow-*`, `payment-*`, `split-toggle`, `counter-flow-add-split`). The IN section's own Split button gets the new testid `counter-flow-split-toggle`, so `split-toggle` stays unique to "Shop pays".
- Main header: `"Shop pays"` + chip text `OUT` (testid stays `direction-chip-you-pay`; only the text changes).
- Section title: `"Customer pays — <CUR>"` when `lockCurrency`, else `"Customer pays"`; chip text `IN` (testid stays `direction-chip-customer-pays`).
- The page's own `label` (e.g. Services "Cashout" on Whish ↓) is replaced by "Shop pays" on payout screens with a customer section (owner naming decision 2026-10-14).
- Any other screen: unchanged ("Payment" header, no chips).
