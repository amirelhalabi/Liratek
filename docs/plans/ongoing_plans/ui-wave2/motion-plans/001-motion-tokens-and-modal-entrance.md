# 001 — Motion tokens + real modal entrance (replace dead animate-in classes)

Commit: ec3464f5. Repo: /Users/amir/Desktop/docs/Liratek.

Why: `animate-in fade-in zoom-in-95 slide-in-from-*` are not defined anywhere (no tw-animate-css plugin; absent from built CSS). Modals appear with no motion.

Steps

1. frontend/src/index.css, inside the existing top `:root {}` block add:
   --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
   --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
2. In index.css near `@keyframes scale-in` (~line 2020): change `.animate-scale-in` to `animation: scale-in 180ms var(--ease-out);` and change the keyframe `from` scale 0.95 → 0.97. Add:
   @keyframes backdrop-in { from { opacity: 0 } to { opacity: 1 } }
   .animate-backdrop-in { animation: backdrop-in 150ms var(--ease-out); }
3. In every `.tsx` under frontend/src and packages/ui/src: on modal backdrops replace `animate-in fade-in duration-200` with `animate-backdrop-in`; on modal panels replace `animate-in zoom-in-95 duration-200` with `animate-scale-in`. On page wrappers delete `animate-in fade-in duration-500` entirely (e.g. features/sales/pages/POS/index.tsx:788). Delete `animate-in slide-in-from-bottom-2 duration-200` and the `animationDelay` style at features/sessions/components/MessengerStyleSessionButton.tsx:88-92. Find all with `grep -rn "animate-in" --include='*.tsx' frontend/src packages/ui/src`.
4. Extend the reduced-motion block (index.css ~2105):
   .animate-scale-in { animation: backdrop-in 120ms var(--ease-out); }
   html.theme-transition { animation: none; }
   Out of scope: exit animations (none — closes stay instant), installing any plugin.
   Verify: grep returns zero `animate-in`; open Checkout and Confirm modals in DevTools Animations panel at 10% speed — panel scales 0.97→1, no overshoot; with "Emulate prefers-reduced-motion: reduce" only opacity changes. Escape closes instantly.
