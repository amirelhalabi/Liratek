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
  }) => void;
}
```

## Behaviour

- **Single mode** (default with one seed line): one large line, no "+ Add line", no ×. The section header has its own `SplitToggle` (same button and look as the "Shop pays" header's).
- **Split mode**: rows with ×, "+ Add line". Opens in split mode when `seedLines.length > 1`.
- **Leftover**: typing less than `totalAmount` in single mode switches to split and adds the leftover line; "+ Add line" also fills the leftover. Method = `CUSTOMER_ACCOUNT` when offered (client check passed), else `CASH`; 0 leftover ⇒ `CASH`.
- **Overpay**: never auto-corrected; reported as `overpaid: true`. Pages disable Confirm.
- **Lock**: `lockCurrency` disables every line's currency select (lock icon), new lines inherit `currency`.

`PaymentSheet` also takes `confirmDisabled?: boolean`; pages set it from `onStateChange` (`overpaid || needsClient || !balanced`). The server check stays authoritative.

## Labels and order (payout screens only: `payer === "payout"` and `counterFlow` set)

- Section order: "Customer pays" (IN) **above** "Shop pays" (OUT). DOM order only; testids unchanged (`counter-flow-*`, `payment-*`, `split-toggle`, `counter-flow-add-split`). The IN section's own Split button gets the new testid `counter-flow-split-toggle`, so `split-toggle` stays unique to "Shop pays".
- Main header: `"Shop pays"` + chip text `OUT` (testid stays `direction-chip-you-pay`; only the text changes).
- Section title: `"Customer pays — <CUR>"` when `lockCurrency`, else `"Customer pays"`; chip text `IN` (testid stays `direction-chip-customer-pays`).
- Any other screen: unchanged ("Payment" header, no chips).
