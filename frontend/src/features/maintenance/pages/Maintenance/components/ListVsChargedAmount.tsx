/**
 * Renders a maintenance job amount: `charged` alone, or the list price struck
 * through next to it when the job was discounted (LIRA-185 D6). Which figure
 * is which is decided by `getLabourAmounts` in `./jobAmounts`.
 */
interface ListVsChargedProps {
  list: number;
  charged: number;
  discounted: boolean;
  format: (amount: number) => string;
}

export function ListVsCharged({
  list,
  charged,
  discounted,
  format,
}: ListVsChargedProps) {
  if (!discounted) return <>{format(charged)}</>;
  return (
    <span title={`List price ${format(list)}, charged ${format(charged)}`}>
      <s className="text-slate-500 font-normal">{format(list)}</s>
      <span aria-hidden="true" className="mx-1 text-slate-500">
        →
      </span>
      <span>{format(charged)}</span>
    </span>
  );
}
