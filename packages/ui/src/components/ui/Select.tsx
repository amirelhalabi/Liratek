import {
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";

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
          anchor="bottom end"
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
          className={`
            z-[500] min-w-[var(--button-width)] max-h-60 overflow-auto
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
                  : `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                      focus
                        ? "bg-violet-500/20 text-white"
                        : selected
                          ? "bg-slate-800 text-white"
                          : "text-slate-300"
                    }`
              }
            >
              {({ selected }) => (
                <>
                  <span
                    className={`block truncate ${
                      selected && !option.disabled
                        ? "font-medium"
                        : "font-normal"
                    }`}
                  >
                    {option.label}
                  </span>
                  {selected && !option.disabled ? (
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-violet-400">
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </span>
                  ) : null}
                </>
              )}
            </ListboxOption>
          ))}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
