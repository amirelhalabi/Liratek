# Contract: WhatsApp message (phone rule, layout, length)

## Phone rule

`toWhatsAppNumber(raw)` returns exactly the spec's FR-014 table (the test fixture is that table verbatim, plus the rejects: `"abc"`, `"12"`, `""`, `"   "`, and an over-15-digit number). One function is used by the receipt action and by `WhatsAppService`.

## Layout: `formatReceiptWhatsApp(data: ReceiptData): string`

One fact per line, no padding. Amount and label stay on one line (FR-009). The lines appear in this order, each only when the paper receipt prints it:

```
*<shop name>*
<header text lines>
<location>
<phone>

Receipt: RCP-<n>
Date: <device date> <device time>        ← same toLocale* calls as paper
Client: <name>

<item name> — $<line amount>
  <qty> × $<unit>                        ← only when qty > 1
  <IMEI|Serial>: <value>
  Warranty until: <YYYY-MM-DD>
...
<warranty terms>                         ← only if any line has a warranty

Subtotal: $x                             ← when discount or extra
Discount: -$x
Extra: +$x
*Total: $x*
Total in LBP: <n> LBP
Paid USD: $x
Paid LBP: <n>
Gift card: $x
On account: $x                            ← its own line, never inside "Paid"
Change: $x
Change LBP: <n>

<note>
Thank You!
Powered by LiraTek • 81077357
```

The figure formats are the same as paper: `toFixed(2)` for USD and `toLocaleString()` for LBP (FR-005, FR-006). WhatsApp's `*bold*` markers are used only on the shop name and the total. No internal figure appears (FR-010).

## Link

`buildWhatsAppLink(digits, text) = "https://wa.me/" + digits + "?text=" + encodeURIComponent(text)`.

## Length

When `encodeURIComponent(text).length > WHATSAPP_TEXT_MAX_ENCODED` (measured in T031; a provisional value until then), the formatter shortens in this order:
1. warranty terms;
2. item sub-lines;
3. the tail of the items, as "…and N more items".

The total, payment, gift card, account and change lines are never removed. It then appends `(shortened — ask the shop for the full receipt)` (FR-011).
