# Contracts: LIRA-366

One shared fragment in `validators/common.ts`:

```ts
export const typedNoteField = z.string().max(500).optional()
  .transform((s) => (s?.trim() ? s.trim() : undefined));
```

`typedNote: typedNoteField` is added to the create schemas for sale, exchange, financial (system send, App, Binance, bills, Katsh), recharge, loto, custom service, voucher sell and debt repayment. Maintenance and Hold keep their existing `note` / `notes`.

Each service must read the key (rule 23, reverse). It writes `details.note`, writes the module `note` column from `typedNote ?? note`, and adds the note to the customer's debt note through `withTypedNote`.

Before the key ships, check three key sets for each channel (rule 23): the schema, the `preload.ts` `data` type, and the fields the handler or route forwards.

Edit payloads (`updateMetadata`) are unchanged: their `note` is the new typed note, and the repository calls `syncTypedNote`.
