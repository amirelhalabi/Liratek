# 003 — Replace transition-all with explicit properties

Commit: ec3464f5. 219 uses in frontend/src, 236 incl. packages/ui/src. Start with POS: CartLineRow.tsx:218,329; ProductSearch.tsx:422,630; Cart.tsx:135,144; CheckoutModal.tsx:1014,1090,1503,1571; CheckoutModal/CustomerSearch.tsx:42,89; POS index.tsx:1013.
Rules (mechanical):

- Only colour/bg/border changes on hover → `transition-colors`.
- Element also has `active:scale-*` → `transition-[transform,background-color] duration-150 ease-out motion-reduce:active:scale-100`.
- `focus-within:ring-*` wrappers → `transition-[box-shadow,border-color]`.
- `opacity-*` reveal → `transition-opacity`.
  Exemplar: features/recharge/components/ProviderTabs.tsx:79,136.
  Extra in this plan: CartLineRow.tsx:329 remove button → `opacity-60 hover:opacity-100 focus-visible:opacity-100 transition-[opacity,color] duration-150` (currently invisible on touch). ProductSearch.tsx:630 product tile → add `active:scale-[0.97]` with `transition-[transform,background-color,border-color] duration-100 ease-out motion-reduce:active:scale-100`.
  Verify: `grep -rn transition-all` count drops; visually hover/press unchanged except no longer animating height/padding/ring width.
