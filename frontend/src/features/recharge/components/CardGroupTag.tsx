import { cardGroupLabel } from "../utils/cardGroupLabel";

/**
 * Small tag at the right of the title row on a card that has artwork (the
 * title stays on the left, like cards without artwork) — the artwork
 * replaces the subcategory line, so without it a plain name like "20$" or
 * "1GB" loses which group it is in. Never shrinks; cut at a fixed 7rem — a percentage max-width resolved against the content-sized title row and collapsed the tag to nothing.
 */
export function CardGroupTag({
  item,
}: {
  item: { category: string; subcategory: string };
}) {
  const label = cardGroupLabel(item);
  if (!label) return null;
  return (
    <span
      title={label}
      className="ms-auto shrink-0 max-w-28 truncate rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-300"
    >
      {label}
    </span>
  );
}
