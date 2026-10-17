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
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DirIcon } from "./DirIcon";

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
  /**
   * How an option is shown. Defaults to the option string itself. Lets a
   * caller keep stable option KEYS as values (and in test ids) while showing
   * a friendly label — e.g. the OMT covered-types picker (LIRA-322).
   */
  getOptionLabel?: (option: string) => ReactNode;
  /**
   * Optional sections. When given, each group is a collapsible header
   * (collapsed by default) with its own checkbox that ticks or clears every
   * option in it; options not in any group are listed after. Absent = the
   * flat list, as before, so existing callers are unchanged.
   */
  groups?: { label: string; options: string[] }[];
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
  getOptionLabel,
  groups,
}: MultiSelectProps) {
  const { t } = useTranslation("ui");
  const count = values.length;
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleGroupOpen = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  /**
   * `flat`: the original look (checkbox on the left) — every caller without
   * `groups`. `top` / `child`: the grouped list, checkbox on the right;
   * `child` rows are indented under their group header.
   */
  const renderOption = (
    option: string,
    layout: "flat" | "top" | "child" = "flat",
  ) => {
    const box = (selected: boolean) => (
      <span
        className={`flex h-4 w-4 items-center justify-center rounded border ${
          selected
            ? "border-violet-500 bg-violet-600"
            : "border-slate-600 bg-slate-800"
        }`}
      >
        {selected && <Check className="h-3 w-3 text-white" aria-hidden="true" />}
      </span>
    );
    const pad =
      layout === "flat"
        ? "ps-9 pe-4"
        : layout === "top"
          ? "ps-3 pe-10"
          : "ps-[2.125rem] pe-10";
    return (
      <ListboxOption
        key={option}
        value={option}
        data-testid={testId ? `${testId}-option-${option}` : undefined}
        className={({ focus, selected }) =>
          `relative cursor-pointer select-none py-2 ${pad} ${
            focus
              ? "bg-violet-500/20 text-white"
              : selected
                ? "bg-slate-800 text-white"
                : "text-slate-300"
          }`
        }
      >
        {({ selected }) => (
          <span>
            <span
              className={`pointer-events-none absolute inset-y-0 flex items-center ${
                layout === "flat" ? "start-0 ps-2.5" : "end-0 pe-3"
              }`}
            >
              {box(selected)}
            </span>
            <span
              className={`block truncate ${
                selected ? "font-medium" : "font-normal"
              }`}
            >
              {getOptionLabel ? getOptionLabel(option) : option}
            </span>
          </span>
        )}
      </ListboxOption>
    );
  };

  const renderGroups = (list: { label: string; options: string[] }[]) => {
    const grouped = new Set(list.flatMap((g) => g.options));
    const rest = options.filter((o) => !grouped.has(o));
    return (
      <>
        {list.map((g) => {
          // A one-item group needs no header: show the item on its own.
          if (g.options.length === 1) return renderOption(g.options[0], "top");
          const ticked = g.options.filter((o) => values.includes(o)).length;
          const allOn = ticked === g.options.length;
          const someOn = ticked > 0 && !allOn;
          const isOpen = openGroups.has(g.label);
          const toggleAll = () =>
            onChange(
              allOn
                ? values.filter((v) => !g.options.includes(v))
                : [
                    ...values,
                    ...g.options.filter((o) => !values.includes(o)),
                  ],
            );
          return (
            <div key={g.label} role="group" aria-label={g.label}>
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-slate-900 ps-1.5 pe-3 py-2 border-t border-slate-800 first:border-t-0">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={t(
                    isOpen ? "multiSelect.collapse" : "multiSelect.expand",
                    { label: g.label },
                  )}
                  data-testid={
                    testId ? `${testId}-group-toggle-${g.label}` : undefined
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroupOpen(g.label);
                  }}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-200"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <DirIcon
                      icon={ChevronRight}
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                  )}
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroupOpen(g.label);
                  }}
                  className="flex flex-1 items-center justify-between gap-2 text-start"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {g.label}
                  </span>
                  {ticked > 0 && (
                    <span className="text-[11px] font-mono text-violet-300">
                      {ticked}/{g.options.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={allOn ? true : someOn ? "mixed" : false}
                  aria-label={t("multiSelect.selectAll", { label: g.label })}
                  data-testid={
                    testId ? `${testId}-group-${g.label}` : undefined
                  }
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAll();
                  }}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    allOn || someOn
                      ? "border-violet-500 bg-violet-600"
                      : "border-slate-600 bg-slate-800"
                  }`}
                >
                  {allOn ? (
                    <Check className="h-3 w-3 text-white" aria-hidden="true" />
                  ) : someOn ? (
                    <Minus className="h-3 w-3 text-white" aria-hidden="true" />
                  ) : null}
                </button>
              </div>
              {isOpen && g.options.map((o) => renderOption(o, "child"))}
            </div>
          );
        })}
        {rest.map((o) => renderOption(o, "top"))}
      </>
    );
  };

  return (
    <Listbox value={values} onChange={onChange} multiple disabled={disabled}>
      <div className={`relative ${className}`}>
        <ListboxButton
          data-testid={testId}
          className={`
            relative w-full cursor-pointer rounded-lg
            bg-slate-900 border border-slate-700
            py-2 ps-3 pe-10 text-start text-white text-sm
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
                    <span className="ms-1.5 inline-flex items-center justify-center rounded bg-violet-600/30 px-1.5 py-0.5 text-xs font-medium text-violet-300">
                      {count}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400">{label}</span>
                )}
              </span>
              <span className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-2.5">
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
              {t("multiSelect.noOptions")}
            </div>
          ) : (
            groups ? (
              renderGroups(groups)
            ) : (
              options.map((o) => renderOption(o))
            )
          )}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}
