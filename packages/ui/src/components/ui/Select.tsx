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
          className={`
            z-50 min-w-[var(--button-width)] max-h-60 overflow-auto
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
