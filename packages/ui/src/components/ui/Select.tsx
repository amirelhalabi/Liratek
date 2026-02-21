import { Fragment } from "react";
import { Listbox, Transition } from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";

interface SelectOption {
  value: string;
  label: string;
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
}: SelectProps) {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <Listbox value={value} onChange={onChange}>
      {({ open }) => (
        <div className={`relative ${className}`}>
          <Listbox.Button
            className={`
              relative w-full cursor-pointer rounded-lg 
              bg-slate-900 border border-slate-700 
              py-2.5 pl-3 pr-10 text-left text-white text-sm
              outline-none focus:outline-none focus:border-slate-700
              transition-all
              ${buttonClassName}
            `}
          >
            <span className="block truncate">
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronDown
                className={`h-5 w-5 text-slate-400 transition-transform ${
                  open ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </span>
          </Listbox.Button>
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Listbox.Options
              className={`
                absolute z-10 mt-1 max-h-60 w-full overflow-auto 
                rounded-lg bg-slate-900 border border-slate-700 
                py-1 shadow-lg ring-1 ring-black ring-opacity-5 
                focus:outline-none text-sm
                ${optionsClassName}
              `}
            >
              {options.map((option) => (
                <Listbox.Option
                  key={option.value}
                  value={option.value}
                  className={({ active, selected }) =>
                    `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                      active
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
                          selected ? "font-medium" : "font-normal"
                        }`}
                      >
                        {option.label}
                      </span>
                      {selected ? (
                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-violet-400">
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </span>
                      ) : null}
                    </>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      )}
    </Listbox>
  );
}
