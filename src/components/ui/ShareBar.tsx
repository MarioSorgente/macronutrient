import { cn } from "@/components/ui/cn";

export type Slice = {
  label: string;
  value: number;
  /** A background utility class, e.g. "bg-basil". */
  tone: string;
};

/**
 * A proportion bar in plain divs, with its legend underneath.
 *
 * Same policy as MiniBars: the app carries no charting dependency and the macro
 * energy split in MacroSummary is already a hand-rolled stacked bar, so a
 * pickup-versus-delivery split does not justify pulling one in. Shares this
 * shape with that bar deliberately, so the two read as the same product.
 */
export default function ShareBar({
  slices,
  format = (n) => String(Math.round(n)),
  className,
}: {
  slices: Slice[];
  format?: (value: number) => string;
  className?: string;
}) {
  const total = slices.reduce((n, slice) => n + slice.value, 0);
  const pct = (value: number) => (total ? (value / total) * 100 : 0);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-cream-deep"
        role="img"
        aria-label={
          total
            ? slices
                .map(
                  (slice) =>
                    `${slice.label}: ${format(slice.value)} (${Math.round(pct(slice.value))}%)`
                )
                .join(", ")
            : "Nothing to show yet"
        }
      >
        {slices.map((slice) => (
          <span
            key={slice.label}
            className={slice.tone}
            style={{ width: `${pct(slice.value)}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-charcoal-soft">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-1.5">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", slice.tone)} />
            <span className="text-charcoal">{slice.label}</span>
            <b className="font-700 tabular-nums text-charcoal">
              {format(slice.value)}
            </b>
            <span className="tabular-nums">
              {Math.round(pct(slice.value))}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
