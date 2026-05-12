/**
 * SaveAsClientCheckbox
 *
 * Small inline checkbox shown under a name field to save
 * the entered name+phone as a new client in the clients table.
 */

import { UserPlus } from "lucide-react";

interface SaveAsClientCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Hide the checkbox entirely (e.g. when a client is already selected) */
  hidden?: boolean;
}

export function SaveAsClientCheckbox({
  checked,
  onChange,
  hidden,
}: SaveAsClientCheckboxProps) {
  if (hidden) return null;

  return (
    <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-500 hover:text-white transition-colors mt-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-600 bg-slate-900 text-teal-500 focus:ring-teal-500 focus:ring-offset-0 h-3 w-3"
      />
      <UserPlus size={12} />
      Save as client
    </label>
  );
}
