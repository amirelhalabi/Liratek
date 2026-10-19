# 004 — Reduced-motion coverage, exit easing, POS strip/bar entrances

Commit: ec3464f5. Needs 001 tokens.

1. index.css:2066 and :2102 — change `ease-in` to `var(--ease-out)` (keep 0.18s; shared/hooks/usePresence.ts PRESENCE_EXIT_MS=180 depends on it). Change :2049 and :2098 `ease-out` → `var(--ease-out)`.
2. SaleCompletedStrip.tsx:51 root div: add `animate-swipe-up` (already reduced-motion-safe). No exit animation.
3. POS index.tsx:986 minimized-orders bar: add class `animate-bar-up` defined as
   @keyframes bar-up { from { opacity: 0; transform: translateY(100%) } }
   .animate-bar-up { animation: bar-up 220ms var(--ease-out); }
   reduced: `.animate-bar-up { animation: backdrop-in 120ms var(--ease-out); }`.
4. POS index.tsx:1034 — remove `animate-pulse` from the newest-order dot (static dot).
5. Reduced-motion block additions: `.animate-pulse, .animate-ping { animation: none; }`; HomeGrid.tsx:347 replace `transition-all duration-200 hover:scale-[1.03]` with `transition-[transform,border-color,box-shadow] duration-150 ease-out motion-reduce:active:scale-100` (drop hover scale, keep active 0.98).
6. ThemeContext.tsx:34-37 — delete the theme-transition add/remove (instant theme switch), and delete index.css:2005-2017.
   Keep: `.sidebar-hold-fill` and `animate-spin` under reduced motion (they carry information).
   Verify: DevTools reduce-motion emulation — strip/bar fade only; complete a sale → strip rises 8px; scan next item → strip disappears instantly.
