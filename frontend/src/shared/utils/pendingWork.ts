/**
 * "Is the cashier in the middle of something?" — read by the web app's
 * auto-reload (useAutoReloadOnNewVersion) so a newer build never wipes work
 * in progress (owner rule 2026-11-28: reload only when nothing is selected
 * and no data is entered in fields).
 *
 * Two sources:
 *  1. Selections held in app state that a reload would lose (the Mobile
 *     Recharge basket, the POS cart): the owner registers them with
 *     {@link usePendingWork}. A customer session's cart is saved on the
 *     server and survives a reload, so it does not register.
 *  2. Fields the cashier typed into: any input / textarea / select whose
 *     value differs from what it held when the cashier first focused it.
 *     Prefilled fields (rates, dates) count only once edited, and a field
 *     cleared after a sale (or removed with its page) stops counting.
 */
import { useEffect } from "react";

const holders = new Set<symbol>();
const touched = new Map<Element, string>();

/** Register app-state work a reload would lose, while `active` is true. */
export function usePendingWork(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const token = Symbol("pending-work");
    holders.add(token);
    return () => {
      holders.delete(token);
    };
  }, [active]);
}

const NON_ENTRY_INPUT_TYPES = new Set([
  "button",
  "submit",
  "reset",
  "hidden",
  "image",
  "file",
  "range",
  "color",
]);

/** The comparable value of an entry field, or null for anything else. */
function entryValue(el: EventTarget | null): string | null {
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.value;
  if (el instanceof HTMLInputElement) {
    if (NON_ENTRY_INPUT_TYPES.has(el.type)) return null;
    if (el.type === "checkbox" || el.type === "radio")
      return String(el.checked);
    return el.value;
  }
  return null;
}

function onFocusIn(e: FocusEvent): void {
  const el = e.target as Element | null;
  if (!el || touched.has(el)) return;
  const value = entryValue(el);
  if (value !== null) touched.set(el, value);
}

/** Start watching which fields the cashier types into. Returns a stop. */
export function startFieldTracking(): () => void {
  document.addEventListener("focusin", onFocusIn, true);
  return () => {
    document.removeEventListener("focusin", onFocusIn, true);
    touched.clear();
  };
}

function hasEditedField(): boolean {
  let edited = false;
  for (const [el, initial] of touched) {
    if (!el.isConnected) {
      touched.delete(el);
      continue;
    }
    if (entryValue(el) !== initial) edited = true;
  }
  return edited;
}

/** True while a reload would lose something the cashier selected or typed. */
export function hasPendingWork(): boolean {
  return holders.size > 0 || hasEditedField();
}
