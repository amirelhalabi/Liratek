# Warranty for any item, not just phones — LIRA-296

**Status:** DONE 2026-10-10 — built in three local commits (P1, P2, P3; not pushed). The
spec, plan and task list are in `specs/296-warranty-any-item/`. Owner request 2026-10-10:
"there could be different items that can have warranty, not just phones."

## What already exists (verified against source, 2026-10-10)

- **Warranty length on ANY product.** `products.warranty_months` (LIRA-143 v157); the
  "Warranty (months)" field shows for every product in the Product form, not only phones
  (`ProductForm.tsx` ~line 1002).
- **Stamped on ANY sale line.** `SalesRepository` stamps `sale_items.warranty_until =
  sale date + warranty_months` for every completed sale line, "unit-tracked or not"
  (`SalesRepository.ts` ~line 848).
- **Printed on the receipt** ("Warranty until", `receiptFormatter.ts`).
- **Per-unit override** for tracked units (`warranty_override_until`).

## What is missing (the gaps this plan closes)

Today, after the sale, warranty can only be LOOKED UP and ACTED ON through a phone's IMEI
(`ImeiStoryCard`, the IMEI-line hint in `SaleDetailModal`). A charger, earbuds, a speaker,
a laptop, or a repair has a stamped date that nobody can find or use.

| # | Gap | Why it matters |
|---|---|---|
| G1 | **Find a warranty without an IMEI**: by customer, phone number, receipt/sale number, or product | A customer walks in with broken earbuds and no receipt |
| G2 | **Serial numbers for non-phone items**: generalise "IMEI" to "Serial / IMEI" per category (`categories.tracks_imei_units`) | Laptops, tablets, watches, consoles have serials, not IMEIs; proves *this* unit was sold here |
| G3 | **Warranty state on every sale line** in Sale detail, not only IMEI lines (`warrantyStatus.ts` already computes it) | Staff see "Covered until …" / "Expired" at a glance |
| G4 | **Warranty claim flow**: under warranty, choose **repair** (opens a Maintenance job marked "warranty", no charge to the customer), **replace** (swap from stock, linked to the original sale) or **refund**; keep a claim history per item | Today a warranty repair or swap is recorded by hand, if at all |
| G5 | **Supplier warranty (RMA)**: send the faulty item back to the supplier and track it until credit, replacement or rejection | The shop's own cost of honouring warranty is recovered from the supplier |
| G6 | **Warranty rules**: a default per category (e.g. accessories 1 month, phones 12, used phones 0), editable per line at sale time; warranty terms text on the receipt | Faster product setup; fewer mistakes |
| G7 | **Warranty on repairs**: a Maintenance job gives its own warranty (e.g. 3 months on a screen replacement) | Repairs are a big part of a phone shop's day |
| G8 | **Report**: items currently under warranty, claims and their cost (to the shop vs to suppliers) | Shows what warranty really costs |

## Owner decisions (answered 2026-10-10 — see specs/296-warranty-any-item/spec.md)

D1: one "Warranty cost" line in Profits, faulty units held as defective, supplier credits reduce it. D2: replacement keeps the original end date. D3: per category (block or warn). D4: P1 → P2 → P3.

### Original questions

- **D1** Claim cost: who carries it in Profits — the sale's original profit, a "warranty cost"
  expense, or the supplier (when an RMA succeeds)?
- **D2** Replace: does a replacement item restart the warranty, or keep the original end date?
- **D3** Serial numbers: required for which categories, and can staff sell a serial-tracked item
  without scanning one?
- **D4** Scope order: suggested **G1 + G3 + G6** first (cheap, uses data that already exists),
  then **G4 + G7**, then **G2**, **G5**, **G8**.

## Money rules

G4, G5 and G7 write transactions (rule 18: read `docs/FEATURE_GUIDE.md` §13 first). Every new
side-effect row needs a reversal owner (rule 20); auto rows carry `is_auto` (rule 26).
