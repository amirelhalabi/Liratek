import {
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
} from "@headlessui/react";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  /** Renders as a non-selectable group header when true */
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  optionsClassName?: string;
  ringColor?: string;
  disabled?: boolean;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Select option",
  className = "",
  buttonClassName = "",
  optionsClassName = "",
  ringColor: _ringColor = "ring-violet-500",
  disabled = false,
}: SelectProps) {
  const selectedOption = options.find(
    (opt) => opt.value === value && !opt.disabled,
  );

  return (
    <Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className={`relative ${className}`}>
        <ListboxButton
          className={`
            relative w-full cursor-pointer rounded-lg
            bg-slate-900 border border-slate-700
            py-2.5 pl-3 pr-12 text-left text-white text-sm
            outline-none focus:outline-none focus:border-slate-700
            transition-all disabled:opacity-50 disabled:cursor-not-allowed
            ${buttonClassName}
          `}
        >
          {({ open }) => (
            <>
              <span className="block truncate">
                {selectedOption ? selectedOption.label : placeholder}
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                <ChevronDown
                  className={`h-5 w-5 text-slate-400 transition-transform ${
                    open ? "rotate-180" : ""
                  }`}
                  aria-hidden="true"
                />
              </span>
            </>
          )}
        </ListboxButton>

        <ListboxOptions
          anchor="bottom start"
          // LIRA-120: `anchor` forces @headlessui/react to portal this panel
          // into ONE shared <div id="headlessui-portal-root"> appended to
          // <body> (dist/components/portal/portal.js) — the SAME div every
          // other open Select in the app uses. Only THIS element's own
          // z-index ranks it against whatever else is on screen; a z-50
          // panel rendered BEHIND any modal backdrop declared with a higher
          // z-index elsewhere in the app (Partners' local "Add Credit /
          // Debt" Modal: z-[60]; SaleDetailModal's confirm step and
          // Maintenance's panel: z-[60]; ConfirmModal / AddTenantModal /
          // DrawerCard: z-[100]; SessionCheckoutModal: z-[200]) — open in
          // React state (the trigger's chevron correctly flips) but
          // invisible and unreachable on screen.
          //
          // z-[500] clears every modal in the app today with headroom in
          // both directions: above the highest (SessionCheckoutModal,
          // z-[200]) and below NotificationCenter's toasts (z-[1000], which
          // should stay visible even over an open dropdown). This changes
          // ONLY this element's own z-index — @headlessui/react already
          // sets `position: absolute` on it directly (floating-ui strategy
          // "absolute"; @floating-ui/dom always recomputes the anchor rect
          // relative to this element's actual offsetParent, so nothing here
          // introduces a new positioned ancestor that could hijack that
          // math — the earlier draft of this fix tried lifting the shared
          // portal root itself via an ancestor `position: relative`, which
          // would have done exactly that, silently, for every Select in the
          // app; reverted before shipping). If a future modal ever needs
          // z-index > 500, bump this value — there is no way to make a
          // fixed-position dropdown outrank truly EVERY future z-index
          // without ALSO risking outranking things that should stay on top
          // (toasts), so this is a deliberate, revisitable ceiling rather
          // than the CSS max.
          //
          // anchor="bottom start" is the PRIMARY fix for the layout bug
          // (opening OMT/Whish's "OMT Service" dropdown dragged the whole
          // document sideways, hiding the sidebar). This was shipped first
          // as anchor="bottom end", which pins the panel's RIGHT edge to
          // the trigger's right edge — floating-ui computes that edge from
          // the panel's MEASURED width, and `ListboxOptions` renders with
          // its real `min-w-[var(--button-width)]` width already applied
          // by the time position is computed, so on a trigger spanning
          // most of the page (~1500px) this offset math is done against a
          // wide box relative to the trigger, and any small mismatch
          // between the measured/used width and the trigger's own width
          // pushes the box's LEFT edge past the trigger's left edge —
          // there's no headroom to the right of "end" to absorb an
          // oversized box, only to the left, straight into the sidebar's
          // territory and beyond. `anchor="bottom start"` pins the LEFT
          // edge to the trigger's left edge instead: any growth in the
          // panel's own width (from `min-w` matching a wide trigger, or
          // simply exceeding it) extends RIGHTWARD from that fixed left
          // edge, and `shift` (@floating-ui/react-dom middleware,
          // unconditionally included in this component's `useFloating`
          // config — confirmed by reading
          // @headlessui/react/dist/internal/floating.js) pulls the whole
          // box back into the viewport if that rightward growth would
          // overflow it, the same way it already protects every
          // start-anchored dropdown elsewhere in this app (MultiSelect.tsx,
          // InventoryFiltersPopover.tsx already use `anchor="bottom
          // start"` with no reported overhang). No CSS clamp is airtight
          // against every measurement-timing edge case an anchor choice
          // can hit; picking the anchor whose growth direction `shift` can
          // always correct for is what actually closes this off structurally.
          //
          // min-w-[min(var(--button-width),calc(100vw-1rem))] is the
          // BACKSTOP, not the fix, for one specific pathological case the
          // alignment change above does NOT cover: a trigger wider than
          // the viewport itself (`--button-width > 100vw`), where even a
          // correctly left-anchored, shift-corrected panel would still be
          // wider than the window. `max-w` cannot do this job: per the CSS
          // box-sizing algorithm, when `min-width` and `max-width`
          // conflict, `min-width` wins (evaluated AFTER max-width is
          // applied, so it always has the final say) — a
          // `max-w-[calc(100vw-1rem)]` class would be silently overridden
          // by a wider `min-w`, and it's doubly moot regardless:
          // @floating-ui/dom's `size` middleware unconditionally sets its
          // own INLINE `max-width` on this exact element too
          // (`${availableWidth}px`, confirmed by reading
          // @headlessui/react/dist/internal/floating.js) on every
          // reposition, and an inline style always beats any class — so
          // ANY `max-w-*` class here is DEAD for capping purposes; only
          // the floor is actually reachable. `min()` inside the min-width
          // itself is the only lever that works: it clamps `--button-width`
          // against the viewport BEFORE min/max resolution ever runs, so
          // the used min-width can never exceed `calc(100vw-1rem)` no
          // matter how wide the trigger measures. Do not "simplify" this
          // back to a plain `max-w-*` class — it looks sufficient and is
          // not (see failing-first proof in
          // Select.viewportBoundedWidth.test.tsx).
          //
          // max-w-[calc(100vw-1rem)] is kept anyway as a second, currently
          // redundant bound — per the paragraph above it is superseded by
          // floating-ui's own inline `max-width` on every real render.
          // There is no `--anchor-max-width` CSS var to hook into the way
          // `--anchor-max-height` works below: reading
          // @headlessui/react/dist/internal/floating.js, the `size`
          // middleware's `apply` sets `maxHeight` as
          // `min(var(--anchor-max-height, 100vh), Npx)` (a `var()` we can
          // feed) but sets `maxWidth` as a bare `${availableWidth}px` —
          // no variable indirection at all. So unlike the height case,
          // there is currently no lever that would make this class do
          // real capping work; it stays only as documentation of intent /
          // a fallback should that internal ever change, not as something
          // this fix depends on — the anchor change and the min-width
          // clamp above are what actually bound the panel.
          //
          // [--anchor-max-height:15rem]: the same `size` middleware
          // unconditionally sets an INLINE `max-height` on this exact
          // element — `min(var(--anchor-max-height, 100vh), <space below
          // the trigger>px)` — every time it repositions. An inline style
          // always wins over the `max-h-60` Tailwind class below, so
          // without this CSS var the panel's real cap is however much
          // room happens to be below the trigger, not 15rem — which is
          // why a tall list could render 8 full rows instead of scrolling
          // after ~6. Setting `--anchor-max-height` feeds INTO that same
          // inline calc (headlessui reads it via `var()`), which is the
          // only way to actually constrain it; `max-h-60` is kept as a
          // documented fallback/no-op-if-unused.
          className={`
            z-[500] min-w-[min(var(--button-width),calc(100vw-1rem))]
            max-w-[calc(100vw-1rem)]
            max-h-60 [--anchor-max-height:15rem] overflow-auto
            rounded-lg bg-slate-900 border border-slate-700
            py-1 shadow-lg ring-1 ring-black ring-opacity-5
            focus:outline-none text-sm
            ${optionsClassName}
          `}
        >
          {options.map((option, i) => (
            <ListboxOption
              key={`${option.value}-${i}`}
              value={option.value}
              disabled={option.disabled ?? false}
              className={({ focus, selected }) =>
                option.disabled
                  ? "px-3 pt-2 pb-0.5 text-xs uppercase tracking-wide text-slate-500 cursor-default select-none"
                  : `relative cursor-pointer select-none py-2 pl-4 pr-4 ${
                      focus
                        ? "bg-violet-500/20 text-white"
                        : selected
                          ? "bg-slate-800 text-white"
                          : "text-slate-300"
                    }`
              }
            >
              {({ selected }) => (
                <span
                  className={`block truncate ${
                    selected && !option.disabled ? "font-medium" : "font-normal"
                  }`}
                >
                  {option.label}
                </span>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
