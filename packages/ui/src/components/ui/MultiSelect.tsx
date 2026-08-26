/**
 * MultiSelect — shared multi-value dropdown, modeled on `Select.tsx`.
 *
 * Same dark-slate idiom and the same portal/z-index behaviour as `Select`
 * (see the long `anchor` note in Select.tsx — the panel is portalled into the
 * ONE shared headlessui portal root, so it needs its own z-index to rank
 * above modals; z-[500] matches Select's deliberate ceiling).
 *
 * The button renders `label` plus a count badge once anything is selected
 * ("Category (2)"), so the control stays narrow inside a toolbar row.
 */

import {
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";

export interface MultiSelectProps {
  /** Static button label — the count badge is appended when values is non-empty. */
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: string[];
  className?: string;
  buttonClassName?: string;
  optionsClassName?: string;
  disabled?: boolean;
  /** `data-testid` for the button; options get `${testId}-option-${option}`. */
  testId?: string;
}

export default function MultiSelect({
  label,
  values,
  onChange,
  options,
  className = "",
  buttonClassName = "",
  optionsClassName = "",
  disabled = false,
  testId,
}: MultiSelectProps) {
  const count = values.length;

  return (
    <Listbox value={values} onChange={onChange} multiple disabled={disabled}>
      <div className={`relative ${className}`}>
        <ListboxButton
          data-testid={testId}
          className={`
            relative w-full cursor-pointer rounded-lg
            bg-slate-900 border border-slate-700
            py-2 pl-3 pr-10 text-left text-white text-sm
            outline-none focus:outline-none focus:border-slate-700
            transition-all disabled:opacity-50 disabled:cursor-not-allowed
            ${buttonClassName}
          `}
        >
          {({ open }) => (
            <>
              <span className="block truncate">
                {count > 0 ? (
                  <>
                    <span className="text-slate-300">{label}</span>
                    <span className="ml-1.5 inline-flex items-center justify-center rounded bg-violet-600/30 px-1.5 py-0.5 text-xs font-medium text-violet-300">
                      {count}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400">{label}</span>
                )}
              </span>
              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5">
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform ${
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
          className={`
            z-[500] min-w-[var(--button-width)] max-h-60 overflow-auto
            rounded-lg bg-slate-900 border border-slate-700
            py-1 shadow-lg ring-1 ring-black ring-opacity-5
            focus:outline-none text-sm
            ${optionsClassName}
          `}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500 select-none">
              No options
            </div>
          ) : (
            options.map((option) => (
              <ListboxOption
                key={option}
                value={option}
                className={({ focus, selected }) =>
                  `relative cursor-pointer select-none py-2 pl-9 pr-4 ${
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
                    data-testid={
                      testId ? `${testId}-option-${option}` : undefined
                    }
                  >
                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                      <span
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          selected
                            ? "border-violet-500 bg-violet-600"
                            : "border-slate-600 bg-slate-800"
                        }`}
                      >
                        {selected && (
                          <Check
                            className="h-3 w-3 text-white"
                            aria-hidden="true"
                          />
                        )}
                      </span>
                    </span>
                    <span
                      className={`block truncate ${
                        selected ? "font-medium" : "font-normal"
                      }`}
                    >
                      {option}
                    </span>
                  </span>
                )}
              </ListboxOption>
            ))
          )}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
