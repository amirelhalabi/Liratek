# 002 — Confirm a repeat scan on the existing cart line

Commit: ec3464f5. Depends on 001 (tokens) only for the easing value; inline the cubic-bezier if 001 is not done.

Today: features/sales/pages/POS/index.tsx:237-241 merges a repeat add into `quantity + 1`; nothing marks the line and it may be scrolled out of view in Cart.tsx:96.
Steps

1. In features/sales/pages/POS/components/CartLineRow.tsx add a `ref` on the root div (line 218) and a `useEffect` keyed on `item.quantity` that, when quantity INCREASED versus the previous value (useRef prev), runs:
   el.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
   el.animate([{ backgroundColor: flash }, { backgroundColor: "transparent" }], { duration: 450, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
   where flash = document.documentElement.classList.contains("dark") ? "rgb(139 92 246 / 0.25)" : "rgb(124 58 237 / 0.14)", reduced = matchMedia("(prefers-reduced-motion: reduce)").matches. Colour flash is kept under reduced motion (not movement).
   Skip on first mount. Do not animate the quantity digit or price.
2. Same trigger for the +/− buttons is acceptable (increase only).
   Constraints: WAAPI call restarts cleanly on rapid scans; must not touch focus (the scanner input keeps focus).
   Verify: scan the same barcode 5x fast — each scan flashes the line, input keeps focus; dark and light both visible; jsdom tests: guard `el.animate` exists (`typeof el.animate === "function"`).
